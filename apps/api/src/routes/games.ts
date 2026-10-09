import type { FastifyPluginAsync } from "fastify";
import {
	CreateGameSchema,
	JoinGameSchema,
	LeaveGameSchema,
	StartGameSchema,
} from "../../../../packages/contracts/src/index";
import { getBearerToken, resolveSession } from "../services/auth";
import {
	createGame,
	type GameDb,
	GameJoinError,
	GameSnapshotError,
	GameStartError,
	getGameSnapshot,
	joinGame,
	startGame,
} from "../services/games-services";
import { leaveGame, RoundError } from "../services/round-service";
import { registerRoundRoutes } from "./rounds";

export const registerGameRoutes: FastifyPluginAsync<{ db: GameDb }> = async (
	app,
	{ db },
) => {
	app.register(registerRoundRoutes, { db });
	app.post<{ Params: { gameId: string } }>(
		"/v1/games/:gameId/leave",
		async (request) => {
			const token = getBearerToken(request.headers.authorization);
			const session = token ? await resolveSession(token, db) : null;
			if (!session)
				throw new RoundError(
					401,
					"UNAUTHENTICATED",
					"A valid bearer token is required",
				);
			if (
				!LeaveGameSchema.safeParse(
					request.body === undefined ? {} : request.body,
				).success
			)
				throw new RoundError(422, "VALIDATION_ERROR", "Invalid leave request");
			return leaveGame(request.params.gameId, session, db);
		},
	);
	app.post("/v1/games", async (request, reply) => {
		const parsedBody = CreateGameSchema.safeParse(request.body);
		if (!parsedBody.success) {
			return reply.code(422).send({
				error: {
					code: "VALIDATION_ERROR",
					message: parsedBody.error.issues
						.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
						.join("; "),
					requestId: request.id,
				},
			});
		}

		const createdGame = await createGame(parsedBody.data, db);
		return reply.code(201).send(createdGame);
	});

	app.post("/v1/games/:joinCode/teams", async (request, reply) => {
		const parsedBody = JoinGameSchema.safeParse(request.body);
		if (!parsedBody.success) {
			return reply.code(422).send({
				error: {
					code: "VALIDATION_ERROR",
					message: parsedBody.error.issues
						.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
						.join("; "),
					requestId: request.id,
				},
			});
		}

		try {
			const params = request.params as { joinCode: string };
			const joinedGame = await joinGame(params.joinCode, parsedBody.data, db);
			return reply.code(201).send(joinedGame);
		} catch (error) {
			if (error instanceof GameJoinError) {
				return reply.code(error.statusCode).send({
					error: {
						code: error.code,
						message: error.message,
						requestId: request.id,
					},
				});
			}
			throw error;
		}
	});

	app.post("/v1/games/:gameId/start", async (request, reply) => {
		const parsedBody = StartGameSchema.safeParse(request.body ?? {});
		if (!parsedBody.success) {
			return reply.code(422).send({
				error: {
					code: "VALIDATION_ERROR",
					message: parsedBody.error.issues
						.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
						.join("; "),
					requestId: request.id,
				},
			});
		}

		const token = getBearerToken(request.headers.authorization);
		if (!token) {
			return reply.code(401).send({
				error: {
					code: "UNAUTHENTICATED",
					message: "A valid bearer token is required",
					requestId: request.id,
				},
			});
		}

		const session = await resolveSession(token, db);
		if (!session) {
			return reply.code(401).send({
				error: {
					code: "UNAUTHENTICATED",
					message: "A valid bearer token is required",
					requestId: request.id,
				},
			});
		}

		try {
			const params = request.params as { gameId: string };
			const startedGame = await startGame(
				params.gameId,
				parsedBody.data.practice,
				session,
				db,
			);
			return reply.code(200).send({ game: startedGame });
		} catch (error) {
			if (error instanceof GameStartError) {
				return reply.code(error.statusCode).send({
					error: {
						code: error.code,
						message: error.message,
						requestId: request.id,
					},
				});
			}
			throw error;
		}
	});

	app.get("/v1/games/:gameId/snapshot", async (request, reply) => {
		const token = getBearerToken(request.headers.authorization);
		if (!token) {
			return reply.code(401).send({
				error: {
					code: "UNAUTHENTICATED",
					message: "A valid bearer token is required",
					requestId: request.id,
				},
			});
		}

		const session = await resolveSession(token, db);
		if (!session) {
			return reply.code(401).send({
				error: {
					code: "UNAUTHENTICATED",
					message: "A valid bearer token is required",
					requestId: request.id,
				},
			});
		}

		try {
			const params = request.params as { gameId: string };
			const snapshot = await getGameSnapshot(params.gameId, session, db);
			return reply.code(200).send(snapshot);
		} catch (error) {
			if (error instanceof GameSnapshotError) {
				return reply.code(error.statusCode).send({
					error: {
						code: error.code,
						message: error.message,
						requestId: request.id,
					},
				});
			}
			throw error;
		}
	});

	app.setErrorHandler((error, request, reply) => {
		if (error instanceof RoundError) {
			return reply.code(error.statusCode).send({
				error: {
					code: error.code,
					message: error.message,
					requestId: request.id,
				},
			});
		}
		const parserError = error as {
			code?: string;
			statusCode?: number;
			message?: string;
		};
		const malformedJson =
			parserError.code === "FST_ERR_CTP_INVALID_JSON" ||
			(parserError.statusCode === 400 &&
				parserError.message?.toLowerCase().includes("json"));
		if (malformedJson) {
			return reply.code(400).send({
				error: {
					code: "MALFORMED_JSON",
					message: "Request body contains malformed JSON",
					requestId: request.id,
				},
			});
		}

		request.log.error(error);
		return reply.code(500).send({
			error: {
				code: "INTERNAL_ERROR",
				message: "An unexpected error occurred",
				requestId: request.id,
			},
		});
	});
};
