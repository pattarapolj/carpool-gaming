import { describe, expect, it } from "vitest";
import { catalog, entries } from "../src/services/puzzle-catalog";

describe("animal trivia question bank", () => {
	it("contains exactly 300 unique playable animal questions", () => {
		const questions = catalog.filter(
			(question) =>
				question.theme === "animals" && question.format === "TRIVIA",
		);
		expect(questions).toHaveLength(300);
		expect(new Set(questions.map((question) => question.id)).size).toBe(300);
		expect(
			new Set(questions.map((question) => question.prompt.trim().toLowerCase()))
				.size,
		).toBe(300);
		const answerIds = new Set(entries.animals.map((entry) => entry.id));
		for (const question of questions) {
			expect(question.prompt.trim().length).toBeGreaterThan(0);
			expect(answerIds.has(question.answerId)).toBe(true);
		}
	});
});
