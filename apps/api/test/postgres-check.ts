import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";
import { io } from "socket.io-client";
import {
	GameCompletedSchema,
	LiveSnapshotAckSchema,
	QuestionTopicIds,
	RoundRevealedSchema,
} from "../../../packages/contracts/src/index";
import { tick } from "../src/coordinator";
import { buildServer, createPostgresDb } from "../src/server";
import type { GameDb } from "../src/services/auth";
import { hashToken, type Session } from "../src/services/auth";
import {
	createGame,
	getGameSnapshot,
	joinGame,
} from "../src/services/games-services";
import {
	endGame,
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
		const seed = await readFile(
			new URL("../seeds/questions.sql", import.meta.url),
			"utf8",
		);
		await control.query(seed);
		const seeded = (await control.query("SELECT * FROM questions ORDER BY id"))
			.rows;
		assert.equal(
			seeded.filter((question) => question.is_active).length,
			300 * QuestionTopicIds.length,
		);
		await control.query(seed);
		assert.deepEqual(
			(await control.query("SELECT * FROM questions ORDER BY id")).rows,
			seeded,
		);
		console.log(
			"PASS playable topic banks plus preserved archives load and reload without changing rows",
		);
		const fixtureQuestionIds = Array.from(
			{ length: 25 },
			(_, index) =>
				`60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
		);
		await control.query("UPDATE questions SET is_active=false");
		await control.query(
			`INSERT INTO questions (id,type,prompt,choices,correct_answer,explanation,source_title,source_url,topic_id,answer_window_seconds)
			 SELECT id,'MULTIPLE_CHOICE','PostgreSQL acceptance question '||ordinality,
			 ' ["Jupiter","Earth","Mars","Venus"]'::jsonb,'"Jupiter"'::jsonb,
			 'Fixture answer for the database acceptance journey.','PostgreSQL test fixture',
			 'https://example.invalid/postgres-check','science',60
			 FROM unnest($1::uuid[]) WITH ORDINALITY AS fixture(id,ordinality)`,
			[fixtureQuestionIds],
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
			await control.query(
				"UPDATE questions SET is_active=(id=ANY($1::uuid[]))",
				[fixtureQuestionIds.slice(0, 2)],
			);
			await control.query(
				"UPDATE games SET selected_topics=ARRAY['science'] WHERE id=$1",
				[gameId],
			);
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
				"SELECT id,sequence,status,question_id FROM rounds WHERE game_id=$1",
				[gameId],
			);
			assert.equal(rounds.rows.length, 1);
			assert.equal(rounds.rows[0].sequence, 1);
			assert.equal(rounds.rows[0].status, "OPEN");
			await revealDueRound(rounds.rows[0].id, storage, at(180));
			await control.query("UPDATE games SET next_round_at=$2 WHERE id=$1", [
				gameId,
				at(180)(),
			]);
			const second = await openDueRound(gameId, storage, at(180));
			assert(second);
			const openedQuestions = await control.query(
				"SELECT sequence,question_id FROM rounds WHERE game_id=$1 ORDER BY sequence",
				[gameId],
			);
			assert.equal(openedQuestions.rows.length, 2);
			assert.equal(openedQuestions.rows[0].sequence, 1);
			assert.equal(openedQuestions.rows[1].sequence, 2);
			assert.notEqual(
				openedQuestions.rows[0].question_id,
				openedQuestions.rows[1].question_id,
			);
			console.log(
				"PASS overlapping openers: one sequence and no repeated question",
			);
			await control.query(
				"UPDATE questions SET is_active=(id=ANY($1::uuid[]))",
				[fixtureQuestionIds],
			);
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
					is_correct: true,
					points_awarded: 1,
				},
			]);
			const scores = await control.query(
				"SELECT score FROM car_teams WHERE game_id=$1 ORDER BY name",
				[gameId],
			);
			assert.deepEqual(scores.rows, [{ score: 1 }, { score: 0 }]);
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
			let transitionReady = () => {};
			let release = () => {};
			const ready = new Promise<void>((resolve) => {
				transitionReady = resolve;
			});
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const gated: GameDb = {
				...storage,
				transaction: (run) =>
					storage.transaction(async (tx) => {
						const result = await run(tx);
						transitionReady();
						await gate;
						return result;
					}),
			};
			const scoring = Promise.allSettled([
				revealDueRound(opened.round.id, gated, at(60)),
			]);
			let reading: ReturnType<typeof getGameSnapshot> | undefined;
			try {
				await Promise.race([
					ready,
					scoring.then(() =>
						assert.fail("Scoring finished before transition readiness"),
					),
				]);
				reading = getGameSnapshot(gameId, sessions[0], storage);
				await waiting(1);
				const before = await control.query(
					"SELECT r.status,t.score FROM rounds r JOIN car_teams t ON t.game_id=r.game_id WHERE r.id=$1 ORDER BY t.name",
					[opened.round.id],
				);
				assert.deepEqual(before.rows, [
					{ status: "OPEN", score: 1 },
					{ status: "OPEN", score: 0 },
				]);
				release();
				const snapshot = await reading;
				assert.equal(snapshot.round?.status, "REVEALED");
				assert.deepEqual(
					snapshot.leaderboard.map((team) => [team.score, team.rank]),
					[
						[1, 1],
						[0, 2],
					],
				);
				assert.equal(
					snapshot.round?.status === "REVEALED" &&
						snapshot.round.results?.find(
							(result) => result.teamId === sessions[0].teamId,
						)?.pointsAwarded,
					1,
				);
				assert.equal((await scoring)[0].status, "fulfilled");
				console.log(
					"PASS atomic snapshot waits for scoring commit: REVEALED, grades, scores and ranks agree",
				);
			} finally {
				release();
				await scoring;
				if (reading) await reading;
			}
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
			await control.query("UPDATE questions SET is_active=(id=$1)", [
				opened.round.question.id,
			]);
			try {
				const results = await overlap(gameId, [
					() => tick(storage, at(60)),
					() => tick(storage, at(60)),
				]);
				assert(results.every((result) => result.status === "fulfilled"));
				const snapshot = await getGameSnapshot(gameId, sessions[1], storage);
				assert.equal(snapshot.round?.status, "REVEALED");
				assert.equal(snapshot.game.status, "COMPLETE");
				assert.equal(snapshot.game.completionReason, "QUESTION_BANK_EXHAUSTED");
				assert.equal(snapshot.game.nextRoundAt, null);
				assert.deepEqual(
					snapshot.leaderboard.map((team) => team.score),
					[1, 0],
				);
				console.log(
					"PASS overlapping coordinator ticks on independent connections: last-bank completion, reveal and points once",
				);
			} finally {
				await control.query(
					"UPDATE questions SET is_active=(id=ANY($1::uuid[]))",
					[fixtureQuestionIds],
				);
			}
		}
		{
			const createdGame = await createGame(
				{ name: "Final slot", roundIntervalSeconds: 300 },
				storage,
			);
			for (let i = 0; i < 19; i++)
				await joinGame(
					createdGame.game.joinCode,
					{ name: `Car ${i}` },
					storage,
				);
			const contenders = await overlap(createdGame.game.id, [
				() => joinGame(createdGame.game.joinCode, { name: "Slot A" }, storage),
				() => joinGame(createdGame.game.joinCode, { name: "Slot B" }, storage),
			]);
			assert.equal(
				contenders.filter((result) => result.status === "fulfilled").length,
				1,
			);
			const rejected = contenders.find(
				(result) => result.status === "rejected",
			);
			assert(rejected?.status === "rejected");
			assert.equal(rejected.reason.code, "GAME_FULL");
			const teams = await control.query(
				"SELECT count(*)::int AS count FROM car_teams WHERE game_id=$1 AND status='ACTIVE'",
				[createdGame.game.id],
			);
			assert.equal(teams.rows[0].count, 20);
			console.log(
				"PASS competing independent-connection lobby joins: final slot admitted once, excess GAME_FULL",
			);
		}
		for (const endFirst of [false, true]) {
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
			const host: Session = { gameId, role: "HOST" };
			const ending = () => endGame(gameId, host, storage, at(59));
			const answer = () =>
				lockAnswer(
					opened.round.id,
					{ value: "Jupiter" },
					sessions[1],
					storage,
					at(59),
				);
			const deadline = () => revealDueRound(opened.round.id, storage, at(60));
			const results = await overlap<unknown>(
				gameId,
				endFirst ? [ending, answer, deadline] : [answer, deadline, ending],
			);
			assert.equal(results[endFirst ? 0 : 2].status, "fulfilled");
			assert.equal(
				results[endFirst ? 1 : 0].status,
				endFirst ? "rejected" : "fulfilled",
			);
			const final = await getGameSnapshot(gameId, host, storage);
			assert.equal(final.game.status, "COMPLETE");
			assert.equal(final.game.completionReason, "HOST_ENDED");
			assert.equal(final.round?.status, "REVEALED");
			assert.equal(final.game.nextRoundAt, null);
			assert.deepEqual(
				final.leaderboard.map((team) => team.score),
				endFirst ? [1, 0] : [1, 1],
			);
			assert.deepEqual(await endGame(gameId, host, storage, at(100)), {
				game: {
					id: gameId,
					status: "COMPLETE",
					completedAt: final.game.completedAt,
					completionReason: "HOST_ENDED",
				},
				leaderboard: final.leaderboard,
			});
			console.log(
				`PASS host end/final-answer/deadline overlap (${endFirst ? "end" : "answer"} first): completion durable, points once`,
			);
		}
		{
			const { gameId, sessions } = await game();
			const opened = await openDueRound(gameId, storage, at(0));
			assert(opened);
			await control.query("UPDATE rounds SET ends_at=$2 WHERE id=$1", [
				opened.round.id,
				at(7300)(),
			]);
			let now = at(7199.999)();
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
					now = at(7200)();
				},
			);
			assert(result.status === "rejected");
			assert.equal(result.reason.code, "ROUND_EXPIRED");
			await tick(storage, at(7200));
			const final = await getGameSnapshot(gameId, sessions[0], storage);
			assert.equal(final.game.completionReason, "TIME_LIMIT");
			assert.equal(final.round?.status, "REVEALED");
			console.log(
				"PASS two-hour eligibility after real lock wait and forced completion before persisted round deadline",
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
			let ready = () => {};
			let release = () => {};
			const transitionReady = new Promise<void>((resolve) => {
				ready = resolve;
			});
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const gated: GameDb = {
				...storage,
				transaction: (run) =>
					storage.transaction(async (tx) => {
						const result = await run(tx);
						ready();
						await gate;
						return result;
					}),
			};
			const ending = Promise.allSettled([
				endGame(gameId, { gameId, role: "HOST" }, gated, at(2)),
			]);
			let reading: ReturnType<typeof getGameSnapshot> | undefined;
			try {
				await Promise.race([
					transitionReady,
					ending.then(() => assert.fail("Ending finished before readiness")),
				]);
				reading = getGameSnapshot(gameId, sessions[0], storage);
				await waiting(1);
				const before = await control.query(
					"SELECT g.status AS game_status,g.completed_at,r.status AS round_status,t.score FROM games g JOIN rounds r ON r.game_id=g.id JOIN car_teams t ON t.game_id=g.id WHERE g.id=$1 ORDER BY t.name",
					[gameId],
				);
				assert.deepEqual(before.rows, [
					{
						game_status: "WAITING",
						completed_at: null,
						round_status: "OPEN",
						score: 1,
					},
					{
						game_status: "WAITING",
						completed_at: null,
						round_status: "OPEN",
						score: 0,
					},
				]);
				release();
				const final = await reading;
				assert.equal(final.game.status, "COMPLETE");
				assert.equal(final.game.completedAt, at(2)().toISOString());
				assert.equal(final.round?.status, "REVEALED");
				assert.deepEqual(
					final.leaderboard.map((team) => team.score),
					[1, 0],
				);
				assert.equal((await ending)[0].status, "fulfilled");
				console.log(
					"PASS completion snapshot waits for atomic grade, reveal, metadata and score commit",
				);
			} finally {
				release();
				await ending;
				if (reading) await reading;
			}
		}
		{
			const created = await createGame(
				{ name: "PG live delivery", roundIntervalSeconds: 300 },
				storage,
			);
			const teams: Awaited<ReturnType<typeof joinGame>>[] = [];
			for (let i = 0; i < 2; i++)
				teams.push(
					await joinGame(
						created.game.joinCode,
						{ name: `Live car ${i}` },
						storage,
					),
				);
			const address = await app.listen({ host: "127.0.0.1", port: 0 });
			const socket = io(address, {
				auth: { token: created.hostToken },
				autoConnect: false,
				reconnection: false,
				transports: ["websocket"],
			});
			const events: string[] = [];
			const revealedRoundIds: string[] = [];
			const post = (url: string, token: string, payload = {}) =>
				app.inject({
					method: "POST",
					url,
					headers: { authorization: `Bearer ${token}` },
					payload,
				});
			try {
				const connected = new Promise<void>((resolve, reject) => {
					socket.once("connect", resolve);
					socket.once("connect_error", reject);
				});
				socket.connect();
				await connected;
				const ack = LiveSnapshotAckSchema.parse(
					await socket
						.timeout(2000)
						.emitWithAck("game.subscribe", { gameId: created.game.id }),
				);
				assert(ack.ok);
				assert.equal(
					(await post(`/v1/games/${created.game.id}/start`, created.hostToken))
						.statusCode,
					200,
				);
				const host: Session = { gameId: created.game.id, role: "HOST" };
				const snapshot = await getGameSnapshot(created.game.id, host, storage);
				assert(snapshot.round);
				const roundId = snapshot.round.id;
				assert.equal(
					(
						await post(`/v1/rounds/${roundId}/answers`, teams[0].captainToken, {
							value: "Jupiter",
						})
					).statusCode,
					200,
				);
				socket.on("round.revealed", (payload) => {
					events.push("round.revealed");
					revealedRoundIds.push(RoundRevealedSchema.parse(payload).roundId);
				});
				socket.on("game.completed", () => events.push("game.completed"));
				const revealed = new Promise<unknown>((resolve, reject) => {
					const timer = setTimeout(
						() => reject(new Error("PG live reveal missing")),
						5000,
					);
					socket.once("round.revealed", (payload) => {
						clearTimeout(timer);
						resolve(payload);
					});
				});
				const completed = new Promise<unknown>((resolve, reject) => {
					const timer = setTimeout(
						() => reject(new Error("PG live completion missing")),
						5000,
					);
					socket.once("game.completed", (payload) => {
						clearTimeout(timer);
						resolve(payload);
					});
				});
				const delivered = Promise.all([revealed, completed]);
				void delivered.catch(() => {});
				// Observe real independent row-lock waits before releasing both HTTP contenders.
				const results = await overlap(created.game.id, [
					() =>
						post(`/v1/rounds/${roundId}/answers`, teams[1].captainToken, {
							value: "Earth",
						}),
					() => post(`/v1/games/${created.game.id}/end`, created.hostToken),
				]);
				const [answerResult, endResult] = results;
				assert(
					answerResult.status === "fulfilled" &&
						endResult.status === "fulfilled",
				);
				assert([200, 409].includes(answerResult.value.statusCode));
				assert.equal(endResult.value.statusCode, 200);
				const [revealPayload, completionPayload] = await delivered;
				const reveal = RoundRevealedSchema.parse(revealPayload);
				const completion = GameCompletedSchema.parse(completionPayload);
				assert.equal(reveal.roundId, roundId);
				assert.deepEqual(
					reveal.leaderboard.map((team) => team.score),
					[1, 0],
				);
				assert.equal(completion.game.status, "COMPLETE");
				assert.equal(
					(
						await control.query<{ status: string }>(
							"SELECT status FROM games WHERE id=$1",
							[created.game.id],
						)
					).rows[0].status,
					"COMPLETE",
				);
				assert.equal(
					(await post(`/v1/games/${created.game.id}/end`, created.hostToken))
						.statusCode,
					200,
				);
				const recovered = LiveSnapshotAckSchema.parse(
					await socket
						.timeout(2000)
						.emitWithAck("game.snapshot", { gameId: created.game.id }),
				);
				assert(recovered.ok);
				assert.equal(recovered.snapshot.game.status, "COMPLETE");
				const answeredFirst = answerResult.value.statusCode === 200;
				assert.deepEqual(
					events,
					answeredFirst
						? ["round.revealed", "round.revealed", "game.completed"]
						: ["round.revealed", "game.completed"],
				);
				const rounds = await control.query<{
					id: string;
					sequence: number;
					status: string;
				}>(
					"SELECT id,sequence,status FROM rounds WHERE game_id=$1 ORDER BY sequence",
					[created.game.id],
				);
				assert.deepEqual(
					rounds.rows.map((row) => row.sequence),
					answeredFirst ? [1, 2] : [1],
				);
				assert(rounds.rows.every((row) => row.status === "REVEALED"));
				assert.deepEqual(
					revealedRoundIds,
					rounds.rows.map((row) => row.id),
				);
				console.log(
					"PASS real authenticated WebSocket reveals each committed round once during immediate successor/end contention",
				);
			} finally {
				socket.disconnect();
			}
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
