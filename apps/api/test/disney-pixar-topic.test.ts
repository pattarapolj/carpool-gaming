import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { QuestionTopicIds } from "../../../packages/contracts/src";
import { loadMigrations } from "../src/migrations";
import { buildServer } from "../src/server";

it("adds Disney & Pixar to new-game defaults and accepts it while preserving existing selections", async () => {
	const db = new PGlite();
	try {
		const migrations = await loadMigrations();
		for (const migration of migrations.filter(
			(m) => m.name < "017_disney_pixar_quiz_topic.sql",
		))
			await db.exec(migration.sql);
		await db.exec(
			"INSERT INTO games(id,name,join_code,host_token_hash,round_interval_seconds,selected_topics) VALUES('11111111-1111-4111-8111-111111111111','Existing trip','DPOLD1','hash',300,ARRAY['science','marvel','nba'])",
		);
		const before = (await db.query("SELECT * FROM games ORDER BY id")).rows;
		const migration = migrations.find(
			(m) => m.name === "017_disney_pixar_quiz_topic.sql",
		);
		expect(migration).toBeDefined();
		await db.exec(migration?.sql ?? "");
		expect((await db.query("SELECT * FROM games ORDER BY id")).rows).toEqual(
			before,
		);
		await db.exec(
			"INSERT INTO games(id,name,join_code,host_token_hash,round_interval_seconds) VALUES('22222222-2222-4222-8222-222222222222','New trip','DPNEW1','hash',300)",
		);
		expect(
			(
				await db.query(
					"SELECT selected_topics FROM games WHERE join_code='DPNEW1'",
				)
			).rows,
		).toEqual([{ selected_topics: [...QuestionTopicIds] }]);
		await db.exec(
			"INSERT INTO games(id,name,join_code,host_token_hash,round_interval_seconds,selected_topics) VALUES('33333333-3333-4333-8333-333333333333','Animated trip','DPONLY','hash',300,ARRAY['disney-pixar'])",
		);
		expect(
			(
				await db.query(
					"SELECT selected_topics FROM games WHERE join_code='DPONLY'",
				)
			).rows,
		).toEqual([{ selected_topics: ["disney-pixar"] }]);
		await expect(
			db.exec(
				"UPDATE games SET selected_topics=ARRAY['unknown'] WHERE join_code='DPONLY'",
			),
		).rejects.toThrow(/games_selected_topics_check/);
	} finally {
		await db.close();
	}
});

it("seeds 300 story questions without changing released data and plays only the selected Disney & Pixar bank", async () => {
	const db = new PGlite();
	const app = buildServer({
		query: (sql, values) => db.query(sql, values),
		transaction: (run) => db.transaction((tx) => run(tx)),
		end: () => db.close(),
	});
	try {
		for (const migration of await loadMigrations())
			await db.exec(migration.sql);
		const seed = await readFile(
			new URL("../seeds/questions.sql", import.meta.url),
			"utf8",
		);
		await db.exec(seed.split("-- Disney & Pixar trivia")[0]);
		const released = (
			await db.query<{ id: string }>("SELECT * FROM questions ORDER BY id")
		).rows;
		await db.exec(seed);
		expect(
			(
				await db.query(
					"SELECT * FROM questions WHERE id=ANY($1::uuid[]) ORDER BY id",
					[released.map((q) => q.id)],
				)
			).rows,
		).toEqual(released);
		const questions = (
			await db.query<{
				id: string;
				prompt: string;
				choices: string[];
				correct_answer: string;
				explanation: string;
				source_title: string;
				source_url: string;
				answer_window_seconds: number;
			}>(
				"SELECT * FROM questions WHERE topic_id='disney-pixar' AND is_active ORDER BY id",
			)
		).rows;
		expect(questions).toHaveLength(300);
		expect(new Set(questions.map((q) => q.prompt)).size).toBe(300);
		const positions = [0, 0, 0, 0];
		for (const q of questions) {
			expect(q.choices).toHaveLength(4);
			expect(new Set(q.choices).size).toBe(4);
			expect(q.choices).toContain(q.correct_answer);
			positions[q.choices.indexOf(q.correct_answer)]++;
			expect(q.answer_window_seconds).toBe(60);
			expect(q.source_title.trim()).not.toBe("");
			expect(q.source_url).toMatch(/^https:\/\//);
			expect(q.explanation.trim()).not.toBe("");
			expect(q.prompt).not.toMatch(
				/\b(?:director|actor|actress|performer|screenwriter|release year|box office|runtime)\b|who (?:directed|directs|voiced)|year.*released|released.*year/i,
			);
		}
		expect(positions).toEqual([75, 75, 75, 75]);
		const beforeReload = (await db.query("SELECT * FROM questions ORDER BY id"))
			.rows;
		await db.exec(seed);
		expect(
			(await db.query("SELECT * FROM questions ORDER BY id")).rows,
		).toEqual(beforeReload);
		const create = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: {
				name: "Animated adventure",
				teamName: "Disney fans",
				roundIntervalSeconds: 300,
				topics: ["disney-pixar"],
			},
		});
		expect(create.statusCode).toBe(201);
		const { game, hostToken } = create.json();
		const headers = { authorization: `Bearer ${hostToken}` };
		const start = await app.inject({
			method: "POST",
			url: `/v1/games/${game.id}/start`,
			headers,
			payload: { practice: true },
		});
		expect(start.statusCode).toBe(200);
		const snapshot = (
			await app.inject({
				method: "GET",
				url: `/v1/games/${game.id}/snapshot`,
				headers,
			})
		).json();
		expect(snapshot.game.selectedTopics).toEqual(["disney-pixar"]);
		const row = questions.find(
			(q) => q.prompt === snapshot.round.question.prompt,
		);
		expect(row).toBeDefined();
		const answer = await app.inject({
			method: "POST",
			url: `/v1/rounds/${snapshot.round.id}/answers`,
			headers,
			payload: { value: row?.correct_answer },
		});
		expect(answer.statusCode).toBe(200);
		expect(answer.json().isCorrect).toBe(true);
		expect(answer.json().pointsAwarded).toBe(1);
		const next = (
			await app.inject({
				method: "GET",
				url: `/v1/games/${game.id}/snapshot`,
				headers,
			})
		).json();
		expect(next.round.sequence).toBe(2);
		expect(questions.some((q) => q.prompt === next.round.question.prompt)).toBe(
			true,
		);
		expect(next.round.question.id).not.toBe(row?.id);
	} finally {
		await app.close();
	}
}, 30000);
