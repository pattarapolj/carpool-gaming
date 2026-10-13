import { describe, expect, it } from "vitest";
import {
	CreateGameSchema,
	QUESTION_TOPICS,
	QuestionTopicIds,
	QuestionTopicSchema,
} from "../src";

describe("CreateGameSchema", () => {
	it("defines exactly the 19 selectable topic IDs and their display names", () => {
		expect(QUESTION_TOPICS).toEqual({
			world: "Around the World",
			thailand: "Thailand",
			food: "Food & Drinks",
			weird: "Weird but True",
			nature: "Animals & Nature",
			science: "Science & Space",
			"taylor-swift": "Taylor Swift",
			"breaking-bad": "Breaking Bad (full-series spoilers)",
			marvel: "Marvel (MCU film spoilers)",
			logic: "Logic & Clever Strategies",
			lateral: "Lateral Thinking",
			probability: "Probability Puzzles",
			estimate: "Closest Estimate",
			"harry-potter": "Harry Potter (seven-book spoilers)",
			history: "History",
			sports: "Sports",
			"video-games": "Video Games",
			nba: "NBA",
			"disney-pixar": "Disney & Pixar (animated-film spoilers)",
		});
		for (const id of Object.keys(QUESTION_TOPICS))
			expect(QuestionTopicSchema.parse(id)).toBe(id);
		expect(QuestionTopicIds).toEqual(Object.keys(QUESTION_TOPICS));
	});

	it("accepts all topics and deduplicates explicit selections in their supplied order", () => {
		const input = { name: "Trip", roundIntervalSeconds: 300 };
		expect(
			CreateGameSchema.parse({ ...input, topics: QuestionTopicIds }).topics,
		).toEqual(QuestionTopicIds);
		expect(
			CreateGameSchema.parse({
				...input,
				topics: ["science", "world", "science"],
			}).topics,
		).toEqual(["science", "world"]);
	});

	it.each(
		[[], ["unknown"], ["mixed"], ["Mixed Topics"], ["science", "unknown"]].map(
			(topics) => ({ topics }),
		),
	)("rejects invalid topic selection $topics", ({ topics }) => {
		expect(
			CreateGameSchema.safeParse({
				name: "Trip",
				roundIntervalSeconds: 300,
				topics,
			}).success,
		).toBe(false);
	});

	it("defaults omitted topics to all 19 selectable topics", () => {
		expect(
			CreateGameSchema.parse({ name: "Trip", roundIntervalSeconds: 300 }),
		).toMatchObject({
			topics: [
				"world",
				"thailand",
				"food",
				"weird",
				"nature",
				"science",
				"taylor-swift",
				"breaking-bad",
				"marvel",
				"logic",
				"lateral",
				"probability",
				"estimate",
				"harry-potter",
				"history",
				"sports",
				"video-games",
				"nba",
				"disney-pixar",
			],
		});
	});

	it.each([300, 600, 900])(
		"accepts supported round interval %j",
		(roundIntervalSeconds) => {
			const result = CreateGameSchema.safeParse({
				name: "Beach convoy",
				roundIntervalSeconds,
			});

			expect(result.success).toBe(true);
		},
	);

	it.each([123, 400, 1800])(
		"rejects unsupported round interval %j",
		(roundIntervalSeconds) => {
			const result = CreateGameSchema.safeParse({
				name: "Beach convoy",
				roundIntervalSeconds,
			});

			expect(result.success).toBe(false);
		},
	);

	it.each([1, 60])(
		"accepts a game name boundary of %i characters",
		(length) => {
			const result = CreateGameSchema.safeParse({
				name: "a".repeat(length),
				roundIntervalSeconds: 300,
			});

			expect(result.success).toBe(true);
		},
	);

	it("trims surrounding game-name whitespace", () => {
		const result = CreateGameSchema.parse({
			name: "  Beach convoy  ",
			roundIntervalSeconds: 300,
		});

		expect(result.name).toBe("Beach convoy");
	});

	it("rejects a missing game name", () => {
		expect(
			CreateGameSchema.safeParse({ roundIntervalSeconds: 300 }).success,
		).toBe(false);
	});

	it.each(["", " ", "\t"])("rejects blank game name %j", (name) => {
		expect(
			CreateGameSchema.safeParse({ name, roundIntervalSeconds: 300 }).success,
		).toBe(false);
	});

	it("rejects a game name over 60 characters", () => {
		expect(
			CreateGameSchema.safeParse({
				name: "a".repeat(61),
				roundIntervalSeconds: 300,
			}).success,
		).toBe(false);
	});

	it("rejects a missing round interval", () => {
		expect(CreateGameSchema.safeParse({ name: "Beach convoy" }).success).toBe(
			false,
		);
	});

	it("rejects a non-numeric round interval without coercing it", () => {
		expect(
			CreateGameSchema.safeParse({
				name: "Beach convoy",
				roundIntervalSeconds: "300",
			}).success,
		).toBe(false);
	});
});

it("accepts Disney & Pixar as the only selected quiz topic", () => {
	expect(
		CreateGameSchema.parse({
			name: "Animated adventure",
			roundIntervalSeconds: 300,
			topics: ["disney-pixar"],
		}).topics,
	).toEqual(["disney-pixar"]);
});
