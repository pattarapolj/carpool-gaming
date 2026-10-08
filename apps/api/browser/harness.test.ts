import assert from "node:assert/strict";
import { it } from "vitest";
import { closeBrowserHarness } from "./harness";

it("attempts every owned cleanup after browser and database close failures and reports both", async () => {
	const originalOrigin = process.env.FRONTEND_ORIGIN;
	const browserFailure = new Error("browser close failed");
	const dbFailure = new Error("database end failed");
	const adminFailure = new Error("admin end failed");
	const calls: string[] = [];
	const stop = (name: string, failure?: Error) => async () => {
		calls.push(name);
		if (failure) throw failure;
	};
	process.env.FRONTEND_ORIGIN = "http://test-owned-origin.invalid";
	try {
		let result: unknown;
		try {
			await closeBrowserHarness({
				browser: { close: stop("browser", browserFailure) },
				web: { close: stop("Vite") },
				live: { close: stop("live") },
				app: { close: stop("HTTP") },
				db: { end: stop("database", dbFailure) },
				control: {
					query: async (sql) => {
						calls.push(sql);
					},
					end: stop("admin", adminFailure),
				},
				schema: "carpool_browser_cleanup",
				created: true,
				originalOrigin,
			});
		} catch (error) {
			result = error;
		}
		assert.deepEqual(calls, [
			"browser",
			"Vite",
			"live",
			"HTTP",
			"database",
			"DROP SCHEMA carpool_browser_cleanup CASCADE",
			"admin",
		]);
		assert.equal(process.env.FRONTEND_ORIGIN, originalOrigin);
		assert(result instanceof AggregateError);
		assert.deepEqual(result.errors, [browserFailure, dbFailure, adminFailure]);
	} finally {
		if (originalOrigin === undefined) delete process.env.FRONTEND_ORIGIN;
		else process.env.FRONTEND_ORIGIN = originalOrigin;
	}
});
