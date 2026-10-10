import {
	type CreatedGame,
	type CreateGameInput,
	CreateGameResponseSchema,
	CreateGameSchema,
	EndGameResponseSchema,
	type GameSnapshot,
	GameSnapshotSchema,
	type JoinedGame,
	type JoinGameInput,
	JoinGameResponseSchema,
	JoinGameSchema,
	LeaveGameResponseSchema,
	type PuzzleAction,
	PuzzleActionResponseSchema,
	PuzzleActionSchema,
	SongClipRequestSchema,
	SongClipResponseSchema,
	type StartedGame,
	StartGameResponseSchema,
	StartGameSchema,
	type SubmitAnswerInput,
	SubmitAnswerResponseSchema,
	SubmitAnswerSchema,
} from "@carpool/contracts";
import type { GameSession } from "./session";

export async function createGame(input: CreateGameInput): Promise<CreatedGame> {
	const parsed = CreateGameSchema.safeParse(input);
	if (!parsed.success)
		throw new Error(
			"Enter a game name, choose a topic, and set a round interval.",
		);
	return request("/v1/games", CreateGameResponseSchema, {
		method: "POST",
		body: JSON.stringify(parsed.data),
	});
}

export async function joinGame(
	joinCode: string,
	name: JoinGameInput["name"],
): Promise<JoinedGame> {
	const parsed = JoinGameSchema.safeParse({ name });
	if (!parsed.success) throw new Error("Enter a name for your car.");
	return request(
		`/v1/games/${encodeURIComponent(joinCode.trim().toUpperCase())}/teams`,
		JoinGameResponseSchema,
		{ method: "POST", body: JSON.stringify(parsed.data) },
	);
}

export async function getGameSnapshot(
	session: GameSession,
): Promise<GameSnapshot> {
	return request(
		`/v1/games/${encodeURIComponent(session.gameId)}/snapshot`,
		GameSnapshotSchema,
		{ headers: { authorization: `Bearer ${session.token}` } },
	);
}

export async function startGame(
	session: GameSession,
	practice: boolean,
): Promise<StartedGame> {
	const body = StartGameSchema.parse({ practice });
	return request(
		`/v1/games/${encodeURIComponent(session.gameId)}/start`,
		StartGameResponseSchema,
		{
			method: "POST",
			headers: { authorization: `Bearer ${session.token}` },
			body: JSON.stringify(body),
		},
	);
}

async function request<T>(
	path: string,
	schema: { parse: (value: unknown) => T },
	init: RequestInit = {},
): Promise<T> {
	const headers = new Headers(init.headers);
	if (init.body) headers.set("content-type", "application/json");
	let response: Response;
	try {
		response = await fetch(path, {
			...init,
			headers,
			signal: init.signal ?? AbortSignal.timeout(10000),
		});
	} catch {
		throw new Error(
			"Can't reach the game service. Check your connection and try again.",
		);
	}
	let value: unknown;
	try {
		value = await response.json();
	} catch {
		throw new Error("The game service returned an invalid response.");
	}
	if (!response.ok) {
		const error =
			typeof value === "object" && value !== null && "error" in value
				? (value.error as { message?: unknown; code?: unknown })
				: undefined;
		throw new ApiError(
			typeof error?.message === "string"
				? error.message
				: "The game service could not complete that request.",
			response.status,
			typeof error?.code === "string" ? error.code : null,
		);
	}

	try {
		return schema.parse(value);
	} catch {
		throw new Error("The game service returned an invalid response.");
	}
}

export class ApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly code: string | null,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export async function submitAnswer(
	session: GameSession,
	roundId: string,
	value: SubmitAnswerInput["value"],
) {
	const body = SubmitAnswerSchema.parse({ value });
	return request(
		`/v1/rounds/${encodeURIComponent(roundId)}/answers`,
		SubmitAnswerResponseSchema,
		{
			method: "POST",
			headers: { authorization: `Bearer ${session.token}` },
			body: JSON.stringify(body),
		},
	);
}

export async function leaveGame(session: GameSession) {
	return request(
		`/v1/games/${encodeURIComponent(session.gameId)}/leave`,
		LeaveGameResponseSchema,
		{
			method: "POST",
			headers: { authorization: `Bearer ${session.token}` },
			body: "{}",
		},
	);
}

export async function endGame(session: GameSession) {
	return request(
		`/v1/games/${encodeURIComponent(session.gameId)}/end`,
		EndGameResponseSchema,
		{
			method: "POST",
			headers: { authorization: `Bearer ${session.token}` },
			body: "{}",
		},
	);
}

export async function sendPuzzleAction(
	session: GameSession,
	action: PuzzleAction,
) {
	return request(
		`/v1/games/${encodeURIComponent(session.gameId)}/puzzles/actions`,
		PuzzleActionResponseSchema,
		{
			method: "POST",
			headers: { authorization: `Bearer ${session.token}` },
			body: JSON.stringify(PuzzleActionSchema.parse(action)),
		},
	);
}

export async function getSongClip(session: GameSession, puzzleId: string) {
	const body = SongClipRequestSchema.parse({ puzzleId });
	const { media } = await request(
		`/v1/games/${encodeURIComponent(session.gameId)}/puzzles/clip`,
		SongClipResponseSchema,
		{
			method: "POST",
			headers: { authorization: `Bearer ${session.token}` },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15000),
		},
	);
	return media;
}
