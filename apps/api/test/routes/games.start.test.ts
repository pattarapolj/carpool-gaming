import { describe, expect, it } from "vitest";
import { buildServer } from "../../src/server";
import { type GameDb, startGame } from "../../src/services/games-services";

const gameId = "game-1";
const hostToken = "host-token";

describe("POST /v1/games/:gameId/start", () => {
	it("lets the host start a ready game", async () => {
		const app = createStartApp();

		try {
			const response = await postStart(app);

			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				game: {
					id: gameId,
					status: "WAITING",
					startedAt: expect.any(String),
					nextRoundAt: expect.any(String),
				},
			});
		} finally {
			await app.close();
		}
	});

	it("rejects a missing bearer token", async () => {
		const app = createStartApp();

		try {
			const response = await app.inject({
				method: "POST",
				url: `/v1/games/${gameId}/start`,
				payload: {},
			});

			expect(response.statusCode).toBe(401);
			expect(response.json()).toMatchObject({
				error: { code: "UNAUTHENTICATED" },
			});
		} finally {
			await app.close();
		}
	});

	it("rejects an invalid bearer token", async () => {
		const app = createStartApp({ session: null });

		try {
			const response = await postStart(app, "invalid-token");

			expect(response.statusCode).toBe(401);
			expect(response.json()).toMatchObject({
				error: { code: "UNAUTHENTICATED" },
			});
		} finally {
			await app.close();
		}
	});

	it("rejects a captain token", async () => {
		const app = createStartApp({
			session: { gameId, role: "CAPTAIN" },
		});

		try {
			const response = await postStart(app);

			expect(response.statusCode).toBe(403);
			expect(response.json()).toMatchObject({
				error: { code: "FORBIDDEN" },
			});
		} finally {
			await app.close();
		}
	});

	it("rejects a token from another game", async () => {
		const app = createStartApp({
			session: { gameId: "other-game", role: "HOST" },
		});

		try {
			const response = await postStart(app);

			expect(response.statusCode).toBe(403);
			expect(response.json()).toMatchObject({
				error: { code: "FORBIDDEN" },
			});
		} finally {
			await app.close();
		}
	});

	it("rejects an unknown game", async () => {
		const app = createStartApp({ game: null });

		try {
			const response = await postStart(app);

			expect(response.statusCode).toBe(404);
			expect(response.json()).toMatchObject({
				error: { code: "GAME_NOT_FOUND" },
			});
		} finally {
			await app.close();
		}
	});

	it("rejects a game that already started", async () => {
		const app = createStartApp({ game: { status: "WAITING" } });

		try {
			const response = await postStart(app);

			expect(response.statusCode).toBe(409);
			expect(response.json()).toMatchObject({
				error: { code: "GAME_ALREADY_STARTED" },
			});
		} finally {
			await app.close();
		}
	});

	it("requires two active teams unless practice mode is enabled", async () => {
		const app = createStartApp({ activeTeamCount: 1 });

		try {
			const response = await postStart(app);

			expect(response.statusCode).toBe(422);
			expect(response.json()).toMatchObject({
				error: { code: "GAME_NOT_READY" },
			});
		} finally {
			await app.close();
		}
	});

	it("rejects practice mode when there are no active teams", async () => {
		const app = createStartApp({ activeTeamCount: 0 });

		try {
			const response = await postStart(app, hostToken, { practice: true });

			expect(response.statusCode).toBe(422);
			expect(response.json()).toMatchObject({
				error: { code: "GAME_NOT_READY" },
			});
		} finally {
			await app.close();
		}
	});

	it("allows one active team in explicit practice mode", async () => {
		const app = createStartApp({ activeTeamCount: 1 });

		try {
			const response = await postStart(app, hostToken, { practice: true });

			expect(response.statusCode).toBe(200);
		} finally {
			await app.close();
		}
	});

	it("rejects a non-boolean practice value", async () => {
		const app = createStartApp();

		try {
			const response = await postStart(app, hostToken, {
				practice: "true",
			});

			expect(response.statusCode).toBe(422);
			expect(response.json()).toMatchObject({
				error: { code: "VALIDATION_ERROR" },
			});
		} finally {
			await app.close();
		}
	});

	it("maps malformed JSON to the standard error", async () => {
		const app = createStartApp();

		try {
			const response = await app.inject({
				method: "POST",
				url: `/v1/games/${gameId}/start`,
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${hostToken}`,
				},
				payload: '{"practice":',
			});

			expect(response.statusCode).toBe(400);
			expect(response.json()).toMatchObject({
				error: { code: "MALFORMED_JSON" },
			});
		} finally {
			await app.close();
		}
	});
});

type StartOptions = {
	session?: { gameId: string; role: "HOST" | "CAPTAIN" } | null;
	game?: { status: string } | null;
	activeTeamCount?: number;
};

function createStartApp(options: StartOptions = {}) {
	const session =
		options.session === undefined
			? { gameId, role: "HOST" as const }
			: options.session;
	const game = options.game === undefined ? { status: "LOBBY" } : options.game;
	const activeTeamCount = options.activeTeamCount ?? 2;

	return buildServer({
		query: async (sql: string) => {
			if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
			if (sql.includes("host_token_hash")) {
				return { rows: session ? [session] : [] };
			}
			if (sql.includes("FOR UPDATE")) {
				return {
					rows: game ? [{ id: gameId, status: game.status }] : [],
				};
			}
			if (sql.includes("COUNT")) {
				return { rows: [{ count: String(activeTeamCount) }] };
			}
			if (sql.includes("UPDATE games")) {
				return {
					rows: [
						{
							id: gameId,
							status: "WAITING",
							startedAt: "2026-09-22T09:00:00.000Z",
							nextRoundAt: "2026-09-22T09:00:00.000Z",
						},
					],
				};
			}
			throw new Error(`Unexpected query: ${sql}`);
		},
		end: async () => {},
	});
}

async function postStart(
	app: ReturnType<typeof buildServer>,
	token = hostToken,
	payload: Record<string, unknown> = {},
) {
	return await app.inject({
		method: "POST",
		url: `/v1/games/${gameId}/start`,
		headers: { authorization: `Bearer ${token}` },
		payload,
	});
}

describe("startGame transaction boundary", () => {
	it("uses the database transaction connection for the state transition", async () => {
		let transactionCalls = 0;
		const connection = {
			query: async (sql: string) => {
				if (sql.includes("FOR UPDATE")) {
					return { rows: [{ id: gameId, status: "LOBBY" }] };
				}
				if (sql.includes("COUNT")) return { rows: [{ count: "2" }] };
				if (sql.includes("UPDATE games")) {
					return {
						rows: [
							{
								id: gameId,
								status: "WAITING",
								startedAt: "2026-09-22T09:00:00.000Z",
								nextRoundAt: "2026-09-22T09:00:00.000Z",
							},
						],
					};
				}
				throw new Error(`Unexpected transaction query: ${sql}`);
			},
		};
		const db = {
			query: async () => {
				throw new Error("start transition must use a transaction connection");
			},
			end: async () => {},
			transaction: async (
				run: (transactionDb: typeof connection) => Promise<unknown>,
			) => {
				transactionCalls += 1;
				return run(connection);
			},
		} as unknown as GameDb;

		const result = await startGame(gameId, false, { gameId, role: "HOST" }, db);

		expect(transactionCalls).toBe(1);
		expect(result?.status).toBe("WAITING");
	});
});
