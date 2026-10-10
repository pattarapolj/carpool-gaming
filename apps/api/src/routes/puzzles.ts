import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PuzzleActionSchema } from "../../../../packages/contracts/src/puzzles";
import { type GameDb, getBearerToken, resolveSession } from "../services/auth";
import {
	loadSongClue,
	PuzzleError,
	puzzleAction,
} from "../services/puzzle-service";

export const registerPuzzleRoutes: FastifyPluginAsync<{ db: GameDb }> = async (
	app,
	{ db },
) => {
	app.post("/v1/games/:gameId/puzzles/clip", async (request, reply) => {
		reply.header("cache-control", "no-store");
		const token = getBearerToken(request.headers.authorization);
		const session = token ? await resolveSession(token, db) : null;
		const fail = (status: number, code: string, message: string) =>
			reply
				.code(status)
				.send({ error: { code, message, requestId: request.id } });
		if (!session)
			return fail(401, "UNAUTHENTICATED", "A valid bearer token is required");
		const parsed = z
			.object({ puzzleId: z.string().min(1).max(80) })
			.strict()
			.safeParse(request.body);
		if (!parsed.success)
			return fail(422, "VALIDATION_ERROR", "Invalid song clip request");
		try {
			return await loadSongClue(
				(request.params as { gameId: string }).gameId,
				parsed.data.puzzleId,
				session,
				db,
			);
		} catch (error) {
			if (error instanceof PuzzleError)
				return fail(error.statusCode, error.code, error.message);
			throw error;
		}
	});
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
