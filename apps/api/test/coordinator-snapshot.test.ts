import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { GameSnapshotSchema } from "../../../packages/contracts/src/index";
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
		end: () => db.close(),
	};
});
afterAll(async () => db.close());

async function fixture(count = 3) {
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
	for (let i = 0; i < count; i++) {
		const joined = await joinGame(
			created.game.joinCode,
			{ name: `Car ${i}` },
			storage,
		);
		captains.push({
			gameId: created.game.id,
			role: "CAPTAIN",
			teamId: joined.team.id,
		});
	}
	return {
		gameId: created.game.id,
		host,
		captains,
		hostToken: created.hostToken,
	};
}

it("successful start commits the first question immediately and advances the anchored schedule", async () => {
	const { gameId, host } = await fixture();
	const started = await startGame(gameId, false, host, storage);
	assert(started.nextRoundAt);
	const rounds = await db.query<{
		starts_at: Date;
		ends_at: Date;
		sequence: number;
	}>("SELECT starts_at,ends_at,sequence FROM rounds WHERE game_id=$1", [
		gameId,
	]);
	expect(rounds.rows).toHaveLength(1);
	expect(rounds.rows[0].sequence).toBe(1);
	expect(new Date(rounds.rows[0].starts_at).toISOString()).toBe(
		new Date(started.startedAt).toISOString(),
	);
	expect(
		new Date(started.nextRoundAt).getTime() -
			new Date(started.startedAt).getTime(),
	).toBe(300000);
});

it("failed first-round persistence rolls back the entire start", async () => {
	const { gameId, host } = await fixture();
	await db.exec(
		"CREATE FUNCTION fail_open() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'failed first question'; END; $$; CREATE TRIGGER fail_open BEFORE INSERT ON rounds FOR EACH ROW EXECUTE FUNCTION fail_open()",
	);
	try {
		await expect(startGame(gameId, false, host, storage)).rejects.toThrow(
			"failed first question",
		);
		expect((await getGameSnapshot(gameId, host, storage)).game).toMatchObject({
			status: "LOBBY",
			startedAt: null,
			nextRoundAt: null,
		});
		expect(
			(await db.query("SELECT id FROM rounds WHERE game_id=$1", [gameId])).rows,
		).toEqual([]);
	} finally {
		await db.exec(
			"DROP TRIGGER fail_open ON rounds; DROP FUNCTION fail_open()",
		);
	}
});

