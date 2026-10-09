import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	LeaveGameResponseSchema,
	SubmitAnswerResponseSchema,
} from "../../../../packages/contracts/src/index";
import { buildServer } from "../../src/server";
import { type GameDb, hashToken } from "../../src/services/auth";

let db: PGlite;
let app: ReturnType<typeof buildServer>;
let storage: GameDb;
const gameId = randomUUID();
const teamId = randomUUID();
const roundId = randomUUID();

beforeAll(async () => {
	db = new PGlite();
	for (const file of [
		"001_games.sql",
		"002_car_teams.sql",
		"003_round_storage.sql",
		"006_question_topics.sql",
	]) {
		await db.exec(
			await readFile(
				new URL(`../../migrations/${file}`, import.meta.url),
				"utf8",
			),
		);
	}
	await db.exec(
		await readFile(
			new URL("../../seeds/questions.sql", import.meta.url),
			"utf8",
		),
	);
	storage = {
		query: (sql, values) => db.query(sql, values),
		end: () => db.close(),
		transaction: (run) => db.transaction((tx) => run(tx)),
	};
	app = buildServer(storage);
	await db.query(
		"INSERT INTO games (id,name,join_code,host_token_hash,status,round_interval_seconds) VALUES ($1,'Trip','ABCDEF',$2,'WAITING',300)",
		[gameId, hashToken("host")],
	);
	await db.query(
		"INSERT INTO car_teams (id,game_id,name,captain_token_hash) VALUES ($1,$2,'Blue',$3)",
		[teamId, gameId, hashToken("captain")],
	);
	await db.query(
		"INSERT INTO rounds (id,game_id,question_id,sequence,starts_at,ends_at,expected_team_count) VALUES ($1,$2,'10000000-0000-4000-8000-000000000001',1,now(),now()+interval '1 hour',2)",
		[roundId, gameId],
	);
	await db.exec(
		await readFile(
			new URL("../../migrations/004_round_participants.sql", import.meta.url),
			"utf8",
		),
	);
});

afterAll(async () => {
	await app.close();
});

it("locks the token's team answer and rejects an immutable duplicate", async () => {
	const response = await app.inject({
		method: "POST",
		url: `/v1/rounds/${roundId}/answers`,
		headers: { authorization: "Bearer captain" },
		payload: { value: "Jupiter", teamId: randomUUID() },
	});
	expect(response.statusCode).toBe(200);
	expect(SubmitAnswerResponseSchema.safeParse(response.json()).success).toBe(
		true,
	);
	expect(response.json()).toMatchObject({
		status: "locked",
		answerId: expect.any(String),
		roundEndsAt: expect.any(String),
	});
	const second = await app.inject({
		method: "POST",
		url: `/v1/rounds/${roundId}/answers`,
		headers: { authorization: "Bearer captain" },
		payload: { value: "Earth" },
	});
	expect(second.statusCode).toBe(409);
	expect(second.json().error.code).toBe("ANSWER_ALREADY_LOCKED");
	const stored = await db.query(
		"SELECT car_team_id,value FROM answers WHERE round_id=$1",
		[roundId],
	);
	expect(stored.rows).toEqual([{ car_team_id: teamId, value: "Jupiter" }]);
});

it("preserves existing rounds with an explicitly unknown historical roster", async () => {
	const result = await db.query(
		"SELECT expected_team_count,expected_team_ids FROM rounds WHERE id=$1",
		[roundId],
	);
	expect(result.rows).toEqual([
		{ expected_team_count: 2, expected_team_ids: null },
	]);
});

