import Fastify, { type FastifyInstance } from "fastify";

export function buildServer(): FastifyInstance {
	const app = Fastify();

	app.get("/health", () => ({ ok: true }));

	return app;
}
