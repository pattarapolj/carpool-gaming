import * as crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { PUZZLE_PACKS } from "../../../packages/contracts/src/puzzles";
import { tick } from "../src/coordinator";
import { buildServer } from "../src/server";
import type { GameDb } from "../src/services/auth";
import { resolveSession } from "../src/services/auth";
import { catalog } from "../src/services/puzzle-catalog";
import { puzzleAction } from "../src/services/puzzle-service";
import { songPacks } from "../src/services/song-packs";
import * as songProvider from "../src/services/song-preview";
import { previewFixture } from "./fixtures/song-recording";

vi.mock("node:crypto", async (importOriginal) => {
	const actual = await importOriginal<typeof crypto>();
	return { ...actual, randomInt: vi.fn(actual.randomInt) };
});

let db: PGlite;
let storage: GameDb;
let app: ReturnType<typeof buildServer>;
afterEach(() => {
	vi.mocked(crypto.randomInt).mockReset();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
it("requires authentication to load a song clip", async () => {
	const response = await app.inject({
		method: "POST",
		url: "/v1/games/unknown/puzzles/clip",
		payload: { puzzleId: "unknown" },
	});
	expect(response.statusCode).toBe(401);
});

it.each([
	"taylor-swift",
	"ed-sheeran",
	"adele",
	"imagine-dragons",
	"kpop",
	"songs-2000s",
	"songs-2010s",
	"songs-2020s",
])(
	"plays a real song clip from %s with a theme-specific answer list",
	async (theme) => {
		vi.stubGlobal("fetch", previewFixture);
		const { id, tokens } = await setup(theme, "MUSIC", 1);
		const p = (await snapshot(id, tokens[0])).puzzles;
		const total = songPacks[theme as keyof typeof songPacks].length;
		expect(p.round.total).toBe(total);
		expect(p.options).toHaveLength(total);
		const response = await app.inject({
			method: "POST",
			url: `/v1/games/${id}/puzzles/clip`,
			headers: { authorization: `Bearer ${tokens[0]}` },
			payload: { puzzleId: p.puzzle.id },
		});
		expect(response.statusCode).toBe(200);
		const wav = Buffer.from(response.json().media.split(",")[1], "base64");
		expect(wav.length).toBe(44 + 2 * 32000);
		expect(await answerFor(p.round.id, p.puzzle.id)).toMatch(
			new RegExp(`^${theme}-`),
		);
		await tick(storage, () => new Date(p.round.endsAt));
		expect(
			(
				await action(id, tokens[0], {
					kind: "theme",
					roundId: p.round.id,
					theme,
				})
			).statusCode,
		).toBe(200);
		expect(
			(
				await action(id, tokens[0], {
					kind: "format",
					roundId: p.round.id,
					format: "MUSIC",
				})
			).statusCode,
		).toBe(200);
		expect((await snapshot(id, tokens[0])).puzzles.round.theme).toBe(theme);
	},
);
beforeAll(async () => {
	db = new PGlite();
	for (const file of (await readdir(new URL("../migrations/", import.meta.url)))
		.filter((f) => f.endsWith(".sql"))
		.sort()) {
		await db.exec(
			await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
		);
	}
	storage = {
		query: (sql, values) => db.query(sql, values),
		end: () => db.close(),
		transaction: (run) => db.transaction((tx) => run(tx)),
	};
	app = buildServer(storage);
});
afterAll(async () => {
	await app?.close();
});

async function setup(theme = "animals", format = "TRIVIA", count = 3) {
	const created = (
		await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: {
				name: "Puzzle trip",
				teamName: "Host car",
				roundIntervalSeconds: 300,
				puzzleSetup: { theme, format },
			},
		})
	).json();
	const tokens = [created.hostToken];
	for (let i = 1; i < count; i++)
		tokens.push(
			(
				await app.inject({
					method: "POST",
					url: `/v1/games/${created.game.joinCode}/teams`,
					payload: { name: `Car ${i}` },
				})
			).json().captainToken,
		);
	const start = await app.inject({
		method: "POST",
		url: `/v1/games/${created.game.id}/start`,
		headers: { authorization: `Bearer ${created.hostToken}` },
		payload: { practice: count === 1 },
	});
	expect(start.statusCode).toBe(200);
	return { id: created.game.id as string, tokens };
}
async function snapshot(id: string, token: string) {
	const response = await app.inject({
		method: "GET",
		url: `/v1/games/${id}/snapshot`,
		headers: { authorization: `Bearer ${token}` },
	});
	expect(response.statusCode).toBe(200);
	return response.json();
}
async function action(id: string, token: string, body: object) {
	return app.inject({
		method: "POST",
		url: `/v1/games/${id}/puzzles/actions`,
		headers: { authorization: `Bearer ${token}` },
		payload: body,
	});
}
async function answerFor(roundId: string, puzzleId: string) {
	const result = await db.query<{ puzzle_ids: string[] }>(
		"SELECT puzzle_ids FROM puzzle_rounds WHERE id=$1",
		[roundId],
	);
	const internalId =
		result.rows[0].puzzle_ids[Number(puzzleId.split("/").at(-1))];
	return catalog.find((p) => p.id === internalId)?.answerId as string;
}

