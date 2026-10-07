import type { FastifyPluginAsync } from "fastify";
import { SubmitAnswerSchema } from "../../../../packages/contracts/src/index";
import { type GameDb, getBearerToken, resolveSession } from "../services/auth";
import { lockAnswer, RoundError } from "../services/round-service";

export const registerRoundRoutes: FastifyPluginAsync<{ db: GameDb }> = async (
	app,
	{ db },
) => {
	app.post<{ Params: { roundId: string } }>(
		"/v1/rounds/:roundId/answers",
		async (request) => {
			const token = getBearerToken(request.headers.authorization);
			const session = token ? await resolveSession(token, db) : null;
			if (!session)
				throw new RoundError(
					401,
					"UNAUTHENTICATED",
					"A valid bearer token is required",
				);
			const input = SubmitAnswerSchema.safeParse(request.body);
			if (!input.success)
				throw new RoundError(
					422,
					"INVALID_ANSWER_VALUE",
					"Invalid answer value",
				);
			return (await lockAnswer(request.params.roundId, input.data, session, db))
				.answer;
		},
	);
};
