export type GameSession = {
	gameId: string;
	role: "HOST" | "CAPTAIN";
	token: string;
};

const SESSION_KEY = "carpool-game-session";

type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadSession(storage?: SessionStorage) {
	const target = storage ?? getLocalStorage();
	if (!target) return null;

	let value: string | null;
	try {
		value = target.getItem(SESSION_KEY);
	} catch {
		return null;
	}
	if (!value) return null;

	try {
		const session: unknown = JSON.parse(value);
		if (isGameSession(session)) return session;
	} catch {
		// Invalid persisted state is cleared below.
	}

	try {
		target.removeItem(SESSION_KEY);
	} catch {
		// Storage may be disabled by the browser.
	}
	return null;
}

export function saveSession(session: GameSession, storage?: SessionStorage) {
	const target = storage ?? getLocalStorage();
	if (!target) throw new Error("Browser storage is unavailable.");
	target.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(storage?: SessionStorage) {
	const target = storage ?? getLocalStorage();
	try {
		target?.removeItem(SESSION_KEY);
	} catch {
		// The page can still switch games; the old credential remains local.
	}
}

function isGameSession(value: unknown): value is GameSession {
	if (typeof value !== "object" || value === null) return false;
	const session = value as Record<string, unknown>;
	return (
		typeof session.gameId === "string" &&
		/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(session.gameId) &&
		(session.role === "HOST" || session.role === "CAPTAIN") &&
		typeof session.token === "string" &&
		session.token.length > 0
	);
}

function getLocalStorage() {
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}
