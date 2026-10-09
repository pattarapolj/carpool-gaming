import { loadMigrations, migrate, seed } from "./migrations";
import { productionConfig } from "./production";
import { buildServer, createPostgresDb } from "./server";

async function main() {
	const config = await productionConfig(process.env);
	process.env.FRONTEND_ORIGIN = config.origin;
	const db = createPostgresDb({ connectionString: config.connectionString });
	try {
		await migrate(db, await loadMigrations());
		await seed(db);
	} catch {
		await db.end();
		throw new Error(
			"Database initialization failed; verify migrations and connection configuration",
		);
	}
	const app = buildServer(db, { logger: true }, config.webRoot);
	const shutdown = () => {
		void app.close().catch((error: unknown) => {
			app.log.error(error, "Failed to close the API server");
			process.exitCode = 1;
		});
	};

	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);

	try {
		await app.listen({ host: config.host, port: config.port });
	} catch {
		app.log.error("Failed to start the API server");
		await app.close();
		process.exitCode = 1;
	}
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : "Startup failed");
	process.exitCode = 1;
});
