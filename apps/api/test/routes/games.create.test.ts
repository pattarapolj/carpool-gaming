import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server";

describe("POST /v1/games", () => {
	let app: ReturnType<typeof buildServer>;

	beforeEach(() => {
		app = buildServer();
	});

	afterEach(async () => {
		await app.close();
	});

	it("creates a game with a normalized join code", async () => {
		// Arrange is the app setup above and this valid request body.
		const payload = { name: "Beach convoy", roundIntervalSeconds: 300 };

		// Act through the public HTTP boundary; no real network port is needed.
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload,
		});

		// Assert only behavior promised by the contract.
		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			game: {
				name: "Beach convoy",
				status: "LOBBY",
				joinCode: expect.stringMatching(/^[A-Z0-9]{6}$/),
			},
			hostToken: expect.any(String),
		});
		expect(response.json().hostToken.length).toBeGreaterThan(0);
	});

	it.each([300, 600, 900])(
		"accepts supported round interval %j",
		async (roundIntervalSeconds) => {
			const response = await app.inject({
				method: "POST",
				url: "/v1/games",
				payload: { name: "Beach convoy", roundIntervalSeconds },
			});

			expect(response.statusCode).toBe(201);
		},
	);

	it.each([1, 60])(
		"accepts a trimmed game-name boundary of %i characters",
		async (length) => {
			const response = await app.inject({
				method: "POST",
				url: "/v1/games",
				payload: {
					name: "a".repeat(length),
					roundIntervalSeconds: 300,
				},
			});

			expect(response.statusCode).toBe(201);
		},
	);

	it("trims surrounding game-name whitespace", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "  Beach convoy  ", roundIntervalSeconds: 300 },
		});

		expect(response.statusCode).toBe(201);
		expect(response.json().game.name).toBe("Beach convoy");
	});

	it("rejects a missing game name", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { roundIntervalSeconds: 300 },
		});

		expectValidationError(response.statusCode, response.json());
	});

	it.each(["", " ", "\t"])("rejects a blank game name %j", async (name) => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name, roundIntervalSeconds: 300 },
		});

		expectValidationError(response.statusCode, response.json());
	});

	it("rejects a game name longer than 60 characters", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "a".repeat(61), roundIntervalSeconds: 300 },
		});

		expectValidationError(response.statusCode, response.json());
	});

	it.each([123, 400, 1800])(
		"rejects unsupported round interval %j",
		async (roundIntervalSeconds) => {
			const response = await app.inject({
				method: "POST",
				url: "/v1/games",
				payload: { name: "Beach convoy", roundIntervalSeconds },
			});

			expectValidationError(response.statusCode, response.json());
		},
	);

	it("rejects a string round interval", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Beach convoy", roundIntervalSeconds: "300" },
		});

		expectValidationError(response.statusCode, response.json());
	});

	it("rejects malformed JSON", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			headers: { "content-type": "application/json" },
			payload: '{"name":"Beach convoy",',
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({
			error: { code: "MALFORMED_JSON" },
		});
	});

	it("returns the standard validation-error envelope", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "", roundIntervalSeconds: 300 },
		});

		expect(response.statusCode).toBe(422);
		expect(response.json()).toEqual({
			error: {
				code: "VALIDATION_ERROR",
				message: expect.any(String),
				requestId: expect.any(String),
			},
		});
		expect(response.json().error.message.length).toBeGreaterThan(0);
		expect(response.json().error.requestId.length).toBeGreaterThan(0);
	});

	it("does not return the stored token hash", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Beach convoy", roundIntervalSeconds: 300 },
		});

		expect(response.statusCode).toBe(201);
		expect(response.json().hostToken).toEqual(expect.any(String));
		expect(response.body).not.toContain("host_token_hash");
		expect(response.body).not.toContain("hostTokenHash");
	});

	it.todo("creates a persisted game with the hash of the returned host token");
});

function expectValidationError(statusCode: number, body: unknown) {
	expect(statusCode).toBe(422);
	expect(body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
}
