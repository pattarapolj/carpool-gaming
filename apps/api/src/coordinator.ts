import type { GameDb } from "./services/auth";
import { processDueGame } from "./services/round-service";

export async function tick(db: GameDb, clock = () => new Date()) {
	const games = (await db.query(
		"SELECT id FROM games WHERE status='WAITING' ORDER BY id",
		[],
	)) as { rows: { id: string }[] };
	const transitions: Awaited<ReturnType<typeof processDueGame>>[] = [];
	for (const game of games.rows) {
		const transition = await processDueGame(game.id, db, clock);
		if (transition.opened || transition.reveal || transition.completion)
			transitions.push(transition);
	}
	return transitions;
}
