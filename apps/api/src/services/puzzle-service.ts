import { randomInt, randomUUID } from "node:crypto";
import {
	type PuzzleAction,
	type PuzzleSetup,
	PuzzleSetupSchema,
	type PuzzleView,
} from "../../../../packages/contracts/src/puzzles";
import type { GameDb, QueryDb, Session } from "./auth";
import { catalog, clueMedia, entries, feedback } from "./puzzle-catalog";
import {
	getUnavailableSongTrackIds,
	recordSongPreviewResult,
} from "./song-availability";
import {
	describeSongPreviewError,
	songPreview,
	warmSongPreviews,
} from "./song-preview";

export type SongPreviewLogger = (
	details: Record<string, unknown>,
	message: string,
) => void;
const puzzlesById = new Map(catalog.map((puzzle) => [puzzle.id, puzzle]));
function trackForPuzzle(id: string) {
	const puzzle = puzzlesById.get(id);
	return entries[puzzle?.theme ?? ""]?.find((e) => e.id === puzzle?.answerId)
		?.trackId;
}
function previewError(
	error: unknown,
	trackId: number,
	log?: SongPreviewLogger,
) {
	const details = describeSongPreviewError(error);
	log?.({ trackId, ...details }, "Song preview failed");
	return new PuzzleError(
		503,
		details.code === "TRACK_UNAVAILABLE"
			? "CLIP_UNAVAILABLE"
			: details.stage === "decode"
				? "CLIP_DECODE_FAILED"
				: "CLIP_TEMPORARILY_UNAVAILABLE",
		details.code === "TRACK_UNAVAILABLE"
			? "Preview unavailable for this recording. Skip this song and revisit it later."
			: details.stage === "decode"
				? "Couldn't prepare this song clip. Retry or skip this song."
				: "The song provider is temporarily unavailable. Retry or skip this song.",
	);
}

// Prepare outside game transactions: the round timer starts only after this returns.
export async function prepareSongRound(
	theme: PuzzleSetup["theme"],
	db: QueryDb,
	log?: SongPreviewLogger,
) {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			stopped = true;
			log?.(
				{ code: "PREPARATION_TIMEOUT", stage: "preparation", retryable: true },
				"Song round preparation timed out",
			);
			reject(
				new PuzzleError(
					503,
					"CLIP_TEMPORARILY_UNAVAILABLE",
					"Song preparation is taking too long. Try again or choose another pack.",
				),
			);
		}, 30000);
	});
	try {
		return await Promise.race([
			prepareSongRoundWork(theme, db, log, () => stopped),
			timeout,
		]);
	} finally {
		clearTimeout(timer);
	}
}
async function prepareSongRoundWork(
	theme: PuzzleSetup["theme"],
	db: QueryDb,
	log: SongPreviewLogger | undefined,
	stopped: () => boolean,
) {
	const unavailable = await getUnavailableSongTrackIds(db);
	const ids = shuffled(
		catalog
			.filter(
				(p) =>
					!p.legacy &&
					p.theme === theme &&
					p.format === "MUSIC" &&
					trackForPuzzle(p.id) !== undefined &&
					!unavailable.has(trackForPuzzle(p.id) ?? 0),
			)
			.map((p) => p.id),
	);
	let attempts = 0;
	while (ids.length) {
		if (stopped()) return ids;
		const trackId = trackForPuzzle(ids[0]);
		if (trackId === undefined)
			throw new PuzzleError(422, "NOT_A_SONG", "This puzzle has no song clip");
		try {
			await songPreview(trackId, 2);
			if (stopped()) return ids;
			await recordSongPreviewResult(db, trackId);
			void warmSongPreviews(
				ids
					.slice(1, 3)
					.map(trackForPuzzle)
					.filter((id): id is number => id !== undefined),
			);
			return ids;
		} catch (error) {
			if (stopped()) throw error;
			await recordSongPreviewResult(db, trackId, error);
			const failure = previewError(error, trackId, log);
			if (
				describeSongPreviewError(error).code !== "TRACK_UNAVAILABLE" ||
				++attempts >= 5
			)
				throw failure;
			ids.shift();
		}
	}
	throw new PuzzleError(
		503,
		"PACK_UNAVAILABLE",
		"No playable previews are currently available in this pack. Choose another pack or try again later.",
	);
}

