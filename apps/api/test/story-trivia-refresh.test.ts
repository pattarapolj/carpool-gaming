import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { QuestionTopicIds } from "../../../packages/contracts/src";
import { loadMigrations } from "../src/migrations";
import type { GameDb } from "../src/services/auth";
import { lockAnswer } from "../src/services/round-service";

const topics = ["breaking-bad", "marvel", "harry-potter"];
const oldQuestionId = "46000000-0000-4000-8000-000000000002";
const gameId = randomUUID();
const teamId = randomUUID();
const roundId = randomUUID();
const now = new Date();
let db: PGlite;
let seed: string;
let legacy: Record<string, unknown>[];
let current: Record<string, unknown>[];
const productionTrivia =
	/\b(?:actor|actress|performer|director|screenwriter|writing credit|box office|runtime)\b|\bwho (?:directs|directed|portrays|plays|wrote)|credited with directing|which season|which episode|release year|year.*released|released.*year|first released/i;

beforeAll(async () => {
	db = new PGlite();
	for (const migration of await loadMigrations()) await db.exec(migration.sql);
	seed = await readFile(
		new URL("../seeds/questions.sql", import.meta.url),
		"utf8",
	);
	await db.exec(seed.split("-- Story-focused trivia refresh")[0]);
	legacy = (
		await db.query<Record<string, unknown>>(
			"SELECT * FROM questions ORDER BY id",
		)
	).rows;
	await db.query(
		"INSERT INTO games(id,name,join_code,host_token_hash,status,round_interval_seconds,started_at,next_round_at,selected_topics) VALUES($1,'Existing story game','STORY1',$2,'WAITING',300,$3,$3,ARRAY['breaking-bad'])",
		[gameId, "a".repeat(64), now],
	);
	await db.query(
		"INSERT INTO car_teams(id,game_id,name,captain_token_hash) VALUES($1,$2,'Existing car',$3)",
		[teamId, gameId, "b".repeat(64)],
	);
	await db.query(
		"INSERT INTO rounds(id,game_id,question_id,sequence,starts_at,ends_at,expected_team_count,expected_team_ids) VALUES($1,$2,$3,1,$4,$5,1,ARRAY[$6::uuid])",
		[
			roundId,
			gameId,
			oldQuestionId,
			now,
			new Date(now.getTime() + 60000),
			teamId,
		],
	);
	await db.transaction((tx) => tx.exec(seed));
	current = (
		await db.query<Record<string, unknown>>(
			"SELECT * FROM questions ORDER BY id",
		)
	).rows;
}, 30000);
afterAll(async () => {
	await db?.close();
});

it.each(topics)(
	"keeps 300 playable %s questions focused on the story",
	(topic) => {
		const rows = current.filter((q) => q.topic_id === topic && q.is_active);
		expect(rows).toHaveLength(300);
		expect(
			rows
				.filter((q) => productionTrivia.test(String(q.prompt)))
				.map((q) => q.prompt),
		).toEqual([]);
		expect(new Set(rows.map((q) => q.prompt)).size).toBe(300);
	},
);

it("retires weak questions while preserving every released fact and unrelated topic", () => {
	const indexed = new Map(current.map((q) => [q.id, q]));
	const retired = legacy.filter((q) => indexed.get(q.id)?.is_active === false);
	expect(retired.length).toBeGreaterThan(0);
	expect(indexed.get(oldQuestionId)?.is_active).toBe(false);
	for (const original of legacy) {
		const { is_active: oldActive, ...oldContent } = original;
		const { is_active: active, ...content } = indexed.get(original.id) ?? {};
		expect(content).toEqual(oldContent);
		if (!topics.includes(String(original.topic_id)))
			expect(active).toBe(oldActive);
	}
	const oldIds = new Set(legacy.map((q) => q.id));
	const replacements = current.filter(
		(q) => !oldIds.has(q.id) && topics.includes(String(q.topic_id)),
	);
	expect(replacements).toHaveLength(retired.length);
	expect(
		replacements.every(
			(q) => q.is_active && topics.includes(String(q.topic_id)),
		),
	).toBe(true);
	expect(current.filter((q) => q.is_active)).toHaveLength(
		300 * QuestionTopicIds.length,
	);
});

it("reseeds without duplicating replacements or overwriting a previously stored question", async () => {
	await db.query(
		"UPDATE questions SET explanation='Stored historical explanation' WHERE id=$1",
		[oldQuestionId],
	);
	const before = (await db.query("SELECT * FROM questions ORDER BY id")).rows;
	await db.transaction((tx) => tx.exec(seed));
	expect((await db.query("SELECT * FROM questions ORDER BY id")).rows).toEqual(
		before,
	);
});

it("still grades an in-progress retired question with its original answer, then opens a playable story question", async () => {
	const original = legacy.find((q) => q.id === oldQuestionId);
	const storage: GameDb = {
		query: (sql, values) => db.query(sql, values),
		transaction: (run) => db.transaction((tx) => run(tx)),
		end: () => db.close(),
	};
	const result = await lockAnswer(
		roundId,
		{ value: String(original?.correct_answer) },
		{ gameId, teamId, role: "CAPTAIN" },
		storage,
		() => now,
	);
	expect(result.answer.isCorrect).toBe(true);
	expect(result.answer.pointsAwarded).toBe(1);
	expect(result.opened?.round.sequence).toBe(2);
	const nextId = result.opened?.round.question.id;
	expect(current.find((q) => q.id === nextId)?.is_active).toBe(true);
	expect(result.opened?.round.question.prompt).not.toMatch(productionTrivia);
});

it("balances the replacement answer positions in each story category", () => {
	for (const topic of topics) {
		const replacements = current.filter(
			(q) => q.topic_id === topic && String(q.id).startsWith("52000000-"),
		);
		expect(replacements.length).toBeGreaterThan(0);
		const positions = [0, 0, 0, 0];
		for (const q of replacements) {
			const choices = q.choices as string[];
			expect(choices).toHaveLength(4);
			expect(new Set(choices).size).toBe(4);
			const position = choices.indexOf(String(q.correct_answer));
			expect(position).toBeGreaterThanOrEqual(0);
			positions[position] += 1;
		}
		expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(
			1,
		);
	}
});
