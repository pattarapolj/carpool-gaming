import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type GameDb, hashToken, type Session } from "../src/services/auth";
import { getGameSnapshot } from "../src/services/games-services";
import * as engine from "../src/services/round-service";

let db: PGlite;
let storage: GameDb;
const origin = new Date("2026-10-07T10:00:00Z");
const at = (seconds: number) => () =>
	new Date(origin.getTime() + seconds * 1000);

beforeAll(async () => {
	db = new PGlite();
	for (const file of (await readdir(new URL("../migrations/", import.meta.url)))
		.filter((name) => name.endsWith(".sql"))
		.sort()) {
		await db.exec(
			await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
		);
	}
	await db.exec(
		await readFile(new URL("../seeds/questions.sql", import.meta.url), "utf8"),
	);
	storage = {
		query: (sql, values) => db.query(sql, values),
		end: () => db.close(),
		transaction: (run) => db.transaction((tx) => run(tx)),
	};
});
afterAll(async () => {
	await db.close();
});

async function game(count = 3) {
	const gameId = randomUUID();
	await db.query(
		"INSERT INTO games (id,name,join_code,host_token_hash,status,round_interval_seconds,started_at,next_round_at) VALUES ($1,'Trip',$2,$3,'WAITING',300,$4,$4)",
		[gameId, gameId.slice(0, 6), hashToken(gameId), origin],
	);
	const sessions: Session[] = [];
	for (let i = 0; i < count; i++) {
		const teamId = randomUUID();
		await db.query(
			"INSERT INTO car_teams (id,game_id,name,captain_token_hash) VALUES ($1,$2,$3,$4)",
			[teamId, gameId, `Car ${i}`, hashToken(teamId)],
		);
		sessions.push({ gameId, teamId, role: "CAPTAIN" });
	}
	return { gameId, sessions };
}

it("opens one public round immediately with a full window and fixed schedule", async () => {
	const { gameId } = await game();
	const opened = await Promise.all([
		engine.openDueRound(gameId, storage, at(0)),
		engine.openDueRound(gameId, storage, at(0)),
	]);
	expect(opened.filter(Boolean)).toHaveLength(1);
	expect(opened.find(Boolean)).toMatchObject({
		gameId,
		round: {
			sequence: 1,
			startsAt: "2026-10-07T10:00:00.000Z",
			endsAt: "2026-10-07T10:01:00.000Z",
			question: { type: "MULTIPLE_CHOICE" },
		},
		nextRoundAt: "2026-10-07T10:05:00.000Z",
	});
	expect(JSON.stringify(opened)).not.toMatch(
		/correct_answer|correctAnswer|source_url|sourceTitle|explanation|token/i,
	);
	const stored = await db.query<{
		expected_team_count: number;
		expected_team_ids: string[];
	}>(
		"SELECT expected_team_count,expected_team_ids FROM rounds WHERE game_id=$1",
		[gameId],
	);
	expect(stored.rows[0].expected_team_count).toBe(3);
	expect(stored.rows[0].expected_team_ids).toHaveLength(3);
});

it("starts the next round on the final confirmed answer and retains results after refresh", async () => {
	const { gameId, sessions } = await game(2);
	const first = await engine.openDueRound(gameId, storage, at(0));
	assert(first);
	const pending = await engine.lockAnswer(
		first.round.id,
		{ value: "Jupiter" },
		sessions[0],
		storage,
		at(1),
	);
	expect(pending.reveal).toBeNull();
	const final = await engine.lockAnswer(
		first.round.id,
		{ value: "Earth" },
		sessions[1],
		storage,
		at(2),
	);
	expect(final).toMatchObject({
		reveal: { roundId: first.round.id },
		opened: {
			round: {
				sequence: 2,
				startsAt: "2026-10-07T10:00:02.000Z",
				endsAt: "2026-10-07T10:01:02.000Z",
			},
		},
	});
	const refreshed = await getGameSnapshot(gameId, sessions[0], storage);
	expect(refreshed).toMatchObject({
		round: { status: "OPEN", sequence: 2 },
		previousRound: {
			id: first.round.id,
			status: "REVEALED",
			correctAnswer: "Jupiter",
			results: expect.arrayContaining([
				expect.objectContaining({
					teamId: sessions[0].teamId,
					pointsAwarded: 1,
				}),
			]),
		},
		ownAnswer: null,
	});
	expect(await engine.processDueGame(gameId, storage, at(2))).toMatchObject({
		opened: null,
		reveal: null,
	});
	await expect(
		engine.lockAnswer(
			first.round.id,
			{ value: "Jupiter" },
			sessions[1],
			storage,
			at(2),
		),
	).rejects.toMatchObject({ code: "ANSWER_ALREADY_LOCKED" });
	expect(
		(await getGameSnapshot(gameId, sessions[0], storage)).leaderboard.map(
			(t) => t.score,
		),
	).toEqual([1, 0]);
});

