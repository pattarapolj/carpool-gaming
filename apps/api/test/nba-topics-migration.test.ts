import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { QuestionTopicIds } from "../../../packages/contracts/src";
import { loadMigrations } from "../src/migrations";

it("adds NBA to new-game defaults while preserving existing topic selections", async () => {
	const db = new PGlite();
	try {
		const migrations = await loadMigrations();
		for (const migration of migrations.filter(
			(entry) => entry.name < "014_nba_quiz_topic.sql",
		))
			await db.exec(migration.sql);
		await db.exec(
			"INSERT INTO games(id,name,join_code,host_token_hash,round_interval_seconds) VALUES('11111111-1111-4111-8111-111111111111','Existing game','BEFORE','hash',300)",
		);
		const before = (await db.query("SELECT * FROM games ORDER BY id")).rows;
		const migration = migrations.find(
			(entry) => entry.name === "014_nba_quiz_topic.sql",
		);
		expect(migration).toBeDefined();
		await db.exec(migration?.sql ?? "");
		expect((await db.query("SELECT * FROM games ORDER BY id")).rows).toEqual(
			before,
		);
		await db.exec(
			"INSERT INTO games(id,name,join_code,host_token_hash,round_interval_seconds) VALUES('22222222-2222-4222-8222-222222222222','New game','AFTER1','hash',300)",
		);
		expect(
			(
				await db.query(
					"SELECT selected_topics FROM games WHERE join_code='AFTER1'",
				)
			).rows,
		).toEqual([{ selected_topics: QuestionTopicIds.slice(0, 18) }]);
		await db.exec(
			"INSERT INTO games(id,name,join_code,host_token_hash,round_interval_seconds,selected_topics) VALUES('33333333-3333-4333-8333-333333333333','NBA only','NBAONE','hash',300,ARRAY['nba'])",
		);
		expect(
			(
				await db.query(
					"SELECT selected_topics FROM games WHERE join_code='NBAONE'",
				)
			).rows,
		).toEqual([{ selected_topics: ["nba"] }]);
		await expect(
			db.exec(
				"INSERT INTO games(id,name,join_code,host_token_hash,round_interval_seconds,selected_topics) VALUES('44444444-4444-4444-8444-444444444444','Invalid topic','BADONE','hash',300,ARRAY['unknown'])",
			),
		).rejects.toThrow(/games_selected_topics_check/);
	} finally {
		await db.close();
	}
});
