import { access } from "node:fs/promises";
import { resolve } from "node:path";

export function databaseUrl(value: string | undefined) {
	try {
		const url = new URL(value ?? "");
		if (
			!["postgres:", "postgresql:"].includes(url.protocol) ||
			!url.hostname ||
			url.pathname.length < 2 ||
			url.hash ||
			url.search
		)
			throw new Error();
		return url.toString();
	} catch {
		throw new Error("Invalid DATABASE_URL");
	}
}

export async function productionConfig(
	env: NodeJS.ProcessEnv,
	webRoot = resolve(__dirname, "../web"),
) {
	const connectionString = databaseUrl(env.DATABASE_URL);
	const port = Number(env.PORT ?? "3000");
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error("Invalid PORT");
	const origin =
		env.FRONTEND_ORIGIN ??
		(env.NODE_ENV === "production" ? "" : "http://localhost:5173");
	try {
		const url = new URL(origin);
		if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
			throw new Error();
	} catch {
		throw new Error("Invalid FRONTEND_ORIGIN");
	}
	if (env.NODE_ENV === "production") {
		try {
			await access(resolve(webRoot, "index.html"));
		} catch {
			throw new Error("Invalid WEB_ASSETS");
		}
	}
	return {
		connectionString,
		port,
		host: env.HOST ?? "127.0.0.1",
		origin,
		webRoot: env.NODE_ENV === "production" ? webRoot : undefined,
	};
}
