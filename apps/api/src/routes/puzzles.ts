import type { FastifyPluginAsync } from "fastify";
import { PuzzleActionSchema } from "../../../../packages/contracts/src/puzzles";
import { type GameDb, getBearerToken, resolveSession } from "../services/auth";
import { PuzzleError, puzzleAction } from "../services/puzzle-service";

export const registerPuzzleRoutes: FastifyPluginAsync<{ db: GameDb }> = async (
	app,
	{ db },
) => {
	app.post("/v1/games/:gameId/puzzles/actions", async (request, reply) => {
		const token = getBearerToken(request.headers.authorization);
		const session = token ? await resolveSession(token, db) : null;
		if (!session)
			return reply.code(401).send({
				error: {
					code: "UNAUTHENTICATED",
					message: "A valid bearer token is required",
					requestId: request.id,
				},
			});
		const parsed = PuzzleActionSchema.safeParse(request.body);
		if (!parsed.success)
			return reply.code(422).send({
				error: {
					code: "VALIDATION_ERROR",
					message: "Invalid puzzle action",
					requestId: request.id,
				},
			});
		try {
			return await puzzleAction(
				(request.params as { gameId: string }).gameId,
				parsed.data,
				session,
				db,
			);
		} catch (error) {
			if (error instanceof PuzzleError)
				return reply.code(error.statusCode).send({
					error: {
						code: error.code,
						message: error.message,
						requestId: request.id,
					},
				});
			throw error;
		}
	});
};
