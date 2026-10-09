import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { Pool } from "pg";
import { chromium } from "playwright";
import { createServer } from "vite";
import { tick } from "../src/coordinator";
import { createLiveServer } from "../src/live";
import { registerGameRoutes } from "../src/routes/games";
import { createPostgresDb } from "../src/server";
import type { GameDb, QueryDb } from "../src/services/auth";
import { testDatabaseUrl } from "../test/postgres-url";

export async function browserHarness() {
	// Fail closed before creating a pool. Each run owns only its generated schema.
	const connectionString = testDatabaseUrl(process.env.TEST_DATABASE_URL);
	const schema = `carpool_browser_${randomUUID().replaceAll("-", "")}`;
	const options = `-c search_path=${schema} -c statement_timeout=10000`;
	const control = new Pool({ connectionString, options });
	const storage = createPostgresDb({ connectionString, options });
	const db: GameDb = {
		query: (sql, values) => storage.query(sql, values),
		end: () => storage.end(),
		transaction: async <Result>(run: (tx: QueryDb) => Promise<Result>) =>
			storage.transaction(async (tx) => {
				// Repeat the real random selector with a stable sequence in browser acceptance.
				await tx.query("SELECT setseed(0.88)", []);
				return run(tx);
			}),
	};
	const app = Fastify();
	let created = false;
	let live: ReturnType<typeof createLiveServer> | undefined;
	let web: Awaited<ReturnType<typeof createServer>> | undefined;
	let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
	const originalOrigin = process.env.FRONTEND_ORIGIN;
	const url = "http://127.0.0.1:5174";
	async function close() {
		await closeBrowserHarness({
			browser,
			web,
			live,
			app,
			db,
			control,
			schema,
			created,
			originalOrigin,
		});
	}
	try {
		await control.query(`CREATE SCHEMA ${schema}`);
		created = true;
		for (const file of (
			await readdir(new URL("../migrations/", import.meta.url))
		)
			.filter((name) => name.endsWith(".sql"))
			.sort()) {
			await control.query(
				await readFile(
					new URL(`../migrations/${file}`, import.meta.url),
					"utf8",
				),
			);
		}
		await control.query(`INSERT INTO questions
			(id,type,prompt,choices,correct_answer,explanation,source_title,source_url) VALUES
			('00000000-0000-4000-8000-000000000001','MULTIPLE_CHOICE','Which ocean is the largest on Earth?',
			 '["Pacific Ocean","Atlantic Ocean","Indian Ocean","A deliberately long answer choice to check wrapping on narrow passenger screens"]',
			 '"Pacific Ocean"','The Pacific Ocean is the largest ocean.','Acceptance fixture','https://example.com/fixture'),
			('00000000-0000-4000-8000-000000000002','TRUE_FALSE','The Sun orbits the Earth.',NULL,
			 'false','Earth orbits the Sun.','Acceptance fixture','https://example.com/fixture'),
			('00000000-0000-4000-8000-000000000003','ESTIMATE','Estimate the fixture target.',NULL,
			 '100','The fixture target is 100.','Acceptance fixture','https://example.com/fixture'),
			('00000000-0000-4000-8000-000000000004','TRUE_FALSE','An unused question remains.',NULL,
			 'true','Keeps the bank available during time-limit acceptance.','Acceptance fixture','https://example.com/fixture')`);
		// Same exported route/auth/error/origin/live wiring as buildServer. The test
		// drives its exported coordinator directly instead of starting a real-time interval.
		process.env.FRONTEND_ORIGIN = url;
		live = createLiveServer(app, db);
		app.register(registerGameRoutes, { db, live });
		await app.listen({ host: "127.0.0.1", port: 0 });
		const apiAddress = app.server.address();
		assert(apiAddress && typeof apiAddress !== "string");
		const api = `http://127.0.0.1:${apiAddress.port}`;
		web = await createServer({
			root: fileURLToPath(new URL("../../web/", import.meta.url)),
			configFile: fileURLToPath(
				new URL("../../web/vite.config.ts", import.meta.url),
			),
			logLevel: "error",
			server: {
				host: "127.0.0.1",
				port: 5174,
				strictPort: true,
				proxy: {
					"/v1": api,
					"/socket.io": { target: api, ws: true },
				},
			},
		});
		await web.listen();
		browser = await chromium.launch();
		console.log(`Browser acceptance: Chromium ${browser.version()}`);
		const artifacts = fileURLToPath(
			new URL("../../../output/playwright/", import.meta.url),
		);
		await mkdir(artifacts, { recursive: true });
		return {
			browser,
			url,
			artifacts,
			control,
			close,
			tick: () => tick(db, () => new Date(), live?.publishTransition),
		};
	} catch (error) {
		try {
			await close();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Browser acceptance setup and cleanup failed",
			);
		}
		throw error;
	}
}

export async function closeBrowserHarness(resources: {
	browser?: { close: () => unknown };
	web?: { close: () => unknown };
	live?: { close: () => unknown };
	app: { close: () => unknown };
	db: { end: () => unknown };
	control: { end: () => unknown; query: (sql: string) => unknown };
	schema: string;
	created: boolean;
	originalOrigin: string | undefined;
}) {
	const {
		browser,
		web,
		live,
		app,
		db,
		control,
		schema,
		created,
		originalOrigin,
	} = resources;
	const errors: unknown[] = [];
	for (const stop of [
		() => browser?.close(),
		() => web?.close(),
		() => live?.close(),
		() => app.close(),
		() => db.end(),
		() =>
			created ? control.query(`DROP SCHEMA ${schema} CASCADE`) : undefined,
		() => control.end(),
		() => {
			if (originalOrigin === undefined) delete process.env.FRONTEND_ORIGIN;
			else process.env.FRONTEND_ORIGIN = originalOrigin;
		},
	]) {
		try {
			await stop();
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length)
		throw new AggregateError(errors, "Browser acceptance cleanup failed");
}
