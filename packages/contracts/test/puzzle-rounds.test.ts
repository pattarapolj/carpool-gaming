import { expect, it } from "vitest";
import { CreateGameSchema, PuzzleActionSchema } from "../src/index";

it("accepts supported opening packs and rejects mismatched formats", () => {
	const game = { name: "Puzzle trip", roundIntervalSeconds: 300 };
	expect(
		CreateGameSchema.safeParse({
			...game,
			puzzleSetup: { theme: "naruto", format: "CHARACTER" },
		}).success,
	).toBe(true);
	expect(
		CreateGameSchema.safeParse({
			...game,
			puzzleSetup: { theme: "naruto", format: "MUSIC" },
		}).success,
	).toBe(false);
});
it("requires a round identity and rejects caller-supplied scores or team IDs", () => {
	const action = {
		kind: "guess",
		roundId: "a6775a41-50ab-4d61-b1fa-f9f07a28c62b",
		puzzleId: "round/0",
		answerId: "character-0",
	};
	expect(PuzzleActionSchema.safeParse(action).success).toBe(true);
	expect(
		PuzzleActionSchema.safeParse({
			...action,
			teamId: "another-car",
			score: 20,
		}).success,
	).toBe(false);
	expect(
		PuzzleActionSchema.safeParse({ ...action, roundId: undefined }).success,
	).toBe(false);
});
