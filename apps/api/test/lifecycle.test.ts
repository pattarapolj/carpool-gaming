import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
	EndGameResponseSchema,
	GameSnapshotSchema,
	StartGameResponseSchema,
} from "../../../packages/contracts/src/index";
import { tick } from "../src/coordinator";
import { buildServer } from "../src/server";
import type { GameDb, Session } from "../src/services/auth";
import {
	createGame,
	getGameSnapshot,
	joinGame,
	startGame,
} from "../src/services/games-services";
import {
	leaveGame,
	lockAnswer,
	openDueRound,
	processDueGame,
	revealDueRound,
} from "../src/services/round-service";

let db: PGlite;
let storage: GameDb;
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
	await db.query(
		"INSERT INTO questions (id,type,prompt,choices,correct_answer,explanation,source_title,source_url,topic_id,answer_window_seconds) VALUES ('30000000-0000-4000-8000-000000000001','MULTIPLE_CHOICE','Test question','[\"Jupiter\",\"Earth\"]','\"Jupiter\"','Test question','Test source','https://example.com','science',60)",
	);
	storage = {
		query: (sql, values) => db.query(sql, values),
		transaction: (run) => db.transaction((tx) => run(tx)),
		end: async () => {},
	};
});
afterAll(async () => db.close());

async function fixture(count = 2, playing = true) {
	const created = await createGame(
		{ name: "Trip", roundIntervalSeconds: 300 },
		storage,
	);
	await db.query(
		"UPDATE games SET selected_topics=ARRAY['science'] WHERE id=$1",
		[created.game.id],
	);
	await db.query("UPDATE questions SET is_active=(id=$1 OR id=$2)", [
		"10000000-0000-4000-8000-000000000001",
		"30000000-0000-4000-8000-000000000001",
	]);
	const host: Session = { gameId: created.game.id, role: "HOST" };
	const captains: Session[] = [];
	const tokens: string[] = [];
	for (let i = 0; i < count; i++) {
		const team = await joinGame(
			created.game.joinCode,
			{ name: `Car ${i}` },
			storage,
		);
		captains.push({
			gameId: created.game.id,
			role: "CAPTAIN",
			teamId: team.team.id,
		});
		tokens.push(team.captainToken);
	}
	if (playing) await startGame(created.game.id, count === 1, host, storage);
	const snapshot = await getGameSnapshot(created.game.id, host, storage);
	const origin = new Date(snapshot.game.startedAt ?? snapshot.serverTime);
	const at = (seconds: number) => () =>
		new Date(origin.getTime() + seconds * 1000);
	return {
		...created,
		gameId: created.game.id,
		host,
		captains,
		tokens,
		snapshot,
		at,
	};
}

it.each([
	[false, 0],
	[false, 2],
	[true, 2],
] as const)(
	"host ends lobby/open game and repeat preserves final state (playing %s, cars %s)",
	async (playing, count) => {
		const f = await fixture(count, playing);
		if (f.snapshot.round)
			await lockAnswer(
				f.snapshot.round.id,
				{ value: "Jupiter" },
				f.captains[0],
				storage,
				f.at(1),
			);
		const app = buildServer(storage);
		try {
			const end = () =>
				app.inject({
					method: "POST",
					url: `/v1/games/${f.gameId}/end`,
					headers: { authorization: `Bearer ${f.hostToken}` },
				});
			const first = await end();
			expect(first.statusCode).toBe(200);
			expect(EndGameResponseSchema.safeParse(first.json()).success).toBe(true);
			expect(first.json()).toMatchObject({
				game: {
					id: f.gameId,
					status: "COMPLETE",
					completionReason: "HOST_ENDED",
					completedAt: expect.any(String),
				},
				leaderboard: count
					? expect.arrayContaining([
							expect.objectContaining({ score: playing ? 1 : 0 }),
							expect.objectContaining({ score: 0 }),
						])
					: [],
			});
			expect(first.json().leaderboard).toHaveLength(count);
			const repeated = await end();
			expect(repeated.statusCode).toBe(200);
			expect(repeated.json()).toEqual(first.json());
			const final = GameSnapshotSchema.parse(
				await getGameSnapshot(f.gameId, f.host, storage),
			);
			expect(final.game).toMatchObject({
				status: "COMPLETE",
				nextRoundAt: null,
				completionReason: "HOST_ENDED",
			});
			expect(final.round?.status ?? null).toBe(playing ? "REVEALED" : null);
			if (final.round) {
				await expect(
					lockAnswer(
						final.round.id,
						{ value: "Earth" },
						f.captains[0],
						storage,
					),
				).rejects.toMatchObject({ code: "ANSWER_ALREADY_LOCKED" });
				await expect(
					lockAnswer(
						final.round.id,
						{ value: "Jupiter" },
						f.captains[1],
						storage,
					),
				).rejects.toMatchObject({ code: "ROUND_NOT_OPEN" });
			}
		} finally {
			await app.close();
		}
	},
);

