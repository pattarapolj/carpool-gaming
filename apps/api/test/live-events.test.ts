import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
	AnswerLockedSchema,
	GameCompletedSchema,
	GameSnapshotSchema,
	GameUpdatedSchema,
	LiveSnapshotAckSchema,
	RoundRevealedSchema,
	RoundStartedSchema,
} from "../../../packages/contracts/src/index";
import { buildServer } from "../src/server";
import type { GameDb } from "../src/services/auth";
import { createGame, joinGame } from "../src/services/games-services";

let db: PGlite;
let storage: GameDb;
let app: ReturnType<typeof buildServer>;
let address: string;
const clients: Socket[] = [];
let failAuth = false;
let failSnapshot = false;
beforeAll(async () => {
	db = new PGlite();
	for (const file of (await readdir(new URL("../migrations/", import.meta.url)))
		.filter((name) => name.endsWith(".sql"))
		.sort())
		await db.exec(
			await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
		);
	await db.exec(
		await readFile(new URL("../seeds/questions.sql", import.meta.url), "utf8"),
	);
	storage = {
		query: (sql, values) => db.query(sql, values),
		transaction: (run) => db.transaction((tx) => run(tx)),
		end: () => db.close(),
	};
	app = buildServer({
		...storage,
		query: (sql, values) => {
			if (failAuth && sql.includes("host_token_hash = $1"))
				throw new Error("synthetic storage failure");
			return storage.query(sql, values);
		},
		transaction: (run) =>
			storage.transaction((tx) =>
				run({
					query: (sql, values) => {
						if (failSnapshot && sql.includes("FOR SHARE"))
							throw new Error("synthetic snapshot failure");
						return tx.query(sql, values);
					},
				}),
			),
	});
	address = await app.listen({ host: "127.0.0.1", port: 0 });
});
afterAll(async () => {
	await app.close();
	await settle();
	for (const client of clients) {
		expect(client.connected).toBe(false);
		client.disconnect();
	}
});
function client(token?: string) {
	const socket = io(address, {
		auth: { token },
		autoConnect: false,
		reconnection: false,
		timeout: 500,
	});
	clients.push(socket);
	return socket;
}
function event(socket: Socket, name: string) {
	return new Promise<unknown>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Missing ${name}`)), 2500);
		socket.once(name, (value) => {
			clearTimeout(timer);
			resolve(value);
		});
	});
}
async function connect(token: string) {
	const socket = client(token);
	const ready = event(socket, "connect");
	socket.connect();
	await ready;
	return socket;
}
async function fixture() {
	const created = await createGame(
		{ name: "Live trip", roundIntervalSeconds: 300 },
		storage,
	);
	const teams = [];
	for (let i = 0; i < 2; i++)
		teams.push(
			await joinGame(created.game.joinCode, { name: `Car ${i}` }, storage),
		);
	return { ...created, teams };
}
it("rejects missing and invalid auth safely on the actual listener", async () => {
	for (const token of [undefined, "invalid synthetic token"]) {
		const socket = client(token);
		const denied = event(socket, "connect_error");
		socket.connect();
		const failure = (await denied) as Error & { data: unknown };
		expect(failure.data).toMatchObject({
			error: { code: "UNAUTHENTICATED", requestId: expect.any(String) },
		});
		expect(JSON.stringify(failure.data)).not.toContain("synthetic");
		expect(socket.connected).toBe(false);
	}
});
it("acknowledges an atomic own-game view and rejects foreign subscriptions", async () => {
	const own = await fixture();
	const other = await fixture();
	const socket = await connect(own.hostToken);
	expect(
		await socket
			.timeout(1000)
			.emitWithAck("game.snapshot", { gameId: own.game.id }),
	).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
	const subscribed = await socket
		.timeout(1000)
		.emitWithAck("game.subscribe", { gameId: own.game.id });
	expect(subscribed).toMatchObject({
		ok: true,
		snapshot: {
			game: { id: own.game.id },
			ownAnswer: null,
			teams: own.teams.map((team) => team.team),
		},
	});
	const denied = await socket.timeout(1000).emitWithAck("game.subscribe", {
		gameId: other.game.id,
		teamId: other.teams[0].team.id,
	});
	expect(denied).toMatchObject({
		ok: false,
		error: { code: "VALIDATION_ERROR" },
	});
	expect(
		await socket
			.timeout(1000)
			.emitWithAck("game.subscribe", { gameId: other.game.id }),
	).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
	assert(socket.connected);
});

async function subscribe(token: string, gameId: string) {
	const socket = await connect(token);
	const ack = LiveSnapshotAckSchema.parse(
		await socket.timeout(1000).emitWithAck("game.subscribe", { gameId }),
	);
	assert(ack.ok);
	return socket;
}
function post(
	path: string,
	token: string,
	payload: Record<string, unknown> = {},
) {
	return app.inject({
		method: "POST",
		url: path,
		headers: { authorization: `Bearer ${token}` },
		payload,
	});
}
function record(socket: Socket, names: string[]) {
	const events: { name: string; value: unknown }[] = [];
	for (const name of names)
		socket.on(name, (value) => events.push({ name, value }));
	return events;
}
const liveNames = [
	"game.updated",
	"round.started",
	"answer.locked",
	"round.revealed",
	"game.completed",
];
async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 40));
}

it("publishes identical safe start/reveal data to host/captains and locks only the submitting team", async () => {
	const own = await fixture();
	const foreign = await fixture();
	const members = await Promise.all(
		[own.hostToken, ...own.teams.map((team) => team.captainToken)].map(
			(token) => subscribe(token, own.game.id),
		),
	);
	const outsider = await subscribe(foreign.hostToken, foreign.game.id);
	const foreignEvents = record(outsider, liveNames);
	const memberEvents = members.map((socket) => record(socket, liveNames));
	const starts = members.map((socket) => event(socket, "round.started"));
	const updates = members.map((socket) => event(socket, "game.updated"));
	const start = await post(`/v1/games/${own.game.id}/start`, own.hostToken);
	expect(start.statusCode).toBe(200);
	expect(Object.keys(start.json())).toEqual(["game"]);
	const opened = (await Promise.all(starts)).map((value) =>
		RoundStartedSchema.parse(value),
	);
	expect(opened[0]).toEqual(opened[1]);
	expect(opened[1]).toEqual(opened[2]);
	for (const value of await Promise.all(updates)) {
		expect(GameUpdatedSchema.parse(value).game.status).toBe("WAITING");
		expect(JSON.stringify(value)).not.toMatch(
			/token|hash|ownAnswer|correctAnswer|explanation/,
		);
	}
	expect(JSON.stringify(opened)).not.toMatch(
		/correctAnswer|explanation|token|hash/,
	);
	const roundId = opened[0].id;
	const locked = event(members[1], "answer.locked");
	const first = await post(
		`/v1/rounds/${roundId}/answers`,
		own.teams[0].captainToken,
		{ value: "Jupiter" },
	);
	expect(first.statusCode).toBe(200);
	expect(AnswerLockedSchema.parse(await locked)).toEqual({
		roundId,
		roundEndsAt: first.json().roundEndsAt,
	});
	const snapshot = LiveSnapshotAckSchema.parse(
		await members[2]
			.timeout(1000)
			.emitWithAck("game.snapshot", { gameId: own.game.id }),
	);
	assert(snapshot.ok);
	expect(snapshot.snapshot.ownAnswer).toBeNull();
	expect(JSON.stringify(snapshot.snapshot)).not.toMatch(
		/submittedAt|correctAnswer|explanation/,
	);
	const reveals = members.map((socket) => event(socket, "round.revealed"));
	const second = await post(
		`/v1/rounds/${roundId}/answers`,
		own.teams[1].captainToken,
		{ value: "Earth" },
	);
	expect(second.statusCode).toBe(200);
	expect(Object.keys(second.json()).sort()).toEqual([
		"answerId",
		"roundEndsAt",
		"status",
	]);
	const revealed = (await Promise.all(reveals)).map((value) =>
		RoundRevealedSchema.parse(value),
	);
	expect(revealed[0]).toEqual(revealed[1]);
	expect(revealed[1]).toEqual(revealed[2]);
	expect(revealed[0].correctAnswer).toBe("Jupiter");
	expect(revealed[0].results).toHaveLength(2);
	expect(revealed[0].leaderboard.map((team) => team.score)).toEqual([1, 0]);
	const replay = await post(
		`/v1/rounds/${roundId}/answers`,
		own.teams[1].captainToken,
		{ value: "Jupiter" },
	);
	expect(replay.statusCode).toBe(409);
	await db.query(
		"UPDATE rounds SET starts_at=now()-interval '2 seconds',ends_at=now()-interval '1 second' WHERE id=$1",
		[roundId],
	);
	await new Promise((resolve) => setTimeout(resolve, 1100));
	expect(
		memberEvents.map(
			(events) => events.filter((e) => e.name === "round.revealed").length,
		),
	).toEqual([1, 1, 1]);
	expect(memberEvents[0].filter((e) => e.name === "answer.locked")).toEqual([]);
	expect(
		memberEvents[1].filter((e) => e.name === "answer.locked"),
	).toHaveLength(1);
	expect(
		memberEvents[2].filter((e) => e.name === "answer.locked"),
	).toHaveLength(1);
	expect(foreignEvents).toEqual([]);
});

it("publishes lobby join/leave updates once and keeps LEFT read access on reconnect", async () => {
	const own = await fixture();
	const host = await subscribe(own.hostToken, own.game.id);
	const events = record(host, liveNames);
	const joinedEvent = event(host, "game.updated");
	const joined = await app.inject({
		method: "POST",
		url: `/v1/games/${own.game.joinCode}/teams`,
		payload: { name: "Third car" },
	});
	expect(joined.statusCode).toBe(201);
	expect(GameUpdatedSchema.parse(await joinedEvent).teams).toHaveLength(3);
	const token = joined.json().captainToken;
	const leaveEvent = event(host, "game.updated");
	expect((await post(`/v1/games/${own.game.id}/leave`, token)).statusCode).toBe(
		200,
	);
	expect(GameUpdatedSchema.parse(await leaveEvent).teams).toHaveLength(2);
	expect((await post(`/v1/games/${own.game.id}/leave`, token)).statusCode).toBe(
		200,
	);
	await settle();
	expect(events.filter((e) => e.name === "game.updated")).toHaveLength(2);
	const left = await subscribe(token, own.game.id);
	const snapshot = LiveSnapshotAckSchema.parse(
		await left
			.timeout(1000)
			.emitWithAck("game.snapshot", { gameId: own.game.id }),
	);
	assert(snapshot.ok);
	expect(snapshot.snapshot.callerTeam?.status).toBe("LEFT");
});

it("publishes forced host-end reveal/completion once and preserves exact end HTTP response", async () => {
	const own = await fixture();
	const socket = await subscribe(own.hostToken, own.game.id);
	await post(`/v1/games/${own.game.id}/start`, own.hostToken);
	const snapshot = GameSnapshotSchema.parse(
		(
			await app.inject({
				url: `/v1/games/${own.game.id}/snapshot`,
				headers: { authorization: `Bearer ${own.hostToken}` },
			})
		).json(),
	);
	assert(snapshot.round);
	await post(
		`/v1/rounds/${snapshot.round.id}/answers`,
		own.teams[0].captainToken,
		{ value: "Jupiter" },
	);
	const events = record(socket, liveNames);
	const revealed = event(socket, "round.revealed");
	const completed = event(socket, "game.completed");
	const response = await post(`/v1/games/${own.game.id}/end`, own.hostToken);
	const reveal = RoundRevealedSchema.parse(await revealed);
	const completion = GameCompletedSchema.parse(await completed);
	expect(completion).toEqual(response.json());
	expect(completion.game.completionReason).toBe("HOST_ENDED");
	expect(reveal.nextRoundAt).toBeNull();
	expect(
		reveal.results?.find((result) => result.teamId === own.teams[1].team.id)
			?.value,
	).toBeNull();
	expect(
		(await post(`/v1/games/${own.game.id}/end`, own.hostToken)).json(),
	).toEqual(response.json());
	await settle();
	expect(events.map((e) => e.name)).toEqual([
		"round.revealed",
		"game.completed",
	]);
	socket.disconnect();
	const reconnected = await subscribe(own.hostToken, own.game.id);
	const recovery = LiveSnapshotAckSchema.parse(
		await reconnected
			.timeout(1000)
			.emitWithAck("game.snapshot", { gameId: own.game.id }),
	);
	assert(recovery.ok);
	expect(recovery.snapshot.game.status).toBe("COMPLETE");
	expect(recovery.snapshot.round?.status).toBe("REVEALED");
});

it("deadline delivery reveals once and sends last-question completion from the same commit", async () => {
	const own = await fixture();
	const socket = await subscribe(own.hostToken, own.game.id);
	await post(`/v1/games/${own.game.id}/start`, own.hostToken);
	await settle();
	const rounds = await db.query<{ id: string }>(
		"SELECT id FROM rounds WHERE game_id=$1",
		[own.game.id],
	);
	const roundId = rounds.rows[0].id;
	await db.query(
		"UPDATE questions SET is_active=(id='10000000-0000-4000-8000-000000000001')",
	);
	try {
		const events = record(socket, liveNames);
		const revealed = event(socket, "round.revealed");
		const completed = event(socket, "game.completed");
		await db.query(
			"UPDATE rounds SET starts_at=now()-interval '2 seconds',ends_at=now()-interval '1 second' WHERE id=$1",
			[roundId],
		);
		const reveal = RoundRevealedSchema.parse(await revealed);
		const completion = GameCompletedSchema.parse(await completed);
		expect(reveal.roundId).toBe(roundId);
		expect(reveal.results?.map((result) => result.value)).toEqual([null, null]);
		expect(reveal.nextRoundAt).toBeNull();
		expect(completion.game.completionReason).toBe("QUESTION_BANK_EXHAUSTED");
		await settle();
		expect(events.map((e) => e.name)).toEqual([
			"round.revealed",
			"game.completed",
		]);
	} finally {
		await db.query("UPDATE questions SET is_active=true");
	}
});

it("a scoring rollback emits neither the final lock nor reveal/completion", async () => {
	const own = await fixture();
	await subscribe(own.hostToken, own.game.id);
	await post(`/v1/games/${own.game.id}/start`, own.hostToken);
	const rounds = await db.query<{ id: string }>(
		"SELECT id FROM rounds WHERE game_id=$1",
		[own.game.id],
	);
	const roundId = rounds.rows[0].id;
	await post(`/v1/rounds/${roundId}/answers`, own.teams[0].captainToken, {
		value: "Jupiter",
	});
	const captain = await subscribe(own.teams[1].captainToken, own.game.id);
	const events = record(captain, liveNames);
	await db.exec(
		"CREATE FUNCTION fail_live_score() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic scoring failure'; END; $$; CREATE TRIGGER fail_live_score BEFORE UPDATE OF score ON car_teams FOR EACH ROW EXECUTE FUNCTION fail_live_score()",
	);
	try {
		expect(
			(
				await post(`/v1/rounds/${roundId}/answers`, own.teams[1].captainToken, {
					value: "Jupiter",
				})
			).statusCode,
		).toBe(500);
		await settle();
		expect(events).toEqual([]);
		expect(
			(await db.query("SELECT id FROM answers WHERE round_id=$1", [roundId]))
				.rows,
		).toHaveLength(1);
	} finally {
		await db.exec(
			"DROP TRIGGER fail_live_score ON car_teams; DROP FUNCTION fail_live_score()",
		);
	}
});

it("a first-round rollback emits no start/update, and an empty bank start publishes completion", async () => {
	const own = await fixture();
	const socket = await subscribe(own.hostToken, own.game.id);
	const events = record(socket, liveNames);
	await db.exec(
		"CREATE FUNCTION fail_live_open() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic opening failure'; END; $$; CREATE TRIGGER fail_live_open BEFORE INSERT ON rounds FOR EACH ROW EXECUTE FUNCTION fail_live_open()",
	);
	try {
		expect(
			(await post(`/v1/games/${own.game.id}/start`, own.hostToken)).statusCode,
		).toBe(500);
		await settle();
		expect(events).toEqual([]);
		expect(
			(
				await db.query<{ status: string }>(
					"SELECT status FROM games WHERE id=$1",
					[own.game.id],
				)
			).rows[0].status,
		).toBe("LOBBY");
	} finally {
		await db.exec(
			"DROP TRIGGER fail_live_open ON rounds; DROP FUNCTION fail_live_open()",
		);
	}
	await db.exec("UPDATE questions SET is_active=false");
	try {
		const completed = event(socket, "game.completed");
		const response = await post(
			`/v1/games/${own.game.id}/start`,
			own.hostToken,
		);
		expect(response.statusCode).toBe(200);
		expect(response.json().game).toMatchObject({
			status: "COMPLETE",
			nextRoundAt: null,
		});
		expect(
			GameCompletedSchema.parse(await completed).game.completionReason,
		).toBe("QUESTION_BANK_EXHAUSTED");
		await settle();
		expect(events.map((e) => e.name)).toEqual([
			"game.completed",
			"game.updated",
		]);
	} finally {
		await db.exec("UPDATE questions SET is_active=true");
	}
});

it("preserves explicit unknown historical roster in the revealed event", async () => {
	const own = await fixture();
	const socket = await subscribe(own.hostToken, own.game.id);
	await post(`/v1/games/${own.game.id}/start`, own.hostToken);
	await db.query("UPDATE rounds SET expected_team_ids=NULL WHERE game_id=$1", [
		own.game.id,
	]);
	const revealed = event(socket, "round.revealed");
	await post(`/v1/games/${own.game.id}/end`, own.hostToken);
	expect(RoundRevealedSchema.parse(await revealed).results).toBeNull();
});

it("logs post-commit snapshot failure and preserves a successful durable join", async () => {
	const own = await fixture();
	const socket = await subscribe(own.hostToken, own.game.id);
	const events = record(socket, liveNames);
	const logged = vi.spyOn(app.log, "error");
	failSnapshot = true;
	try {
		const joined = await app.inject({
			method: "POST",
			url: `/v1/games/${own.game.joinCode}/teams`,
			payload: { name: "Durable car" },
		});
		expect(joined.statusCode).toBe(201);
		expect(
			(
				await db.query("SELECT id FROM car_teams WHERE game_id=$1", [
					own.game.id,
				])
			).rows,
		).toHaveLength(3);
		expect(logged).toHaveBeenCalledWith(
			expect.any(Error),
			"Live publication failed after commit",
		);
		await settle();
		expect(events).toEqual([]);
	} finally {
		failSnapshot = false;
		logged.mockRestore();
	}
	const ack = LiveSnapshotAckSchema.parse(
		await socket
			.timeout(1000)
			.emitWithAck("game.snapshot", { gameId: own.game.id }),
	);
	assert(ack.ok);
	expect(ack.snapshot.teams).toHaveLength(3);
});

it("transient auth queries produce safe INTERNAL_ERROR without misclassifying valid credentials", async () => {
	const own = await fixture();
	const socket = await subscribe(own.hostToken, own.game.id);
	failAuth = true;
	try {
		const denied = client(own.hostToken);
		const error = event(denied, "connect_error");
		denied.connect();
		expect(((await error) as { data: unknown }).data).toMatchObject({
			error: { code: "INTERNAL_ERROR" },
		});
		const ack = await socket
			.timeout(1000)
			.emitWithAck("game.snapshot", { gameId: own.game.id });
		expect(ack).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
		expect(JSON.stringify(ack)).not.toMatch(/synthetic|SELECT|hash/);
		expect(socket.connected).toBe(true);
	} finally {
		failAuth = false;
	}
	expect(
		await socket
			.timeout(1000)
			.emitWithAck("game.snapshot", { gameId: own.game.id }),
	).toMatchObject({ ok: true });
});

it("enforces the configured browser origin for polling and WebSockets", async () => {
	const own = await fixture();
	for (const transport of ["polling", "websocket"]) {
		const denied = io(address, {
			auth: { token: own.hostToken },
			autoConnect: false,
			reconnection: false,
			transports: [transport],
			extraHeaders: { Origin: "https://foreign.invalid" },
			timeout: 500,
		});
		clients.push(denied);
		const failure = event(denied, "connect_error");
		denied.connect();
		await failure;
		expect(denied.connected).toBe(false);
		const allowed = io(address, {
			auth: { token: own.hostToken },
			autoConnect: false,
			reconnection: false,
			transports: [transport],
			extraHeaders: { Origin: "http://localhost:5173" },
			timeout: 500,
		});
		clients.push(allowed);
		const ready = event(allowed, "connect");
		allowed.connect();
		await ready;
		expect(allowed.connected).toBe(true);
	}
});

it("joins rooms before snapshot acquisition so an event during subscribe cannot be missed", async () => {
	const own = await fixture();
	let release = () => {};
	let entered = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const observed = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let blockNext = false;
	const gated = buildServer({
		...storage,
		end: async () => {},
		transaction: async (run) => {
			if (blockNext) {
				blockNext = false;
				entered();
				await blocked;
			}
			return storage.transaction(run);
		},
	});
	const url = await gated.listen({ host: "127.0.0.1", port: 0 });
	const socket = io(url, {
		auth: { token: own.hostToken },
		autoConnect: false,
		reconnection: false,
	});
	try {
		const ready = event(socket, "connect");
		socket.connect();
		await ready;
		const updated = event(socket, "game.updated");
		blockNext = true;
		const subscribing = socket
			.timeout(2000)
			.emitWithAck("game.subscribe", { gameId: own.game.id });
		await observed;
		const joined = await gated.inject({
			method: "POST",
			url: `/v1/games/${own.game.joinCode}/teams`,
			payload: { name: "Between join and snapshot" },
		});
		expect(joined.statusCode).toBe(201);
		expect(GameUpdatedSchema.parse(await updated).teams).toHaveLength(3);
		release();
		const ack = LiveSnapshotAckSchema.parse(await subscribing);
		assert(ack.ok);
		expect(ack.snapshot.teams).toHaveLength(3);
	} finally {
		release();
		socket.disconnect();
		await gated.close();
	}
});

it("graceful restart permits automatic reconnect and a fresh subscribed snapshot", async () => {
	const own = await fixture();
	const shared = { ...storage, end: async () => {} };
	const first = buildServer(shared);
	const second = buildServer(shared);
	const url = await first.listen({ host: "127.0.0.1", port: 0 });
	const socket = io(url, {
		auth: { token: own.hostToken },
		autoConnect: false,
		transports: ["websocket"],
		reconnectionDelay: 20,
		reconnectionDelayMax: 50,
	});
	try {
		const ready = event(socket, "connect");
		socket.connect();
		await ready;
		const initial = LiveSnapshotAckSchema.parse(
			await socket
				.timeout(2000)
				.emitWithAck("game.subscribe", { gameId: own.game.id }),
		);
		assert(initial.ok);
		const disconnected = event(socket, "disconnect");
		await first.close();
		expect(await disconnected).toBe("transport close");
		const reconnected = event(socket, "connect");
		await second.listen({ host: "127.0.0.1", port: Number(new URL(url).port) });
		await reconnected;
		const recovered = LiveSnapshotAckSchema.parse(
			await socket
				.timeout(2000)
				.emitWithAck("game.subscribe", { gameId: own.game.id }),
		);
		assert(recovered.ok);
		expect(recovered.snapshot.game).toEqual(initial.snapshot.game);
		expect(recovered.snapshot.teams).toEqual(initial.snapshot.teams);
	} finally {
		socket.disconnect();
		await first.close();
		await second.close();
	}
});

it("close drains pending socket auth and snapshots before storage and stops new work", async () => {
	const own = await fixture();
	let release = () => {};
	let entered = () => {};
	let blocking = false;
	let blockedCalls = 0;
	let ended = false;
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const observed = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const gated = buildServer({
		...storage,
		end: async () => {
			ended = true;
		},
		query: async (sql, values) => {
			if (blocking) {
				if (++blockedCalls === 2) entered();
				await blocked;
			}
			return storage.query(sql, values);
		},
	});
	const url = await gated.listen({ host: "127.0.0.1", port: 0 });
	const socket = io(url, {
		auth: { token: own.hostToken },
		autoConnect: false,
		reconnection: false,
		transports: ["websocket"],
	});
	const pending = io(url, {
		auth: { token: own.hostToken },
		autoConnect: false,
		reconnection: false,
		transports: ["websocket"],
	});
	try {
		const ready = event(socket, "connect");
		socket.connect();
		await ready;
		await socket
			.timeout(1000)
			.emitWithAck("game.subscribe", { gameId: own.game.id });
		blocking = true;
		pending.connect();
		const snapshot = socket
			.timeout(2000)
			.emitWithAck("game.snapshot", { gameId: own.game.id })
			.catch(() => {});
		await observed;
		expect(blockedCalls).toBe(2);
		const closing = gated.close();
		await settle();
		expect(ended).toBe(false);
		expect(socket.connected).toBe(false);
		release();
		await closing;
		await snapshot;
		expect(ended).toBe(true);
		expect(pending.connected).toBe(false);
	} finally {
		release();
		socket.disconnect();
		pending.disconnect();
		await gated.close();
	}
});
