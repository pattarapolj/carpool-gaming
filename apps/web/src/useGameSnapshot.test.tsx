// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameSnapshot, session } from "./test/game-fixtures";
import { useGameSnapshot } from "./useGameSnapshot";

const { createSocket } = vi.hoisted(() => ({ createSocket: vi.fn() }));
vi.mock("./realtime", () => ({ createGameSocket: createSocket }));
type Ack = (error: Error | null, response?: unknown) => void;
class TestSocket {
	connected = false;
	listeners = new Map<string, () => void>();
	requests: { event: string; ack: Ack }[] = [];
	on(event: string, callback: () => void) {
		this.listeners.set(event, callback);
		return this;
	}
	timeout = vi.fn(() => this);
	emit(event: string, _request: unknown, ack: Ack) {
		this.requests.push({ event, ack });
		return this;
	}
	connect() {
		expect(this.listeners.has("round.started")).toBe(true);
		this.fire("connect");
		return this;
	}
	disconnect() {
		this.connected = false;
		return this;
	}
	removeAllListeners() {
		this.listeners.clear();
		return this;
	}
	fire(event: string) {
		if (event === "connect") this.connected = true;
		if (event === "disconnect") this.connected = false;
		this.listeners.get(event)?.();
	}
	answer(index: number, snapshot = gameSnapshot()) {
		this.requests[index].ack(null, { ok: true, snapshot });
	}
}
let socket: TestSocket;
async function respond(index: number, snapshot = gameSnapshot()) {
	await act(async () => socket.answer(index, snapshot));
}
beforeEach(() => {
	socket = new TestSocket();
	createSocket.mockReturnValue(socket);
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("authoritative live recovery", () => {
	it("coalesces events during a snapshot read and recovers dropped publications while connected", async () => {
		vi.useFakeTimers();
		const { result } = renderHook(() => useGameSnapshot(session));
		await respond(0);
		act(() => socket.fire("game.updated"));
		act(() => {
			socket.fire("answer.locked");
			socket.fire("round.revealed");
		});
		expect(socket.requests).toHaveLength(2);
		await respond(1);
		expect(socket.requests).toHaveLength(3);
		const locked = gameSnapshot();
		locked.ownAnswer = {
			answerId: "94ae7f94-042a-446a-b523-b7b45d84e929",
			value: false,
			submittedAt: locked.serverTime,
		};
		await respond(2, locked);
		expect(result.current.snapshot?.ownAnswer?.value).toBe(false);
		await act(async () => vi.advanceTimersByTime(15000));
		const complete = gameSnapshot();
		complete.game.status = "COMPLETE";
		await respond(3, complete);
		expect(result.current.snapshot?.game.status).toBe("COMPLETE");
	});
	it("retries a failed subscription before permitting snapshot reads", async () => {
		vi.useFakeTimers();
		renderHook(() => useGameSnapshot(session));
		await act(async () => socket.requests[0].ack(new Error("timeout")));
		await act(async () => vi.advanceTimersByTime(15000));
		expect(socket.requests[1].event).toBe("game.subscribe");
		await respond(1);
		act(() => socket.fire("game.completed"));
		expect(socket.requests[2].event).toBe("game.snapshot");
	});
	it("subscribes before snapshots and rereads when an event arrives during recovery", async () => {
		const { result } = renderHook(() => useGameSnapshot(session));
		expect(socket.requests[0].event).toBe("game.subscribe");
		act(() => socket.fire("round.revealed"));
		await respond(0);
		expect(socket.requests[1].event).toBe("game.snapshot");
		const revealed = gameSnapshot();
		if (!revealed.round) throw Error("fixture");
		revealed.round = {
			...revealed.round,
			status: "REVEALED",
			revealedAt: revealed.serverTime,
			correctAnswer: false,
			explanation: "A very thin atmosphere.",
			results: [],
		};
		await respond(1, revealed);
		expect(result.current.snapshot?.round?.status).toBe("REVEALED");
		// A delayed same-round start event invalidates, never overwrites the revealed view.
		act(() => socket.fire("round.started"));
		expect(result.current.snapshot?.round?.status).toBe("REVEALED");
		await respond(2, revealed);
		expect(result.current.snapshot?.round?.status).toBe("REVEALED");
	});

	it("ignores old acknowledgement after reconnect and repeats the handshake", async () => {
		const { result } = renderHook(() => useGameSnapshot(session));
		act(() => {
			socket.fire("disconnect");
			socket.fire("connect");
		});
		expect(socket.requests.map((request) => request.event)).toEqual([
			"game.subscribe",
			"game.subscribe",
		]);
		const next = gameSnapshot();
		next.game.name = "Fresh state";
		await respond(1, next);
		await respond(0);
		expect(result.current.snapshot?.game.name).toBe("Fresh state");
	});

	it("ignores a response from the previous browser session", async () => {
		const oldSocket = socket;
		const { result, rerender } = renderHook(
			({ current }) => useGameSnapshot(current),
			{ initialProps: { current: session } },
		);
		socket = new TestSocket();
		createSocket.mockReturnValue(socket);
		rerender({ current: { ...session, token: "different-token" } });
		const next = gameSnapshot();
		next.game.name = "New session";
		await respond(0, next);
		await act(async () => oldSocket.answer(0));
		expect(result.current.snapshot?.game.name).toBe("New session");
		expect(oldSocket.connected).toBe(false);
	});

	it("retains the last good snapshot after lost ack and retries within 15 seconds", async () => {
		vi.useFakeTimers();
		const { result } = renderHook(() => useGameSnapshot(session));
		await respond(0);
		act(() => socket.fire("game.updated"));
		await act(async () => socket.requests[1].ack(new Error("timeout")));
		expect(result.current.snapshot?.game.name).toBe("Coast drive");
		expect(result.current.syncError).toBeTruthy();
		expect(socket.timeout).toHaveBeenCalledWith(5000);
		await act(async () => vi.advanceTimersByTime(15000));
		expect(socket.requests[2].event).toBe("game.snapshot");
		await respond(2);
		expect(result.current.syncError).toBeNull();
	});
});
