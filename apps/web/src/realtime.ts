import type {
	ClientToServerEvents,
	ServerToClientEvents,
} from "@carpool/contracts";
import { io, type Socket } from "socket.io-client";
import type { GameSession } from "./session";

export function createGameSocket(
	session: GameSession,
): Socket<ServerToClientEvents, ClientToServerEvents> {
	return io({ autoConnect: false, auth: { token: session.token } });
}
