import { createHash } from "node:crypto";

export type QueryDb = {
	query(sql: string, values: unknown[]): Promise<unknown>;
};

export type GameDb = QueryDb & {
	end(): Promise<void>;
	transaction: <Result>(
		run: (db: QueryDb) => Promise<Result>,
	) => Promise<Result>;
};

export type Session = {
	gameId: string;
	role: "HOST" | "CAPTAIN";
	teamId?: string | null;
};

type QueryResult<Row> = { rows: Row[] };

export function hashToken(token: string) {
	return createHash("sha256").update(token).digest("hex");
}

export function getBearerToken(authorization: string | undefined) {
	const match = authorization?.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || undefined;
}

export async function resolveSession(
	token: string,
	db: GameDb,
): Promise<Session | null> {
	const result = (await db.query(
		`SELECT g.id AS "gameId", 'HOST' AS role, t.id AS "teamId"
		 FROM games g LEFT JOIN car_teams t
		 ON t.game_id = g.id AND t.captain_token_hash = g.host_token_hash
		 WHERE g.host_token_hash = $1
		 UNION ALL
		 SELECT game_id AS "gameId", 'CAPTAIN' AS role, id AS "teamId"
		 FROM car_teams
		 WHERE captain_token_hash = $1
		 ORDER BY role DESC
		 LIMIT 1`,
		[hashToken(token)],
	)) as QueryResult<Session>;

	return result.rows[0] ?? null;
}