type Rows<T> = { rows: T[] };
type Round = {
	id: string;
	game_id: string;
	sequence: number;
	theme: PuzzleSetup["theme"];
	format: PuzzleSetup["format"];
	status: "OPEN" | "RESULTS";
	starts_at: Date;
	ends_at: Date;
	puzzle_ids: string[];
	theme_team_id: string | null;
	format_team_id: string | null;
	next_theme: PuzzleSetup["theme"] | null;
};
type Progress = {
	team_id: string;
	current_index: number;
	guesses: Record<string, string[]>;
	solved: string[];
	skipped: string[];
	given_up: string[];
	tie_order: number;
};
function publicPuzzleId(round: Round, index: number) {
	return `${round.id}/${index}`;
}
export class PuzzleError extends Error {
	constructor(
		readonly statusCode: number,
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}
async function latest(gameId: string, tx: QueryDb) {
	return (
		(await tx.query(
			"SELECT * FROM puzzle_rounds WHERE game_id=$1 ORDER BY sequence DESC LIMIT 1",
			[gameId],
		)) as Rows<Round>
	).rows[0];
}
function shuffled<T>(values: T[]): T[] {
	const copy = [...values];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}
async function openRound(
	gameId: string,
	setup: PuzzleSetup,
	sequence: number,
	seconds: number,
	tx: QueryDb,
	now: Date,
	preparedIds?: string[],
) {
	let ids =
		preparedIds ??
		shuffled(
			catalog
				.filter(
					(p) =>
						!p.legacy && p.theme === setup.theme && p.format === setup.format,
				)
				.map((p) => p.id),
		);
	if (setup.format === "MUSIC") {
		const unavailable = await getUnavailableSongTrackIds(tx);
		ids = ids.filter((id) => {
			const trackId = trackForPuzzle(id);
			return trackId !== undefined && !unavailable.has(trackId);
		});
		// Availability may have changed while the first recording was preparing.
		if (preparedIds && ids[0] !== preparedIds[0])
			throw new PuzzleError(
				503,
				"CLIP_UNAVAILABLE",
				"This recording became unavailable. Try starting the round again.",
			);
	}
	if (!ids.length)
		throw new PuzzleError(422, "PACK_EMPTY", "This pack has no puzzles");
	const teams = (
		(await tx.query(
			"SELECT id FROM car_teams WHERE game_id=$1 AND status='ACTIVE' ORDER BY id",
			[gameId],
		)) as Rows<{ id: string }>
	).rows;
	const id = randomUUID();
	await tx.query(
		"INSERT INTO puzzle_rounds(id,game_id,sequence,theme,format,starts_at,ends_at,puzzle_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
		[
			id,
			gameId,
			sequence,
			setup.theme,
			setup.format,
			now,
			new Date(now.getTime() + seconds * 1000),
			ids,
		],
	);
	for (const [order, team] of shuffled(teams).entries())
		await tx.query(
			"INSERT INTO puzzle_progress(round_id,team_id,tie_order) VALUES($1,$2,$3)",
			[id, team.id, order],
		);
	await tx.query("UPDATE games SET next_round_at=NULL WHERE id=$1", [gameId]);
}

// Caller owns the game lock; both coordinator and start use this transition.
export async function advancePuzzleRound(
	gameId: string,
	setup: PuzzleSetup,
	seconds: number,
	tx: QueryDb,
	now: Date,
	preparedIds?: string[],
) {
	const round = await latest(gameId, tx);
	if (!round) await openRound(gameId, setup, 1, seconds, tx, now, preparedIds);
	else if (round.status === "OPEN" && now >= new Date(round.ends_at))
		await finishPuzzleRound(gameId, tx);
	else if (round.status === "RESULTS") await repairSelectors(round, tx);
}
async function ranked(round: Round, tx: QueryDb) {
	return (
		(await tx.query(
			`SELECT p.*,t.name,t.status FROM puzzle_progress p JOIN car_teams t ON t.id=p.team_id WHERE p.round_id=$1 ORDER BY cardinality(p.solved) DESC,p.tie_order`,
			[round.id],
		)) as Rows<Progress & { name: string; status: string }>
	).rows;
}
async function repairSelectors(round: Round, tx: QueryDb) {
	const candidates = (await ranked(round, tx))
		.filter((t) => t.status === "ACTIVE")
		.reverse();
	const themeTeamId = candidates.some((t) => t.team_id === round.theme_team_id)
		? round.theme_team_id
		: (candidates[0]?.team_id ?? null);
	const formatTeamId = candidates.some(
		(t) =>
			t.team_id === round.format_team_id &&
			(candidates.length < 2 || t.team_id !== themeTeamId),
	)
		? round.format_team_id
		: (candidates.find((t) => t.team_id !== themeTeamId)?.team_id ??
			themeTeamId);
	await tx.query(
		"UPDATE puzzle_rounds SET theme_team_id=$2,format_team_id=$3 WHERE id=$1",
		[round.id, themeTeamId, formatTeamId],
	);
	round.theme_team_id = themeTeamId;
	round.format_team_id = formatTeamId;
}
export async function finishPuzzleRound(gameId: string, tx: QueryDb) {
	const round = await latest(gameId, tx);
	if (round?.status !== "OPEN") return;
	await tx.query(
		"UPDATE car_teams t SET score=t.score+cardinality(p.solved) FROM puzzle_progress p WHERE p.round_id=$1 AND t.id=p.team_id",
		[round.id],
	);
	await tx.query("UPDATE puzzle_rounds SET status='RESULTS' WHERE id=$1", [
		round.id,
	]);
	round.status = "RESULTS";
	await repairSelectors(round, tx);
}

export async function getPuzzleView(
	gameId: string,
	teamId: string | null | undefined,
	tx: QueryDb,
): Promise<PuzzleView | undefined> {
	const round = await latest(gameId, tx);
	if (!round) return undefined;
	const progress = teamId
		? (
				(await tx.query(
					"SELECT * FROM puzzle_progress WHERE round_id=$1 AND team_id=$2",
					[round.id, teamId],
				)) as Rows<Progress>
			).rows[0]
		: undefined;
	const currentId =
		progress && round.status === "OPEN"
			? round.puzzle_ids[progress.current_index]
			: undefined;
	const puzzle = catalog.find((p) => p.id === currentId);
	const guesses = currentId ? (progress?.guesses[currentId] ?? []) : [];
	const results = round.status === "RESULTS" ? await ranked(round, tx) : [];
	const answerIds = new Set(
		round.puzzle_ids.map((id) => puzzlesById.get(id)?.answerId),
	);
	return {
		round: {
			id: round.id,
			sequence: round.sequence,
			theme: round.theme,
			format: round.format,
			status: round.status,
			startsAt: new Date(round.starts_at).toISOString(),
			endsAt: new Date(round.ends_at).toISOString(),
			total: round.puzzle_ids.length,
		},
		solved: progress?.solved.length ?? 0,
		puzzle:
			puzzle && progress
				? {
						id: publicPuzzleId(round, progress.current_index),
						number: progress.current_index + 1,
						prompt: puzzle.prompt,
						...(progress.given_up.includes(puzzle.id)
							? {
									revealedAnswer: entries[round.theme].find(
										(e) => e.id === puzzle.answerId,
									)?.name,
								}
							: {}),
						media: clueMedia(
							puzzle,
							guesses.filter((g) => g !== puzzle.answerId).length,
						),
						guesses: guesses.map((g) => feedback(puzzle, g)),
					}
				: null,
		skipped: (progress?.skipped ?? []).map((id) => ({
			id: publicPuzzleId(round, round.puzzle_ids.indexOf(id)),
			number: round.puzzle_ids.indexOf(id) + 1,
		})),
		options:
			round.status === "OPEN"
				? entries[round.theme]
						.filter((e) => answerIds.has(e.id))
						.map(({ id, name, aliases }) => ({
							id,
							name,
							aliases,
						}))
				: [],
		results: results.map((team, i) => ({
			teamId: team.team_id,
			name: team.name,
			solved: team.solved.length,
			rank:
				i === 0
					? 1
					: results.findIndex((t) => t.solved.length === team.solved.length) +
						1,
		})),
		selection: {
			themeTeamId: round.theme_team_id,
			formatTeamId: round.format_team_id,
			theme: round.next_theme,
		},
	};
}

export async function loadSongClue(
	gameId: string,
	puzzleId: string,
	session: Session,
	db: GameDb,
	log?: SongPreviewLogger,
) {
	const clue = await db.transaction(async (tx) => {
		if (session.gameId !== gameId || !session.teamId)
			throw new PuzzleError(
				403,
				"FORBIDDEN",
				"Your car cannot play in this game",
			);
		const game = (
			(await tx.query(
				"SELECT status,started_at FROM games WHERE id::text=$1 FOR SHARE",
				[gameId],
			)) as Rows<{ status: string; started_at: Date }>
		).rows[0];
		const team = (
			(await tx.query(
				"SELECT status FROM car_teams WHERE id=$1 AND game_id=$2",
				[session.teamId, gameId],
			)) as Rows<{ status: string }>
		).rows[0];
		if (team?.status !== "ACTIVE")
			throw new PuzzleError(403, "TEAM_LEFT", "Your car has left this game");
		const round = await latest(gameId, tx);
		if (
			game?.status !== "WAITING" ||
			!round ||
			round.status !== "OPEN" ||
			Date.now() >= new Date(round.ends_at).getTime() ||
			Date.now() >= new Date(game.started_at).getTime() + 7200000
		)
			throw new PuzzleError(409, "ROUND_CLOSED", "This song round has ended");
		const progress = (
			(await tx.query(
				"SELECT * FROM puzzle_progress WHERE round_id=$1 AND team_id=$2",
				[round.id, session.teamId],
			)) as Rows<Progress>
		).rows[0];
		if (!progress || puzzleId !== publicPuzzleId(round, progress.current_index))
			throw new PuzzleError(409, "STALE_PUZZLE", "This puzzle has changed");
		const puzzle = catalog.find(
			(p) => p.id === round.puzzle_ids[progress.current_index],
		);
		const trackId = entries[puzzle?.theme ?? ""]?.find(
			(e) => e.id === puzzle?.answerId,
		)?.trackId;
		if (puzzle?.format !== "MUSIC" || !trackId)
			throw new PuzzleError(422, "NOT_A_SONG", "This puzzle has no song clip");
		const mistakes = (progress.guesses[puzzle.id] ?? []).filter(
			(g) => g !== puzzle.answerId,
		).length;
		const upcoming = round.puzzle_ids
			.filter(
				(id) =>
					id !== puzzle.id &&
					!progress.solved.includes(id) &&
					!progress.skipped.includes(id) &&
					!progress.given_up.includes(id),
			)
			.slice(0, 2)
			.map(trackForPuzzle)
			.filter((id): id is number => id !== undefined);
		return { trackId, seconds: [2, 4, 8, 15][Math.min(3, mistakes)], upcoming };
	});
	// Network requests and decoding happen after releasing the game lock.
	try {
		const pending = songPreview(clue.trackId, clue.seconds);
		void warmSongPreviews(clue.upcoming);
		const media = await pending;
		await recordSongPreviewResult(db, clue.trackId);
		return { media };
	} catch (error) {
		await recordSongPreviewResult(db, clue.trackId, error);
		throw previewError(error, clue.trackId, log);
	}
}

export async function puzzleAction(
	gameId: string,
	action: PuzzleAction,
	session: Session,
	db: GameDb,
	clock = () => new Date(),
	log?: SongPreviewLogger,
) {
	let preparedIds: string[] | undefined;
	if (action.kind === "format" && action.format === "MUSIC") {
		const setup = await db.transaction(async (tx) => {
			// Validate the chooser first, then release the lock before provider requests.
			if (session.gameId !== gameId || !session.teamId)
				throw new PuzzleError(
					403,
					"FORBIDDEN",
					"Your car cannot play in this game",
				);
			const game = (
				(await tx.query(
					"SELECT status,started_at,puzzle_setup FROM games WHERE id::text=$1 FOR UPDATE",
					[gameId],
				)) as Rows<{
					status: string;
					started_at: Date;
					puzzle_setup: PuzzleSetup | null;
				}>
			).rows[0];
			if (!game) throw new PuzzleError(404, "GAME_NOT_FOUND", "Game not found");
			const team = (
				(await tx.query(
					"SELECT status FROM car_teams WHERE id=$1 AND game_id=$2",
					[session.teamId, gameId],
				)) as Rows<{ status: string }>
			).rows[0];
			if (team?.status !== "ACTIVE")
				throw new PuzzleError(403, "TEAM_LEFT", "Your car has left this game");
			if (
				game.status !== "WAITING" ||
				!game.puzzle_setup ||
				clock().getTime() >= new Date(game.started_at).getTime() + 7200000
			)
				throw new PuzzleError(
					409,
					"GAME_NOT_PLAYING",
					"This game is not accepting puzzle actions",
				);
			const round = await latest(gameId, tx);
			if (!round || action.roundId !== round.id)
				throw new PuzzleError(
					409,
					"STALE_ROUND",
					"This round has changed. Refresh and try again.",
				);
			if (round.status !== "RESULTS")
				throw new PuzzleError(
					409,
					"ROUND_NOT_FINISHED",
					"Wait for the round results",
				);
			await repairSelectors(round, tx);
			if (session.teamId !== round.format_team_id)
				throw new PuzzleError(
					403,
					"NOT_YOUR_PICK",
					"Another car chooses this part of the next round",
				);
			if (!round.next_theme)
				throw new PuzzleError(
					409,
					"THEME_REQUIRED",
					"The theme must be chosen first",
				);
			const parsed = PuzzleSetupSchema.safeParse({
				theme: round.next_theme,
				format: action.format,
			});
			if (!parsed.success)
				throw new PuzzleError(
					422,
					"UNSUPPORTED_FORMAT",
					"That theme does not support this game type",
				);
			return parsed.data;
		});
		preparedIds = await prepareSongRound(setup.theme, db, log);
	}
	return db.transaction(async (tx) => {
		let result:
			| { name: string; correct: boolean; pointsAwarded: 0 | 1 }
			| undefined;
		const game = (
			(await tx.query(
				"SELECT status,started_at,puzzle_setup,round_interval_seconds FROM games WHERE id::text=$1 FOR UPDATE",
				[gameId],
			)) as Rows<{
				status: string;
				started_at: Date;
				puzzle_setup: PuzzleSetup | null;
				round_interval_seconds: number;
			}>
		).rows[0];
		if (!game) throw new PuzzleError(404, "GAME_NOT_FOUND", "Game not found");
		if (session.gameId !== gameId || !session.teamId)
			throw new PuzzleError(
				403,
				"FORBIDDEN",
				"Your car cannot play in this game",
			);
		const team = (
			(await tx.query(
				"SELECT status FROM car_teams WHERE id=$1 AND game_id=$2",
				[session.teamId, gameId],
			)) as Rows<{ status: string }>
		).rows[0];
		if (team?.status !== "ACTIVE")
			throw new PuzzleError(403, "TEAM_LEFT", "Your car has left this game");
		const now = clock();
		if (
			game.status !== "WAITING" ||
			!game.puzzle_setup ||
			now.getTime() >= new Date(game.started_at).getTime() + 7200000
		)
			throw new PuzzleError(
				409,
				"GAME_NOT_PLAYING",
				"This game is not accepting puzzle actions",
			);
		const round = await latest(gameId, tx);
		if (!round || action.roundId !== round.id)
			throw new PuzzleError(
				409,
				"STALE_ROUND",
				"This round has changed. Refresh and try again.",
			);
		if (action.kind === "theme" || action.kind === "format") {
			if (round.status !== "RESULTS")
				throw new PuzzleError(
					409,
					"ROUND_NOT_FINISHED",
					"Wait for the round results",
				);
			await repairSelectors(round, tx);
			const chooser =
				action.kind === "theme" ? round.theme_team_id : round.format_team_id;
			if (session.teamId !== chooser)
				throw new PuzzleError(
					403,
					"NOT_YOUR_PICK",
					"Another car chooses this part of the next round",
				);
			if (action.kind === "theme") {
				if (round.next_theme)
					throw new PuzzleError(
						409,
						"THEME_ALREADY_CHOSEN",
						"The next theme has already been chosen",
					);
				await tx.query("UPDATE puzzle_rounds SET next_theme=$2 WHERE id=$1", [
					round.id,
					action.theme,
				]);
			} else {
				if (!round.next_theme)
					throw new PuzzleError(
						409,
						"THEME_REQUIRED",
						"The theme must be chosen first",
					);
				const parsed = PuzzleSetupSchema.safeParse({
					theme: round.next_theme,
					format: action.format,
				});
				if (!parsed.success)
					throw new PuzzleError(
						422,
						"UNSUPPORTED_FORMAT",
						"That theme does not support this game type",
					);
				const remaining =
					(new Date(game.started_at).getTime() + 7200000 - now.getTime()) /
					1000;
				await openRound(
					gameId,
					parsed.data,
					round.sequence + 1,
					Math.min(remaining, game.round_interval_seconds),
					tx,
					now,
					preparedIds,
				);
			}
		} else {
			if (round.status !== "OPEN" || now >= new Date(round.ends_at))
				throw new PuzzleError(
					409,
					"ROUND_EXPIRED",
					"Time is up. Wait for the round results.",
				);
			const progress = (
				(await tx.query(
					"SELECT * FROM puzzle_progress WHERE round_id=$1 AND team_id=$2",
					[round.id, session.teamId],
				)) as Rows<Progress>
			).rows[0];
			if (!progress)
				throw new PuzzleError(
					403,
					"FORBIDDEN",
					"Your car is not in this round",
				);
			const current = round.puzzle_ids[progress.current_index];
			if (
				progress.given_up.includes(current) &&
				action.kind !== "next" &&
				action.kind !== "give-up"
			)
				throw new PuzzleError(
					409,
					"SONG_REVEALED",
					"This song was revealed and cannot earn points. Choose Next song.",
				);
			const requestedId = round.puzzle_ids.find(
				(_, index) => publicPuzzleId(round, index) === action.puzzleId,
			);
			if (!requestedId)
				throw new PuzzleError(422, "PUZZLE_NOT_FOUND", "Puzzle unavailable");
			if (action.kind === "revisit") {
				if (!progress.skipped.includes(requestedId))
					throw new PuzzleError(
						422,
						"NOT_SKIPPED",
						"Choose one of your skipped puzzles",
					);
				const current = round.puzzle_ids[progress.current_index];
				if (
					current &&
					!progress.solved.includes(current) &&
					!progress.given_up.includes(current) &&
					!progress.skipped.includes(current)
				)
					progress.skipped.push(current);
				progress.current_index = round.puzzle_ids.indexOf(requestedId);
			} else {
				const currentId = round.puzzle_ids[progress.current_index];
				if (currentId !== requestedId)
					throw new PuzzleError(
						409,
						"STALE_PUZZLE",
						"This puzzle has changed. Refresh and try again.",
					);
				const puzzle = catalog.find((p) => p.id === currentId);
				if (!puzzle)
					throw new PuzzleError(422, "PUZZLE_NOT_FOUND", "Puzzle unavailable");
				if (
					(action.kind === "give-up" || action.kind === "next") &&
					round.format !== "MUSIC"
				)
					throw new PuzzleError(
						422,
						"NOT_A_SONG",
						"Only song puzzles can be revealed",
					);
				const givenUp = progress.given_up.includes(currentId);
				if (action.kind === "next" && !givenUp)
					throw new PuzzleError(
						409,
						"SONG_NOT_REVEALED",
						"Give up and reveal this song before continuing.",
					);
				if (action.kind === "give-up") {
					if (!givenUp) progress.given_up.push(currentId);
					progress.skipped = progress.skipped.filter((id) => id !== currentId);
				}
				if (action.kind === "guess") {
					if (
						!round.puzzle_ids.some(
							(id) =>
								catalog.find((p) => p.id === id)?.answerId === action.answerId,
						)
					)
						throw new PuzzleError(
							422,
							"INVALID_ANSWER",
							"Choose an answer from the suggestions",
						);
					const guesses = progress.guesses[currentId] ?? [];
					result = {
						name:
							entries[round.theme].find((e) => e.id === action.answerId)
								?.name ?? "",
						correct: action.answerId === puzzle.answerId,
						pointsAwarded:
							action.answerId === puzzle.answerId &&
							!progress.solved.includes(currentId)
								? 1
								: 0,
					};
					if (!guesses.includes(action.answerId)) guesses.push(action.answerId);
					progress.guesses[currentId] = guesses;
					if (action.answerId === puzzle.answerId) {
						if (!progress.solved.includes(currentId))
							progress.solved.push(currentId);
						progress.skipped = progress.skipped.filter(
							(id) => id !== currentId,
						);
					}
				} else if (
					action.kind === "skip" &&
					!givenUp &&
					!progress.skipped.includes(currentId)
				)
					progress.skipped.push(currentId);
				if (
					action.kind === "skip" ||
					action.kind === "next" ||
					progress.solved.includes(currentId)
				) {
					const next = round.puzzle_ids.findIndex(
						(id) =>
							!progress.solved.includes(id) &&
							!progress.skipped.includes(id) &&
							!progress.given_up.includes(id),
					);
					progress.current_index = next < 0 ? round.puzzle_ids.length : next;
				}
			}
			await tx.query(
				"UPDATE puzzle_progress SET current_index=$3,guesses=$4,solved=$5,skipped=$6,given_up=$7 WHERE round_id=$1 AND team_id=$2",
				[
					round.id,
					session.teamId,
					progress.current_index,
					JSON.stringify(progress.guesses),
					progress.solved,
					progress.skipped,
					progress.given_up,
				],
			);
		}
		return { ok: true, ...(result ? { result } : {}) };
	});
}