it("reveals a song only to the giving-up car, persists it, and awards no points", async () => {
	const { id, tokens } = await setup("kpop", "MUSIC", 2);
	const before = (await snapshot(id, tokens[0])).puzzles;
	const target = await answerFor(before.round.id, before.puzzle.id);
	const name = before.options.find((o: { id: string }) => o.id === target).name;
	expect(before.puzzle.revealedAnswer).toBeUndefined();
	const giveUp = {
		kind: "give-up",
		roundId: before.round.id,
		puzzleId: before.puzzle.id,
	};
	expect((await action(id, tokens[0], giveUp)).statusCode).toBe(200);
	// A retry after a lost response is safe.
	expect((await action(id, tokens[0], giveUp)).statusCode).toBe(200);
	const revealed = (await snapshot(id, tokens[0])).puzzles;
	expect(revealed.puzzle.id).toBe(before.puzzle.id);
	expect(revealed.puzzle.revealedAnswer).toBe(name);
	expect(revealed.solved).toBe(0);
	expect(revealed.skipped).toEqual([]);
	const other = (await snapshot(id, tokens[1])).puzzles;
	expect(other.puzzle.id).toBe(before.puzzle.id);
	expect(other.puzzle.revealedAnswer).toBeUndefined();
	expect(
		(
			await action(id, tokens[0], {
				kind: "guess",
				roundId: before.round.id,
				puzzleId: before.puzzle.id,
				answerId: target,
			})
		).statusCode,
	).toBe(409);
	expect(
		(
			await action(id, tokens[1], {
				kind: "guess",
				roundId: before.round.id,
				puzzleId: before.puzzle.id,
				answerId: target,
			})
		).json().result.pointsAwarded,
	).toBe(1);
	expect(
		(
			await action(id, tokens[0], {
				kind: "next",
				roundId: before.round.id,
				puzzleId: before.puzzle.id,
			})
		).statusCode,
	).toBe(200);
	const next = (await snapshot(id, tokens[0])).puzzles;
	expect(next.puzzle.id).not.toBe(before.puzzle.id);
	expect(next.puzzle.revealedAnswer).toBeUndefined();
	expect(next.solved).toBe(0);
	expect(
		(
			await action(id, tokens[0], {
				kind: "revisit",
				roundId: before.round.id,
				puzzleId: before.puzzle.id,
			})
		).statusCode,
	).toBe(422);
	// Final scoring also excludes the revealed song.
	await tick(storage, () => new Date(before.round.endsAt));
	const results = await snapshot(id, tokens[0]);
	expect(results.callerTeam.score).toBe(0);
	expect(
		results.puzzles.results.find(
			(t: { teamId: string }) => t.teamId === results.callerTeam.id,
		).solved,
	).toBe(0);
});

it("requires Next song to leave a revealed song, even through older skip/revisit actions", async () => {
	const { id, tokens } = await setup("kpop", "MUSIC", 1);
	const first = (await snapshot(id, tokens[0])).puzzles;
	expect(
		(
			await action(id, tokens[0], {
				kind: "skip",
				roundId: first.round.id,
				puzzleId: first.puzzle.id,
			})
		).statusCode,
	).toBe(200);
	const current = (await snapshot(id, tokens[0])).puzzles;
	expect(
		(
			await action(id, tokens[0], {
				kind: "give-up",
				roundId: current.round.id,
				puzzleId: current.puzzle.id,
			})
		).statusCode,
	).toBe(200);
	expect(
		(
			await action(id, tokens[0], {
				kind: "skip",
				roundId: current.round.id,
				puzzleId: current.puzzle.id,
			})
		).statusCode,
	).toBe(409);
	expect(
		(
			await action(id, tokens[0], {
				kind: "revisit",
				roundId: current.round.id,
				puzzleId: first.puzzle.id,
			})
		).statusCode,
	).toBe(409);
	expect((await snapshot(id, tokens[0])).puzzles.puzzle.id).toBe(
		current.puzzle.id,
	);
});

