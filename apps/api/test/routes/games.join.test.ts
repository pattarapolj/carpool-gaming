import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildServer } from "../../src/server";

describe("POST /v1/games/:joinCode/teams", () => {
	it("joins a lobby game and returns a captain token", async () => {
		const gameId = randomUUID();
		const teamId = randomUUID();
		const writes: { sql: string; values: unknown[] }[] = [];
		const app = buildServer({
			query: async (sql: string, values: unknown[]) => {
				if (sql.includes("FROM games")) {
					return {
						rows: [
							{
								id: gameId,
								name: "Beach convoy",
								joinCode: "AB12CD",
								status: "LOBBY",
							},
						],
					};
				}

				if (sql.includes("INSERT INTO car_teams")) {
					writes.push({ sql, values });
					return {
						rows: [
							{
								id: teamId,
								name: "Blue Sedan",
								status: "ACTIVE",
								score: 0,
							},
						],
					};
				}

				throw new Error(`Unexpected query: ${sql}`);
			},
			end: async () => {},
		});

		try {
			const response = await app.inject({
				method: "POST",
				url: "/v1/games/ab12cd/teams",
				payload: { name: "Blue Sedan" },
			});

			expect(response.statusCode).toBe(201);
			expect(response.json()).toMatchObject({
				game: {
					id: gameId,
					name: "Beach convoy",
					joinCode: "AB12CD",
					status: "LOBBY",
				},
				team: {
					id: teamId,
					name: "Blue Sedan",
					status: "ACTIVE",
					score: 0,
				},
				captainToken: expect.any(String),
			});
			expect(writes).toHaveLength(1);
		} finally {
			await app.close();
		}
	});

	it.each([
		["missing name", {}],
		["blank name", { name: "  " }],
		["name over 60 characters", { name: "a".repeat(61) }],
	])("rejects %s", async (_caseName, payload) => {
		const app = buildServer({
			query: async () => {
				throw new Error("validation should not query the database");
			},
			end: async () => {},
		});

		try {
			const response = await app.inject({
				method: "POST",
				url: "/v1/games/AB12CD/teams",
				payload,
			});

			expect(response.statusCode).toBe(422);
			expect(response.json()).toMatchObject({
				error: { code: "VALIDATION_ERROR" },
			});
		} finally {
			await app.close();
		}
	});
});