it("host end after results preserves scores and automatic completion survives repeated host end", async () => {
	const f = await fixture(1);
	assert(f.snapshot.round);
	await lockAnswer(
		f.snapshot.round.id,
		{ value: "Jupiter" },
		f.captains[0],
		storage,
		f.at(1),
	);
	// End the immediately opened successor after the injected answer clock.
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(f.at(2)());
	const app = buildServer(storage);
	try {
		const result = await app.inject({
			method: "POST",
			url: `/v1/games/${f.gameId}/end`,
			headers: { authorization: `Bearer ${f.hostToken}` },
			payload: {},
		});
		expect(result.statusCode).toBe(200);
		expect(result.json().leaderboard[0].score).toBe(1);
		const automatic = await fixture(1);
		assert(automatic.snapshot.round);
		await revealDueRound(
			automatic.snapshot.round.id,
			storage,
			automatic.at(60),
		);
		await leaveGame(automatic.gameId, automatic.captains[0], storage);
		await tick(storage, automatic.at(61));
		const completed = (
			await getGameSnapshot(automatic.gameId, automatic.host, storage)
		).game;
		const repeated = await app.inject({
			method: "POST",
			url: `/v1/games/${automatic.gameId}/end`,
			headers: { authorization: `Bearer ${automatic.hostToken}` },
			payload: {},
		});
		expect(repeated.json().game).toMatchObject({
			completedAt: completed.completedAt,
			completionReason: "NO_ACTIVE_TEAMS",
		});
	} finally {
		await app.close();
		vi.useRealTimers();
	}
});

it("host-end grading and completion failure roll back together before retry", async () => {
	const f = await fixture();
	assert(f.snapshot.round);
	await lockAnswer(
		f.snapshot.round.id,
		{ value: "Jupiter" },
		f.captains[0],
		storage,
		f.at(1),
	);
	await db.exec(
		"CREATE FUNCTION fail_complete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='COMPLETE' THEN RAISE EXCEPTION 'completion failed'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_complete BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION fail_complete()",
	);
	const app = buildServer(storage);
	try {
		const result = await app.inject({
			method: "POST",
			url: `/v1/games/${f.gameId}/end`,
			headers: { authorization: `Bearer ${f.hostToken}` },
			payload: {},
		});
		expect(result.statusCode).toBe(500);
		const unchanged = await getGameSnapshot(f.gameId, f.host, storage);
		expect(unchanged.game).toMatchObject({
			status: "WAITING",
			completedAt: null,
		});
		expect(unchanged.round?.status).toBe("OPEN");
		expect(unchanged.leaderboard.map((t) => t.score)).toEqual([0, 0]);
	} finally {
		await db.exec(
			"DROP TRIGGER fail_complete ON games; DROP FUNCTION fail_complete()",
		);
		await app.close();
	}
	const retry = buildServer(storage);
	try {
		const result = await retry.inject({
			method: "POST",
			url: `/v1/games/${f.gameId}/end`,
			headers: { authorization: `Bearer ${f.hostToken}` },
			payload: {},
		});
		expect(result.statusCode).toBe(200);
		expect(
			result.json().leaderboard.map((t: { score: number }) => t.score),
		).toEqual([1, 0]);
	} finally {
		await retry.close();
	}
});

