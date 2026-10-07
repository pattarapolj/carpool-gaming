import { describe, expect, it } from "vitest";
import { clearSession, loadSession, saveSession } from "./session";

describe("browser session persistence", () => {
	it("restores a saved host or captain session after refresh", () => {
		const storage = createMemoryStorage();
		const session = {
			gameId: "e895e664-208c-4248-bde6-b4ca8a06a539",
			role: "CAPTAIN" as const,
			token: "opaque-token",
		};

		saveSession(session, storage);

		expect(loadSession(storage)).toEqual(session);
		clearSession(storage);
		expect(loadSession(storage)).toBeNull();
	});

	it("discards malformed or incomplete stored sessions", () => {
		const storage = createMemoryStorage();
		storage.setItem("carpool-game-session", "not-json");

		expect(loadSession(storage)).toBeNull();
		expect(storage.getItem("carpool-game-session")).toBeNull();
	});
});

function createMemoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
	};
}
