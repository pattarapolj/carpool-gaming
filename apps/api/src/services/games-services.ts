import { randomBytes, randomUUID } from "node:crypto";
import type { z } from "zod";
import type {
	CreateGameSchema,
	GameSnapshot,
	JoinGameSchema,
	StartedGame,
} from "../../../../packages/contracts/src/index";
import { type GameDb, hashToken, type QueryDb, type Session } from "./auth";
import {
	getLeaderboard,
	getRoundResults,
	openGameInTransaction,
} from "./round-service";

export type { GameDb } from "./auth";

type CreateGameInput = z.infer<typeof CreateGameSchema>;
type JoinGameInput = z.infer<typeof JoinGameSchema>;

type QueryResult<Row> = { rows: Row[] };

type GameRow = {
	id: string;
	name: string;
	joinCode: string;
	status: string;
};

type TeamRow = {
	id: string;
	name: string;
	status: string;
	score: number;
};

type StartGameRow = Omit<StartedGame["game"], "startedAt" | "nextRoundAt"> & {
	startedAt: Date | string;
	nextRoundAt: Date | string | null;
};

type SnapshotGameRow = {
	id: string;
	name: string;
	joinCode: string;
	status: "LOBBY" | "WAITING" | "COMPLETE";
	roundIntervalSeconds: 300 | 600 | 900;
	startedAt: Date | string | null;
	nextRoundAt: Date | string | null;
	completedAt: Date | string | null;
	completionReason: GameSnapshot["game"]["completionReason"];
};

type SnapshotTeamRow = {
	id: string;
	name: string;
	status: "ACTIVE";
	score: number;
};

export class GameJoinError extends Error {
	constructor(
		readonly statusCode: 404 | 409,
		readonly code:
			| "GAME_NOT_FOUND"
			| "GAME_NOT_JOINABLE"
			| "TEAM_NAME_TAKEN"
			| "GAME_FULL",
		message: string,
	) {
		super(message);
		this.name = "GameJoinError";
	}
}

export class GameStartError extends Error {
	constructor(
		readonly statusCode: 403 | 404 | 409 | 422,
		readonly code:
			| "FORBIDDEN"
			| "GAME_NOT_FOUND"
			| "GAME_ALREADY_STARTED"
			| "GAME_NOT_READY",
		message: string,
	) {
		super(message);
		this.name = "GameStartError";
	}
}

export class GameSnapshotError extends Error {
	constructor(
		readonly statusCode: 403 | 404,
		readonly code: "FORBIDDEN" | "GAME_NOT_FOUND",
		message: string,
	) {
		super(message);
		this.name = "GameSnapshotError";
	}
}

export async function createGame(input: CreateGameInput, db: GameDb) {
	const game = {
		id: randomUUID(),
		name: input.name,
		status: "LOBBY",
		joinCode: generateJoinCode(),
	};
	const hostToken = randomBytes(32).toString("hex");
	const hostTokenHash = hashToken(hostToken);

	for (let attempt = 0; ; attempt++) {
		try {
			await db.query(
				"INSERT INTO games (id, name, join_code, host_token_hash, round_interval_seconds) VALUES ($1, $2, $3, $4, $5)",
				[
					game.id,
					game.name,
					game.joinCode,
					hostTokenHash,
					input.roundIntervalSeconds,
				],
			);
			return { game, hostToken };
		} catch (error) {
			const dbError = error as { code?: string; constraint?: string };
			// ponytail: Five attempts cap collision retries; revisit only if codes collide in practice.
			if (
				dbError.code !== "23505" ||
				dbError.constraint !== "games_join_code_key" ||
				attempt === 4
			) {
				throw error;
			}
			game.joinCode = generateJoinCode();
		}
	}
}

