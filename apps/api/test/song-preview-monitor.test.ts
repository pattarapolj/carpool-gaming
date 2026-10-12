import { afterEach, expect, it, vi } from "vitest";
import type { GameDb } from "../src/services/auth";
import * as availability from "../src/services/song-availability";
import { startSongPreviewChecks } from "../src/services/song-preview-monitor";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
it("runs small periodic checks without overlapping a slow provider request", async () => {
	vi.useFakeTimers();
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	const check = vi
		.spyOn(availability, "checkNextSongPreviews")
		.mockImplementation(() => pending);
	const db = {} as GameDb;
	const stop = startSongPreviewChecks(db, () => {});
	await vi.advanceTimersByTimeAsync(30000);
	expect(check).toHaveBeenCalledTimes(1);
	expect(check.mock.calls[0][1]).toBe(1);
	await vi.advanceTimersByTimeAsync(90000);
	expect(check).toHaveBeenCalledTimes(1);
	release();
	await pending;
	await stop();
	await vi.advanceTimersByTimeAsync(90000);
	expect(check).toHaveBeenCalledTimes(1);
});
