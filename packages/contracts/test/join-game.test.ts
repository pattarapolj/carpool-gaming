import { describe, expect, it } from "vitest";
import { JoinGameSchema } from "../src";

describe("JoinGameSchema", () => {
	it("trims a valid team name", () => {
		expect(JoinGameSchema.parse({ name: "  Blue Sedan  " })).toEqual({
			name: "Blue Sedan",
		});
	});

	it.each([{}, { name: "" }, { name: "a".repeat(61) }])(
		"rejects invalid team names",
		(name) => {
			expect(JoinGameSchema.safeParse(name).success).toBe(false);
		},
	);
});