export async function joinGame(
	joinCode: string,
	input: JoinGameInput,
	db: GameDb,
) {
	const teamId = randomUUID();
	const captainToken = randomBytes(32).toString("hex");
	const captainTokenHash = hashToken(captainToken);

	try {
		return await db.transaction(async (transactionDb) => {
			const gameResult = (await transactionDb.query(
				'SELECT id, name, join_code AS "joinCode", status FROM games WHERE join_code = $1 FOR UPDATE',
				[normalizeJoinCode(joinCode)],
			)) as QueryResult<GameRow>;
			const game = gameResult.rows[0];

			if (!game) {
				throw new GameJoinError(404, "GAME_NOT_FOUND", "Game not found");
			}
			if (game.status !== "LOBBY") {
				throw new GameJoinError(
					409,
					"GAME_NOT_JOINABLE",
					"Game is no longer accepting teams",
				);
			}

			const admission = (await transactionDb.query(
				"SELECT count(*) FILTER (WHERE status='ACTIVE') AS count, bool_or(lower(name)=lower($2)) AS duplicate FROM car_teams WHERE game_id=$1",
				[game.id, input.name],
			)) as QueryResult<{ count: string | number; duplicate: boolean }>;
			if (admission.rows[0]?.duplicate)
				throw new GameJoinError(
					409,
					"TEAM_NAME_TAKEN",
					"That team name is already taken",
				);
			if (Number(admission.rows[0]?.count ?? 0) >= 20)
				throw new GameJoinError(
					409,
					"GAME_FULL",
					"Game already has 20 active teams",
				);
			const teamResult = (await transactionDb.query(
				"INSERT INTO car_teams (id, game_id, name, captain_token_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, status, score",
				[teamId, game.id, input.name, captainTokenHash],
			)) as QueryResult<TeamRow>;
			const team = teamResult.rows[0] ?? {
				id: teamId,
				name: input.name,
				status: "ACTIVE",
				score: 0,
			};

			return {
				game: {
					id: game.id,
					name: game.name,
					joinCode: game.joinCode,
					status: game.status,
				},
				team,
				captainToken,
			};
		});
	} catch (error) {
		const dbError = error as { code?: string; constraint?: string };
		if (
			dbError.code === "23505" &&
			dbError.constraint === "car_teams_game_name_key"
		) {
			throw new GameJoinError(
				409,
				"TEAM_NAME_TAKEN",
				"That team name is already taken",
			);
		}
		throw error;
	}
}

export async function startGame(
	gameId: string,
	practice: boolean,
	session: Session,
	db: GameDb,
) {
	return (await startGameTransition(gameId, practice, session, db)).game;
}

export async function startGameTransition(
	gameId: string,
	practice: boolean,
	session: Session,
	db: GameDb,
) {
	return db.transaction((transactionDb) =>
		performStartGame(gameId, practice, session, transactionDb),
	);
}

async function performStartGame(
	gameId: string,
	practice: boolean,
	session: Session,
	db: QueryDb,
) {
	if (!isUuid(gameId)) {
		throw new GameStartError(404, "GAME_NOT_FOUND", "Game not found");
	}

	const gameResult = (await db.query(
		`SELECT id, status
		 FROM games
		 WHERE id = $1
		 FOR UPDATE`,
		[gameId],
	)) as QueryResult<{ id: string; status: string }>;
	const game = gameResult.rows[0];

	if (!game) {
		throw new GameStartError(404, "GAME_NOT_FOUND", "Game not found");
	}
	if (session.gameId !== game.id || session.role !== "HOST") {
		throw new GameStartError(403, "FORBIDDEN", "Host access required");
	}
	if (game.status !== "LOBBY") {
		throw new GameStartError(
			409,
			"GAME_ALREADY_STARTED",
			"Game has already started",
		);
	}

	const teamsResult = (await db.query(
		"SELECT COUNT(*) AS count FROM car_teams WHERE game_id = $1 AND status = 'ACTIVE'",
		[gameId],
	)) as QueryResult<{ count: string | number }>;
	const activeTeamCount = Number(teamsResult.rows[0]?.count ?? 0);

	if (activeTeamCount === 0 || (!practice && activeTeamCount < 2)) {
		throw new GameStartError(
			422,
			"GAME_NOT_READY",
			"Game needs at least two active teams unless practice mode is enabled",
		);
	}

	const now = new Date();
	await db.query(
		`UPDATE games
		 SET status = 'WAITING', started_at = $2, next_round_at = $2
		 WHERE id = $1
		 RETURNING id, status, started_at AS "startedAt", next_round_at AS "nextRoundAt"`,
		[gameId, now],
	);
	const transition = await openGameInTransaction(gameId, db, () => now);
	const committed = (await db.query(
		'SELECT id,status,started_at AS "startedAt",next_round_at AS "nextRoundAt" FROM games WHERE id=$1',
		[gameId],
	)) as QueryResult<StartGameRow>;
	const started = committed.rows[0];
	return {
		game: {
			...started,
			startedAt: new Date(started.startedAt).toISOString(),
			nextRoundAt: toISOString(started.nextRoundAt),
		},
		gameId,
		...transition,
		reveal: null,
	};
}

