import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server";

describe("starting a game with PostgreSQL semantics", () => {
	let db: PGlite;
	let app: ReturnType<typeof buildServer>;

	beforeAll(async () => {
		db = new PGlite();
		for (const migrationName of ["001_games.sql", "002_car_teams.sql"]) {
			const migration = await readFile(
				new URL(`../../migrations/${migrationName}`, import.meta.url),
				"utf8",
			);
			await db.exec(migration);
		}
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

	it("commits WAITING and matching server timestamps", async () => {
		const createResponse = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Start me", roundIntervalSeconds: 300 },
		});
		const created = createResponse.json();

		for (const name of ["Blue Sedan", "Red Hatchback"]) {
			const joinResponse = await app.inject({
				method: "POST",
				url: `/v1/games/${created.game.joinCode}/teams`,
				payload: { name },
			});
			expect(joinResponse.statusCode).toBe(201);
		}

		const response = await app.inject({
			method: "POST",
			url: `/v1/games/${created.game.id}/start`,
			headers: { authorization: `Bearer ${created.hostToken}` },
			payload: {},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			game: { id: created.game.id, status: "WAITING" },
		});

		const result = await db.query<{
			status: string;
			started_at: Date | string | null;
			next_round_at: Date | string | null;
		}>("SELECT status, started_at, next_round_at FROM games WHERE id = $1", [
			created.game.id,
		]);
		expect(result.rows[0].status).toBe("WAITING");
		expect(result.rows[0].started_at).not.toBeNull();
		expect(result.rows[0].started_at).toEqual(result.rows[0].next_round_at);
	});

	it("rolls back readiness failures and leaves the game in the lobby", async () => {
		const createResponse = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Needs teams", roundIntervalSeconds: 300 },
		});
		const created = createResponse.json();

		const response = await app.inject({
			method: "POST",
			url: `/v1/games/${created.game.id}/start`,
			headers: { authorization: `Bearer ${created.hostToken}` },
			payload: {},
		});

		expect(response.statusCode).toBe(422);

		const result = await db.query<{
			status: string;
			started_at: Date | string | null;
			next_round_at: Date | string | null;
		}>("SELECT status, started_at, next_round_at FROM games WHERE id = $1", [
			created.game.id,
		]);
		expect(result.rows[0]).toEqual({
			status: "LOBBY",
			started_at: null,
			next_round_at: null,
		});
	});

	it("returns not found for a malformed game ID", async () => {
		const createResponse = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Invalid ID check", roundIntervalSeconds: 300 },
		});
		const { hostToken } = createResponse.json();

		const response = await app.inject({
			method: "POST",
			url: "/v1/games/not-a-uuid/start",
			headers: { authorization: `Bearer ${hostToken}` },
			payload: {},
		});

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({
			error: { code: "GAME_NOT_FOUND" },
		});
	});

	it("rejects a second start after the first commit", async () => {
		const createResponse = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Start once", roundIntervalSeconds: 300 },
		});
		const created = createResponse.json();

		for (const name of ["Blue Sedan", "Red Hatchback"]) {
			await app.inject({
				method: "POST",
				url: `/v1/games/${created.game.joinCode}/teams`,
				payload: { name },
			});
		}

		const startUrl = `/v1/games/${created.game.id}/start`;
		const headers = { authorization: `Bearer ${created.hostToken}` };
		const firstResponse = await app.inject({
			method: "POST",
			url: startUrl,
			headers,
			payload: {},
		});
		const secondResponse = await app.inject({
			method: "POST",
			url: startUrl,
			headers,
			payload: {},
		});

		expect(firstResponse.statusCode).toBe(200);
		expect(secondResponse.statusCode).toBe(409);
		expect(secondResponse.json()).toMatchObject({
			error: { code: "GAME_ALREADY_STARTED" },
		});
	});

	it("rejects a captain token from starting the game", async () => {
		const createResponse = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Captain cannot start", roundIntervalSeconds: 300 },
		});
		const created = createResponse.json();
		const joinResponse = await app.inject({
			method: "POST",
			url: `/v1/games/${created.game.joinCode}/teams`,
			payload: { name: "Blue Sedan" },
		});

		const response = await app.inject({
			method: "POST",
			url: `/v1/games/${created.game.id}/start`,
			headers: { authorization: `Bearer ${joinResponse.json().captainToken}` },
			payload: { practice: true },
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({
			error: { code: "FORBIDDEN" },
		});
	});
});
