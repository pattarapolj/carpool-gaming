import { randomUUID } from "node:crypto";
import type {
	GameSnapshot,
	LeftGame,
	RoundResult,
	SubmitAnswerInput,
	SubmittedAnswer,
} from "../../../../packages/contracts/src/index";
import type { GameDb, QueryDb, Session } from "./auth";

type Rows<T> = { rows: T[] };
type Clock = () => Date;
type Round = {
	id: string;
	game_id: string;
	status: string;
	ends_at: Date;
	expected_team_count: number;
	type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "ESTIMATE";
	choices: string[] | null;
	expected_team_ids: string[] | null;
};

export class RoundError extends Error {
	constructor(
		readonly statusCode: number,
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

function captain(session: Session, gameId: string) {
	if (session.role !== "CAPTAIN")
		throw new RoundError(403, "CAPTAIN_REQUIRED", "Captain access required");
	if (session.gameId !== gameId || !session.teamId)
		throw new RoundError(403, "FORBIDDEN", "Game access required");
}

async function lockRound(roundId: string, db: QueryDb) {
	// Acquire the game lock before any round/team lock, including deadline processing.
	const games = (await db.query(
		"SELECT g.id FROM games g JOIN rounds r ON r.game_id=g.id WHERE r.id::text=$1 FOR UPDATE OF g",
		[roundId],
	)) as Rows<{ id: string }>;
	if (!games.rows[0])
		throw new RoundError(404, "ROUND_NOT_FOUND", "Round not found");
	const rounds = (await db.query(
		"SELECT r.*, q.type, q.choices FROM rounds r JOIN questions q ON q.id=r.question_id WHERE r.id=$1 FOR UPDATE OF r",
		[roundId],
	)) as Rows<Round>;
	return rounds.rows[0];
}

export async function lockAnswer(
	roundId: string,
	input: SubmitAnswerInput,
	session: Session,
	db: GameDb,
	clock: Clock = () => new Date(),
) {
	return db.transaction(async (tx) => {
		const round = await lockRound(roundId, tx);
		captain(session, round.game_id);
		const teams = (await tx.query(
			"SELECT status FROM car_teams WHERE id=$1 AND game_id=$2 FOR UPDATE",
			[session.teamId, round.game_id],
		)) as Rows<{ status: string }>;
		if (!teams.rows[0])
			throw new RoundError(403, "FORBIDDEN", "Game access required");
		if (teams.rows[0].status === "LEFT")
			throw new RoundError(409, "TEAM_LEFT", "Team has left");
		const existing = (await tx.query(
			"SELECT id FROM answers WHERE round_id=$1 AND car_team_id=$2",
			[roundId, session.teamId],
		)) as Rows<{ id: string }>;
		if (existing.rows.length)
			throw new RoundError(
				409,
				"ANSWER_ALREADY_LOCKED",
				"Answer already locked",
			);
		if (round.status !== "OPEN")
			throw new RoundError(409, "ROUND_NOT_OPEN", "Round is not open");
		const now = clock();
		if (now >= new Date(round.ends_at))
			throw new RoundError(422, "ROUND_EXPIRED", "Round has expired");
		const { value } = input;
		const valid =
			round.type === "MULTIPLE_CHOICE"
				? typeof value === "string" && round.choices?.includes(value)
				: round.type === "TRUE_FALSE"
					? typeof value === "boolean"
					: typeof value === "number" && Number.isFinite(value);
		if (!valid)
			throw new RoundError(422, "INVALID_ANSWER_VALUE", "Invalid answer value");
		const answerId = randomUUID();
		await tx.query(
			"INSERT INTO answers (id,game_id,round_id,car_team_id,value,submitted_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6)",
			[
				answerId,
				round.game_id,
				roundId,
				session.teamId,
				JSON.stringify(value),
				now,
			],
		);
		const answer: SubmittedAnswer = {
			answerId,
			status: "locked",
			roundEndsAt: new Date(round.ends_at).toISOString(),
		};
		return { answer, reveal: await revealLockedRound(round, tx, clock) };
	});
}

export async function openDueRound(
	gameId: string,
	db: GameDb,
	clock: Clock = () => new Date(),
) {
	return db.transaction((tx) => openDueRoundInTransaction(gameId, tx, clock));
}

// Start and scheduled delivery share the same game-first transition.
export async function openDueRoundInTransaction(
	gameId: string,
	tx: QueryDb,
	clock: Clock = () => new Date(),
) {
	const games = (await tx.query(
		"SELECT status,started_at,next_round_at,round_interval_seconds,question_window_seconds FROM games WHERE id::text=$1 FOR UPDATE",
		[gameId],
	)) as Rows<{
		status: string;
		started_at: Date;
		next_round_at: Date;
		round_interval_seconds: number;
		question_window_seconds: number;
	}>;
	const game = games.rows[0];
	if (game?.status !== "WAITING" || !game.started_at || !game.next_round_at)
		return null;
	const previous = (await tx.query(
		"SELECT sequence,status FROM rounds WHERE game_id=$1 ORDER BY sequence DESC LIMIT 1",
		[gameId],
	)) as Rows<{ sequence: number; status: string }>;
	if (previous.rows[0]?.status === "OPEN") return null;
	const teams = (await tx.query(
		"SELECT id FROM car_teams WHERE game_id=$1 AND status='ACTIVE' ORDER BY id FOR UPDATE",
		[gameId],
	)) as Rows<{ id: string }>;
	if (!teams.rows.length) return null;
	const questions = (await tx.query(
		"SELECT id,type,prompt,choices FROM questions q WHERE is_active AND NOT EXISTS (SELECT 1 FROM rounds r WHERE r.game_id=$1 AND r.question_id=q.id) ORDER BY id LIMIT 1",
		[gameId],
	)) as Rows<{
		id: string;
		type: Round["type"];
		prompt: string;
		choices: string[] | null;
	}>;
	const question = questions.rows[0];
	if (!question) return null;
	const now = clock();
	if (now < new Date(game.next_round_at)) return null;
	const interval = game.round_interval_seconds * 1000;
	const anchor = new Date(game.started_at).getTime();
	// Sequence counts delivered rounds; missed schedule slots are skipped.
	const nextRoundAt = new Date(
		anchor + (Math.floor((now.getTime() - anchor) / interval) + 1) * interval,
	);
	const endsAt = new Date(now.getTime() + game.question_window_seconds * 1000);
	const id = randomUUID();
	const sequence = (previous.rows[0]?.sequence ?? 0) + 1;
	await tx.query(
		"INSERT INTO rounds (id,game_id,question_id,sequence,starts_at,ends_at,expected_team_count,expected_team_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
		[
			id,
			gameId,
			question.id,
			sequence,
			now,
			endsAt,
			teams.rows.length,
			teams.rows.map((team) => team.id),
		],
	);
	await tx.query("UPDATE games SET next_round_at=$2 WHERE id=$1", [
		gameId,
		nextRoundAt,
	]);
	return {
		gameId,
		round: {
			id,
			sequence,
			status: "OPEN" as const,
			startsAt: now.toISOString(),
			endsAt: endsAt.toISOString(),
			question,
		},
		nextRoundAt: nextRoundAt.toISOString(),
	};
}

export async function revealDueRound(
	roundId: string,
	db: GameDb,
	clock: Clock = () => new Date(),
) {
	return db.transaction(async (tx) =>
		revealLockedRound(await lockRound(roundId, tx), tx, clock),
	);
}

async function revealLockedRound(round: Round, tx: QueryDb, clock: Clock) {
	if (round.status !== "OPEN") return null;
	const answers = (await tx.query(
		"SELECT count(*) AS count FROM answers WHERE round_id=$1",
		[round.id],
	)) as Rows<{ count: string }>;
	const now = clock();
	if (
		Number(answers.rows[0].count) < round.expected_team_count &&
		now < new Date(round.ends_at)
	)
		return null;
	// Numeric arithmetic in PostgreSQL avoids overflow when finite JSON estimates
	// on opposite ends of the JavaScript number range are compared.
	await tx.query(
		`WITH distances AS (
		SELECT a.id, a.value=q.correct_answer AS matches,
		 CASE WHEN q.type='ESTIMATE' THEN abs((a.value #>> '{}')::numeric - (q.correct_answer #>> '{}')::numeric) END AS distance
		FROM answers a JOIN rounds r ON r.id=a.round_id JOIN questions q ON q.id=r.question_id WHERE a.round_id=$1
	), grades AS (
		SELECT id, CASE WHEN distance IS NULL THEN matches ELSE distance=min(distance) OVER () END AS correct FROM distances
	), scored AS (
		UPDATE answers a SET is_correct=g.correct,points_awarded=CASE WHEN g.correct THEN 1 ELSE 0 END
		FROM grades g WHERE a.id=g.id RETURNING a.car_team_id,a.points_awarded
	)
	UPDATE car_teams t SET score=t.score+s.points_awarded FROM scored s WHERE t.id=s.car_team_id`,
		[round.id],
	);
	await tx.query(
		"UPDATE rounds SET status='REVEALED',revealed_at=$2 WHERE id=$1",
		[round.id, now],
	);
	const detail = (await tx.query(
		'SELECT q.correct_answer AS "correctAnswer",q.explanation,g.next_round_at AS "nextRoundAt" FROM rounds r JOIN questions q ON q.id=r.question_id JOIN games g ON g.id=r.game_id WHERE r.id=$1',
		[round.id],
	)) as Rows<{
		correctAnswer: string | boolean | number;
		explanation: string;
		nextRoundAt: Date;
	}>;
	const results = await getRoundResults(
		round.id,
		round.game_id,
		round.expected_team_ids,
		tx,
	);
	const leaderboard = await getLeaderboard(round.game_id, tx);
	return {
		gameId: round.game_id,
		roundId: round.id,
		revealedAt: now.toISOString(),
		correctAnswer: detail.rows[0].correctAnswer,
		explanation: detail.rows[0].explanation,
		results,
		leaderboard,
		nextRoundAt: new Date(detail.rows[0].nextRoundAt).toISOString(),
	};
}

export async function getRoundResults(
	roundId: string,
	gameId: string,
	teamIds: string[] | null,
	tx: QueryDb,
) {
	if (teamIds === null) return null;
	const results = (await tx.query(
		`SELECT t.id AS "teamId",t.name,a.value,COALESCE(a.is_correct,false) AS "isCorrect",COALESCE(a.points_awarded,0) AS "pointsAwarded"
		FROM car_teams t LEFT JOIN answers a ON a.car_team_id=t.id AND a.round_id=$1
		WHERE t.game_id=$2 AND t.id=ANY($3::uuid[]) ORDER BY t.name,t.id`,
		[roundId, gameId, teamIds],
	)) as Rows<RoundResult>;
	return results.rows;
}

export async function getLeaderboard(gameId: string, tx: QueryDb) {
	const teams = (await tx.query(
		"SELECT id,name,status,score,(rank() OVER (ORDER BY score DESC))::integer AS rank FROM car_teams WHERE game_id=$1 ORDER BY score DESC,name,id",
		[gameId],
	)) as Rows<GameSnapshot["leaderboard"][number]>;
	return teams.rows;
}

export async function leaveGame(
	gameId: string,
	session: Session,
	db: GameDb,
): Promise<LeftGame> {
	return db.transaction(async (tx) => {
		const games = (await tx.query(
			"SELECT id,status FROM games WHERE id::text=$1 FOR UPDATE",
			[gameId],
		)) as Rows<{ id: string; status: string }>;
		if (!games.rows[0])
			throw new RoundError(404, "GAME_NOT_FOUND", "Game not found");
		captain(session, gameId);
		if (games.rows[0].status === "COMPLETE")
			throw new RoundError(409, "GAME_COMPLETE", "Game is complete");
		const teams = (await tx.query(
			"UPDATE car_teams SET status='LEFT' WHERE id=$1 AND game_id=$2 RETURNING id,status",
			[session.teamId, gameId],
		)) as Rows<LeftGame["team"]>;
		if (!teams.rows[0])
			throw new RoundError(403, "FORBIDDEN", "Game access required");
		return { team: teams.rows[0] };
	});
}
