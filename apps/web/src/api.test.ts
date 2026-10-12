import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ApiError,
	createGame,
	getSongClip,
	sendPuzzleAction,
	startGame,
	submitAnswer,
} from "./api";
import { session } from "./test/game-fixtures";

describe("lobby API client", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});
	it("allows server preview retries to finish before the clip request times out", async () => {
		vi.useFakeTimers();
		vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
			const controller = new AbortController();
			setTimeout(() => controller.abort(), milliseconds);
			return controller.signal;
		});
		vi.stubGlobal(
			"fetch",
			(_path: string, init: RequestInit) =>
				new Promise<Response>((resolve, reject) => {
					const timer = setTimeout(
						() =>
							resolve(
								Response.json({ media: "data:audio/wav;base64,UklGRg==" }),
							),
						26000,
					);
					init.signal?.addEventListener("abort", () => {
						clearTimeout(timer);
						reject(init.signal?.reason);
					});
				}),
		);
		const result = getSongClip(session, "song-0");
		const settled = result.catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(26000);
		expect(await settled).toBe("data:audio/wav;base64,UklGRg==");
	});
	it.each(["start", "format"])(
		"allows song preparation to finish before %s times out",
		async (operation) => {
			vi.useFakeTimers();
			vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
				const controller = new AbortController();
				setTimeout(() => controller.abort(), milliseconds);
				return controller.signal;
			});
			const game = {
				id: session.gameId,
				status: "COMPLETE",
				startedAt: "2026-10-08T10:00:00.000Z",
				nextRoundAt: null,
			};
			vi.stubGlobal(
				"fetch",
				(_path: string, init: RequestInit) =>
					new Promise<Response>((resolve, reject) => {
						const timer = setTimeout(
							() =>
								resolve(
									Response.json(
										operation === "start" ? { game } : { ok: true },
									),
								),
							26000,
						);
						init.signal?.addEventListener("abort", () => {
							clearTimeout(timer);
							reject(init.signal?.reason);
						});
					}),
			);
			const result =
				operation === "start"
					? startGame(session, false)
					: sendPuzzleAction(session, {
							kind: "format",
							roundId: "a6775a41-50ab-4d61-b1fa-f9f07a28c62b",
							format: "MUSIC",
						});
			const settled = result.catch((error: unknown) => error);
			await vi.advanceTimersByTimeAsync(26000);
			expect(await settled).toEqual(
				operation === "start" ? { game } : { ok: true },
			);
		},
	);
	it("validates the song clip request before sending it", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({ media: "data:audio/wav;base64,UklGRg==" }),
		);
		vi.stubGlobal("fetch", fetchMock);
		await expect(getSongClip(session, "")).rejects.toThrow();
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it("rejects song clip responses containing provider metadata", async () => {
		vi.stubGlobal("fetch", async () =>
			Response.json({
				media: "data:audio/wav;base64,UklGRg==",
				trackId: 13141170,
			}),
		);
		await expect(getSongClip(session, "round/0")).rejects.toThrow();
	});
	it("preserves duplicate status/code and sends false without a caller-supplied team identity", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						error: { code: "ANSWER_ALREADY_LOCKED", message: "Already locked" },
					}),
					{ status: 409 },
				),
		);
		vi.stubGlobal("fetch", fetchMock);
		const result = await submitAnswer(session, "round-id", false).catch(
			(error) => error,
		);
		expect(result).toBeInstanceOf(ApiError);
		expect(result).toMatchObject({
			status: 409,
			code: "ANSWER_ALREADY_LOCKED",
			message: "Already locked",
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"/v1/rounds/round-id/answers",
			expect.objectContaining({
				body: '{"value":false}',
				signal: expect.any(AbortSignal),
			}),
		);
		await expect(
			submitAnswer(session, "round-id", Number.POSITIVE_INFINITY),
		).rejects.toThrow();
		expect(fetchMock).toHaveBeenCalledOnce();
	});
	it("accepts the committed COMPLETE start response from an empty bank", async () => {
		const gameId = "e895e664-208c-4248-bde6-b4ca8a06a539";
		const game = {
			id: gameId,
			status: "COMPLETE",
			startedAt: "2026-10-08T10:00:00.000Z",
			nextRoundAt: null,
		};
		vi.stubGlobal(
			"fetch",
			async () =>
				new Response(JSON.stringify({ game }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		expect(
			await startGame(
				{ gameId, role: "HOST", token: "opaque-host-token" },
				false,
			),
		).toEqual({ game });
	});

	it("sends the selected interval and defaults omitted topics when creating a game", async () => {
		const responseBody = {
			game: {
				id: "e895e664-208c-4248-bde6-b4ca8a06a539",
				name: "Beach convoy",
				joinCode: "AB12CD",
				status: "LOBBY",
			},
			hostToken: "opaque-host-token",
		};
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify(responseBody), {
					status: 201,
					headers: { "content-type": "application/json" },
				}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await createGame({ name: "Beach convoy", roundIntervalSeconds: 600 });

		expect(fetchMock).toHaveBeenCalledWith(
			"/v1/games",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					name: "Beach convoy",
					topics: [...QuestionTopicIds],
					roundIntervalSeconds: 600,
				}),
			}),
		);
	});
});

import { QuestionTopicIds } from "@carpool/contracts";
