import {
	type CreatedGame,
	type CreateGameInput,
	CreateGameResponseSchema,
	CreateGameSchema,
	type GameSnapshot,
	GameSnapshotSchema,
	type JoinedGame,
	type JoinGameInput,
	JoinGameResponseSchema,
	JoinGameSchema,
	type StartedGame,
	StartGameResponseSchema,
	StartGameSchema,
} from "@carpool/contracts";
import type { GameSession } from "./session";

export async function createGame(input: CreateGameInput): Promise<CreatedGame> {
	const parsed = CreateGameSchema.safeParse(input);
	if (!parsed.success)
		throw new Error("Enter a game name and choose a round interval.");
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
		response = await fetch(path, { ...init, headers });
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
		const message =
			typeof value === "object" && value !== null && "error" in value
				? (value.error as { message?: unknown }).message
				: undefined;
		throw new Error(
			typeof message === "string"
				? message
				: "The game service could not complete that request.",
		);
	}

	try {
		return schema.parse(value);
	} catch {
		throw new Error("The game service returned an invalid response.");
	}
}