async function fixture(type = "MULTIPLE_CHOICE") {
	const id = randomUUID();
	const team = randomUUID();
	const round = randomUUID();
	await db.query(
		"INSERT INTO games (id,name,join_code,host_token_hash,status,round_interval_seconds) VALUES ($1,'Case',$2,$3,'WAITING',300)",
		[id, id.slice(0, 6), hashToken(`host-${id}`)],
	);
	await db.query(
		"INSERT INTO car_teams (id,game_id,name,captain_token_hash) VALUES ($1,$2,'Car',$3)",
		[team, id, hashToken(team)],
	);
	await db.query(
		"INSERT INTO rounds (id,game_id,question_id,sequence,starts_at,ends_at,expected_team_count) SELECT $1,$2,id,1,now(),now()+interval '1 hour',2 FROM questions WHERE type=$3 ORDER BY id LIMIT 1",
		[round, id, type],
	);
	return { id, team, round, headers: { authorization: `Bearer ${team}` } };
}

it.each([
	["MULTIPLE_CHOICE", "Mars"],
	["MULTIPLE_CHOICE", true],
	["TRUE_FALSE", "true"],
	["TRUE_FALSE", 1],
	["ESTIMATE", "165"],
	["ESTIMATE", false],
	["ESTIMATE", null],
	["ESTIMATE", []],
])(
	"rejects an invalid %s value %j without persisting it",
	async (type, value) => {
		const f = await fixture(type);
		const response = await app.inject({
			method: "POST",
			url: `/v1/rounds/${f.round}/answers`,
			headers: f.headers,
			payload: { value },
		});
		expect(response.statusCode).toBe(422);
		expect(response.json().error.code).toBe("INVALID_ANSWER_VALUE");
		expect(
			(await db.query("SELECT id FROM answers WHERE round_id=$1", [f.round]))
				.rows,
		).toHaveLength(0);
	},
);

it.each([
	["TRUE_FALSE", false],
	["ESTIMATE", 164.5],
])("accepts a valid %s answer", async (type, value) => {
	const f = await fixture(type as string);
	const response = await app.inject({
		method: "POST",
		url: `/v1/rounds/${f.round}/answers`,
		headers: f.headers,
		payload: { value },
	});
	expect(response.statusCode).toBe(200);
});

it("enforces answer authentication, role, game, state and malformed IDs", async () => {
	const f = await fixture();
	for (const [token, id, status, code] of [
		["", f.round, 401, "UNAUTHENTICATED"],
		["invalid", f.round, 401, "UNAUTHENTICATED"],
		[`host-${f.id}`, f.round, 403, "CAPTAIN_REQUIRED"],
		["captain", f.round, 403, "FORBIDDEN"],
		[f.team, randomUUID(), 404, "ROUND_NOT_FOUND"],
		[f.team, "bad", 404, "ROUND_NOT_FOUND"],
	] as const) {
		const response = await app.inject({
			method: "POST",
			url: `/v1/rounds/${id}/answers`,
			headers: { authorization: `Bearer ${token}` },
			payload: { value: "Jupiter" },
		});
		expect(response.statusCode).toBe(status);
		expect(response.json().error.code).toBe(code);
	}
	await db.query(
		"UPDATE rounds SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE id=$1",
		[f.round],
	);
	const expired = await app.inject({
		method: "POST",
		url: `/v1/rounds/${f.round}/answers`,
		headers: f.headers,
		payload: { value: "Jupiter", now: "2000-01-01" },
	});
	expect(expired.statusCode).toBe(422);
	expect(expired.json().error.code).toBe("ROUND_EXPIRED");
	await db.query(
		"UPDATE rounds SET status='REVEALED',revealed_at=now() WHERE id=$1",
		[f.round],
	);
	const revealed = await app.inject({
		method: "POST",
		url: `/v1/rounds/${f.round}/answers`,
		headers: f.headers,
		payload: { value: "Jupiter" },
	});
	expect(revealed.statusCode).toBe(409);
	expect(revealed.json().error.code).toBe("ROUND_NOT_OPEN");
});