it("can give up the final song and reach the end without replaying it or scoring", async () => {
	const { id, tokens } = await setup("kpop", "MUSIC", 1);
	const before = (await snapshot(id, tokens[0])).puzzles;
	await db.query(
		"UPDATE puzzle_rounds SET puzzle_ids=puzzle_ids[1:1] WHERE id=$1",
		[before.round.id],
	);
	const current = (await snapshot(id, tokens[0])).puzzles;
	expect(current.round.total).toBe(1);
	expect(
		(
			await action(id, tokens[0], {
				kind: "give-up",
				roundId: current.round.id,
				puzzleId: current.puzzle.id,
			})
		).statusCode,
	).toBe(200);
	expect(
		(
			await action(id, tokens[0], {
				kind: "next",
				roundId: current.round.id,
				puzzleId: current.puzzle.id,
			})
		).statusCode,
	).toBe(200);
	const exhausted = (await snapshot(id, tokens[0])).puzzles;
	expect(exhausted.puzzle).toBeNull();
	expect(exhausted.solved).toBe(0);
	expect(exhausted.skipped).toEqual([]);
});

it("does not allow next-song actions to skip an unrevealed song", async () => {
	const { id, tokens } = await setup("kpop", "MUSIC", 1);
	const p = (await snapshot(id, tokens[0])).puzzles;
	expect(
		(
			await action(id, tokens[0], {
				kind: "next",
				roundId: p.round.id,
				puzzleId: p.puzzle.id,
			})
		).statusCode,
	).toBe(409);
	expect((await snapshot(id, tokens[0])).puzzles.puzzle.id).toBe(p.puzzle.id);
});

it("rejects give-up for other formats, stale puzzles, and expired rounds", async () => {
	const animal = await setup("animals", "TRIVIA", 1);
	const a = (await snapshot(animal.id, animal.tokens[0])).puzzles;
	expect(
		(
			await action(animal.id, animal.tokens[0], {
				kind: "give-up",
				roundId: a.round.id,
				puzzleId: a.puzzle.id,
			})
		).statusCode,
	).toBe(422);
	const { id, tokens } = await setup("kpop", "MUSIC", 1);
	const p = (await snapshot(id, tokens[0])).puzzles;
	expect(
		(
			await action(id, tokens[0], {
				kind: "give-up",
				roundId: p.round.id,
				puzzleId: `${p.round.id}/1`,
			})
		).statusCode,
	).toBe(409);
	await tick(storage, () => new Date(p.round.endsAt));
	expect(
		(
			await action(id, tokens[0], {
				kind: "give-up",
				roundId: p.round.id,
				puzzleId: p.puzzle.id,
			})
		).statusCode,
	).toBe(409);
});

it("rejects legacy melody guesses in new song rounds", async () => {
	const { id, tokens } = await setup("melodies", "MUSIC", 1);
	const p = (await snapshot(id, tokens[0])).puzzles;
	expect(
		(
			await action(id, tokens[0], {
				kind: "guess",
				roundId: p.round.id,
				puzzleId: p.puzzle.id,
				answerId: "song-0",
			})
		).statusCode,
	).toBe(422);
});

