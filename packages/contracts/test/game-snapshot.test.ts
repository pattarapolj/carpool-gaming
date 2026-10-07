import { expect, it } from "vitest";
import { GameSnapshotSchema } from "../src/index";

const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-10-08T00:00:00.000Z";
const snapshot = {
	game: {
		id,
		name: "Trip",
		joinCode: "AB12CD",
		status: "WAITING",
		roundIntervalSeconds: 300,
		startedAt: now,
		nextRoundAt: now,
	},
	teams: [],
	callerTeam: null,
	ownAnswer: null,
	leaderboard: [],
	serverTime: now,
	round: {
		id,
		sequence: 1,
		status: "OPEN",
		startsAt: now,
		endsAt: now,
		question: {
			id,
			type: "MULTIPLE_CHOICE",
			prompt: "Choose",
			choices: ["A", "B"],
		},
	},
};

it("accepts nullable lobby fields and both round phases", () => {
	expect(GameSnapshotSchema.safeParse(snapshot).success).toBe(true);
	expect(
		GameSnapshotSchema.safeParse({ ...snapshot, round: null }).success,
	).toBe(true);
	expect(
		GameSnapshotSchema.safeParse({
			...snapshot,
			round: {
				...snapshot.round,
				status: "REVEALED",
				revealedAt: now,
				correctAnswer: "A",
				explanation: "Because",
				results: null,
			},
		}).success,
	).toBe(true);
});

it("rejects leaked OPEN keys, results and private credentials", () => {
	for (const extra of [
		{ correctAnswer: "A" },
		{ explanation: "Secret" },
		{ results: [] },
	])
		expect(
			GameSnapshotSchema.safeParse({
				...snapshot,
				round: { ...snapshot.round, ...extra },
			}).success,
		).toBe(false);
	expect(
		GameSnapshotSchema.safeParse({ ...snapshot, hostToken: "private" }).success,
	).toBe(false);
	expect(
		GameSnapshotSchema.safeParse({
			...snapshot,
			round: {
				...snapshot.round,
				question: { ...snapshot.round.question, explanation: "Secret" },
			},
		}).success,
	).toBe(false);
});

it("requires choices only for multiple choice questions", () => {
	for (const [type, choices, accepted] of [
		["MULTIPLE_CHOICE", null, false],
		["TRUE_FALSE", ["A", "B"], false],
		["ESTIMATE", ["A", "B"], false],
		["TRUE_FALSE", null, true],
		["ESTIMATE", null, true],
	] as const) {
		expect(
			GameSnapshotSchema.safeParse({
				...snapshot,
				round: {
					...snapshot.round,
					question: { ...snapshot.round.question, type, choices },
				},
			}).success,
		).toBe(accepted);
	}
});