it("scores correct, wrong and unanswered teams atomically at the exact deadline", async () => {
	const { gameId, sessions } = await game();
	const opened = await engine.openDueRound(gameId, storage, at(0));
	assert(opened);
	const id = opened.round.id;
	await engine.lockAnswer(
		id,
		{ value: "Jupiter" },
		sessions[0],
		storage,
		at(1),
	);
	await engine.lockAnswer(id, { value: "Earth" }, sessions[1], storage, at(2));
	expect(await engine.revealDueRound(id, storage, at(59.999))).toBeNull();
	await expect(
		engine.lockAnswer(id, { value: "Jupiter" }, sessions[2], storage, at(60)),
	).rejects.toMatchObject({ code: "ROUND_EXPIRED" });
	const reveal = await engine.revealDueRound(id, storage, at(60));
	expect(reveal).toMatchObject({
		gameId,
		roundId: id,
		correctAnswer: "Jupiter",
		nextRoundAt: "2026-10-07T10:05:00.000Z",
	});
	expect(reveal?.results).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				teamId: sessions[0].teamId,
				pointsAwarded: 1,
				isCorrect: true,
				value: "Jupiter",
			}),
			expect.objectContaining({
				teamId: sessions[1].teamId,
				pointsAwarded: 0,
				isCorrect: false,
				value: "Earth",
			}),
			expect.objectContaining({
				teamId: sessions[2].teamId,
				pointsAwarded: 0,
				isCorrect: false,
				value: null,
			}),
		]),
	);
	expect(reveal?.leaderboard.map((team) => team.score)).toEqual([1, 0, 0]);
	expect(await engine.revealDueRound(id, storage, at(61))).toBeNull();
});

it("reveals on all answers, scores booleans and closest estimate ties once", async () => {
	const { gameId, sessions } = await game();
	await db.query(
		"UPDATE questions SET is_active=(id <= '10000000-0000-4000-8000-000000000003')",
	);
	try {
		let opened = await engine.openDueRound(gameId, storage, at(0));
		for (const [index, values, points] of [
			[0, ["Jupiter", "Earth", "Earth"], [1, 0, 0]],
			[1, [true, false, false], [1, 0, 0]],
			[2, [155, 175, 195], [1, 1, 0]],
		] as const) {
			assert(opened);
			const id = opened.round.id;
			const answers = await Promise.all(
				sessions.map((session, i) =>
					engine.lockAnswer(
						id,
						{ value: values[i] },
						session,
						storage,
						at(index + 1),
					),
				),
			);
			expect(answers.filter((answer) => answer.reveal)).toHaveLength(1);
			const reveal = answers.find((answer) => answer.reveal)?.reveal;
			assert(reveal);
			for (let i = 0; i < 3; i++)
				expect(
					reveal.results?.find((result) => result.teamId === sessions[i].teamId)
						?.pointsAwarded,
				).toBe(points[i]);
			expect(reveal.nextRoundAt).toBe(
				index === 2 ? null : at(index + 1)().toISOString(),
			);
			expect(
				await engine.revealDueRound(id, storage, at(index + 2)),
			).toBeNull();
			opened = answers.find((answer) => answer.opened)?.opened ?? null;
		}
		const scores = await db.query<{ score: number }>(
			"SELECT score FROM car_teams WHERE game_id=$1 ORDER BY name",
			[gameId],
		);
		expect(scores.rows.map((team) => team.score)).toEqual([3, 1, 0]);
		expect(await engine.openDueRound(gameId, storage, at(900))).toBeNull();
	} finally {
		await db.query("UPDATE questions SET is_active=true");
	}
});

