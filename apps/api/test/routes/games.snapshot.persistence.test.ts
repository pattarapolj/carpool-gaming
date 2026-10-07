import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server";

describe("GET /v1/games/:gameId/snapshot", () => {
	let db: PGlite;
	let app: ReturnType<typeof buildServer>;

	beforeAll(async () => {
		db = new PGlite();
		for (const migrationName of [
			"001_games.sql",
			"002_car_teams.sql",
			"003_round_storage.sql",
			"004_round_participants.sql",
		]) {
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

	it("returns the persisted lobby and active team roster to its host", async () => {
		const { game, hostToken } = await createGame("Beach convoy");
		const join = await app.inject({
			method: "POST",
			url: `/v1/games/${game.joinCode}/teams`,
			payload: { name: "Blue Sedan" },
		});
		const { team, captainToken } = join.json();

		const response = await app.inject({
			method: "GET",
			url: `/v1/games/${game.id}/snapshot`,
			headers: { authorization: `Bearer ${hostToken}` },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			game: {
				id: game.id,
				name: "Beach convoy",
				joinCode: game.joinCode,
				status: "LOBBY",
				roundIntervalSeconds: 300,
			},
			teams: [{ id: team.id, name: "Blue Sedan", status: "ACTIVE", score: 0 }],
		});
		expect(response.body).not.toContain(hostToken);
		expect(response.body).not.toContain(captainToken);
		expect(response.body).not.toMatch(/token_hash/i);
	});

	it("returns the same lobby to a captain and excludes cars that left", async () => {
		const { game } = await createGame("Captain snapshot");
		const activeJoin = await joinTeam(game.joinCode, "Blue Sedan");
		const leftJoin = await joinTeam(game.joinCode, "Red Van");
		await db.query("UPDATE car_teams SET status = 'LEFT' WHERE id = $1", [
			leftJoin.team.id,
		]);

		const response = await app.inject({
			method: "GET",
			url: `/v1/games/${game.id}/snapshot`,
			headers: { authorization: `Bearer ${activeJoin.captainToken}` },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().teams).toEqual([
			{
				id: activeJoin.team.id,
				name: "Blue Sedan",
				status: "ACTIVE",
				score: 0,
			},
		]);
	});

	it("rejects missing and invalid bearer tokens", async () => {
		const { game } = await createGame("Private lobby");
		const noToken = await app.inject({
			method: "GET",
			url: `/v1/games/${game.id}/snapshot`,
		});
		const invalidToken = await app.inject({
			method: "GET",
			url: `/v1/games/${game.id}/snapshot`,
			headers: { authorization: "Bearer invalid-token" },
		});

		expect(noToken.statusCode).toBe(401);
		expect(noToken.json()).toMatchObject({
			error: { code: "UNAUTHENTICATED" },
		});
		expect(invalidToken.statusCode).toBe(401);
		expect(invalidToken.json()).toMatchObject({
			error: { code: "UNAUTHENTICATED" },
		});
	});

	it("rejects a valid token from another game", async () => {
		const first = await createGame("First game");
		const second = await createGame("Second game");
		const response = await app.inject({
			method: "GET",
			url: `/v1/games/${first.game.id}/snapshot`,
			headers: { authorization: `Bearer ${second.hostToken}` },
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
	});

	it("returns a game-not-found error for an unknown ID", async () => {
		const { hostToken } = await createGame("Existing game");
		const response = await app.inject({
			method: "GET",
			url: `/v1/games/${randomUUID()}/snapshot`,
			headers: { authorization: `Bearer ${hostToken}` },
		});

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({
			error: { code: "GAME_NOT_FOUND" },
		});
	});

	async function createGame(name: string) {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name, roundIntervalSeconds: 300 },
		});
		return response.json();
	}

	async function joinTeam(joinCode: string, name: string) {
		const response = await app.inject({
			method: "POST",
			url: `/v1/games/${joinCode}/teams`,
			payload: { name },
		});
		return response.json();
	}
});
