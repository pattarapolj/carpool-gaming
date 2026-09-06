import type { FastifyPluginAsync } from "fastify";
import { CreateGameSchema } from "../../../../packages/contracts/src/index";
import { createGame } from "../services/games-services";

export const registerGameRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/games", async (req, res) => {
    // 1. Validate request.body with CreateGameSchema
    const parsedBody = CreateGameSchema.safeParse(req.body);
    // 2. Return 422 when validation fails
    if (!parsedBody.success) {
      return handleValidationError(req, res, parsedBody.error);
    }
    // 3. Pass the validated input to createGame()
    const createdGame = await createGame(parsedBody.data);
    // 4. Return the created game with HTTP 201
    // 5. Never include the stored host-token hash -- done in games-services
    return res.status(201).send(createdGame);
  });

  app.setErrorHandler((error, req, res) => {
    const parserError = error as {
      code?: string;
      message?: string;
      statusCode?: number;
    };
    // case: Malformed JSON in request body
    const isMalformedJson =
      parserError.code === "FST_ERR_CTP_INVALID_JSON" ||
      (parserError.statusCode === 400 &&
        parserError.message?.toLowerCase().includes("json"));

    if (isMalformedJson) {
      return res.status(400).send({
        error: {
          code: "MALFORMED_JSON",
          message: "Request body contains malformed JSON",
          requestId: req.id,
        },
      });
    }
    // case: Other errors
    return res.status(parserError.statusCode ?? 500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred",
        requestId: req.id,
      },
    });
  });
};

function handleValidationError(req: any, res: any, error: any) {
  return res.status(422).send({
    error: {
      code: "VALIDATION_ERROR",
      message: error.flatten().fieldErrors.name?.join(", "),
      requestId: req.id,
    },
  });
}
