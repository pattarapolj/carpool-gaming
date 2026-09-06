import Fastify, { type FastifyInstance } from "fastify";
import { registerGameRoutes } from "./routes/games";

export function buildServer(): FastifyInstance {
  const app = Fastify();

  app.get("/health", () => ({ ok: true }));
  app.register(registerGameRoutes);

  return app;
}
