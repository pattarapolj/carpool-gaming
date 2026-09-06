import type { FastifyPluginAsync } from "fastify";

export const registerGameRoutes: FastifyPluginAsync = async (app) => {
    app.post("/v1/games", async () => {
        // Later:
        // 1. Validate request.body with CreateGameSchema
        // 2. Return 422 when validation fails
        // 3. Pass the validated input to createGame()
        // 4. Return the created game with HTTP 201
        // 5. Never include the stored host-token hash
        throw new Error("Not implemented");
    });
};
