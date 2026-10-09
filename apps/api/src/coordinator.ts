import type { GameDb } from "./services/auth";
import { openDueRound, revealDueRound } from "./services/round-service";

export async function tick(db: GameDb, clock = () => new Date()) {
	const games = (await db.query(
		`SELECT g.id,r.id AS round_id FROM games g
		LEFT JOIN rounds r ON r.game_id=g.id AND r.status='OPEN'
		WHERE g.status='WAITING' ORDER BY g.id`,
		[],
	)) as { rows: { id: string; round_id: string | null }[] };
	for (const game of games.rows) {
		if (game.round_id) await revealDueRound(game.round_id, db, clock);
		await openDueRound(game.id, db, clock);
	}
}