it("serves only each team's unlocked song clip and rejects tampered or stale requests", async () => {
	vi.stubGlobal("fetch", previewFixture);
	const { id, tokens } = await setup("melodies", "MUSIC", 2);
	const other = await setup("melodies", "MUSIC", 1);
	const p = (await snapshot(id, tokens[0])).puzzles;
	const clip = (token: string, payload: object = { puzzleId: p.puzzle.id }) =>
		app.inject({
			method: "POST",
			url: `/v1/games/${id}/puzzles/clip`,
			headers: { authorization: `Bearer ${token}` },
			payload,
		});
	const duration = async (token: string) => {
		const response = await clip(token);
		expect(response.statusCode).toBe(200);
		expect(response.headers["cache-control"]).toBe("no-store");
		const wav = Buffer.from(response.json().media.split(",")[1], "base64");
		return wav.readUInt32LE(40) / wav.readUInt32LE(28);
	};
	expect(await duration(tokens[0])).toBe(2);
	expect((await clip(other.tokens[0])).statusCode).toBe(403);
	expect(
		(await clip(tokens[0], { puzzleId: p.puzzle.id, seconds: 15 })).statusCode,
	).toBe(422);
	const target = await answerFor(p.round.id, p.puzzle.id);
	const wrong = p.options.filter((o: { id: string }) => o.id !== target);
	for (let i = 0; i < 4; i++) {
		expect(
			(
				await action(id, tokens[0], {
					kind: "guess",
					roundId: p.round.id,
					puzzleId: p.puzzle.id,
					answerId: wrong[i].id,
				})
			).statusCode,
		).toBe(200);
		expect(await duration(tokens[0])).toBe([4, 8, 15, 15][i]);
	}
	expect(await duration(tokens[1])).toBe(2);
	await action(id, tokens[0], {
		kind: "skip",
		roundId: p.round.id,
		puzzleId: p.puzzle.id,
	});
	expect((await clip(tokens[0])).statusCode).toBe(409);
	await db.query(
		"UPDATE puzzle_rounds SET starts_at=$2,ends_at=$3 WHERE id=$1",
		[p.round.id, new Date(Date.now() - 10000), new Date(Date.now() - 1000)],
	);
	expect((await clip(tokens[1])).statusCode).toBe(409);
});

it("keeps saved synthesized melody rounds playable", async () => {
	const { id, tokens } = await setup("melodies", "MUSIC", 1);
	const p = (await snapshot(id, tokens[0])).puzzles;
	await db.query("UPDATE puzzle_rounds SET puzzle_ids=$2 WHERE id=$1", [
		p.round.id,
		["music-song-0", "music-song-1"],
	]);
	const saved = (await snapshot(id, tokens[0])).puzzles;
	expect(saved.puzzle.media).toMatch(/^data:audio\/wav;base64,/);
	expect(saved.options.map((o: { id: string }) => o.id)).toEqual([
		"song-0",
		"song-1",
	]);
	expect(
		(
			await action(id, tokens[0], {
				kind: "guess",
				roundId: saved.round.id,
				puzzleId: saved.puzzle.id,
				answerId: "song-0",
			})
		).statusCode,
	).toBe(200);
});

it("offers a recoverable error for unavailable song previews and denies cars that left", async () => {
	vi.spyOn(songProvider, "songPreview").mockRejectedValue(
		new Error("Provider unavailable"),
	);
	const { id, tokens } = await setup("melodies", "MUSIC", 2);
	const p = (await snapshot(id, tokens[0])).puzzles;
	const clip = () =>
		app.inject({
			method: "POST",
			url: `/v1/games/${id}/puzzles/clip`,
			headers: { authorization: `Bearer ${tokens[1]}` },
			payload: { puzzleId: p.puzzle.id },
		});
	const unavailable = await clip();
	expect(unavailable.statusCode).toBe(503);
	expect(unavailable.json().error.code).toBe("CLIP_UNAVAILABLE");
	await app.inject({
		method: "POST",
		url: `/v1/games/${id}/leave`,
		headers: { authorization: `Bearer ${tokens[1]}` },
		payload: {},
	});
	expect((await clip()).statusCode).toBe(403);
});

