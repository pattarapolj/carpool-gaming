import { afterEach, describe, expect, it, vi } from "vitest";
import { createGame } from "./api";

describe("lobby API client", () => {
	afterEach(() => vi.unstubAllGlobals());

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
