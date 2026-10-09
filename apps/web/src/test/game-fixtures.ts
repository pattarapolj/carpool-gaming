import { type GameSnapshot, QuestionTopicIds } from "@carpool/contracts";
import type { GameSession } from "../session";

export const session: GameSession = {
	gameId: "e895e664-208c-4248-bde6-b4ca8a06a539",
	role: "CAPTAIN",
	token: "captain-token",
};
export function gameSnapshot(): GameSnapshot {
	const team = {
		id: "d3075a90-d673-4cac-b90b-668eb01971bc",
		name: "Blue Sedan",
		status: "ACTIVE" as const,
		score: 0,
	};
	return {
		game: {
			id: session.gameId,
			name: "Coast drive",
			joinCode: "AB12CD",
			status: "WAITING",
			roundIntervalSeconds: 300,
			selectedTopics: [...QuestionTopicIds],
			startedAt: "2026-10-08T10:00:00.000Z",
			nextRoundAt: "2026-10-08T10:05:00.000Z",
			completedAt: null,
			completionReason: null,
		},
		teams: [team],
		callerTeam: team,
		leaderboard: [{ ...team, rank: 1 }],
		ownAnswer: null,
		serverTime: "2026-10-08T10:00:00.000Z",
		round: {
			id: "fe4e7294-2367-4d55-a775-a2c8ad6e90c2",
			sequence: 1,
			startsAt: "2026-10-08T10:00:00.000Z",
			endsAt: "2026-10-08T10:01:00.000Z",
			status: "OPEN",
			question: {
				id: "b140341b-fafd-42a4-8512-721a27c32aa4",
				type: "TRUE_FALSE",
				prompt: "The Moon has an atmosphere like Earth's.",
				choices: null,
			},
		},
	};
}