it("opens a timed shared sequence with private guesses, repeat protection and restored skip state", async () => {
	const { id, tokens } = await setup();
	const first = await snapshot(id, tokens[0]);
	const other = await snapshot(id, tokens[1]);
	expect(first.puzzles.round.endsAt).toBeTruthy();
	expect(first.puzzles.puzzle.id).toBe(other.puzzles.puzzle.id);
	expect(first.round).toBeNull();
	const roundId = first.puzzles.round.id;
	const puzzleId = first.puzzles.puzzle.id;
	const target = await answerFor(roundId, puzzleId);
	const wrong = first.puzzles.options.find(
		(o: { id: string }) => o.id !== target,
	).id;
	expect(
		(
			await action(id, tokens[0], {
				kind: "guess",
				roundId,
				puzzleId,
				answerId: wrong,
			})
		).statusCode,
	).toBe(200);
	const guessed = (await snapshot(id, tokens[0])).puzzles;
	expect(guessed.puzzle.guesses).toHaveLength(1);
	expect(guessed.puzzle.guesses[0].feedback).toEqual([]);
	expect((await snapshot(id, tokens[1])).puzzles.puzzle.guesses).toHaveLength(
		0,
	);
	expect(JSON.stringify(guessed.puzzle)).not.toContain('"answerId"');
	await action(id, tokens[0], {
		kind: "guess",
		roundId,
		puzzleId,
		answerId: wrong,
	});
	expect((await snapshot(id, tokens[0])).puzzles.puzzle.guesses).toHaveLength(
		1,
	);
	await action(id, tokens[0], { kind: "skip", roundId, puzzleId });
	expect((await snapshot(id, tokens[0])).puzzles.puzzle.id).not.toBe(puzzleId);
	await action(id, tokens[0], { kind: "revisit", roundId, puzzleId });
	const revisited = (await snapshot(id, tokens[0])).puzzles;
	expect(revisited.puzzle.id).toBe(puzzleId);
	expect(revisited.puzzle.guesses).toHaveLength(1);
	await action(id, tokens[0], {
		kind: "guess",
		roundId,
		puzzleId,
		answerId: target,
	});
	await action(id, tokens[0], {
		kind: "guess",
		roundId,
		puzzleId,
		answerId: target,
	});
	expect((await snapshot(id, tokens[0])).puzzles.solved).toBe(1);
});

it("scores once at expiry and lets two distinct lowest cars choose the next round", async () => {
	const { id, tokens } = await setup();
	const view = (await snapshot(id, tokens[0])).puzzles;
	await action(id, tokens[0], {
		kind: "guess",
		roundId: view.round.id,
		puzzleId: view.puzzle.id,
		answerId: await answerFor(view.round.id, view.puzzle.id),
	});
	const deadline = new Date(view.round.endsAt);
	const live = await snapshot(id, tokens[0]);
	expect(live.callerTeam.score).toBe(1);
	expect(live.leaderboard[0].score).toBe(1);
	await tick(storage, () => deadline);
	await tick(storage, () => deadline);
	const ended = await snapshot(id, tokens[0]);
	expect(ended.puzzles.round.status).toBe("RESULTS");
	expect(ended.callerTeam.score).toBe(1);
	expect(
		ended.puzzles.results.find(
			(r: { teamId: string }) => r.teamId === ended.callerTeam.id,
		).solved,
	).toBe(1);
	expect(ended.puzzles.selection.themeTeamId).not.toBe(
		ended.puzzles.selection.formatTeamId,
	);
	const bodies = await Promise.all(tokens.map((t) => snapshot(id, t)));
	const themeToken =
		tokens[
			bodies.findIndex(
				(b) => b.callerTeam.id === ended.puzzles.selection.themeTeamId,
			)
		];
	const formatToken =
		tokens[
			bodies.findIndex(
				(b) => b.callerTeam.id === ended.puzzles.selection.formatTeamId,
			)
		];
	const roundId = view.round.id;
	expect(
		(await action(id, tokens[0], { kind: "theme", roundId, theme: "animals" }))
			.statusCode,
	).toBe(403);
	expect(
		(
			await action(id, formatToken, {
				kind: "format",
				roundId,
				format: "PICTURE",
			})
		).statusCode,
	).toBe(409);
	expect(
		(await action(id, themeToken, { kind: "theme", roundId, theme: "animals" }))
			.statusCode,
	).toBe(200);
	expect(
		(
			await action(id, formatToken, {
				kind: "format",
				roundId,
				format: "MUSIC",
			})
		).statusCode,
	).toBe(422);
	expect(
		(
			await action(id, formatToken, {
				kind: "format",
				roundId,
				format: "PICTURE",
			})
		).statusCode,
	).toBe(200);
	expect((await snapshot(id, themeToken)).puzzles.round.sequence).toBe(2);
	expect(
		(
			await action(id, themeToken, {
				kind: "theme",
				roundId,
				theme: "melodies",
			})
		).statusCode,
	).toBe(409);
});

