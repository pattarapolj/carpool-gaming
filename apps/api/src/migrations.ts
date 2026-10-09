import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { GameDb, QueryDb } from "./services/auth";
export type Migration = { name: string; sql: string };
export async function loadMigrations(): Promise<Migration[]> {
	const root = resolve(__dirname, "../migrations");
	return Promise.all(
		(await readdir(root))
			.filter((name) => /^\d+_.+\.sql$/.test(name))
			.sort()
			.map(async (name) => ({
				name,
				sql: await readFile(resolve(root, name), "utf8"),
			})),
	);
}
const checksum = (sql: string) =>
	createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex");
const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

// App-specific structure check: owners/ACLs and extension-owned objects are not
// migration history. Meaningful SQL bodies/defaults are compared unchanged.
async function structure(db: QueryDb, schema: string) {
	await db.query(
		`SET LOCAL search_path TO ${identifier(schema)}, pg_catalog`,
		[],
	);
	const result = (await db.query(
		`
 WITH app_classes AS (SELECT c.* FROM pg_class c WHERE NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'))
 SELECT 'relation' AS kind, c.relname AS name,
 jsonb_build_array(c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity) AS definition
 FROM app_classes c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','S','f','c') AND c.relname <> 'schema_migrations'
 UNION ALL
 SELECT 'column',c.relname||'.'||a.attname,jsonb_build_array(a.attnum,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attidentity,a.attgenerated,co.collname)
 FROM pg_attribute a JOIN app_classes c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum LEFT JOIN pg_collation co ON co.oid=a.attcollation
 WHERE n.nspname=$1 AND c.relkind IN ('r','p') AND c.relname <> 'schema_migrations' AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'constraint',c.relname||'.'||k.conname,jsonb_build_array(pg_get_constraintdef(k.oid),k.convalidated)
 FROM pg_constraint k JOIN app_classes c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=$1 AND c.relname <> 'schema_migrations'
 UNION ALL
 SELECT 'index',i.relname,jsonb_build_array(replace(pg_get_indexdef(i.oid),' ON '||quote_ident($1)||'.',' ON '),x.indisvalid,x.indisready)
 FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN app_classes c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=$1 AND c.relname <> 'schema_migrations'
 UNION ALL
 SELECT 'trigger',c.relname||'.'||t.tgname,jsonb_build_array(replace(pg_get_triggerdef(t.oid),' ON '||quote_ident($1)||'.',' ON '),t.tgenabled)
 FROM pg_trigger t JOIN app_classes c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=$1 AND NOT t.tgisinternal
 UNION ALL
 SELECT 'internal-trigger',c.relname||'.'||k.conname||'.'||p.proname,
 jsonb_build_array(t.tgtype,t.tgenabled,t.tgdeferrable,t.tginitdeferred)
 FROM pg_trigger t JOIN app_classes c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_constraint k ON k.oid=t.tgconstraint JOIN pg_proc p ON p.oid=t.tgfoid
 WHERE n.nspname=$1 AND t.tgisinternal
 UNION ALL
 SELECT 'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 to_jsonb(replace(pg_get_functiondef(p.oid),'CREATE OR REPLACE FUNCTION '||quote_ident($1)||'.','CREATE OR REPLACE FUNCTION '))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
 UNION ALL
 SELECT 'policy',c.relname||'.'||p.polname,to_jsonb(p.polcmd::text)
 FROM pg_policy p JOIN app_classes c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
 UNION ALL
 SELECT 'rule',c.relname||'.'||r.rulename,to_jsonb(pg_get_ruledef(r.oid))
 FROM pg_rewrite r JOIN app_classes c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
 UNION ALL
 SELECT 'type',t.typname,to_jsonb(t.typtype::text) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname=$1 AND t.typrelid=0 AND t.typelem=0 AND t.typtype <> 'p'
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_type'::regclass AND d.objid=t.oid AND d.deptype='e')
 ORDER BY kind,name`,
		[schema],
	)) as { rows: unknown[] };
	return JSON.stringify(result.rows);
}

export async function migrate(
	db: GameDb,
	migrations: Migration[],
	through?: string,
) {
	if (
		!migrations.length ||
		new Set(migrations.map((m) => m.name)).size !== migrations.length ||
		migrations.some((m, i) => i > 0 && m.name <= migrations[i - 1].name)
	)
		throw new Error("Invalid migration order");
	const boundary =
		through === undefined
			? -1
			: migrations.findIndex((m) => m.name === through);
	if (through !== undefined && boundary < 0)
		throw new Error("Invalid adoption prefix");
	return db.transaction(async (tx) => {
		await tx.query("SELECT pg_advisory_xact_lock(182746, 10)", []);
		const {
			rows: [{ schema }],
		} = (await tx.query("SELECT current_schema() AS schema", [])) as {
			rows: { schema: string }[];
		};
		if (!schema) throw new Error("Invalid database schema");
		const {
			rows: [{ journal }],
		} = (await tx.query("SELECT to_regclass($1) AS journal", [
			`${identifier(schema)}.schema_migrations`,
		])) as { rows: { journal: string | null }[] };
		if (through !== undefined && journal)
			throw new Error("Adoption requires absent journal");
		if (!journal) {
			const existing = await structure(tx, schema);
			if (through === undefined && existing !== "[]")
				throw new Error(
					"Unjournaled schema: use explicit adopt after backup and verification",
				);
			if (through !== undefined) {
				const reference = `carpool_reference_${randomUUID().replaceAll("-", "")}`;
				await tx.query(`CREATE SCHEMA ${reference}`, []);
				await tx.query(`SET LOCAL search_path TO ${reference}, pg_catalog`, []);
				for (const migration of migrations.slice(0, boundary + 1))
					await tx.query(migration.sql, []);
				const expected = await structure(tx, reference);
				if (existing !== expected) {
					throw new Error(
						"Legacy structure does not match selected adoption prefix",
					);
				}
				await tx.query(
					`SET LOCAL search_path TO ${identifier(schema)}, pg_catalog`,
					[],
				);
				await tx.query(`DROP SCHEMA ${reference} CASCADE`, []);
			}
			await tx.query(
				"CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
				[],
			);
		}
		const applied = (await tx.query(
			"SELECT name,checksum FROM schema_migrations ORDER BY name",
			[],
		)) as { rows: { name: string; checksum: string }[] };
		for (const [i, row] of applied.rows.entries()) {
			if (
				migrations[i]?.name !== row.name ||
				checksum(migrations[i].sql) !== row.checksum
			)
				throw new Error("Migration history/checksum mismatch");
		}
		const pending =
			through === undefined
				? migrations.slice(applied.rows.length)
				: migrations.slice(0, boundary + 1);
		for (const migration of pending) {
			if (through === undefined) await tx.query(migration.sql, []);
			await tx.query(
				"INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
				[migration.name, checksum(migration.sql)],
			);
		}
		return pending.map((m) => m.name);
	});
}

export async function seed(db: GameDb) {
	const sql = await readFile(
		resolve(__dirname, "../seeds/questions.sql"),
		"utf8",
	);
	await db.transaction(async (tx) => {
		await tx.query("SELECT pg_advisory_xact_lock(182746, 10)", []);
		await tx.query(sql, []);
	});
}
