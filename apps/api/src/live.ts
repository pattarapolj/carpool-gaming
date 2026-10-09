import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Server } from "socket.io";
import {
	AnswerLockedSchema,
	type ClientToServerEvents,
	GameCompletedSchema,
	GameUpdatedSchema,
	type LiveError,
	LiveErrorSchema,
	LiveGameRequestSchema,
	type LiveSnapshotAck,
	RoundRevealedSchema,
	RoundStartedSchema,
	type ServerToClientEvents,
} from "../../../packages/contracts/src/index";
import { type GameDb, resolveSession, type Session } from "./services/auth";
import { GameSnapshotError, getGameSnapshot } from "./services/games-services";
import type { lockAnswer, processDueGame } from "./services/round-service";

type Transition = Awaited<ReturnType<typeof processDueGame>>;
const gameRoom = (gameId: string) => `game:${gameId}`;
const teamRoom = (teamId: string) => `team:${teamId}`;

export function createLiveServer(app: FastifyInstance, db: GameDb) {
	const origin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
	const io = new Server<ClientToServerEvents, ServerToClientEvents>(
		app.server,
		{
			cors: { origin },
			allowRequest: (request, callback) =>
				callback(
					null,
					!closing &&
						(!request.headers.origin || request.headers.origin === origin),
				),
		},
	);
	let closing = false;
	const pending = new Set<Promise<unknown>>();
	function track<T>(run: () => Promise<T>): Promise<T> {
		const work = run();
		pending.add(work);
		void work.then(
			() => pending.delete(work),
			() => pending.delete(work),
		);
		return work;
	}
	function safeError(code: LiveError["code"]) {
		const messages = {
			UNAUTHENTICATED: "A valid token is required",
			FORBIDDEN: "Game access required",
			VALIDATION_ERROR: "Invalid game request",
			GAME_NOT_FOUND: "Game not found",
			INTERNAL_ERROR: "An unexpected error occurred",
		};
		return LiveErrorSchema.parse({
			code,
			message: messages[code],
			requestId: randomUUID(),
		});
	}
	io.use((socket, next) => {
		void track(async () => {
			try {
				const token: unknown = socket.handshake.auth.token;
				const session =
					!closing && typeof token === "string" && token.length
						? await resolveSession(token, db)
						: null;
				if (session && !closing) return next();
				const error = Object.assign(new Error("A valid token is required"), {
					data: { error: safeError("UNAUTHENTICATED") },
				});
				next(error);
			} catch (cause) {
				app.log.error(cause, "Socket authentication failed");
				next(
					Object.assign(new Error("An unexpected error occurred"), {
						data: { error: safeError("INTERNAL_ERROR") },
					}),
				);
			}
		});
	});
	io.on("connection", (socket) => {
		const synchronize = (
			input: unknown,
			ack: (result: LiveSnapshotAck) => void,
			subscribe: boolean,
		) => {
			if (typeof ack !== "function") return;
			if (closing)
				return ack({ ok: false, error: safeError("INTERNAL_ERROR") });
			void track(async () => {
				try {
					const request = LiveGameRequestSchema.safeParse(input);
					if (!request.success)
						return ack({ ok: false, error: safeError("VALIDATION_ERROR") });
					const session = await resolveSession(socket.handshake.auth.token, db);
					if (!session)
						return ack({ ok: false, error: safeError("UNAUTHENTICATED") });
					if (session.gameId !== request.data.gameId)
						return ack({ ok: false, error: safeError("FORBIDDEN") });
					if (closing || !socket.connected) return;
					if (subscribe) {
						await socket.join(gameRoom(session.gameId));
						if (session.role === "CAPTAIN" && session.teamId)
							await socket.join(teamRoom(session.teamId));
					} else if (!socket.rooms.has(gameRoom(session.gameId))) {
						return ack({ ok: false, error: safeError("FORBIDDEN") });
					}
					const snapshot = await getGameSnapshot(session.gameId, session, db);
					ack({ ok: true, snapshot });
				} catch (cause) {
					if (cause instanceof GameSnapshotError)
						return ack({ ok: false, error: safeError(cause.code) });
					app.log.error(cause, "Socket snapshot failed");
					ack({ ok: false, error: safeError("INTERNAL_ERROR") });
				}
			});
		};
		socket.on("game.subscribe", (input, ack) => synchronize(input, ack, true));
		socket.on("game.snapshot", (input, ack) => synchronize(input, ack, false));
	});
	function publishTransition(transition: Transition) {
		try {
			const room = io.to(gameRoom(transition.gameId));
			if (transition.reveal) {
				const {
					completion: _completion,
					gameId: _gameId,
					...payload
				} = transition.reveal;
				room.emit("round.revealed", RoundRevealedSchema.parse(payload));
			}
			if (transition.opened)
				room.emit(
					"round.started",
					RoundStartedSchema.parse(transition.opened.round),
				);
			if (transition.completion)
				room.emit(
					"game.completed",
					GameCompletedSchema.parse(transition.completion),
				);
		} catch (cause) {
			app.log.error(cause, "Live publication failed after commit");
		}
	}
	return {
		publishTransition,
		publishAnswer(
			roundId: string,
			session: Session,
			locked: Awaited<ReturnType<typeof lockAnswer>>,
		) {
			try {
				if (session.teamId)
					io.to(teamRoom(session.teamId)).emit(
						"answer.locked",
						AnswerLockedSchema.parse({
							roundId,
							roundEndsAt: locked.answer.roundEndsAt,
						}),
					);
			} catch (cause) {
				app.log.error(cause, "Live publication failed after commit");
			}
			publishTransition({
				gameId: session.gameId,
				opened: null,
				reveal: locked.reveal,
				completion: locked.reveal?.completion ?? null,
			});
		},
		async publishUpdated(session: Session) {
			try {
				const snapshot = await getGameSnapshot(session.gameId, session, db);
				io.to(gameRoom(session.gameId)).emit(
					"game.updated",
					GameUpdatedSchema.parse({
						game: snapshot.game,
						teams: snapshot.teams,
					}),
				);
			} catch (cause) {
				app.log.error(cause, "Live publication failed after commit");
			}
		},
		async close() {
			closing = true;
			io.disconnectSockets(true);
			// Fastify owns HTTP shutdown; io.close() would close that listener a second time.
			io.engine.close();
			await io.of("/").adapter.close();
			await Promise.allSettled([...pending]);
		},
	};
}
export type LivePublisher = Pick<
	ReturnType<typeof createLiveServer>,
	"publishTransition" | "publishUpdated" | "publishAnswer"
>;