it("automatic overlap prefers time limit, then no ACTIVE teams over bank exhaustion", async () => {
	const f = await fixture(1);
	assert(f.snapshot.round);
	await leaveGame(f.gameId, f.captains[0], storage);
	await db.query("UPDATE questions SET is_active=false");
	try {
		await tick(storage, f.at(7200));
		expect(
			(await getGameSnapshot(f.gameId, f.host, storage)).game.completionReason,
		).toBe("TIME_LIMIT");
	} finally {
		await db.query("UPDATE questions SET is_active=true");
	}
	const next = await fixture(1);
	assert(next.snapshot.round);
	await leaveGame(next.gameId, next.captains[0], storage);
	await db.query("UPDATE questions SET is_active=false");
	try {
		const reveal = await revealDueRound(
			next.snapshot.round.id,
			storage,
			next.at(60),
		);
		expect(reveal?.completion?.game.completionReason).toBe("NO_ACTIVE_TEAMS");
	} finally {
		await db.query("UPDATE questions SET is_active=true");
	}
});

it("coordinator returns the committed completion when its clock crosses the limit after reveal", async () => {
	const f = await fixture();
	assert(f.snapshot.round);
	await db.query("UPDATE rounds SET ends_at=$2 WHERE id=$1", [
		f.snapshot.round.id,
		f.at(7199.999)(),
	]);
	let reads = 0;
	const transition = await processDueGame(f.gameId, storage, () =>
		f.at(++reads === 1 ? 7199.999 : 7200)(),
	);
	expect(transition?.completion?.game.completionReason).toBe("TIME_LIMIT");
	expect(transition?.reveal?.nextRoundAt).toBeNull();
});

it("end enforces authentication, owning host, strict body, missing game and safe errors", async () => {
	const f = await fixture(1, false);
	const other = await fixture(0, false);
	const app = buildServer(storage);
	try {
		for (const [token, gameId, payload, status, code] of [
			[undefined, f.gameId, {}, 401, "UNAUTHENTICATED"],
			["invalid", f.gameId, {}, 401, "UNAUTHENTICATED"],
			[f.tokens[0], f.gameId, {}, 403, "FORBIDDEN"],
			[other.hostToken, f.gameId, {}, 403, "FORBIDDEN"],
			[f.hostToken, randomUUID(), {}, 404, "GAME_NOT_FOUND"],
			[f.hostToken, "not-uuid", {}, 404, "GAME_NOT_FOUND"],
			[f.hostToken, f.gameId, { extra: true }, 422, "VALIDATION_ERROR"],
			[f.hostToken, f.gameId, null, 422, "VALIDATION_ERROR"],
		] as const) {
			const result = await app.inject({
				method: "POST",
				url: `/v1/games/${gameId}/end`,
				headers: {
					"content-type": "application/json",
					...(token ? { authorization: `Bearer ${token}` } : {}),
				},
				payload: JSON.stringify(payload),
			});
			expect(result.statusCode).toBe(status);
			expect(result.json()).toMatchObject({
				error: { code, requestId: expect.any(String) },
			});
		}
		const malformed = await app.inject({
			method: "POST",
			url: `/v1/games/${f.gameId}/end`,
			headers: {
				authorization: `Bearer ${f.hostToken}`,
				"content-type": "application/json",
			},
			payload: '{"bad":',
		});
		expect(malformed.statusCode).toBe(400);
		expect(malformed.json().error.code).toBe("MALFORMED_JSON");
		expect((await getGameSnapshot(f.gameId, f.host, storage)).game.status).toBe(
			"LOBBY",
		);
	} finally {
		await app.close();
	}
	const broken = buildServer({
		...storage,
		transaction: async () => {
			throw new Error("private SQL token secret");
		},
	});
	try {
		const result = await broken.inject({
			method: "POST",
			url: `/v1/games/${f.gameId}/end`,
			headers: { authorization: `Bearer ${f.hostToken}` },
			payload: {},
		});
		expect(result.statusCode).toBe(500);
		expect(result.json().error.code).toBe("INTERNAL_ERROR");
		expect(result.body).not.toMatch(/private SQL|secret/);
	} finally {
		await broken.close();
	}
});

