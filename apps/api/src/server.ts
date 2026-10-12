import fastifyStatic from "@fastify/static";
import Fastify, {
	type FastifyInstance,
	type FastifyServerOptions,
} from "fastify";
import { Pool, type PoolConfig } from "pg";
import { tick } from "./coordinator";
import { createLiveServer } from "./live";
import { registerGameRoutes } from "./routes/games";
import type { GameDb } from "./services/games-services";
import {
	startSongPreviewWarming,
	stopSongPreviewWarming,
} from "./services/song-preview";
import { startSongPreviewChecks } from "./services/song-preview-monitor";

export function buildServer(
	db: GameDb = createPostgresDb(),
	options: FastifyServerOptions = {},
	webRoot?: string,
): FastifyInstance {
	const app = Fastify(options);
	const live = createLiveServer(app, db);
	app.addHook("onRequest", async (request, reply) => {
		const origin = request.headers.origin;
		if (
			origin &&
			origin !== (process.env.FRONTEND_ORIGIN ?? "http://localhost:5173")
		) {
			return reply.code(403).send({ error: "Origin not allowed" });
		}
	});
	if (webRoot) app.register(fastifyStatic, { root: webRoot, maxAge: 0 });
	let timer: ReturnType<typeof setInterval> | undefined;
	let running: Promise<unknown> | undefined;
	let stopSongChecks: (() => Promise<void>) | undefined;
	app.addHook("onListen", async () => {
		startSongPreviewWarming();
		stopSongChecks = startSongPreviewChecks(db, (details, message) =>
			app.log.warn(details, message),
		);
		timer = setInterval(() => {
			if (running) return;
			running = tick(db, undefined, live.publishTransition)
				.catch((error: unknown) => {
					app.log.error(error, "Round coordinator tick failed");
				})
				.finally(() => {
					running = undefined;
				});
		}, 1000);
	});

	app.get("/health", () => ({ ok: true }));
	app.register(registerGameRoutes, { db, live });
	app.addHook("preClose", async () => {
		clearInterval(timer);
		await Promise.all([
			running,
			stopSongChecks?.(),
			stopSongChecks ? stopSongPreviewWarming() : undefined,
			live.close(),
		]);
	});
	app.addHook("onClose", async () => {
		await db.end();
	});

	return app;
}

export function createPostgresDb(
	config: PoolConfig = { connectionString: process.env.DATABASE_URL },
): GameDb {
	const pool = new Pool(config);

	return {
		query: (sql, values) => pool.query(sql, values),
		end: () => pool.end(),
		transaction: async (run) => {
			const client = await pool.connect();
			try {
				await client.query("BEGIN");
				const result = await run({
					query: (sql, values) => client.query(sql, values),
				});
				await client.query("COMMIT");
				return result;
			} catch (error) {
				try {
					await client.query("ROLLBACK");
				} catch {
					// Preserve the original failure if rollback itself fails.
				}
				throw error;
			} finally {
				client.release();
			}
		},
	};
}
