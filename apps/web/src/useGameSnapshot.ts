import { type GameSnapshot, LiveSnapshotAckSchema } from "@carpool/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { createGameSocket } from "./realtime";
import type { GameSession } from "./session";

export function useGameSnapshot(session: GameSession | null) {
	const [view, setView] = useState<{
		key: string;
		snapshot: GameSnapshot;
		receivedAt: number;
	} | null>(null);
	const [syncError, setSyncError] = useState<string | null>(null);
	const requestRefresh = useRef<() => void>(() => {});
	const gameId = session?.gameId;
	const token = session?.token;
	const role = session?.role;
	const key = JSON.stringify([gameId, token, role]);
	const refresh = useCallback(() => requestRefresh.current(), []);

	useEffect(() => {
		if (!gameId || !token || !role) return;
		const socket = createGameSocket({ gameId, token, role });
		let active = true;
		let epoch = 0;
		let reading = false;
		let dirty = true;
		let subscribed = false;
		setSyncError("Connecting to the game…");

		async function synchronize() {
			if (!active || !socket.connected || reading) return;
			reading = true;
			dirty = false;
			const requestEpoch = epoch;
			const event = subscribed ? "game.snapshot" : "game.subscribe";
			let succeeded = false;
			try {
				const response = await new Promise<unknown>((resolve, reject) => {
					socket
						.timeout(5000)
						.emit(
							event,
							{ gameId: gameId as string },
							(error: Error | null, ack: unknown) => {
								if (error) reject(error);
								else resolve(ack);
							},
						);
				});
				if (!active || requestEpoch !== epoch) return;
				const parsed = LiveSnapshotAckSchema.safeParse(response);
				if (!parsed.success)
					throw new Error("The game service returned an invalid state.");
				const ack = parsed.data;
				if (!ack.ok) throw new Error(ack.error.message);
				if (ack.snapshot.game.id !== gameId)
					throw new Error("The game service returned a different game.");
				subscribed = true;
				succeeded = true;
				setView({ key, snapshot: ack.snapshot, receivedAt: performance.now() });
				setSyncError(null);
			} catch (cause) {
				if (!active || requestEpoch !== epoch) return;
				dirty = true;
				setSyncError(
					cause instanceof Error && cause.message !== "timeout"
						? `${cause.message} Retry to recover the latest state.`
						: "Can't reach the game right now. Retrying…",
				);
			} finally {
				if (active && requestEpoch === epoch) {
					reading = false;
					if (succeeded && dirty) void synchronize();
				}
			}
		}
		function invalidate() {
			dirty = true;
			void synchronize();
		}
		socket.on("connect", () => {
			if (!active) return;
			epoch++;
			reading = false;
			subscribed = false;
			invalidate();
		});
		socket.on("disconnect", () => {
			if (!active) return;
			epoch++;
			reading = false;
			subscribed = false;
			setSyncError("Connection lost. Reconnecting to your game…");
		});
		socket.on("connect_error", () => {
			if (active)
				setSyncError(
					"Can't connect to the game. Check your connection and retry.",
				);
		});
		socket.on("game.updated", invalidate);
		socket.on("round.started", invalidate);
		socket.on("answer.locked", invalidate);
		socket.on("round.revealed", invalidate);
		socket.on("game.completed", invalidate);
		requestRefresh.current = () => {
			if (!socket.connected) socket.connect();
			else invalidate();
		};
		const timer = window.setInterval(invalidate, 15000);
		socket.connect();
		return () => {
			active = false;
			epoch++;
			requestRefresh.current = () => {};
			window.clearInterval(timer);
			socket.removeAllListeners();
			socket.disconnect();
		};
	}, [gameId, token, role, key]);
	return {
		snapshot: view?.key === key ? view.snapshot : null,
		receivedAt: view?.key === key ? view.receivedAt : 0,
		syncError,
		refresh,
	};
}
