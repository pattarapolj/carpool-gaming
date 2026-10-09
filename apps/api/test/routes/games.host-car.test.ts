import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildServer } from "../../src/server";

let db: PGlite;
let app: ReturnType<typeof buildServer>;
beforeAll(async () => {
	db = new PGlite();
	for (const file of (
		await readdir(new URL("../../migrations/", import.meta.url))
	)
		.filter((name) => name.endsWith(".sql"))
		.sort())
		await db.exec(
			await readFile(
				new URL(`../../migrations/${file}`, import.meta.url),
				"utf8",
			),
		);
	await db.exec(
		await readFile(
			new URL("../../seeds/questions.sql", import.meta.url),
			"utf8",
		),
	);
	app = buildServer({
		query: (sql, values) => db.query(sql, values),
		end: () => db.close(),
		transaction: (run) => db.transaction((tx) => run(tx)),
	});
});
afterAll(async () => app.close());

it("creates the host's car and restores it with the host credential", async () => {
	const created = await app.inject({
		method: "POST",
		url: "/v1/games",
		payload: {
			name: "Two phones",
			teamName: "  Host car  ",
			roundIntervalSeconds: 300,
		},
	});
	expect(created.statusCode).toBe(201);
	const { game, hostToken } = created.json();
	const headers = { authorization: `Bearer ${hostToken}` };
	const snapshot = await app.inject({
		method: "GET",
		url: `/v1/games/${game.id}/snapshot`,
		headers,
	});
	expect(snapshot.json().callerTeam).toMatchObject({
		name: "Host car",
		status: "ACTIVE",
		score: 0,
	});
	expect(snapshot.json().teams).toHaveLength(1);
	const duplicate = await app.inject({
		method: "POST",
		url: `/v1/games/${game.joinCode}/teams`,
		payload: { name: "HOST CAR" },
	});
	expect(duplicate.statusCode).toBe(409);
	const joined = await app.inject({
		method: "POST",
		url: `/v1/games/${game.joinCode}/teams`,
		payload: { name: "Other car" },
	});
	const captainHeaders = {
		authorization: `Bearer ${joined.json().captainToken}`,
	};
	const forbiddenStart = await app.inject({
		method: "POST",
		url: `/v1/games/${game.id}/start`,
		headers: captainHeaders,
		payload: {},
	});
	expect(forbiddenStart.statusCode).toBe(403);
	const start = await app.inject({
		method: "POST",
		url: `/v1/games/${game.id}/start`,
		headers,
		payload: {},
	});
	expect(start.statusCode).toBe(200);
	const playing = (
		await app.inject({
			method: "GET",
			url: `/v1/games/${game.id}/snapshot`,
			headers,
		})
	).json();
	const roundId = playing.round.id;
	const correct = await db.query<{ correct_answer: string | boolean | number }>(
		"SELECT q.correct_answer FROM questions q JOIN rounds r ON r.question_id=q.id WHERE r.id=$1",
		[roundId],
	);
	const value = correct.rows[0].correct_answer;
	const answer = await app.inject({
		method: "POST",
		url: `/v1/rounds/${roundId}/answers`,
		headers,
		payload: { value },
	});
	expect(answer.statusCode).toBe(200);
	const restored = (
		await app.inject({
			method: "GET",
			url: `/v1/games/${game.id}/snapshot`,
			headers,
		})
	).json();
	expect(restored.ownAnswer).toMatchObject({ value });
	const other = (
		await app.inject({
			method: "GET",
			url: `/v1/games/${game.id}/snapshot`,
			headers: captainHeaders,
		})
	).json();
	expect(other.ownAnswer).toBeNull();
	const otherAnswer = await app.inject({
		method: "POST",
		url: `/v1/rounds/${roundId}/answers`,
		headers: captainHeaders,
		payload: { value },
	});
	expect(otherAnswer.statusCode).toBe(200);
	const scored = (
		await app.inject({
			method: "GET",
			url: `/v1/games/${game.id}/snapshot`,
			headers,
		})
	).json();
	expect(scored.callerTeam.score).toBe(1);
	expect(scored.leaderboard).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ name: "Host car", score: 1 }),
			expect.objectContaining({ name: "Other car", score: 1 }),
		]),
	);
});

it("rejects host car leave while preserving its answer and end permissions", async () => {
	const created = await app.inject({
		method: "POST",
		url: "/v1/games",
		payload: {
			name: "Host permissions",
			teamName: "Host car",
			roundIntervalSeconds: 300,
		},
	});
	const { game, hostToken } = created.json();
	const headers = { authorization: `Bearer ${hostToken}` };
	const start = await app.inject({
		method: "POST",
		url: `/v1/games/${game.id}/start`,
		headers,
		payload: { practice: true },
	});
	expect(start.statusCode).toBe(200);
	const leave = await app.inject({
		method: "POST",
		url: `/v1/games/${game.id}/leave`,
		headers,
		payload: {},
	});
	expect(leave.statusCode).toBe(403);
	expect(leave.json()).toMatchObject({ error: { code: "CAPTAIN_REQUIRED" } });
	const snapshot = (
		await app.inject({
			method: "GET",
			url: `/v1/games/${game.id}/snapshot`,
			headers,
		})
	).json();
	expect(snapshot.callerTeam.status).toBe("ACTIVE");
	const value = (
		await db.query<{ correct_answer: string | boolean | number }>(
			"SELECT q.correct_answer FROM questions q JOIN rounds r ON r.question_id=q.id WHERE r.id=$1",
			[snapshot.round.id],
		)
	).rows[0].correct_answer;
	const answer = await app.inject({
		method: "POST",
		url: `/v1/rounds/${snapshot.round.id}/answers`,
		headers,
		payload: { value },
	});
	expect(answer.statusCode).toBe(200);
	const end = await app.inject({
		method: "POST",
		url: `/v1/games/${game.id}/end`,
		headers,
		payload: {},
	});
	expect(end.statusCode).toBe(200);
	expect(end.json().game.status).toBe("COMPLETE");
});

it("rolls back the game when its host car cannot be persisted", async () => {
	await db.exec(
		"ALTER TABLE car_teams ADD CONSTRAINT reject_test_host CHECK (name <> 'Reject host')",
	);
	try {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: {
				name: "Rollback trip",
				teamName: "Reject host",
				roundIntervalSeconds: 300,
			},
		});
		expect(response.statusCode).toBe(500);
		const games = await db.query(
			"SELECT id FROM games WHERE name='Rollback trip'",
		);
		expect(games.rows).toEqual([]);
	} finally {
		await db.exec("ALTER TABLE car_teams DROP CONSTRAINT reject_test_host");
	}
});

it.each(["", "   ", "a".repeat(61)])(
	"rejects invalid host car name %j",
	async (teamName) => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Trip", teamName, roundIntervalSeconds: 300 },
		});
		expect(response.statusCode).toBe(422);
	},
);