it("returns immediate correct and incorrect feedback before advancing puzzles", async () => {
	const { id, tokens } = await setup();
	const view = (await snapshot(id, tokens[0])).puzzles;
	const target = await answerFor(view.round.id, view.puzzle.id);
	const wrong = view.options.find((o: { id: string }) => o.id !== target).id;
	for (const answerId of [wrong, target]) {
		const response = await action(id, tokens[0], {
			kind: "guess",
			roundId: view.round.id,
			puzzleId: view.puzzle.id,
			answerId,
		});
		expect(response.json().result).toMatchObject({
			correct: answerId === target,
			pointsAwarded: answerId === target ? 1 : 0,
		});
	}
	expect((await snapshot(id, tokens[0])).puzzles.puzzle.id).not.toBe(
		view.puzzle.id,
	);
});

it.each(
	PUZZLE_PACKS.flatMap((pack) =>
		pack.formats.map((format) => ({ theme: pack.id, format })),
	),
)("shuffles $theme/$format without duplicates", async ({ theme, format }) => {
	vi.mocked(crypto.randomInt).mockImplementation(() => 0);
	const { id, tokens } = await setup(theme, format, 1);
	const view = (await snapshot(id, tokens[0])).puzzles;
	const expected = catalog
		.filter((p) => !p.legacy && p.theme === theme && p.format === format)
		.map((p) => p.id);
	const { rows } = await db.query<{ puzzle_ids: string[] }>(
		"SELECT puzzle_ids FROM puzzle_rounds WHERE id=$1",
		[view.round.id],
	);
	expect([...rows[0].puzzle_ids].sort()).toEqual([...expected].sort());
	expect(rows[0].puzzle_ids).not.toEqual(expected);
});

it("validates guesses, rejects cross-game tokens and stops expired and departed teams", async () => {
	const first = await setup();
	const second = await setup();
	const p = (await snapshot(first.id, first.tokens[1])).puzzles;
	const guess = {
		kind: "guess",
		roundId: p.round.id,
		puzzleId: p.puzzle.id,
		answerId: "missing",
	};
	expect((await action(first.id, second.tokens[1], guess)).statusCode).toBe(
		403,
	);
	expect((await action(first.id, first.tokens[1], guess)).statusCode).toBe(422);
	expect(
		(
			await app.inject({
				method: "POST",
				url: `/v1/games/${first.id}/puzzles/actions`,
				payload: guess,
			})
		).statusCode,
	).toBe(401);
	await db.query(
		"UPDATE puzzle_rounds SET starts_at=$2,ends_at=$3 WHERE id=$1",
		[p.round.id, new Date(Date.now() - 10000), new Date(Date.now() - 1000)],
	);
	expect(
		(
			await action(first.id, first.tokens[1], {
				...guess,
				answerId: p.options[0].id,
			})
		).statusCode,
	).toBe(409);
	await app.inject({
		method: "POST",
		url: `/v1/games/${second.id}/leave`,
		headers: { authorization: `Bearer ${second.tokens[1]}` },
		payload: {},
	});
	const q = (await snapshot(second.id, second.tokens[0])).puzzles;
	expect(
		(
			await action(second.id, second.tokens[1], {
				kind: "skip",
				roundId: q.round.id,
				puzzleId: q.puzzle.id,
			})
		).statusCode,
	).toBe(403);
});

it.each(
	PUZZLE_PACKS.flatMap((pack) =>
		pack.formats.map((format) => [pack.id, format]),
	),
)(
	"plays starter pack %s / %s and ends with durable totals",
	async (theme, format) => {
		const { id, tokens } = await setup(theme, format, 1);
		const p = (await snapshot(id, tokens[0])).puzzles;
		if (format === "PICTURE")
			expect(p.puzzle.media).toMatch(/^data:image\/png;base64,/);
		if (format === "MUSIC") expect(p.puzzle.media).toBe("song-clip:2");
		const target = await answerFor(p.round.id, p.puzzle.id);
		expect(
			(
				await action(id, tokens[0], {
					kind: "guess",
					roundId: p.round.id,
					puzzleId: p.puzzle.id,
					answerId: target,
				})
			).statusCode,
		).toBe(200);
		const end = await app.inject({
			method: "POST",
			url: `/v1/games/${id}/end`,
			headers: { authorization: `Bearer ${tokens[0]}` },
			payload: {},
		});
		expect(end.statusCode).toBe(200);
		expect(end.json().leaderboard[0].score).toBe(1);
		expect((await snapshot(id, tokens[0])).puzzles.round.status).toBe(
			"RESULTS",
		);
	},
);