it("returns the full shared view through the authenticated HTTP snapshot route", async () => {
	const { gameId, host, hostToken } = await fixture();
	await startGame(gameId, false, host, storage);
	const app = buildServer({ ...storage, end: async () => {} });
	try {
		const response = await app.inject({
			method: "GET",
			url: `/v1/games/${gameId}/snapshot`,
			headers: { authorization: `Bearer ${hostToken}` },
		});
		expect(response.statusCode).toBe(200);
		const parsed = GameSnapshotSchema.parse(response.json());
		expect(parsed.round?.status).toBe("OPEN");
		expect(parsed.leaderboard).toHaveLength(3);
		expect(response.body).not.toMatch(/correctAnswer|explanation|hash|token/);
	} finally {
		await app.close();
	}
	await expect(
		getGameSnapshot(
			gameId,
			{ gameId, role: "CAPTAIN", teamId: host.gameId },
			storage,
		),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("refresh restores OPEN, caller-only locked answer, REVEALED results and competition ranks", async () => {
	const { gameId, host, captains } = await fixture();
	const lobby = await getGameSnapshot(gameId, host, storage);
	expect(lobby).toMatchObject({
		round: null,
		ownAnswer: null,
		callerTeam: null,
	});
	await startGame(gameId, false, host, storage);
	const opened = await getGameSnapshot(gameId, captains[0], storage);
	expect(GameSnapshotSchema.safeParse(opened).success).toBe(true);
	expect(opened).toMatchObject({
		round: {
			status: "OPEN",
			sequence: 1,
			question: { type: "MULTIPLE_CHOICE" },
		},
		ownAnswer: null,
		callerTeam: { id: captains[0].teamId },
	});
	expect(JSON.stringify(opened)).not.toMatch(
		/correctAnswer|explanation|token|hash/,
	);
	assert(opened.round);
	await lockAnswer(opened.round.id, { value: "Jupiter" }, captains[0], storage);
	const locked = await getGameSnapshot(gameId, captains[0], storage);
	expect(locked.ownAnswer).toMatchObject({
		value: "Jupiter",
		answerId: expect.any(String),
		submittedAt: expect.any(String),
	});
	for (const session of [host, captains[1]]) {
		const other = await getGameSnapshot(gameId, session, storage);
		expect(other.ownAnswer).toBeNull();
		expect(JSON.stringify(other)).not.toMatch(
			/Jupiter.*submittedAt|correctAnswer|explanation/,
		);
	}
	await lockAnswer(opened.round.id, { value: "Jupiter" }, captains[1], storage);
	await leaveGame(gameId, captains[2], storage);
	const reveal = await revealDueRound(
		opened.round.id,
		storage,
		() => new Date(opened.round?.endsAt ?? ""),
	);
	const recovered = await getGameSnapshot(gameId, captains[2], storage);
	expect(GameSnapshotSchema.safeParse(recovered).success).toBe(true);
	expect(recovered.round).toMatchObject({
		status: "REVEALED",
		correctAnswer: "Jupiter",
		results: expect.arrayContaining([
			expect.objectContaining({
				teamId: captains[2].teamId,
				value: null,
				isCorrect: false,
				pointsAwarded: 0,
			}),
		]),
	});
	expect(recovered.callerTeam?.status).toBe("LEFT");
	expect(recovered.teams).toHaveLength(2);
	expect(recovered.leaderboard.map((team) => [team.score, team.rank])).toEqual([
		[1, 1],
		[1, 1],
		[0, 3],
	]);
	expect(
		recovered.round?.status === "REVEALED" && recovered.round.results,
	).toEqual(reveal?.results);
	expect(recovered.leaderboard).toEqual(reveal?.leaderboard);
	await db.query("UPDATE games SET status='COMPLETE' WHERE id=$1", [gameId]);
	expect((await getGameSnapshot(gameId, host, storage)).round).toEqual(
		recovered.round,
	);
});

it("keeps the unrecorded historical results roster null", async () => {
	const { gameId, host } = await fixture(1);
	await startGame(gameId, true, host, storage);
	const opened = await getGameSnapshot(gameId, host, storage);
	assert(opened.round);
	await db.query("UPDATE rounds SET expected_team_ids=NULL WHERE id=$1", [
		opened.round.id,
	]);
	await revealDueRound(
		opened.round.id,
		storage,
		() => new Date(opened.round?.endsAt ?? ""),
	);
	expect((await getGameSnapshot(gameId, host, storage)).round).toMatchObject({
		status: "REVEALED",
		results: null,
	});
});

it("ticks reveal expired rounds once and automatically open the next anchored round", async () => {
	const { tick } = await import("../src/coordinator");
	const { gameId, host, captains } = await fixture(2);
	await startGame(gameId, false, host, storage);
	const snapshot = await getGameSnapshot(gameId, host, storage);
	assert(snapshot.round);
	const deadline = new Date(snapshot.round.endsAt);
	await lockAnswer(
		snapshot.round.id,
		{ value: "Jupiter" },
		captains[0],
		storage,
	);
	await tick(storage, () => new Date(deadline.getTime() - 1));
	expect((await getGameSnapshot(gameId, host, storage)).round?.status).toBe(
		"OPEN",
	);
	await Promise.all([
		tick(storage, () => deadline),
		tick(storage, () => deadline),
	]);
	const revealed = await getGameSnapshot(gameId, host, storage);
	expect(revealed.round?.status).toBe("REVEALED");
	expect(revealed.leaderboard.map((team) => team.score)).toEqual([1, 0]);
	await tick(storage, () => new Date(revealed.game.nextRoundAt ?? ""));
	expect((await getGameSnapshot(gameId, host, storage)).round).toMatchObject({
		status: "OPEN",
		sequence: 2,
	});
});

it("runtime retries logged tick failures, avoids overlap and drains before closing storage", async () => {
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	let calls = 0;
	let ended = false;
	const app = buildServer({
		...storage,
		query: async (sql, values) => {
			calls++;
			if (calls === 1) throw new Error("tick failure");
			await blocked;
			return storage.query(sql, values);
		},
		end: async () => {
			ended = true;
		},
	});
	const logged = vi.spyOn(app.log, "error");
	try {
		await app.listen({ host: "127.0.0.1", port: 0 });
		await vi.advanceTimersByTimeAsync(1000);
		expect(logged).toHaveBeenCalledWith(
			expect.any(Error),
			"Round coordinator tick failed",
		);
		vi.advanceTimersByTime(1000);
		await Promise.resolve();
		vi.advanceTimersByTime(3000);
		expect(calls).toBe(2);
		const closing = app.close();
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(ended).toBe(false);
		release();
		await closing;
		expect(ended).toBe(true);
		const finishedCalls = calls;
		await vi.advanceTimersByTimeAsync(5000);
		expect(calls).toBe(finishedCalls);
		expect(vi.getTimerCount()).toBe(0);
	} finally {
		release();
		await app.close();
		vi.useRealTimers();
	}
});