it("leaves only the authenticated team, immediately rejects its answer, and repeats safely", async () => {
	const f = await fixture();
	for (let i = 0; i < 2; i++) {
		const leave = await app.inject({
			method: "POST",
			url: `/v1/games/${f.id}/leave`,
			headers: f.headers,
			payload: { teamId },
		});
		expect(leave.statusCode).toBe(200);
		expect(LeaveGameResponseSchema.safeParse(leave.json()).success).toBe(true);
		expect(leave.json()).toEqual({ team: { id: f.team, status: "LEFT" } });
	}
	const answer = await app.inject({
		method: "POST",
		url: `/v1/rounds/${f.round}/answers`,
		headers: f.headers,
		payload: { value: "Jupiter" },
	});
	expect(answer.statusCode).toBe(409);
	expect(answer.json().error.code).toBe("TEAM_LEFT");
	expect(
		(await db.query("SELECT status FROM car_teams WHERE id=$1", [teamId])).rows,
	).toEqual([{ status: "ACTIVE" }]);
});

it("enforces leave role, game, authentication, unknown IDs and completed-game rules", async () => {
	const f = await fixture();
	for (const [token, id, status, code] of [
		["", f.id, 401, "UNAUTHENTICATED"],
		[`host-${f.id}`, f.id, 403, "CAPTAIN_REQUIRED"],
		["captain", f.id, 403, "FORBIDDEN"],
		[f.team, randomUUID(), 404, "GAME_NOT_FOUND"],
		[f.team, "bad", 404, "GAME_NOT_FOUND"],
	] as const) {
		const response = await app.inject({
			method: "POST",
			url: `/v1/games/${id}/leave`,
			headers: { authorization: `Bearer ${token}` },
			payload: {},
		});
		expect(response.statusCode).toBe(status);
		expect(response.json().error.code).toBe(code);
	}
	await db.query("UPDATE games SET status='COMPLETE' WHERE id=$1", [f.id]);
	const response = await app.inject({
		method: "POST",
		url: `/v1/games/${f.id}/leave`,
		headers: f.headers,
		payload: {},
	});
	expect(response.statusCode).toBe(409);
	expect(response.json().error.code).toBe("GAME_COMPLETE");
});

it("uses the safe inherited error envelope for malformed JSON and unexpected failures", async () => {
	for (const url of [
		`/v1/rounds/${roundId}/answers`,
		`/v1/games/${gameId}/leave`,
	]) {
		const malformed = await app.inject({
			method: "POST",
			url,
			headers: {
				"content-type": "application/json",
				authorization: "Bearer captain",
			},
			payload: '{"value":',
		});
		expect(malformed.statusCode).toBe(400);
		expect(malformed.json()).toMatchObject({
			error: { code: "MALFORMED_JSON", requestId: expect.any(String) },
		});
	}
	const broken = buildServer({
		...storage,
		end: async () => {},
		query: async () => {
			throw new Error("SQL secret token answer Jupiter");
		},
	});
	try {
		for (const url of [
			`/v1/rounds/${roundId}/answers`,
			`/v1/games/${gameId}/leave`,
		]) {
			const response = await broken.inject({
				method: "POST",
				url,
				headers: { authorization: "Bearer captain" },
				payload: { value: "Earth" },
			});
			expect(response.statusCode).toBe(500);
			expect(response.json()).toMatchObject({
				error: { code: "INTERNAL_ERROR", requestId: expect.any(String) },
			});
			expect(response.body).not.toMatch(/SQL|secret|Jupiter|stack|token/);
		}
	} finally {
		await broken.close();
	}
});

it("rejects non-object leave bodies but accepts an omitted body", async () => {
	const f = await fixture();
	for (const payload of ["null", "[]", "true", '"leave"']) {
		const response = await app.inject({
			method: "POST",
			url: `/v1/games/${f.id}/leave`,
			headers: { ...f.headers, "content-type": "application/json" },
			payload,
		});
		expect(response.statusCode).toBe(422);
		expect(response.json().error.code).toBe("VALIDATION_ERROR");
	}
	expect(
		(await db.query("SELECT status FROM car_teams WHERE id=$1", [f.team])).rows,
	).toEqual([{ status: "ACTIVE" }]);
	const response = await app.inject({
		method: "POST",
		url: `/v1/games/${f.id}/leave`,
		headers: f.headers,
	});
	expect(response.statusCode).toBe(200);
});
