import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { QuestionTopicIds } from "../../../packages/contracts/src";
import { loadMigrations } from "../src/migrations";

it("upgrades existing games and questions without changing released content, and keeps legacy seed defaults", async () => {
	const db = new PGlite();
	try {
		const migrations = await loadMigrations();
		for (const migration of migrations.filter(
			(entry) => entry.name < "006_question_topics.sql",
		))
			await db.exec(migration.sql);
		await db.exec(
			"INSERT INTO games(id,name,join_code,host_token_hash,round_interval_seconds) VALUES('11111111-1111-4111-8111-111111111111','Legacy game','LEGACY','hash',300)",
		);
		const seed = await readFile(
			new URL("../seeds/questions.sql", import.meta.url),
			"utf8",
		);
		await db.exec(seed);
		const legacy = (await db.query("SELECT * FROM questions ORDER BY id")).rows;
		expect(legacy).toHaveLength(24);
		const migration = await readFile(
			new URL("../migrations/006_question_topics.sql", import.meta.url),
			"utf8",
		);
		expect(migrations.at(-1)?.name).toBe("006_question_topics.sql");
		await db.exec(migration);
		expect((await db.query("SELECT selected_topics FROM games")).rows).toEqual([
			{ selected_topics: [...QuestionTopicIds] },
		]);
		const upgraded = (
			await db.query<Record<string, unknown>>(
				"SELECT * FROM questions ORDER BY id",
			)
		).rows;
		expect(
			upgraded.map(({ topic_id, answer_window_seconds, ...question }) => {
				expect(topic_id).toBe("science");
				expect(answer_window_seconds).toBe(60);
				return question;
			}),
		).toEqual(legacy);
		await db.exec(seed);
		expect(
			(await db.query("SELECT * FROM questions ORDER BY id")).rows,
		).toEqual(upgraded);
		await db.exec(
			"INSERT INTO games(id,name,join_code,host_token_hash,round_interval_seconds) VALUES('22222222-2222-4222-8222-222222222222','New legacy caller','NEWOLD','hash',300)",
		);
		expect(
			(
				await db.query(
					"SELECT selected_topics FROM games WHERE join_code='NEWOLD'",
				)
			).rows,
		).toEqual([{ selected_topics: [...QuestionTopicIds] }]);
	} finally {
		await db.close();
	}
});
