import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

let db: PGlite;
const game = randomUUID();
const otherGame = randomUUID();
const team = randomUUID();
const otherTeam = randomUUID();
const round = randomUUID();
const question = "10000000-0000-4000-8000-000000000001";

beforeAll(async () => {
	db = new PGlite();
	const directory = new URL("../../migrations/", import.meta.url);
	for (const file of (await readdir(directory))
		.filter((name) => name.endsWith(".sql"))
		.sort()) {
		await db.exec(await readFile(new URL(file, directory), "utf8"));
	}
});

afterAll(async () => {
	if (db) await db.close();
});

it("loads the 5,400-question bank with valid topics, windows and typed keys", async () => {
	const seed = await readFile(
		new URL("../../seeds/questions.sql", import.meta.url),
		"utf8",
	);
	await db.exec(seed);
	const { rows } = await db.query<{
		id: string;
		type: string;
		choices: string[] | null;
		correct_answer: string | boolean | number;
		source_title: string;
		source_url: string;
		is_active: boolean;
		topic_id: string;
		answer_window_seconds: number;
	}>(
		"SELECT id, type, choices, correct_answer, source_title, source_url, is_active, topic_id, answer_window_seconds FROM questions ORDER BY id",
	);
	expect(rows).toHaveLength(5400);
	for (const topic of [
		"world",
		"thailand",
		"food",
		"weird",
		"nature",
		"science",
		"taylor-swift",
		"breaking-bad",
		"marvel",
		"logic",
		"lateral",
		"probability",
		"estimate",
		"harry-potter",
		"history",
		"sports",
		"video-games",
		"nba",
	]) {
		const topicRows = rows.filter((row) => row.topic_id === topic);
		expect(topicRows, `${topic} bank size`).toHaveLength(300);
		expect(
			topicRows.every(
				(row) =>
					row.answer_window_seconds ===
					(["logic", "lateral", "probability"].includes(topic) ? 180 : 60),
			),
		).toBe(true);
	}
	for (const row of rows) {
		expect(row.source_title.trim()).not.toBe("");
		expect(row.source_url).toMatch(/^https:\/\//);
		expect(row.is_active).toBe(true);
		if (row.type === "MULTIPLE_CHOICE") {
			expect(typeof row.correct_answer).toBe("string");
			expect(row.choices).toContain(row.correct_answer);
			expect(new Set(row.choices).size).toBe(row.choices?.length);
		} else {
			expect(row.choices).toBeNull();
			expect(typeof row.correct_answer).toBe(
				row.type === "TRUE_FALSE" ? "boolean" : "number",
			);
			if (row.type === "ESTIMATE")
				expect(Number.isFinite(row.correct_answer)).toBe(true);
		}
	}
	const answerPositionCounts = [0, 0, 0, 0];
	for (const row of rows.filter(
		(row) => row.id.startsWith("20000000-") && row.type === "MULTIPLE_CHOICE",
	)) {
		const position = row.choices?.indexOf(String(row.correct_answer)) ?? -1;
		expect(position, `answer position for ${row.id}`).toBeGreaterThanOrEqual(0);
		answerPositionCounts[position] += 1;
	}
	expect(
		Math.max(...answerPositionCounts) - Math.min(...answerPositionCounts),
	).toBeLessThanOrEqual(1);
	expect(rows.slice(0, 3)).toEqual([
		{
			id: "10000000-0000-4000-8000-000000000001",
			type: "MULTIPLE_CHOICE",
			topic_id: "science",
			answer_window_seconds: 60,
			choices: ["Earth", "Jupiter", "Neptune", "Saturn"],
			correct_answer: "Jupiter",
			source_title: "NASA: Jupiter Facts",
			source_url: "https://science.nasa.gov/jupiter/jupiter-facts/",
			is_active: true,
		},
		{
			id: "10000000-0000-4000-8000-000000000002",
			type: "TRUE_FALSE",
			topic_id: "science",
			answer_window_seconds: 60,
			choices: null,
			correct_answer: true,
			source_title: "NASA: Sun Facts",
			source_url: "https://science.nasa.gov/sun/facts/",
			is_active: true,
		},
		{
			id: "10000000-0000-4000-8000-000000000003",
			type: "ESTIMATE",
			topic_id: "science",
			answer_window_seconds: 60,
			choices: null,
			correct_answer: 165,
			source_title: "NASA: Neptune Facts",
			source_url: "https://science.nasa.gov/neptune/neptune-facts/",
			is_active: true,
		},
	]);
	const content = (
		await db.query<{ id: string; prompt: string; explanation: string }>(
			"SELECT id,prompt,explanation FROM questions ORDER BY id",
		)
	).rows;
	expect(content.slice(0, 3).map((row) => row.id)).toEqual([
		"10000000-0000-4000-8000-000000000001",
		"10000000-0000-4000-8000-000000000002",
		"10000000-0000-4000-8000-000000000003",
	]);
	expect(new Set(content.map((row) => row.prompt)).size).toBe(5400);
	for (const row of content) {
		expect(row.prompt.trim()).not.toBe("");
		expect(row.explanation.trim()).not.toBe("");
	}
	await db.query(
		"UPDATE questions SET explanation='Previously released wording' WHERE id=$1",
		[question],
	);
	const before = (await db.query("SELECT * FROM questions ORDER BY id")).rows;
	await db.exec(seed);
	expect((await db.query("SELECT * FROM questions ORDER BY id")).rows).toEqual(
		before,
	);
});

it("stores rounds and rejects duplicate game sequences", async () => {
	for (const [id, code] of [
		[game, "FIRST1"],
		[otherGame, "OTHER2"],
	]) {
		await db.query(
			"INSERT INTO games (id,name,join_code,host_token_hash,round_interval_seconds) VALUES ($1,'Trip',$2,$3,300)",
			[id, code, "0".repeat(64)],
		);
	}
	for (const [id, gameId] of [
		[team, game],
		[otherTeam, otherGame],
	]) {
		await db.query(
			"INSERT INTO car_teams (id,game_id,name,captain_token_hash) VALUES ($1,$2,'Car',$3)",
			[id, gameId, "1".repeat(64)],
		);
	}
	await insertRound(round, game, 1);
	await expect(insertRound(randomUUID(), game, 1)).rejects.toMatchObject({
		code: "23505",
		constraint: "rounds_game_sequence_key",
	});
	await insertRound(randomUUID(), otherGame, 1);
});

function insertRound(id: string, gameId: string, sequence: number) {
	return db.query(
		"INSERT INTO rounds (id,game_id,question_id,sequence,starts_at,ends_at,expected_team_count) VALUES ($1,$2,$3,$4,'2026-10-07T00:00:00Z','2026-10-07T00:01:00Z',1)",
		[id, gameId, question, sequence],
	);
}

function insertAnswer(
	roundId = round,
	gameId = game,
	teamId = team,
	value = '"Jupiter"',
) {
	return db.query(
		"INSERT INTO answers (id,game_id,round_id,car_team_id,value,submitted_at) VALUES ($1,$2,$3,$4,$5,'2026-10-07T00:00:30Z')",
		[randomUUID(), gameId, roundId, teamId, value],
	);
}

it("preserves the original answer on duplicate submission and allows the next round", async () => {
	await insertAnswer();
	const original = (
		await db.query("SELECT * FROM answers WHERE round_id = $1", [round])
	).rows;
	await expect(
		insertAnswer(round, game, team, '"Saturn"'),
	).rejects.toMatchObject({
		code: "23505",
		constraint: "answers_round_team_key",
	});
	expect(
		(await db.query("SELECT * FROM answers WHERE round_id = $1", [round])).rows,
	).toEqual(original);
	const second = randomUUID();
	await insertRound(second, game, 2);
	await insertAnswer(second);
});

it("rejects answers whose round or car belongs to another game", async () => {
	await expect(insertAnswer(round, game, otherTeam)).rejects.toMatchObject({
		code: "23503",
		constraint: "answers_team_game_fkey",
	});
	await expect(insertAnswer(round, otherGame, otherTeam)).rejects.toMatchObject(
		{ code: "23503", constraint: "answers_round_game_fkey" },
	);
});

it("prevents changes to submission identity, value and time while allowing grading", async () => {
	for (const assignment of [
		"id = gen_random_uuid()",
		`game_id = '${otherGame}'`,
		"round_id = gen_random_uuid()",
		`car_team_id = '${otherTeam}'`,
		`value = '"Saturn"'`,
		"submitted_at = submitted_at + interval '1 second'",
	]) {
		await expect(
			db.query(`UPDATE answers SET ${assignment} WHERE round_id = $1`, [round]),
		).rejects.toMatchObject({ code: "23514" });
	}
	await db.query(
		"UPDATE answers SET is_correct = true, points_awarded = 1 WHERE round_id = $1",
		[round],
	);
	expect(
		(
			await db.query(
				"SELECT value,is_correct,points_awarded FROM answers WHERE round_id = $1",
				[round],
			)
		).rows,
	).toEqual([{ value: "Jupiter", is_correct: true, points_awarded: 1 }]);
	await db.query(
		"UPDATE answers SET is_correct = NULL, points_awarded = NULL WHERE round_id = $1",
		[round],
	);
});

it("rejects invalid question types, answer-key shapes and missing attribution", async () => {
	for (const assignment of [
		"type = 'UNKNOWN'",
		"correct_answer = 'null'",
		"choices = '{}'",
		"correct_answer = 'true'",
		"source_title = ''",
		"source_url = ''",
	]) {
		await expect(
			db.query(`UPDATE questions SET ${assignment} WHERE id = $1`, [question]),
		).rejects.toMatchObject({ code: "23514" });
	}
	await expect(
		db.query(
			"UPDATE questions SET correct_answer = '42' WHERE type = 'TRUE_FALSE'",
		),
	).rejects.toMatchObject({ code: "23514" });
	await expect(
		db.query(
			"UPDATE questions SET correct_answer = 'true' WHERE type = 'ESTIMATE'",
		),
	).rejects.toMatchObject({ code: "23514" });
});

it("rejects invalid round state, timing, counts and point awards", async () => {
	for (const assignment of [
		"status = 'WAITING'",
		"sequence = 0",
		"expected_team_count = 0",
		"ends_at = starts_at",
		"status = 'REVEALED'",
		"revealed_at = starts_at",
	]) {
		await expect(
			db.query(`UPDATE rounds SET ${assignment} WHERE id = $1`, [round]),
		).rejects.toMatchObject({ code: "23514" });
	}
	await expect(
		db.query("UPDATE answers SET points_awarded = 2 WHERE round_id = $1", [
			round,
		]),
	).rejects.toMatchObject({ code: "23514" });
	await db.query(
		"UPDATE rounds SET status = 'REVEALED', revealed_at = ends_at WHERE id = $1",
		[round],
	);
});
