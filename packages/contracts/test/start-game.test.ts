import { describe, expect, it } from "vitest";
import { StartGameSchema } from "../src";

describe("StartGameSchema", () => {
	it("defaults practice to false", () => {
		expect(StartGameSchema.parse({})).toEqual({ practice: false });
	});

	it("rejects a non-boolean practice value", () => {
		expect(StartGameSchema.safeParse({ practice: "true" }).success).toBe(false);
	});
});
