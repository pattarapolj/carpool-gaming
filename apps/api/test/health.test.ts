import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server";

describe("GET /health", () => {
	let app: ReturnType<typeof buildServer>;

	beforeEach(() => {
		app = buildServer();
	});

	afterEach(async () => {
		await app.close();
	});

	it("returns ok", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/health",
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ ok: true });
	});
});
