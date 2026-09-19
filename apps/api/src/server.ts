import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { registerGameRoutes } from "./routes/games";
import type { GameDb } from "./services/games-services";

export function buildServer(
	db: GameDb = new Pool({ connectionString: process.env.DATABASE_URL }),
): FastifyInstance {
	const app = Fastify();

	app.get("/health", () => ({ ok: true }));
	app.register(registerGameRoutes, { db });
	app.addHook("onClose", () => db.end());

	return app;
}
