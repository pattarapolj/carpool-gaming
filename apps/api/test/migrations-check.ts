import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { loadMigrations, migrate, seed } from "../src/migrations";
import { createPostgresDb } from "../src/server";
import { testDatabaseUrl } from "./postgres-url";

async function main() {
	const connectionString = testDatabaseUrl(process.env.TEST_DATABASE_URL);
	const schema = `carpool_migrations_${randomUUID().replaceAll("-", "")}`;
	const control = new Pool({ connectionString });
	const db = createPostgresDb({
		connectionString,
		options: `-c search_path=${schema} -c statement_timeout=15000`,
	});
	const migrations = await loadMigrations();
	let created = false;
	try {
		await control.query(`CREATE SCHEMA ${schema}`);
		created = true;
		await db.query(migrations[0].sql, []);
		await db.query(
			"INSERT INTO games(id,name,join_code,host_token_hash,round_interval_seconds) VALUES($1,'Legacy durability','DURABL',$2,300)",
			[randomUUID(), "c".repeat(64)],
		);
		const legacyRows = (await control.query(`SELECT * FROM ${schema}.games`))
			.rows;
		await db.query("ALTER TABLE games SET UNLOGGED", []);
		await assert.rejects(migrate(db, migrations, "001_games.sql"), /structure/);
		assert.equal(
			(
				await control.query("SELECT to_regclass($1) AS journal", [
					`${schema}.schema_migrations`,
				])
			).rows[0].journal,
			null,
		);
		assert.equal(
			(
				await control.query(
					"SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'carpool_reference_%'",
				)
			).rows[0].count,
			"0",
		);
		assert.deepEqual(
			(await control.query(`SELECT * FROM ${schema}.games`)).rows,
			legacyRows,
		);
		await db.query("ALTER TABLE games SET LOGGED", []);
		await migrate(db, migrations, "001_games.sql");
		assert.deepEqual(
			(await control.query(`SELECT * FROM ${schema}.games`)).rows,
			legacyRows,
		);
		// Reset only this generated schema's 001 fixture for the fresh-run race.
		await db.query("DROP TABLE games, schema_migrations", []);
		await Promise.all([
			migrate(db, migrations.slice(0, 3)),
			migrate(db, migrations.slice(0, 3)),
		]);
		assert.equal(
			(await control.query(`SELECT count(*) FROM ${schema}.schema_migrations`))
				.rows[0].count,
			"3",
		);
		const gameId = randomUUID(),
			teamId = randomUUID(),
			roundId = randomUUID(),
			answerId = randomUUID();
		await db.query(
			"INSERT INTO games(id,name,join_code,host_token_hash,round_interval_seconds) VALUES($1,'Preserve me','MIGRAT',$2,300)",
			[gameId, "a".repeat(64)],
		);
		const seedSql = await readFile(
			new URL("../seeds/questions.sql", import.meta.url),
			"utf8",
		);
		const firstInsert = seedSql.indexOf("INSERT INTO questions");
		const topicBankInsert = seedSql.indexOf(
			"INSERT INTO questions",
			firstInsert + 1,
		);
		const legacySeedSql = seedSql.slice(0, topicBankInsert);
		await db.query(legacySeedSql, []);
		await db.query(legacySeedSql, []);
		const legacyQuestions = (
			await control.query(`SELECT * FROM ${schema}.questions ORDER BY id`)
		).rows;
		await db.query(
			"INSERT INTO car_teams(id,game_id,name,captain_token_hash) VALUES($1,$2,'Legacy car',$3)",
			[teamId, gameId, "b".repeat(64)],
		);
		await db.query(
			"INSERT INTO rounds(id,game_id,question_id,sequence,starts_at,ends_at,expected_team_count) SELECT $1,$2,id,1,now(),now()+interval '60 seconds',1 FROM questions ORDER BY id LIMIT 1",
			[roundId, gameId],
		);
		await db.query(
			"INSERT INTO answers(id,game_id,round_id,car_team_id,value) VALUES($1,$2,$3,$4,'true')",
			[answerId, gameId, roundId, teamId],
		);
		const stored = (await control.query(`SELECT * FROM ${schema}.answers`))
			.rows;
		// Upgrade a stored music round through the new theme constraints.
		const hitThemeMigrationIndex = migrations.findIndex(
			(migration) => migration.name === "016_hit_song_themes.sql",
		);
		assert(hitThemeMigrationIndex > 0);
		await migrate(db, migrations.slice(0, hitThemeMigrationIndex));
		const songRoundId = randomUUID();
		await db.query(
			"INSERT INTO puzzle_rounds(id,game_id,sequence,theme,format,starts_at,ends_at,puzzle_ids,next_theme) VALUES($1,$2,1,'melodies','MUSIC',now(),now()+interval '300 seconds',ARRAY['hit-0','hit-1'],'songs-2010s')",
			[songRoundId, gameId],
		);
		const storedSong = (
			await control.query(`SELECT * FROM ${schema}.puzzle_rounds WHERE id=$1`, [
				songRoundId,
			])
		).rows;
		await migrate(db, migrations);
		await migrate(db, migrations);
		assert.deepEqual(
			(
				await control.query(
					`SELECT * FROM ${schema}.puzzle_rounds WHERE id=$1`,
					[songRoundId],
				)
			).rows,
			storedSong,
		);
		for (const theme of ["hit-songs", "pop-hits", "rock-hits", "dance-edm"]) {
			await db.query(
				"UPDATE puzzle_rounds SET theme=$1,next_theme=$1 WHERE id=$2",
				[theme, songRoundId],
			);
			const updated = (
				await control.query(
					`SELECT theme,next_theme,puzzle_ids FROM ${schema}.puzzle_rounds WHERE id=$1`,
					[songRoundId],
				)
			).rows[0];
			assert.equal(updated.theme, theme);
			assert.equal(updated.next_theme, theme);
			assert.deepEqual(updated.puzzle_ids, ["hit-0", "hit-1"]);
		}

		assert.deepEqual(
			(
				await control.query(
					`SELECT selected_topics FROM ${schema}.games WHERE id=$1`,
					[gameId],
				)
			).rows[0].selected_topics,
			[
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
			],
		);
		const upgradedQuestions = (
			await control.query(`SELECT * FROM ${schema}.questions ORDER BY id`)
		).rows;
		assert.deepEqual(
			upgradedQuestions.map(
				({ topic_id, answer_window_seconds, ...question }) => {
					assert.equal(topic_id, "science");
					assert.equal(answer_window_seconds, 60);
					return question;
				},
			),
			legacyQuestions,
		);
		await seed(db);
		await seed(db);
		assert.equal(
			(await control.query(`SELECT count(*) FROM ${schema}.questions`)).rows[0]
				.count,
			"5400",
		);
		assert.deepEqual(
			(
				await control.query(
					`SELECT * FROM ${schema}.questions WHERE id=ANY($1::uuid[]) ORDER BY id`,
					[legacyQuestions.map((question) => question.id)],
				)
			).rows.map(
				({ topic_id, answer_window_seconds, ...question }) => question,
			),
			legacyQuestions,
		);
		assert.equal(
			(await control.query(`SELECT name FROM ${schema}.games`)).rows[0].name,
			"Preserve me",
		);
		await assert.rejects(
			migrate(db, [
				{ ...migrations[0], sql: `${migrations[0].sql}\n-- changed` },
				...migrations.slice(1),
			]),
			/checksum/,
		);
		const failed = [
			...migrations,
			{
				name: "999_failure.sql",
				sql: "CREATE TABLE must_rollback(id int); SELECT no_such_function();",
			},
		];
		await assert.rejects(migrate(db, failed));
		assert.equal(
			(
				await control.query("SELECT to_regclass($1) AS t", [
					`${schema}.must_rollback`,
				])
			).rows[0].t,
			null,
		);
		assert.equal(
			(await control.query(`SELECT count(*) FROM ${schema}.schema_migrations`))
				.rows[0].count,
			String(migrations.length),
		);
		await control.query(`DROP TABLE ${schema}.schema_migrations`);
		await assert.rejects(migrate(db, migrations), /adopt/);
		await assert.rejects(
			migrate(db, migrations, "003_round_storage.sql"),
			/structure/,
		);
		assert.equal(
			(
				await control.query("SELECT to_regclass($1) AS t", [
					`${schema}.schema_migrations`,
				])
			).rows[0].t,
			null,
		);
		await control.query(
			`ALTER TABLE ${schema}.answers DISABLE TRIGGER answers_immutable_submission`,
		);
		await assert.rejects(
			migrate(db, migrations, "006_question_topics.sql"),
			/structure/,
		);
		await control.query(
			`ALTER TABLE ${schema}.answers ENABLE TRIGGER answers_immutable_submission`,
		);
		await control.query(`CREATE TABLE ${schema}.unexpected(id int)`);
		await assert.rejects(
			migrate(db, migrations, "006_question_topics.sql"),
			/structure/,
		);
		await control.query(`DROP TABLE ${schema}.unexpected`);
		const trigger = (
			await control.query(
				"SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname='answers' AND t.tgisinternal LIMIT 1",
				[schema],
			)
		).rows[0].tgname;
		await control.query(
			`ALTER TABLE ${schema}.answers DISABLE TRIGGER "${trigger}"`,
		);
		await assert.rejects(
			migrate(db, migrations, "006_question_topics.sql"),
			/structure/,
		);
		await control.query(
			`ALTER TABLE ${schema}.answers ENABLE TRIGGER "${trigger}"`,
		);
		await migrate(db, migrations, migrations.at(-1)?.name);
		await migrate(db, migrations);
		assert.equal(
			(await control.query(`SELECT name FROM ${schema}.games`)).rows[0].name,
			"Preserve me",
		);
		assert.deepEqual(
			(await control.query(`SELECT * FROM ${schema}.answers`)).rows,
			stored,
		);
		assert.equal(
			(await control.query(`SELECT count(*) FROM ${schema}.questions`)).rows[0]
				.count,
			"5400",
		);
		await assert.rejects(
			db.query("UPDATE answers SET value='false' WHERE id=$1", [answerId]),
			/immutable/,
		);
		await migrate(db, [
			...migrations,
			{ name: "999_failure.sql", sql: "SELECT 1" },
		]);
		assert.equal(
			(await control.query(`SELECT count(*) FROM ${schema}.schema_migrations`))
				.rows[0].count,
			String(migrations.length + 1),
		);
		assert.equal(
			(
				await control.query(
					"SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'carpool_reference_%'",
				)
			).rows[0].count,
			"0",
		);
		console.log(
			"PASS migrations: concurrent fresh, upgrade/data, no-op, checksum, atomic rollback, explicit adoption, drift rejection, reference cleanup",
		);
	} finally {
		await db.end();
		try {
			if (created)
				await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
		} finally {
			await control.end();
		}
	}
}
void main();
