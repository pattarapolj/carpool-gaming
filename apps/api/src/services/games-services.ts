import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { z } from "zod";
import type { CreateGameSchema } from "../../../../packages/contracts/src/index";

type CreateGameInput = z.infer<typeof CreateGameSchema>;

export type GameDb = {
	query(sql: string, values: unknown[]): Promise<unknown>;
	end(): Promise<void>;
};

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

function generateJoinCode() {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	return Array.from(
		randomBytes(6),
		(byte) => alphabet[byte % alphabet.length],
	).join("");
}
