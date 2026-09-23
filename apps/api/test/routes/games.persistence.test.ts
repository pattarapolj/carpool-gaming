import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildServer } from "../../src/server";

let db: PGlite;
let app: ReturnType<typeof buildServer>;
let joinCode: string;

beforeAll(async () => {
	db = new PGlite();
	const migration = await readFile(
		new URL("../../migrations/001_games.sql", import.meta.url),
		"utf8",
	);
	await db.exec(migration);
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

it("stores the normalized lobby and only the host-token hash", async () => {
	const response = await app.inject({
		method: "POST",
		url: "/v1/games",
		payload: { name: "  Beach convoy  ", roundIntervalSeconds: 600 },
	});
	const { game, hostToken } = response.json();
	joinCode = game.joinCode;

	expect(response.statusCode).toBe(201);
	const result = await db.query(
		"SELECT id, name, join_code, host_token_hash, status, round_interval_seconds FROM games WHERE id = $1",
		[game.id],
	);
	expect(result.rows).toEqual([
		{
			id: game.id,
			name: "Beach convoy",
			join_code: joinCode,
			host_token_hash: createHash("sha256").update(hostToken).digest("hex"),
			status: "LOBBY",
			round_interval_seconds: 600,
		},
	]);
	expect(response.body).not.toContain("host_token_hash");
});

it("rejects a duplicate stored join code", async () => {
	await expect(
		db.query(
			"INSERT INTO games (id, name, join_code, host_token_hash, round_interval_seconds) VALUES ($1, $2, $3, $4, $5)",
			[randomUUID(), "Another game", joinCode, "0".repeat(64), 300],
		),
	).rejects.toMatchObject({ code: "23505", constraint: "games_join_code_key" });
});