it("caps ACTIVE lobby cars at 20, retains duplicate precedence, and LEFT frees capacity", async () => {
	const f = await fixture(20, false);
	await expect(
		joinGame(f.game.joinCode, { name: "Car 20" }, storage),
	).rejects.toMatchObject({ code: "GAME_FULL", statusCode: 409 });
	await expect(
		joinGame(f.game.joinCode, { name: "Car 0" }, storage),
	).rejects.toMatchObject({ code: "TEAM_NAME_TAKEN" });
	await leaveGame(f.gameId, f.captains[0], storage);
	await expect(
		joinGame(f.game.joinCode, { name: "Car 0" }, storage),
	).rejects.toMatchObject({ code: "TEAM_NAME_TAKEN" });
	await joinGame(f.game.joinCode, { name: "Replacement" }, storage);
	expect((await getGameSnapshot(f.gameId, f.host, storage)).teams).toHaveLength(
		20,
	);
	await startGame(f.gameId, false, f.host, storage);
	await expect(
		joinGame(f.game.joinCode, { name: "Car 0" }, storage),
	).rejects.toMatchObject({ code: "GAME_NOT_JOINABLE" });
});

it.each([45, 60])(
	"does not open a shortened %s-second final window and waits until two hours",
	async (window) => {
		const f = await fixture();
		assert(f.snapshot.round);
		await revealDueRound(f.snapshot.round.id, storage, f.at(60));
		await db.query("UPDATE questions SET answer_window_seconds=$1", [window]);
		expect(
			await openDueRound(f.gameId, storage, f.at(7200 - window + 0.001)),
		).toBeNull();
		await tick(storage, f.at(7199.999));
		expect(
			(await getGameSnapshot(f.gameId, f.host, storage)).game,
		).toMatchObject({
			status: "WAITING",
			completionReason: null,
		});
		const transitions = await tick(storage, f.at(7200));
		expect(transitions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					completion: expect.objectContaining({
						game: expect.objectContaining({
							id: f.gameId,
							completionReason: "TIME_LIMIT",
							completedAt: f.at(7200)().toISOString(),
						}),
					}),
				}),
			]),
		);
		const final = await getGameSnapshot(f.gameId, f.host, storage);
		expect(final.game).toMatchObject({
			status: "COMPLETE",
			nextRoundAt: null,
			completionReason: "TIME_LIMIT",
		});
		expect(final.round?.sequence).toBe(1);
	},
);

it.each([45, 60])(
	"accepts a full %s-second window ending exactly at the limit and reveals at the limit",
	async (window) => {
		const f = await fixture();
		assert(f.snapshot.round);
		await revealDueRound(f.snapshot.round.id, storage, f.at(60));
		await db.query(
			"UPDATE questions SET is_active=(id='10000000-0000-4000-8000-000000000002'),answer_window_seconds=$1",
			[window],
		);
		const opened = await openDueRound(f.gameId, storage, f.at(7200 - window));
		assert(opened);
		expect(opened.round.endsAt).toBe(f.at(7200)().toISOString());
		await lockAnswer(
			opened.round.id,
			{ value: true },
			f.captains[0],
			storage,
			f.at(7200 - window + 1),
		);
		await tick(storage, f.at(7200));
		const final = await getGameSnapshot(f.gameId, f.host, storage);
		expect(final.game.completionReason).toBe("TIME_LIMIT");
		expect(final.round?.status).toBe("REVEALED");
		expect(final.leaderboard.map((t) => t.score)).toEqual([1, 0]);
	},
);

it("rejects answers at hard limit after lock waits before the coordinator runs", async () => {
	const f = await fixture();
	assert(f.snapshot.round);
	await db.query("UPDATE rounds SET ends_at=$2 WHERE id=$1", [
		f.snapshot.round.id,
		f.at(7300)(),
	]);
	let now = f.at(7199.999)();
	const waiting: GameDb = {
		...storage,
		transaction: (run) =>
			storage.transaction((tx) =>
				run({
					query: async (sql, values) => {
						const result = await tx.query(sql, values);
						if (sql.includes("FOR UPDATE")) now = f.at(7200)();
						return result;
					},
				}),
			),
	};
	await expect(
		lockAnswer(
			f.snapshot.round.id,
			{ value: "Jupiter" },
			f.captains[0],
			waiting,
			() => now,
		),
	).rejects.toMatchObject({ code: "ROUND_EXPIRED" });
	await tick(storage, f.at(7200));
	expect((await getGameSnapshot(f.gameId, f.host, storage)).round?.status).toBe(
		"REVEALED",
	);
});

