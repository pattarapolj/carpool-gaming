import type { FastifyPluginAsync } from "fastify";
import {
	CreateGameSchema,
	JoinGameSchema,
	StartGameSchema,
} from "../../../../packages/contracts/src/index";
import { getBearerToken, resolveSession } from "../services/auth";
import {
	createGame,
	type GameDb,
	GameJoinError,
	GameStartError,
	joinGame,
	startGame,
} from "../services/games-services";

export const registerGameRoutes: FastifyPluginAsync<{ db: GameDb }> = async (
	app,
	{ db },
) => {
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

	app.setErrorHandler((error, request, reply) => {
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
