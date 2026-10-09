import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PUZZLE_PACKS } from "../../../packages/contracts/src/puzzles";
import { tick } from "../src/coordinator";
import { buildServer } from "../src/server";
import type { GameDb } from "../src/services/auth";
import { resolveSession } from "../src/services/auth";
import { catalog } from "../src/services/puzzle-catalog";
import { puzzleAction } from "../src/services/puzzle-service";

let db: PGlite;
let storage: GameDb;
let app: ReturnType<typeof buildServer>;
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

async function setup(theme = "naruto", format = "CHARACTER", count = 3) {
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

it("opens a timed shared sequence with private attribute feedback, repeat protection and restored skip state", async () => {
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
	expect(guessed.puzzle.guesses[0].feedback.length).toBeGreaterThan(0);
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
		(await action(id, themeToken, { kind: "theme", roundId, theme: "naruto" }))
			.statusCode,
	).toBe(409);
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
		if (format === "MUSIC")
			expect(p.puzzle.media).toMatch(/^data:audio\/wav;base64,/);
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
	expect(view.solved).toBe(7);
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
	expect((await snapshot(id, tokens[0])).puzzles.solved).toBe(8);
	expect(
		(
			await action(id, tokens[0], {
				kind: "revisit",
				roundId: view.round.id,
				puzzleId: first,
			})
		).statusCode,
	).toBe(422);
});

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
