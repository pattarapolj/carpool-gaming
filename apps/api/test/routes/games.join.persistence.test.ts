import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrations } from "../../src/migrations";
import { buildServer } from "../../src/server";

describe("joining a game with PostgreSQL semantics", () => {
	let db: PGlite;
	let app: ReturnType<typeof buildServer>;

	beforeAll(async () => {
		db = new PGlite();
		for (const migration of await loadMigrations())
			await db.exec(migration.sql);
		app = buildServer({
			query: (sql, values) => db.query(sql, values),
			end: () => db.close(),
			transaction: (run) => db.transaction((tx) => run(tx)),
		});
	});

	afterAll(async () => {
		if (app) await app.close();
		else if (db) await db.close();
	});

	it("stores a joined team and only the captain-token hash", async () => {
		const createResponse = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Beach convoy", roundIntervalSeconds: 300 },
		});
		const created = createResponse.json();

		const joinResponse = await app.inject({
			method: "POST",
			url: `/v1/games/${created.game.joinCode.toLowerCase()}/teams`,
			payload: { name: "  Blue Sedan  " },
		});

		expect(joinResponse.statusCode).toBe(201);
		expect(joinResponse.json().team.name).toBe("Blue Sedan");
		expect(joinResponse.json().captainToken).toEqual(expect.any(String));

		const result = await db.query(
			"SELECT game_id, name, captain_token_hash, status, score FROM car_teams WHERE id = $1",
			[joinResponse.json().team.id],
		);
		expect(result.rows).toEqual([
			{
				game_id: created.game.id,
				name: "Blue Sedan",
				captain_token_hash: createHash("sha256")
					.update(joinResponse.json().captainToken)
					.digest("hex"),
				status: "ACTIVE",
				score: 0,
			},
		]);
		expect(joinResponse.body).not.toContain("captain_token_hash");
	});

	it("rejects a duplicate team name case-insensitively", async () => {
		const createResponse = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Duplicate check", roundIntervalSeconds: 300 },
		});
		const { joinCode } = createResponse.json().game;

		const firstJoin = await app.inject({
			method: "POST",
			url: `/v1/games/${joinCode}/teams`,
			payload: { name: "Blue Sedan" },
		});
		const duplicateJoin = await app.inject({
			method: "POST",
			url: `/v1/games/${joinCode}/teams`,
			payload: { name: "blue sedan" },
		});

		expect(firstJoin.statusCode).toBe(201);
		expect(duplicateJoin.statusCode).toBe(409);
		expect(duplicateJoin.json()).toMatchObject({
			error: { code: "TEAM_NAME_TAKEN" },
		});
	});

	it("rejects a join after the game starts", async () => {
		const createResponse = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Closed lobby", roundIntervalSeconds: 300 },
		});
		const { game } = createResponse.json();
		await db.query("UPDATE games SET status = 'WAITING' WHERE id = $1", [
			game.id,
		]);

		const response = await app.inject({
			method: "POST",
			url: `/v1/games/${game.joinCode}/teams`,
			payload: { name: "Blue Sedan" },
		});

		expect(response.statusCode).toBe(409);
		expect(response.json()).toMatchObject({
			error: { code: "GAME_NOT_JOINABLE" },
		});
	});

	it("rejects an unknown join code", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games/ZZZZZZ/teams",
			payload: { name: "Blue Sedan" },
		});

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({
			error: { code: "GAME_NOT_FOUND" },
		});
	});
});
