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
	const extraQuestions = [randomUUID(), randomUUID()];
	// Keep existing gameplay assertions deterministic; focused topic tests opt in
	// to additional rows explicitly.
	await db.query(
		"UPDATE questions SET is_active=(id='10000000-0000-4000-8000-000000000001')",
	);
	for (const [index, id] of extraQuestions.entries())
		await db.query(
			"INSERT INTO questions (id,type,prompt,choices,correct_answer,explanation,source_title,source_url,topic_id,answer_window_seconds) VALUES ($1,'MULTIPLE_CHOICE',$2,'[\"Jupiter\",\"Earth\"]','\"Jupiter\"','Test question','Test source','https://example.com','science',60)",
			[id, `Test question ${index}`],
		);
	await db.query(
		"UPDATE questions SET is_active=(id=$1 OR id=ANY($2::uuid[]))",
		["10000000-0000-4000-8000-000000000001", extraQuestions],
	);
	await db.query(
		"INSERT INTO games (id,name,join_code,host_token_hash,status,round_interval_seconds,started_at,next_round_at,selected_topics) VALUES ($1,'Trip',$2,$3,'WAITING',300,$4,$4,ARRAY['science'])",
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

it("chooses unused active questions only from saved topics and exhausts that pool", async () => {
	const { gameId } = await game(1);
	const ids = [
		"10000000-0000-4000-8000-000000000001",
		"10000000-0000-4000-8000-000000000002",
		"10000000-0000-4000-8000-000000000003",
	];
	await db.query("UPDATE questions SET is_active=(id=ANY($1::uuid[]))", [ids]);
	await db.query(
		"UPDATE questions SET topic_id=CASE WHEN id=$1 OR id=$2 THEN 'science' ELSE 'world' END,answer_window_seconds=60 WHERE id=ANY($3::uuid[])",
		[ids[0], ids[1], ids],
	);
	try {
		const first = await engine.openDueRound(gameId, storage, at(0));
		assert(first);
		await engine.revealDueRound(first.round.id, storage, at(60));
		const second = await engine.openDueRound(gameId, storage, at(300));
		assert(second);
		await engine.revealDueRound(second.round.id, storage, at(360));
		assert.equal(await engine.openDueRound(gameId, storage, at(360)), null);
		const state = await db.query(
			"SELECT status,completion_reason FROM games WHERE id=$1",
			[gameId],
		);
		expect(state.rows).toEqual([
			{ status: "COMPLETE", completion_reason: "QUESTION_BANK_EXHAUSTED" },
		]);
		const used = await db.query<{ question_id: string }>(
			"SELECT question_id FROM rounds WHERE game_id=$1",
			[gameId],
		);
		expect(new Set(used.rows.map((row) => row.question_id))).toEqual(
			new Set(ids.slice(0, 2)),
		);
	} finally {
		await db.query(
			"UPDATE questions SET topic_id='science',answer_window_seconds=60,is_active=true WHERE id=ANY($1::uuid[])",
			[ids],
		);
	}
});

it.each([
	["60-second", "10000000-0000-4000-8000-000000000001", 60],
	["180-second", "10000000-0000-4000-8000-000000000002", 180],
])(
	"uses the selected question's %s answer window",
	async (_label, id, seconds) => {
		const { gameId } = await game(1);
		await db.query("UPDATE questions SET is_active=(questions.id=$1)", [id]);
		await db.query(
			"UPDATE questions SET answer_window_seconds=$2 WHERE id=$1",
			[id, seconds],
		);
		try {
			const opened = await engine.openDueRound(gameId, storage, at(0));
			assert(opened);
			expect(opened.round.endsAt).toBe(
				new Date(origin.getTime() + seconds * 1000).toISOString(),
			);
		} finally {
			await db.query(
				"UPDATE questions SET answer_window_seconds=60,is_active=true",
			);
		}
	},
);

it("does not open a selected question whose full answer window crosses the game cap", async () => {
	const { gameId } = await game(1);
	const id = "10000000-0000-4000-8000-000000000002";
	await db.query(
		"UPDATE questions SET is_active=(questions.id=$1),answer_window_seconds=180",
		[id],
	);
	try {
		const opened = await engine.openDueRound(gameId, storage, at(7200 - 60));
		expect(opened).toBeNull();
		expect(
			(
				await db.query(
					"SELECT status,completion_reason FROM games WHERE id=$1",
					[gameId],
				)
			).rows,
		).toEqual([{ status: "WAITING", completion_reason: null }]);
		expect(
			(await db.query("SELECT id FROM rounds WHERE game_id=$1", [gameId])).rows,
		).toEqual([]);
		expect(await engine.openDueRound(gameId, storage, at(7200))).toBeNull();
		expect(
			(
				await db.query(
					"SELECT status,completion_reason FROM games WHERE id=$1",
					[gameId],
				)
			).rows,
		).toEqual([{ status: "COMPLETE", completion_reason: "TIME_LIMIT" }]);
	} finally {
		await db.query(
			"UPDATE questions SET answer_window_seconds=60,is_active=true",
		);
	}
});

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
	const cases = [
		[
			"10000000-0000-4000-8000-000000000001",
			["Jupiter", "Earth", "Earth"],
			[1, 0, 0],
		],
		["10000000-0000-4000-8000-000000000002", [true, false, false], [1, 0, 0]],
		["10000000-0000-4000-8000-000000000003", [155, 175, 195], [1, 1, 0]],
	] as const;
	try {
		for (const [questionId, values, points] of cases) {
			const { gameId, sessions } = await game();
			await db.query("UPDATE questions SET is_active=(id=$1)", [questionId]);
			const opened = await engine.openDueRound(gameId, storage, at(0));
			assert(opened);
			const answers = await Promise.all(
				sessions.map((session, i) =>
					engine.lockAnswer(
						opened.round.id,
						{ value: values[i] },
						session,
						storage,
						at(1),
					),
				),
			);
			expect(answers.filter((answer) => answer.reveal)).toHaveLength(1);
			const reveal = answers.find((answer) => answer.reveal)?.reveal;
			assert(reveal);
			expect(reveal.nextRoundAt).toBeNull();
			for (let i = 0; i < 3; i++)
				expect(
					reveal.results?.find((result) => result.teamId === sessions[i].teamId)
						?.pointsAwarded,
				).toBe(points[i]);
		}
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
		expect(answers.rows).toEqual([{ is_correct: true, points_awarded: 1 }]);
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
