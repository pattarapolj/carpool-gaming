import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { productionConfig } from "../src/production";
import { buildServer } from "../src/server";

it("serves built web with safe caching and enforces HTTP browser origin", async () => {
	const root = await mkdtemp(join(tmpdir(), "carpool-static-"));
	const db = new PGlite();
	const app = buildServer(
		{
			query: (sql, values) => db.query(sql, values),
			transaction: (run) => db.transaction((tx) => run(tx)),
			end: () => db.close(),
		},
		{},
		root,
	);
	try {
		await writeFile(
			join(root, "index.html"),
			"<!doctype html><title>Carpool built web</title>",
		);
		const page = await app.inject("/");
		expect(page.statusCode).toBe(200);
		expect(page.headers["content-type"]).toContain("text/html");
		expect(page.headers["cache-control"]).toContain("max-age=0");
		expect((await app.inject("/v1/does-not-exist")).statusCode).toBe(404);
		expect(
			(
				await app.inject({
					url: "/health",
					headers: { origin: "https://untrusted.example" },
				})
			).statusCode,
		).toBe(403);
		expect(
			(
				await app.inject({
					url: "/health",
					headers: {
						origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
					},
				})
			).statusCode,
		).toBe(200);
		expect((await app.inject("/health")).statusCode).toBe(200);
	} finally {
		await app.close();
		await rm(root, { recursive: true, force: true });
	}
});

it("rejects invalid configuration without exposing values", async () => {
	const valid = {
		DATABASE_URL: "postgres://u:secret@localhost/game",
		NODE_ENV: "production",
		FRONTEND_ORIGIN: "https://quiz.example",
		PORT: "3000",
	};
	for (const [field, value] of [
		["DATABASE_URL", "https://u:secret@host/game"],
		["DATABASE_URL", "postgres://host"],
		["PORT", "NaN"],
		["PORT", "0"],
		["PORT", "65536"],
		["PORT", "1.5"],
		["FRONTEND_ORIGIN", ""],
		["FRONTEND_ORIGIN", "https://user:secret@host"],
		["FRONTEND_ORIGIN", "https://quiz.example/path"],
		["FRONTEND_ORIGIN", "https://quiz.example/"],
	]) {
		await expect(
			productionConfig({ ...valid, [field]: value }),
		).rejects.toThrow(`Invalid ${field}`);
	}
	await expect(productionConfig(valid, "/missing-assets")).rejects.toThrow(
		"Invalid WEB_ASSETS",
	);
});

it("accepts canonical origins and built assets before listening", async () => {
	const root = await mkdtemp(join(tmpdir(), "carpool-assets-"));
	try {
		await writeFile(join(root, "index.html"), "<!doctype html>");
		const config = await productionConfig(
			{
				NODE_ENV: "production",
				DATABASE_URL: "postgres://u:secret@localhost/game",
				FRONTEND_ORIGIN: "http://localhost:3000",
				PORT: "65535",
			},
			root,
		);
		expect(config.port).toBe(65535);
		expect(config.webRoot).toBe(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
