import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { loadMigrations } from "../src/migrations";

it("upgrades saved puzzle progress with an empty reveal list without losing guesses or scores", async () => {
	const db = new PGlite();
	try {
		const migrations = await loadMigrations();
		for (const migration of migrations.filter(
			(m) => m.name < "012_song_give_up.sql",
		))
			await db.exec(migration.sql);
		const gameId = randomUUID(),
			teamId = randomUUID(),
			roundId = randomUUID();
		await db.query(
			"INSERT INTO games(id,name,join_code,host_token_hash,round_interval_seconds) VALUES($1,'Saved music','SAVED1',$2,300)",
			[gameId, "a".repeat(64)],
		);
		await db.query(
			"INSERT INTO car_teams(id,game_id,name,captain_token_hash) VALUES($1,$2,'Saved car',$3)",
			[teamId, gameId, "b".repeat(64)],
		);
		await db.query(
			"INSERT INTO puzzle_rounds(id,game_id,sequence,theme,format,starts_at,ends_at,puzzle_ids) VALUES($1,$2,1,'kpop','MUSIC',now(),now()+interval '5 minutes',$3)",
			[roundId, gameId, ["music-kpop-0", "music-kpop-1"]],
		);
		await db.query(
			"INSERT INTO puzzle_progress(round_id,team_id,current_index,guesses,solved,skipped,tie_order) VALUES($1,$2,1,$3,$4,$5,1)",
			[
				roundId,
				teamId,
				JSON.stringify({ "music-kpop-0": ["kpop-0"] }),
				["music-kpop-0"],
				["music-kpop-1"],
			],
		);
		const before = (
			await db.query<Record<string, unknown>>("SELECT * FROM puzzle_progress")
		).rows[0];
		const upgrade = migrations.find((m) => m.name === "012_song_give_up.sql");
		expect(upgrade).toBeDefined();
		await db.exec(upgrade?.sql ?? "");
		expect((await db.query("SELECT * FROM puzzle_progress")).rows[0]).toEqual({
			...before,
			given_up: [],
		});
	} finally {
		await db.close();
	}
}, 15000);
