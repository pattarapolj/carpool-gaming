import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { buildServer } from "../src/server";
import type { GameDb } from "../src/services/auth";
import { catalog, entries } from "../src/services/puzzle-catalog";
import { prepareSongRound } from "../src/services/puzzle-service";
import * as availability from "../src/services/song-availability";
import * as provider from "../src/services/song-preview";
import { previewFixture } from "./fixtures/song-recording";

let db: PGlite;
let storage: GameDb;
let app: ReturnType<typeof buildServer>;
beforeAll(async () => {
	db = new PGlite();
	for (const file of (await readdir(new URL("../migrations/", import.meta.url)))
		.filter((f) => f.endsWith(".sql"))
		.sort())
		await db.exec(
			await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
		);
	storage = {
		query: (sql, values) => db.query(sql, values),
		transaction: (run) => db.transaction((tx) => run(tx)),
		end: () => db.close(),
	};
	app = buildServer(storage);
});
afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await db.query("DELETE FROM song_preview_availability");
});
afterAll(async () => app.close());
async function create(theme = "melodies") {
	return (
		await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: {
				name: "Reliable songs",
				teamName: "Test car",
				roundIntervalSeconds: 300,
				puzzleSetup: { theme, format: "MUSIC" },
			},
		})
	).json();
}
function start(created: Awaited<ReturnType<typeof create>>) {
	return app.inject({
		method: "POST",
		url: `/v1/games/${created.game.id}/start`,
		headers: { authorization: `Bearer ${created.hostToken}` },
		payload: { practice: true },
	});
}

it("loads the first recording before starting the music round timer", async () => {
	const created = await create("adele");
	let release!: () => void;
	let requested!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const began = new Promise<void>((resolve) => {
		requested = resolve;
	});
	vi.stubGlobal("fetch", async (url: string | URL) => {
		requested();
		await gate;
		return previewFixture(url);
	});
	const pending = start(created);
	const first = await Promise.race([
		began.then(() => "fetch"),
		pending.then(() => "started"),
	]);
	try {
		expect(first).toBe("fetch");
		const game = await db.query<{ status: string }>(
			"SELECT status FROM games WHERE id=$1",
			[created.game.id],
		);
		expect(game.rows[0].status).toBe("LOBBY");
		const rounds = await db.query(
			"SELECT id FROM puzzle_rounds WHERE game_id=$1",
			[created.game.id],
		);
		expect(rounds.rows).toHaveLength(0);
	} finally {
		release();
		await pending;
	}
	expect((await pending).statusCode).toBe(200);
});

it("prepares the next two recordings without exposing their audio or answers", async () => {
	const requested = new Set<number>();
	vi.stubGlobal("fetch", async (url: string | URL) => {
		const match = String(url).match(/\/track\/(\d+)$/);
		if (match) requested.add(Number(match[1]));
		return previewFixture(url);
	});
	const created = await create();
	expect((await start(created)).statusCode).toBe(200);
	const rounds = await db.query<{ puzzle_ids: string[] }>(
		"SELECT puzzle_ids FROM puzzle_rounds WHERE game_id=$1",
		[created.game.id],
	);
	const tracks = rounds.rows[0].puzzle_ids.slice(0, 3).map((id) => {
		const puzzle = catalog.find((p) => p.id === id);
		assert(puzzle);
		const trackId = entries[puzzle.theme].find(
			(e) => e.id === puzzle.answerId,
		)?.trackId;
		assert(trackId);
		return trackId;
	});
	await vi.waitFor(() =>
		expect(tracks.every((id) => requested.has(id))).toBe(true),
	);
	const snapshot = (
		await app.inject({
			method: "GET",
			url: `/v1/games/${created.game.id}/snapshot`,
			headers: { authorization: `Bearer ${created.hostToken}` },
		})
	).json();
	expect(snapshot.puzzles.puzzle.media).toBe("song-clip:2");
	expect(snapshot.puzzles.puzzle.revealedAnswer).toBeUndefined();
});

it("bounds preparation so a slow recording never starts a round after the client gives up waiting", async () => {
	vi.spyOn(availability, "getUnavailableSongTrackIds").mockResolvedValue(
		new Set(),
	);
	vi.spyOn(provider, "songPreview").mockImplementation(
		() => new Promise(() => {}),
	);
	vi.useFakeTimers();
	let code: string | undefined;
	const pending = prepareSongRound("songs-2020s", storage).catch((error) => {
		code = error.code;
	});
	await vi.advanceTimersByTimeAsync(30001);
	expect(code).toBe("CLIP_TEMPORARILY_UNAVAILABLE");
	await pending;
});