it("keeps an unanswered left team in this round but excludes it from the next", async () => {
	const { gameId, sessions } = await game(2);
	const opened = await engine.openDueRound(gameId, storage, at(0));
	assert(opened);
	await engine.leaveGame(gameId, sessions[1], storage);
	await engine.leaveGame(gameId, sessions[1], storage);
	await expect(
		engine.lockAnswer(
			opened.round.id,
			{ value: "Jupiter" },
			sessions[1],
			storage,
			at(1),
		),
	).rejects.toMatchObject({ code: "TEAM_LEFT" });
	const answer = await engine.lockAnswer(
		opened.round.id,
		{ value: "Jupiter" },
		sessions[0],
		storage,
		at(1),
	);
	expect(answer.reveal).toBeNull();
	const reveal = await engine.revealDueRound(opened.round.id, storage, at(60));
	expect(reveal?.results).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				teamId: sessions[1].teamId,
				value: null,
				pointsAwarded: 0,
			}),
		]),
	);
	await engine.openDueRound(gameId, storage, at(300));
	const counts = await db.query<{ expected_team_count: number }>(
		"SELECT expected_team_count FROM rounds WHERE game_id=$1 ORDER BY sequence",
		[gameId],
	);
	expect(counts.rows.map((row) => row.expected_team_count)).toEqual([2, 1]);
});

it("skips missed slots, opens one fresh window and retains anchored boundaries", async () => {
	const { gameId } = await game(1);
	const first = await engine.openDueRound(gameId, storage, at(941));
	assert(first);
	expect(first).toMatchObject({
		round: {
			sequence: 1,
			startsAt: "2026-10-07T10:15:41.000Z",
			endsAt: "2026-10-07T10:16:41.000Z",
		},
		nextRoundAt: "2026-10-07T10:20:00.000Z",
	});
	expect(await engine.openDueRound(gameId, storage, at(1001))).toBeNull();
	await engine.revealDueRound(first.round.id, storage, at(1001));
	expect(await engine.openDueRound(gameId, storage, at(1199))).toBeNull();
	expect(await engine.openDueRound(gameId, storage, at(1200))).toMatchObject({
		round: { sequence: 2 },
		nextRoundAt: "2026-10-07T10:25:00.000Z",
	});
});

it("serializes duplicate answers and overlapping reveal attempts without double points", async () => {
	const { gameId, sessions } = await game(1);
	const opened = await engine.openDueRound(gameId, storage, at(0));
	assert(opened);
	const id = opened.round.id;
	const attempts = await Promise.allSettled([
		engine.lockAnswer(id, { value: "Jupiter" }, sessions[0], storage, at(59)),
		engine.lockAnswer(id, { value: "Earth" }, sessions[0], storage, at(59)),
		engine.revealDueRound(id, storage, at(60)),
		engine.revealDueRound(id, storage, at(60)),
	]);
	expect(attempts[0].status).toBe("fulfilled");
	expect(attempts[1]).toMatchObject({
		status: "rejected",
		reason: { code: "ANSWER_ALREADY_LOCKED" },
	});
	const answer = await db.query(
		"SELECT value,points_awarded FROM answers WHERE round_id=$1",
		[id],
	);
	expect(answer.rows).toEqual([{ value: "Jupiter", points_awarded: 1 }]);
	const score = await db.query("SELECT score FROM car_teams WHERE id=$1", [
		sessions[0].teamId,
	]);
	expect(score.rows).toEqual([{ score: 1 }]);
});

it("rolls back grades, scores, reveal and the final answer when scoring fails", async () => {
	const { gameId, sessions } = await game(2);
	const opened = await engine.openDueRound(gameId, storage, at(0));
	assert(opened);
	await engine.lockAnswer(
		opened.round.id,
		{ value: "Jupiter" },
		sessions[0],
		storage,
		at(1),
	);
	await db.exec(
		"ALTER TABLE car_teams ADD CONSTRAINT test_no_points CHECK(score=0) NOT VALID",
	);
	try {
		await expect(
			engine.lockAnswer(
				opened.round.id,
				{ value: "Jupiter" },
				sessions[1],
				storage,
				at(2),
			),
		).rejects.toBeDefined();
		const rows = await db.query(
			"SELECT status,revealed_at FROM rounds WHERE id=$1",
			[opened.round.id],
		);
		expect(rows.rows).toEqual([{ status: "OPEN", revealed_at: null }]);
		const answers = await db.query(
			"SELECT is_correct,points_awarded FROM answers WHERE round_id=$1",
			[opened.round.id],
		);
		expect(answers.rows).toEqual([{ is_correct: null, points_awarded: null }]);
	} finally {
		await db.exec("ALTER TABLE car_teams DROP CONSTRAINT test_no_points");
	}
	const last = await engine.lockAnswer(
		opened.round.id,
		{ value: "Jupiter" },
		sessions[1],
		storage,
		at(2),
	);
	expect(last.reveal?.leaderboard.map((team) => team.score)).toEqual([1, 1]);
});

