import type { FastifyPluginAsync } from "fastify";
import { CreateGameSchema } from "../../../../packages/contracts/src/index";
import { createGame, type GameDb } from "../services/games-services";

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
