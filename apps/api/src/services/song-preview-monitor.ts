import type { QueryDb } from "./auth";
import type { SongPreviewLogger } from "./puzzle-service";
import { checkNextSongPreviews } from "./song-availability";

export function startSongPreviewChecks(db: QueryDb, log: SongPreviewLogger) {
	let running: Promise<void> | undefined;
	const timer = setInterval(() => {
		if (running) return;
		running = checkNextSongPreviews(db, 1, log)
			.catch(() => {
				log(
					{ code: "PREVIEW_MONITOR_FAILED" },
					"Song availability check could not be saved",
				);
			})
			.finally(() => {
				running = undefined;
			});
	}, 30000);
	timer.unref();
	return async () => {
		clearInterval(timer);
		await running;
	};
}
