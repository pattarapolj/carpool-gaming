import { databaseUrl } from "../src/production";
import { createPostgresDb } from "../src/server";
import {
	getSongPreviewCheckCandidates,
	recordSongPreviewResult,
} from "../src/services/song-availability";
import { songPacks } from "../src/services/song-packs";
import {
	checkSongPreview,
	SongPreviewError,
} from "../src/services/song-preview";

const usage =
	"check-song-previews [--theme <theme>] [--track <catalogID>] [--all] [--dry-run]";

export async function runSongPreviewChecks(args: string[]) {
	let theme: string | undefined;
	let selectedTrackId: number | undefined;
	let all = false;
	let dryRun = false;
	for (let index = 0; index < args.length; index++) {
		switch (args[index]) {
			case "--theme":
				theme = args[++index];
				if (!theme || !Object.hasOwn(songPacks, theme)) throw new Error(usage);
				break;
			case "--all":
				all = true;
				break;
			case "--track": {
				const value = args[++index];
				if (!value || !/^[1-9]\d*$/.test(value)) throw new Error(usage);
				selectedTrackId = Number(value);
				if (!Number.isSafeInteger(selectedTrackId)) throw new Error(usage);
				break;
			}
			case "--dry-run":
				dryRun = true;
				break;
			default:
				throw new Error(usage);
		}
	}
	const tracks = new Map<
		number,
		{ trackId: number; title: string; artist: string; themes: string[] }
	>();
	for (const [packTheme, pack] of Object.entries(songPacks)) {
		if (theme && packTheme !== theme) continue;
		for (const [trackId, title, artist] of pack) {
			const existing = tracks.get(trackId);
			if (existing) existing.themes.push(packTheme);
			else tracks.set(trackId, { trackId, title, artist, themes: [packTheme] });
		}
	}
	const ids = [...tracks.keys()].sort((a, b) => a - b);
	if (selectedTrackId !== undefined && !tracks.has(selectedTrackId))
		throw new Error(usage);
	const targeted =
		selectedTrackId === undefined ? undefined : [selectedTrackId];
	if (dryRun) {
		const planned = targeted ?? (all ? ids : ids.slice(0, 3));
		for (const id of planned)
			console.log(JSON.stringify({ ...tracks.get(id), status: "WOULD_CHECK" }));
		console.log(
			JSON.stringify({ dryRun: true, checked: 0, planned: planned.length }),
		);
		return;
	}
	const db = createPostgresDb({
		connectionString: databaseUrl(process.env.DATABASE_URL),
	});
	try {
		const planned =
			targeted ?? (all ? ids : await getSongPreviewCheckCandidates(db, 3, ids));
		let failures = 0;
		let completed = 0;
		for (const trackId of planned) {
			let failure: unknown;
			try {
				await checkSongPreview(trackId);
			} catch (error) {
				failure = error ?? new Error("Preview check failed");
				failures++;
			}
			await recordSongPreviewResult(db, trackId, failure);
			completed++;
			console.log(
				JSON.stringify({
					...tracks.get(trackId),
					completed,
					planned: planned.length,
					status: failure === undefined ? "AVAILABLE" : "CHECK_FAILED",
					...(failure === undefined
						? {}
						: failure instanceof SongPreviewError
							? {
									code: failure.code,
									stage: failure.stage,
									retryable: failure.retryable,
								}
							: {
									code: "PREVIEW_CHECK_FAILED",
									stage: "validation",
									retryable: true,
								}),
				}),
			);
		}
		console.log(
			JSON.stringify({ dryRun: false, checked: completed, failed: failures }),
		);
		if (failures) process.exitCode = 1;
	} finally {
		await db.end();
	}
}

if (typeof require !== "undefined" && require.main === module)
	void runSongPreviewChecks(process.argv.slice(2)).catch(() => {
		console.error(
			JSON.stringify({
				code: "COMMAND_FAILED",
				usage,
				message:
					"Verify arguments, DATABASE_URL, and applied migrations; no diagnostic secrets are printed.",
			}),
		);
		process.exitCode = 1;
	});
