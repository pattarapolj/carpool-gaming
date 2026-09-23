import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { registerGameRoutes } from "./routes/games";
import type { GameDb } from "./services/games-services";

export function buildServer(db: GameDb = createPostgresDb()): FastifyInstance {
	const app = Fastify();

	app.get("/health", () => ({ ok: true }));
	app.register(registerGameRoutes, { db });
	app.addHook("onClose", () => db.end());

	return app;
}

function createPostgresDb(): GameDb {
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
