import { afterEach, describe, expect, it, vi } from "vitest";
import { createGame, startGame } from "./api";

describe("lobby API client", () => {
	afterEach(() => vi.unstubAllGlobals());
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

	it("sends the selected interval when creating a game", async () => {
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
					roundIntervalSeconds: 600,
				}),
			}),
		);
	});
});
