import { expect, it } from "vitest";
import {
	CreateGameSchema,
	PuzzleActionSchema,
	SongClipRequestSchema,
	SongClipResponseSchema,
} from "../src/index";

it("accepts only a puzzle ID for song clips and only unlocked WAV audio in responses", () => {
	expect(SongClipRequestSchema.safeParse({ puzzleId: "round/0" }).success).toBe(
		true,
	);
	for (const request of [
		{ puzzleId: "" },
		{ puzzleId: "x".repeat(81) },
		{ puzzleId: "round/0", seconds: 15 },
	]) {
		expect(SongClipRequestSchema.safeParse(request).success).toBe(false);
	}
	const media = "data:audio/wav;base64,UklGRg==";
	expect(SongClipResponseSchema.safeParse({ media }).success).toBe(true);
	expect(
		SongClipResponseSchema.safeParse({ media, trackId: 13141170 }).success,
	).toBe(false);
	expect(
		SongClipResponseSchema.safeParse({
			media: "https://provider.example/preview.mp3",
		}).success,
	).toBe(false);
});

it.each([
	"taylor-swift",
	"ed-sheeran",
	"adele",
	"songs-2000s",
	"songs-2010s",
	"songs-2020s",
])("accepts %s for opening and subsequent song rounds only", (theme) => {
	expect(
		CreateGameSchema.safeParse({
			name: "Song trip",
			roundIntervalSeconds: 300,
			puzzleSetup: { theme, format: "MUSIC" },
		}).success,
	).toBe(true);
	expect(
		CreateGameSchema.safeParse({
			name: "Song trip",
			roundIntervalSeconds: 300,
			puzzleSetup: { theme, format: "CHARACTER" },
		}).success,
	).toBe(false);
	expect(
		PuzzleActionSchema.safeParse({
			kind: "theme",
			roundId: "a6775a41-50ab-4d61-b1fa-f9f07a28c62b",
			theme,
		}).success,
	).toBe(true);
});

it("accepts supported opening packs and rejects mismatched formats", () => {
	const game = { name: "Puzzle trip", roundIntervalSeconds: 300 };
	expect(
		CreateGameSchema.safeParse({
			...game,
			puzzleSetup: { theme: "animals", format: "PICTURE" },
		}).success,
	).toBe(true);
	expect(
		CreateGameSchema.safeParse({
			...game,
			puzzleSetup: { theme: "naruto", format: "MUSIC" },
		}).success,
	).toBe(false);
	expect(
		CreateGameSchema.safeParse({
			...game,
			puzzleSetup: { theme: "naruto", format: "CHARACTER" },
		}).success,
	).toBe(false);
});
it("rejects Naruto as a subsequent theme", () => {
	expect(
		PuzzleActionSchema.safeParse({
			kind: "theme",
			roundId: "a6775a41-50ab-4d61-b1fa-f9f07a28c62b",
			theme: "naruto",
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
