import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuestionTopicIds } from "../../../../packages/contracts/src";
import { buildServer } from "../../src/server";

describe("POST /v1/games", () => {
	let app: ReturnType<typeof buildServer>;
	let failQuery: boolean;
	let collideOnce: boolean;
	let writes: { sql: string; values: unknown[] }[];

	beforeEach(() => {
		failQuery = false;
		collideOnce = false;
		writes = [];
		app = buildServer({
			query: async (sql: string, values: unknown[]) => {
				if (failQuery) throw new Error("secret database failure");
				writes.push({ sql, values });
				if (collideOnce) {
					collideOnce = false;
					throw Object.assign(new Error("duplicate join code"), {
						code: "23505",
						constraint: "games_join_code_key",
					});
				}
				return { rows: [], rowCount: 1 };
			},
			end: async () => {},
			transaction(run) {
				return run(this);
			},
		});
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

	it("explains an invalid round interval", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Beach convoy", roundIntervalSeconds: 123 },
		});

		expect(response.statusCode).toBe(422);
		expect(response.json().error.message).toContain("roundIntervalSeconds");
	});

	it("does not report creation when persistence fails", async () => {
		failQuery = true;
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Beach convoy", roundIntervalSeconds: 300 },
		});

		expect(response.statusCode).toBe(500);
		expect(response.json().error).toMatchObject({
			code: "INTERNAL_ERROR",
			message: expect.any(String),
			requestId: expect.any(String),
		});
		expect(response.body).not.toContain("secret database failure");
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

	it("sends the lobby and host-token hash to persistence", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "  Beach convoy  ", roundIntervalSeconds: 600 },
		});

		expect(response.statusCode).toBe(201);
		expect(writes).toHaveLength(1);
		expect(writes[0].sql).toMatch(/INSERT INTO games/i);
		expect(writes[0].values).toEqual([
			response.json().game.id,
			"Beach convoy",
			response.json().game.joinCode,
			createHash("sha256").update(response.json().hostToken).digest("hex"),
			600,
			[...QuestionTopicIds],
		]);
	});

	it("persists explicit topics in deduplicated order", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: {
				name: "Trip",
				roundIntervalSeconds: 300,
				topics: ["logic", "science", "logic"],
			},
		});
		expect(response.statusCode).toBe(201);
		expect(writes[0].sql).toContain("selected_topics");
		expect(writes[0].values[5]).toEqual(["logic", "science"]);
		expect(response.body).not.toMatch(/token_hash|hostTokenHash/);
	});

	it.each([[], ["unknown"], ["mixed"]].map((topics) => ({ topics })))(
		"rejects invalid topics $topics before writing",
		async ({ topics }) => {
			const response = await app.inject({
				method: "POST",
				url: "/v1/games",
				payload: { name: "Trip", roundIntervalSeconds: 300, topics },
			});
			expectValidationError(response.statusCode, response.json());
			expect(writes).toHaveLength(0);
		},
	);

	it("retries a join-code collision", async () => {
		collideOnce = true;
		const response = await app.inject({
			method: "POST",
			url: "/v1/games",
			payload: { name: "Beach convoy", roundIntervalSeconds: 300 },
		});

		expect(response.statusCode).toBe(201);
		expect(writes).toHaveLength(2);
		expect(writes[1].values[2]).toBe(response.json().game.joinCode);
		expect(writes[0].values[2]).not.toBe(writes[1].values[2]);
	});
});

function expectValidationError(statusCode: number, body: unknown) {
	expect(statusCode).toBe(422);
	expect(body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
}
