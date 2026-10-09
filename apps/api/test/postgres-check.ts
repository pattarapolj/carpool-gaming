import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";
import { buildServer, createPostgresDb } from "../src/server";
import { hashToken, type Session } from "../src/services/auth";
import {
	lockAnswer,
	openDueRound,
	revealDueRound,
} from "../src/services/round-service";
import { testDatabaseUrl } from "./postgres-url";

async function main() {
	// Validate before constructing any pool; never fall back to DATABASE_URL.
	const connectionString = testDatabaseUrl(process.env.TEST_DATABASE_URL);
	const schema = `carpool_check_${randomUUID().replaceAll("-", "")}`;
	const options = `-c search_path=${schema} -c statement_timeout=10000`;
	const control = new Pool({ connectionString, options, max: 2 });
	const storage = createPostgresDb({
		connectionString,
		options,
		application_name: schema,
		max: 4,
	});
	const app = buildServer(storage);
	const origin = new Date("2026-10-07T10:00:00Z");
	const at = (seconds: number) => () =>
		new Date(origin.getTime() + seconds * 1000);
	let created = false;

	async function game(count = 2, start = origin) {
		const gameId = randomUUID();
		await control.query(
			"INSERT INTO games (id,name,join_code,host_token_hash,status,round_interval_seconds,started_at,next_round_at) VALUES ($1,'PG check',$2,$3,'WAITING',300,$4,$4)",
			[gameId, gameId.slice(0, 6), hashToken(gameId), start],
		);
		const sessions: Session[] = [];
		for (let i = 0; i < count; i++) {
			const teamId = randomUUID();
			await control.query(
				"INSERT INTO car_teams (id,game_id,name,captain_token_hash) VALUES ($1,$2,$3,$4)",
				[teamId, gameId, `Car ${i}`, hashToken(teamId)],
			);
			sessions.push({ gameId, teamId, role: "CAPTAIN" });
		}
		return { gameId, sessions };
	}

	async function waiting(count: number) {
		const deadline = Date.now() + 5000;
		// Observe actual backend lock waits, rather than assume overlap after a delay.
		while (Date.now() < deadline) {
			const result = await control.query<{ pid: number }>(
				"SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0",
				[schema],
			);
			if (result.rows.length === count) {
				assert.equal(new Set(result.rows.map((row) => row.pid)).size, count);
				return;
			}
		}
		assert.fail(
			`Expected ${count} independent contenders waiting on row locks`,
		);
	}

	async function overlap<T>(
		gameId: string,
		contenders: (() => Promise<T>)[],
		whileLocked = async () => {},
	) {
		const holder = await control.connect();
		const pending: Promise<PromiseSettledResult<T>[]>[] = [];
		try {
			await holder.query("BEGIN");
			await holder.query("SELECT id FROM games WHERE id=$1 FOR UPDATE", [
				gameId,
			]);
			for (const [index, contender] of contenders.entries()) {
				// Attach rejection handling immediately, including on barrier failures.
				pending.push(Promise.allSettled([contender()]));
				await waiting(index + 1);
			}
			await whileLocked();
			await holder.query("COMMIT");
			return (await Promise.all(pending)).flat();
		} finally {
			await holder.query("ROLLBACK");
			holder.release();
			await Promise.all(pending);
		}
	}

	try {
		const version = await control.query<{ server_version: string }>(
			"SHOW server_version",
		);
		assert.match(version.rows[0].server_version, /^16\./);
		console.log(`PostgreSQL ${version.rows[0].server_version}`);
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
		await control.query(
			await readFile(
				new URL("../seeds/questions.sql", import.meta.url),
				"utf8",
			),
		);

		{
			const { gameId, sessions } = await game(2, new Date());
			const opened = await openDueRound(gameId, storage);
			assert(opened);
			const submit = (value: string) =>
				app.inject({
					method: "POST",
					url: `/v1/rounds/${opened.round.id}/answers`,
					headers: { authorization: `Bearer ${sessions[0].teamId}` },
					payload: { value },
				});
			const results = await overlap(gameId, [
				() => submit("Jupiter"),
				() => submit("Earth"),
			]);
			const responses = results.map((result) => {
				assert.equal(result.status, "fulfilled");
				assert(result.status === "fulfilled");
				return result.value;
			});
			assert.deepEqual(
				responses.map((response) => response.statusCode).sort(),
				[200, 409],
			);
			assert.equal(
				responses.find((response) => response.statusCode === 409)?.json().error
					.code,
				"ANSWER_ALREADY_LOCKED",
			);
			const stored = await control.query(
				"SELECT id,value FROM answers WHERE round_id=$1",
				[opened.round.id],
			);
			assert.equal(stored.rows.length, 1);
			assert.equal(
				stored.rows[0].id,
				responses.find((response) => response.statusCode === 200)?.json()
					.answerId,
			);
			await assert.rejects(
				control.query("UPDATE answers SET value='false'::jsonb WHERE id=$1", [
					stored.rows[0].id,
				]),
				{ code: "23514" },
			);
			const unchanged = await control.query(
				"SELECT id,value FROM answers WHERE round_id=$1",
				[opened.round.id],
			);
			assert.deepEqual(unchanged.rows, stored.rows);
			console.log(
				"PASS overlapping same-team HTTP answers: one immutable answer, duplicate 409",
			);
		}

		for (const deadlineFirst of [false, true]) {
			const { gameId, sessions } = await game();
			const opened = await openDueRound(gameId, storage, at(0));
			assert(opened);
			await lockAnswer(
				opened.round.id,
				{ value: "Jupiter" },
				sessions[0],
				storage,
				at(1),
			);
			const finalAnswer = () =>
				lockAnswer(
					opened.round.id,
					{ value: "Jupiter" },
					sessions[1],
					storage,
					at(59.999),
				);
			const deadline = () => revealDueRound(opened.round.id, storage, at(60));
			const contenders = deadlineFirst
				? [deadline, finalAnswer]
				: [finalAnswer, deadline];
			const results = await overlap<unknown>(gameId, contenders);
			const answer = results[deadlineFirst ? 1 : 0];
			const reveal = results[deadlineFirst ? 0 : 1];
			assert.equal(reveal.status, "fulfilled");
			if (deadlineFirst) {
				assert.equal(answer.status, "rejected");
				assert(answer.status === "rejected");
				assert.equal(answer.reason.code, "ROUND_NOT_OPEN");
			} else {
				assert.equal(answer.status, "fulfilled");
				assert(reveal.status === "fulfilled");
				assert.equal(reveal.value, null);
			}
			const scores = await control.query(
				"SELECT score FROM car_teams WHERE game_id=$1 ORDER BY name",
				[gameId],
			);
			assert.deepEqual(
				scores.rows.map((row) => row.score),
				deadlineFirst ? [1, 0] : [1, 1],
			);
			const grades = await control.query(
				"SELECT is_correct,points_awarded FROM answers WHERE round_id=$1",
				[opened.round.id],
			);
			assert.equal(grades.rows.length, deadlineFirst ? 1 : 2);
			assert(
				grades.rows.every(
					(row) => row.is_correct === true && row.points_awarded === 1,
				),
			);
			const round = await control.query(
				"SELECT status,revealed_at FROM rounds WHERE id=$1",
				[opened.round.id],
			);
			assert.equal(round.rows[0].status, "REVEALED");
			assert(round.rows[0].revealed_at);
			assert.equal(
				await revealDueRound(opened.round.id, storage, at(61)),
				null,
			);
			console.log(
				`PASS deadline/final-answer overlap (${deadlineFirst ? "deadline" : "answer"} first): points once`,
			);
		}

		{
			const { gameId } = await game();
			const results = await overlap(gameId, [
				() => openDueRound(gameId, storage, at(0)),
				() => openDueRound(gameId, storage, at(0)),
			]);
			assert(results.every((result) => result.status === "fulfilled"));
			assert.equal(
				results.filter(
					(result) => result.status === "fulfilled" && result.value,
				).length,
				1,
			);
			const rounds = await control.query(
				"SELECT sequence,status FROM rounds WHERE game_id=$1",
				[gameId],
			);
			assert.deepEqual(rounds.rows, [{ sequence: 1, status: "OPEN" }]);
			console.log("PASS overlapping openers: one round sequence");
		}

		{
			const { gameId, sessions } = await game();
			const opened = await openDueRound(gameId, storage, at(0));
			assert(opened);
			let now = at(59.999)();
			const [result] = await overlap(
				gameId,
				[
					() =>
						lockAnswer(
							opened.round.id,
							{ value: "Jupiter" },
							sessions[0],
							storage,
							() => now,
						),
				],
				async () => {
					now = at(60)();
				},
			);
			assert.equal(result.status, "rejected");
			assert(result.status === "rejected");
			assert.equal(result.reason.code, "ROUND_EXPIRED");
			const answers = await control.query(
				"SELECT id FROM answers WHERE round_id=$1",
				[opened.round.id],
			);
			assert.equal(answers.rows.length, 0);
			console.log(
				"PASS answer clock sampled after real row-lock wait: late answer rejected",
			);
		}

		{
			const { gameId, sessions } = await game();
			const opened = await openDueRound(gameId, storage, at(0));
			assert(opened);
			await lockAnswer(
				opened.round.id,
				{ value: "Jupiter" },
				sessions[0],
				storage,
				at(1),
			);
			// Fail after grade/score writes to prove the entire transition rolls back.
			await control.query(`CREATE FUNCTION fail_reveal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced scoring failure'; END; $$;
			CREATE TRIGGER fail_reveal BEFORE UPDATE ON rounds FOR EACH ROW EXECUTE FUNCTION fail_reveal()`);
			await assert.rejects(
				lockAnswer(
					opened.round.id,
					{ value: "Jupiter" },
					sessions[1],
					storage,
					at(2),
				),
				/forced scoring failure/,
			);
			const answers = await control.query(
				"SELECT car_team_id,is_correct,points_awarded FROM answers WHERE round_id=$1",
				[opened.round.id],
			);
			assert.deepEqual(answers.rows, [
				{
					car_team_id: sessions[0].teamId,
					is_correct: null,
					points_awarded: null,
				},
			]);
			const scores = await control.query(
				"SELECT score FROM car_teams WHERE game_id=$1 ORDER BY name",
				[gameId],
			);
			assert.deepEqual(scores.rows, [{ score: 0 }, { score: 0 }]);
			const rounds = await control.query(
				"SELECT status,revealed_at FROM rounds WHERE id=$1",
				[opened.round.id],
			);
			assert.deepEqual(rounds.rows, [{ status: "OPEN", revealed_at: null }]);
			await control.query(
				"DROP TRIGGER fail_reveal ON rounds; DROP FUNCTION fail_reveal()",
			);
			const retried = await lockAnswer(
				opened.round.id,
				{ value: "Jupiter" },
				sessions[1],
				storage,
				at(3),
			);
			assert.deepEqual(
				retried.reveal?.leaderboard.map((team) => team.score),
				[1, 1],
			);
			console.log(
				"PASS scoring failure rolls back final answer, grades, scores and reveal; retry succeeds",
			);
		}
	} finally {
		try {
			await app.close();
		} finally {
			try {
				if (created) await control.query(`DROP SCHEMA ${schema} CASCADE`);
			} finally {
				await control.end();
			}
		}
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
