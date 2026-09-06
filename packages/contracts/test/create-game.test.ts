import { describe, expect, it } from "vitest";
import { CreateGameSchema } from "../src";

describe("CreateGameSchema", () => {
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
