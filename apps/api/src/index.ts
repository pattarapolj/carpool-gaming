import { buildServer } from "./server";

async function main() {
	const app = buildServer();
	const port = Number(process.env.PORT ?? 3000);
	const host = process.env.HOST ?? "127.0.0.1";
	const shutdown = () => {
		void app.close().catch((error: unknown) => {
			app.log.error(error, "Failed to close the API server");
			process.exitCode = 1;
		});
	};

	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);

	try {
		await app.listen({ host, port });
	} catch (error) {
		app.log.error(error, "Failed to start the API server");
		await app.close();
		process.exitCode = 1;
	}
}

void main();