export async function getGameSnapshot(
	gameId: string,
	session: Session,
	db: GameDb,
) {
	if (!isUuid(gameId)) {
		throw new GameSnapshotError(404, "GAME_NOT_FOUND", "Game not found");
	}

	return db.transaction(async (tx): Promise<GameSnapshot> => {
		const gameResult = (await tx.query(
			`SELECT id, name, join_code AS "joinCode", status,
		        round_interval_seconds AS "roundIntervalSeconds",
	        started_at AS "startedAt", next_round_at AS "nextRoundAt",
	        completed_at AS "completedAt", completion_reason AS "completionReason"
		 FROM games
		 WHERE id = $1 FOR SHARE`,
			[gameId],
		)) as QueryResult<SnapshotGameRow>;
		const game = gameResult.rows[0];

		if (!game) {
			throw new GameSnapshotError(404, "GAME_NOT_FOUND", "Game not found");
		}
		if (session.gameId !== game.id) {
			throw new GameSnapshotError(403, "FORBIDDEN", "Game access required");
		}

		const teamsResult = (await tx.query(
			`SELECT id, name, status, score
		 FROM car_teams
		 WHERE game_id = $1 AND status = 'ACTIVE'
		 ORDER BY joined_at, id`,
			[gameId],
		)) as QueryResult<SnapshotTeamRow>;
		const leaderboard = await getLeaderboard(gameId, tx);
		const callerTeam =
			session.role === "CAPTAIN"
				? leaderboard.find((team) => team.id === session.teamId)
				: null;
		if (session.role === "CAPTAIN" && !callerTeam)
			throw new GameSnapshotError(403, "FORBIDDEN", "Game access required");
		const rounds = (await tx.query(
			`SELECT r.id,r.sequence,r.status,r.starts_at,r.ends_at,r.revealed_at,r.expected_team_ids,
		q.id AS question_id,q.type,q.prompt,q.choices,q.correct_answer,q.explanation
		FROM rounds r JOIN questions q ON q.id=r.question_id WHERE r.game_id=$1 ORDER BY r.sequence DESC LIMIT 1`,
			[gameId],
		)) as QueryResult<{
			id: string;
			sequence: number;
			status: "OPEN" | "REVEALED";
			starts_at: Date;
			ends_at: Date;
			revealed_at: Date;
			expected_team_ids: string[] | null;
			question_id: string;
			type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "ESTIMATE";
			prompt: string;
			choices: string[] | null;
			correct_answer: string | boolean | number;
			explanation: string;
		}>;
		const latest = rounds.rows[0];
		let round: GameSnapshot["round"] = null;
		let ownAnswer: GameSnapshot["ownAnswer"] = null;
		if (latest) {
			const publicRound = {
				id: latest.id,
				sequence: latest.sequence,
				startsAt: new Date(latest.starts_at).toISOString(),
				endsAt: new Date(latest.ends_at).toISOString(),
				question: {
					id: latest.question_id,
					type: latest.type,
					prompt: latest.prompt,
					choices: latest.choices,
				},
			};
			round =
				latest.status === "OPEN"
					? { ...publicRound, status: "OPEN" }
					: {
							...publicRound,
							status: "REVEALED",
							revealedAt: new Date(latest.revealed_at).toISOString(),
							correctAnswer: latest.correct_answer,
							explanation: latest.explanation,
							results: await getRoundResults(
								latest.id,
								gameId,
								latest.expected_team_ids,
								tx,
							),
						};
			if (callerTeam) {
				const answers = (await tx.query(
					'SELECT id AS "answerId",value,submitted_at AS "submittedAt" FROM answers WHERE round_id=$1 AND car_team_id=$2',
					[latest.id, callerTeam.id],
				)) as QueryResult<{
					answerId: string;
					value: string | boolean | number;
					submittedAt: Date;
				}>;
				if (answers.rows[0])
					ownAnswer = {
						...answers.rows[0],
						submittedAt: new Date(answers.rows[0].submittedAt).toISOString(),
					};
			}
		}

		return {
			game: {
				...game,
				startedAt: toISOString(game.startedAt),
				nextRoundAt: toISOString(game.nextRoundAt),
				completedAt: toISOString(game.completedAt),
			},
			teams: teamsResult.rows,
			round,
			ownAnswer,
			callerTeam: callerTeam
				? {
						id: callerTeam.id,
						name: callerTeam.name,
						score: callerTeam.score,
						status: callerTeam.status,
					}
				: null,
			leaderboard,
			serverTime: new Date().toISOString(),
		};
	});
}

function isUuid(value: string) {
	return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

function toISOString(value: Date | string | null) {
	return value === null
		? null
		: value instanceof Date
			? value.toISOString()
			: new Date(value).toISOString();
}

function normalizeJoinCode(joinCode: string) {
	return joinCode.trim().toUpperCase();
}

function generateJoinCode() {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	return Array.from(
		randomBytes(6),
		(byte) => alphabet[byte % alphabet.length],
	).join("");
}