// This integration case submits every question in the expanded 300-question pack.
it("keeps skipped puzzles reachable after exhausting a pack and never counts a solve twice", async () => {
	const { id, tokens } = await setup("animals", "TRIVIA", 1);
	let view = (await snapshot(id, tokens[0])).puzzles;
	const first = view.puzzle.id;
	await action(id, tokens[0], {
		kind: "skip",
		roundId: view.round.id,
		puzzleId: first,
	});
	view = (await snapshot(id, tokens[0])).puzzles;
	while (view.puzzle) {
		await action(id, tokens[0], {
			kind: "guess",
			roundId: view.round.id,
			puzzleId: view.puzzle.id,
			answerId: await answerFor(view.round.id, view.puzzle.id),
		});
		view = (await snapshot(id, tokens[0])).puzzles;
	}
	expect(view.solved).toBe(view.round.total - 1);
	expect(view.skipped).toEqual([{ id: first, number: 1 }]);
	await action(id, tokens[0], {
		kind: "revisit",
		roundId: view.round.id,
		puzzleId: first,
	});
	await action(id, tokens[0], {
		kind: "guess",
		roundId: view.round.id,
		puzzleId: first,
		answerId: await answerFor(view.round.id, first),
	});
	expect((await snapshot(id, tokens[0])).puzzles.solved).toBe(view.round.total);
	expect(
		(
			await action(id, tokens[0], {
				kind: "revisit",
				roundId: view.round.id,
				puzzleId: first,
			})
		).statusCode,
	).toBe(422);
}, 30000);

it("reassigns chooser roles after a car leaves and caps the final round at the two-hour deadline", async () => {
	const { id, tokens } = await setup();
	const first = (await snapshot(id, tokens[0])).puzzles;
	await action(id, tokens[0], {
		kind: "guess",
		roundId: first.round.id,
		puzzleId: first.puzzle.id,
		answerId: await answerFor(first.round.id, first.puzzle.id),
	});
	await tick(storage, () => new Date(first.round.endsAt));
	const results = (await snapshot(id, tokens[0])).puzzles;
	const all = await Promise.all(tokens.map((t) => snapshot(id, t)));
	const departed =
		tokens[
			all.findIndex((v) => v.callerTeam.id === results.selection.themeTeamId)
		];
	expect(
		(
			await app.inject({
				method: "POST",
				url: `/v1/games/${id}/leave`,
				headers: { authorization: `Bearer ${departed}` },
				payload: {},
			})
		).statusCode,
	).toBe(200);
	await tick(storage);
	const repaired = (await snapshot(id, tokens[0])).puzzles;
	expect(repaired.selection.themeTeamId).not.toBe(
		results.selection.themeTeamId,
	);
	expect(repaired.selection.themeTeamId).not.toBe(
		repaired.selection.formatTeamId,
	);
	const themeToken =
		tokens[
			all.findIndex((v) => v.callerTeam.id === repaired.selection.themeTeamId)
		];
	const formatToken =
		tokens[
			all.findIndex((v) => v.callerTeam.id === repaired.selection.formatTeamId)
		];
	await action(id, themeToken, {
		kind: "theme",
		roundId: first.round.id,
		theme: "animals",
	});
	const start = (
		await db.query<{ started_at: Date }>(
			"SELECT started_at FROM games WHERE id=$1",
			[id],
		)
	).rows[0].started_at;
	const limit = new Date(new Date(start).getTime() + 7200000);
	const session = await resolveSession(formatToken, storage);
	if (!session) throw new Error("Missing fixture session");
	await puzzleAction(
		id,
		{ kind: "format", roundId: first.round.id, format: "PICTURE" },
		session,
		storage,
		() => new Date(limit.getTime() - 500),
	);
	const next = (await snapshot(id, formatToken)).puzzles;
	expect(next.round.endsAt).toBe(limit.toISOString());
	await tick(storage, () => limit);
	expect((await snapshot(id, formatToken)).game.completionReason).toBe(
		"TIME_LIMIT",
	);
});