it("excludes a confirmed missing recording only from new rounds and preserves existing progress", async () => {
	vi.stubGlobal("fetch", previewFixture);
	const old = await create();
	expect((await start(old)).statusCode).toBe(200);
	const original = (
		await db.query<{ puzzle_ids: string[] }>(
			"SELECT puzzle_ids FROM puzzle_rounds WHERE game_id=$1",
			[old.game.id],
		)
	).rows[0].puzzle_ids;
	const missingPuzzle = catalog.find((p) => p.id === original[0]);
	assert(missingPuzzle);
	const trackId = entries.melodies.find(
		(e) => e.id === missingPuzzle.answerId,
	)?.trackId;
	assert(trackId);
	await availability.recordSongPreviewResult(
		storage,
		trackId,
		new provider.SongPreviewError("metadata", "TRACK_UNAVAILABLE", false),
	);
	const fresh = await create();
	expect((await start(fresh)).statusCode).toBe(200);
	const current = (
		await db.query<{ puzzle_ids: string[] }>(
			"SELECT puzzle_ids FROM puzzle_rounds WHERE game_id=$1",
			[fresh.game.id],
		)
	).rows[0].puzzle_ids;
	expect(current).toHaveLength(299);
	expect(current).not.toContain(missingPuzzle.id);
	expect(
		(
			await db.query<{ puzzle_ids: string[] }>(
				"SELECT puzzle_ids FROM puzzle_rounds WHERE game_id=$1",
				[old.game.id],
			)
		).rows[0].puzzle_ids,
	).toEqual(original);
});

it("keeps a game in the lobby when the provider is temporarily unavailable", async () => {
	const created = await create("songs-2010s");
	vi.spyOn(provider, "songPreview").mockRejectedValue(
		new provider.SongPreviewError("metadata", "PROVIDER_TIMEOUT", true),
	);
	const response = await start(created);
	expect(response.statusCode).toBe(503);
	expect(response.json().error.code).toBe("CLIP_TEMPORARILY_UNAVAILABLE");
	expect(
		(
			await db.query<{ status: string }>(
				"SELECT status FROM games WHERE id=$1",
				[created.game.id],
			)
		).rows[0].status,
	).toBe("LOBBY");
	expect((await availability.getUnavailableSongTrackIds(storage)).size).toBe(0);
});

it("skips a song without revealing it, then lets the team revisit and solve it", async () => {
	vi.stubGlobal("fetch", previewFixture);
	const created = await create("songs-2020s");
	expect((await start(created)).statusCode).toBe(200);
	const url = `/v1/games/${created.game.id}`;
	const headers = { authorization: `Bearer ${created.hostToken}` };
	const snapshot = async () =>
		(
			await app.inject({ method: "GET", url: `${url}/snapshot`, headers })
		).json();
	const action = async (payload: object) =>
		app.inject({
			method: "POST",
			url: `${url}/puzzles/actions`,
			headers,
			payload,
		});
	const view = (await snapshot()).puzzles;
	expect(
		(
			await action({
				kind: "skip",
				roundId: view.round.id,
				puzzleId: view.puzzle.id,
			})
		).statusCode,
	).toBe(200);
	const skipped = (await snapshot()).puzzles;
	expect(skipped.solved).toBe(0);
	expect(skipped.skipped).toContainEqual({
		id: view.puzzle.id,
		number: view.puzzle.number,
	});
	expect(
		(
			await action({
				kind: "revisit",
				roundId: view.round.id,
				puzzleId: view.puzzle.id,
			})
		).statusCode,
	).toBe(200);
	const revisited = (await snapshot()).puzzles;
	expect(revisited.puzzle.revealedAnswer).toBeUndefined();
	const round = (
		await db.query<{ puzzle_ids: string[] }>(
			"SELECT puzzle_ids FROM puzzle_rounds WHERE id=$1",
			[view.round.id],
		)
	).rows[0];
	const puzzle = catalog.find((p) => p.id === round.puzzle_ids[0]);
	assert(puzzle);
	expect(
		(
			await action({
				kind: "guess",
				roundId: view.round.id,
				puzzleId: view.puzzle.id,
				answerId: puzzle.answerId,
			})
		).statusCode,
	).toBe(200);
	expect((await snapshot()).puzzles.solved).toBe(1);
});