it("samples the answer clock after lock waiting", async () => {
	const { gameId, sessions } = await game(2);
	const opened = await engine.openDueRound(gameId, storage, at(0));
	assert(opened);
	let now = at(59)();
	const waiting: GameDb = {
		...storage,
		transaction: (run) =>
			storage.transaction((tx) =>
				run({
					query: async (sql, values) => {
						const result = await tx.query(sql, values);
						if (sql.includes("FOR UPDATE")) now = at(60)();
						return result;
					},
				}),
			),
	};
	await expect(
		engine.lockAnswer(
			opened.round.id,
			{ value: "Jupiter" },
			sessions[0],
			waiting,
			() => now,
		),
	).rejects.toMatchObject({ code: "ROUND_EXPIRED" });
});

it("completes without active teams and safely does nothing in a non-playing game", async () => {
	const empty = await game(0);
	expect(await engine.openDueRound(empty.gameId, storage, at(0))).toBeNull();
	const { gameId } = await game(1);
	await db.query("UPDATE games SET status='COMPLETE' WHERE id=$1", [gameId]);
	expect(await engine.openDueRound(gameId, storage, at(0))).toBeNull();
});

it("keeps a locked answer eligible for scoring after the team leaves", async () => {
	const { gameId, sessions } = await game(2);
	const opened = await engine.openDueRound(gameId, storage, at(0));
	assert(opened);
	await engine.lockAnswer(
		opened.round.id,
		{ value: "Jupiter" },
		sessions[0],
		storage,
		at(59.999),
	);
	await engine.leaveGame(gameId, sessions[0], storage);
	const reveal = await engine.revealDueRound(opened.round.id, storage, at(60));
	expect(reveal?.results).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ teamId: sessions[0].teamId, pointsAwarded: 1 }),
		]),
	);
});

it("chooses only active unused questions and awards the single closest estimate without numeric overflow", async () => {
	const { gameId, sessions } = await game(2);
	await db.query(
		"UPDATE questions SET is_active=(id='10000000-0000-4000-8000-000000000003')",
		[],
	);
	try {
		await db.query(
			"UPDATE questions SET correct_answer=$1::jsonb WHERE id='10000000-0000-4000-8000-000000000003'",
			[JSON.stringify(-Number.MAX_VALUE)],
		);
		const opened = await engine.openDueRound(gameId, storage, at(0));
		assert(opened);
		expect(opened.round.question.type).toBe("ESTIMATE");
		await engine.lockAnswer(
			opened.round.id,
			{ value: Number.MAX_VALUE },
			sessions[0],
			storage,
			at(1),
		);
		const final = await engine.lockAnswer(
			opened.round.id,
			{ value: Number.MAX_VALUE / 2 },
			sessions[1],
			storage,
			at(1),
		);
		expect(
			final.reveal?.results
				?.filter((result) => result.pointsAwarded === 1)
				.map((result) => result.teamId),
		).toEqual([sessions[1].teamId]);
		expect(await engine.openDueRound(gameId, storage, at(300))).toBeNull();
	} finally {
		await db.query(
			"UPDATE questions SET correct_answer='165'::jsonb WHERE id='10000000-0000-4000-8000-000000000003'",
			[],
		);
		await db.query("UPDATE questions SET is_active=true", []);
	}
});

it("serializes leave before opening and an answer so LEFT cannot regain eligibility", async () => {
	const { gameId, sessions } = await game(2);
	const [left, opened] = await Promise.all([
		engine.leaveGame(gameId, sessions[1], storage),
		engine.openDueRound(gameId, storage, at(0)),
	]);
	expect(left.team.status).toBe("LEFT");
	assert(opened);
	const roster = await db.query(
		"SELECT expected_team_count,expected_team_ids FROM rounds WHERE id=$1",
		[opened.round.id],
	);
	expect(roster.rows).toEqual([
		{ expected_team_count: 1, expected_team_ids: [sessions[0].teamId] },
	]);
	const [leave, answer] = await Promise.allSettled([
		engine.leaveGame(gameId, sessions[0], storage),
		engine.lockAnswer(
			opened.round.id,
			{ value: "Jupiter" },
			sessions[0],
			storage,
			at(1),
		),
	]);
	expect(leave.status).toBe("fulfilled");
	expect(answer).toMatchObject({
		status: "rejected",
		reason: { code: "TEAM_LEFT" },
	});
});

it("rejects a persisted participant count mismatch", async () => {
	const { gameId } = await game(2);
	const opened = await engine.openDueRound(gameId, storage, at(0));
	assert(opened);
	await expect(
		db.query(
			"UPDATE rounds SET expected_team_ids=ARRAY[]::uuid[] WHERE id=$1",
			[opened.round.id],
		),
	).rejects.toMatchObject({ code: "23514" });
});
