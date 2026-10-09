import { loadMigrations, migrate, seed } from "./migrations";
import { databaseUrl } from "./production";
import { createPostgresDb } from "./server";

async function main() {
	const [command, flag, through, ...extra] = process.argv.slice(2);
	if (
		!((command === "migrate" || command === "seed") && flag === undefined) &&
		!(command === "adopt" && flag === "--through" && through && !extra.length)
	)
		throw new Error(
			"Usage: db-command migrate | seed | adopt --through <migration.sql>",
		);
	const db = createPostgresDb({
		connectionString: databaseUrl(process.env.DATABASE_URL),
	});
	try {
		if (command === "seed") {
			await seed(db);
			console.log("Seed applied idempotently");
		} else
			console.log(
				`Migration journal: ${(await migrate(db, await loadMigrations(), command === "adopt" ? through : undefined)).join(", ") || "up to date"}`,
			);
	} finally {
		await db.end();
	}
}
void main().catch(() => {
	console.error(
		"Database command failed: verify command, connection, selected prefix, schema and migration checksums",
	);
	process.exitCode = 1;
});