it("empty active bank starts durably COMPLETE with nullable next time", async () => {
	const f = await fixture(2, false);
	await db.query("UPDATE questions SET is_active=false");
	try {
		const started = await startGame(f.gameId, false, f.host, storage);
		expect(started).toMatchObject({
			status: "COMPLETE",
			startedAt: expect.anything(),
			nextRoundAt: null,
		});
		expect(
			StartGameResponseSchema.safeParse({
				game: {
					...started,
					startedAt: new Date(started.startedAt).toISOString(),
				},
			}).success,
		).toBe(true);
		expect(
			(await getGameSnapshot(f.gameId, f.host, storage)).game.completionReason,
		).toBe("QUESTION_BANK_EXHAUSTED");
	} finally {
		await db.query("UPDATE questions SET is_active=true");
	}
});

it("final bank reveal completes in the scoring transaction without phantom next round", async () => {
	const f = await fixture(2, false);
	await db.query(
		"UPDATE questions SET is_active=(id='10000000-0000-4000-8000-000000000001')",
	);
	await startGame(f.gameId, false, f.host, storage);
	const snapshot = await getGameSnapshot(f.gameId, f.host, storage);
	assert(snapshot.round);
	try {
		await lockAnswer(
			snapshot.round.id,
			{ value: "Jupiter" },
			f.captains[0],
			storage,
			f.at(1),
		);
		const last = await lockAnswer(
			snapshot.round.id,
			{ value: "Earth" },
			f.captains[1],
			storage,
			f.at(2),
		);
		expect(last.reveal).toMatchObject({
			nextRoundAt: null,
			completion: {
				game: {
					status: "COMPLETE",
					completionReason: "QUESTION_BANK_EXHAUSTED",
				},
			},
		});
		expect(
			(await getGameSnapshot(f.gameId, f.host, storage)).leaderboard.map(
				(t) => t.score,
			),
		).toEqual([1, 0]);
	} finally {
		await db.query("UPDATE questions SET is_active=true");
	}
});

it("zero ACTIVE cars preserve OPEN deadline then complete; without OPEN complete immediately", async () => {
	const f = await fixture(1);
	assert(f.snapshot.round);
	await leaveGame(f.gameId, f.captains[0], storage);
	await tick(storage, f.at(59.999));
	expect((await getGameSnapshot(f.gameId, f.host, storage)).game.status).toBe(
		"WAITING",
	);
	await tick(storage, f.at(60));
	const final = await getGameSnapshot(f.gameId, f.host, storage);
	expect(final.game.completionReason).toBe("NO_ACTIVE_TEAMS");
	expect(final.round?.status).toBe("REVEALED");
	expect(final.leaderboard[0]).toMatchObject({ status: "LEFT", score: 0 });
	const next = await fixture(1);
	assert(next.snapshot.round);
	await revealDueRound(next.snapshot.round.id, storage, next.at(60));
	await leaveGame(next.gameId, next.captains[0], storage);
	await tick(storage, next.at(61));
	expect(
		(await getGameSnapshot(next.gameId, next.host, storage)).game
			.completionReason,
	).toBe("NO_ACTIVE_TEAMS");
});

it("legacy COMPLETE keeps unknown completion metadata null on snapshot and repeated end", async () => {
	const f = await fixture(0, false);
	await db.query(
		"UPDATE games SET status='COMPLETE',next_round_at=NULL WHERE id=$1",
		[f.gameId],
	);
	expect((await getGameSnapshot(f.gameId, f.host, storage)).game).toMatchObject(
		{ completedAt: null, completionReason: null },
	);
	const app = buildServer(storage);
	try {
		const end = await app.inject({
			method: "POST",
			url: `/v1/games/${f.gameId}/end`,
			headers: { authorization: `Bearer ${f.hostToken}` },
			payload: {},
		});
		expect(end.statusCode).toBe(200);
		expect(end.json().game).toMatchObject({
			completedAt: null,
			completionReason: null,
		});
	} finally {
		await app.close();
	}
});
