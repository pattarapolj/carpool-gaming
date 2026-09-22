import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { z } from "zod";
import type {
	CreateGameSchema,
	JoinGameSchema,
} from "../../../../packages/contracts/src/index";

type CreateGameInput = z.infer<typeof CreateGameSchema>;
type JoinGameInput = z.infer<typeof JoinGameSchema>;

export type GameDb = {
	query(sql: string, values: unknown[]): Promise<unknown>;
	end(): Promise<void>;
};

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

export class GameJoinError extends Error {
	constructor(
		readonly statusCode: 404 | 409,
		readonly code: "GAME_NOT_FOUND" | "GAME_NOT_JOINABLE" | "TEAM_NAME_TAKEN",
		message: string,
	) {
		super(message);
		this.name = "GameJoinError";
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
	const hostTokenHash = createHash("sha256").update(hostToken).digest("hex");

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
	const gameResult = (await db.query(
		'SELECT id, name, join_code AS "joinCode", status FROM games WHERE join_code = $1',
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

	const teamId = randomUUID();
	const captainToken = randomBytes(32).toString("hex");
	const captainTokenHash = createHash("sha256")
		.update(captainToken)
		.digest("hex");

	try {
		const teamResult = (await db.query(
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
