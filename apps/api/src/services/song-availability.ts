import type { QueryDb } from "./auth";
import { songPacks } from "./song-packs";
import { checkSongPreview, SongPreviewError } from "./song-preview";

const catalogTrackIds = [
	...new Set(
		Object.values(songPacks)
			.flat()
			.map(([trackId]) => trackId),
	),
];
const priorityTrackIds = [
	...new Set([
		...songPacks.kpop.slice(100).map(([id]) => Number(id)),
		...songPacks.melodies.slice(80).map(([id]) => Number(id)),
		...songPacks["songs-2000s"].slice(80).map(([id]) => Number(id)),
		...songPacks["songs-2010s"].slice(80).map(([id]) => Number(id)),
		...songPacks["songs-2020s"].slice(80).map(([id]) => Number(id)),
	]),
];

function validateTrackId(trackId: number) {
	if (!Number.isSafeInteger(trackId) || trackId <= 0)
		throw new Error("Invalid preview track ID");
}

/** Persist diagnostic codes only; provider errors and audio never enter the ledger. */
export async function recordSongPreviewResult(
	db: QueryDb,
	trackId: number,
	error?: unknown,
): Promise<void> {
	validateTrackId(trackId);
	const failure = error instanceof SongPreviewError ? error : undefined;
	const available =
		error === undefined
			? true
			: failure?.code === "TRACK_UNAVAILABLE"
				? false
				: null;
	await db.query(
		`INSERT INTO song_preview_availability
		 (track_id, available, checked_at, last_error_code, last_error_stage)
		 VALUES ($1, $2, now(), $3, $4)
		 ON CONFLICT (track_id) DO UPDATE SET
		 available = COALESCE(EXCLUDED.available, song_preview_availability.available),
		 checked_at = EXCLUDED.checked_at,
		 last_error_code = EXCLUDED.last_error_code,
		 last_error_stage = EXCLUDED.last_error_stage`,
		[
			trackId,
			available,
			error === undefined ? null : (failure?.code ?? "PREVIEW_CHECK_FAILED"),
			error === undefined ? null : (failure?.stage ?? "validation"),
		],
	);
}

/** Confirmed missing tracks stay excluded until a later check actually succeeds. */
export async function getUnavailableSongTrackIds(
	db: QueryDb,
): Promise<Set<number>> {
	const result = (await db.query(
		"SELECT track_id FROM song_preview_availability WHERE available = false",
		[],
	)) as { rows: { track_id: number | string }[] };
	return new Set(result.rows.map(({ track_id }) => Number(track_id)));
}

/** Unchecked tracks first, then oldest due check. Temporary failures retry hourly. */
export async function getSongPreviewCheckCandidates(
	db: QueryDb,
	limit = 3,
	trackIds: readonly number[] = catalogTrackIds,
): Promise<number[]> {
	if (!Number.isSafeInteger(limit) || limit < 1)
		throw new Error("Invalid preview check limit");
	for (const id of trackIds) validateTrackId(id);
	const result = (await db.query(
		`SELECT catalog.track_id FROM
		 (SELECT DISTINCT unnest($1::bigint[]) AS track_id) catalog
		 LEFT JOIN song_preview_availability ledger ON ledger.track_id = catalog.track_id
		 WHERE ledger.checked_at IS NULL OR ledger.checked_at <= now() -
		 CASE WHEN ledger.last_error_code IS NOT NULL
		 AND ledger.last_error_code <> 'TRACK_UNAVAILABLE'
		 THEN interval '1 hour' ELSE interval '24 hours' END
		 ORDER BY (ledger.checked_at IS NOT NULL) ASC,
		 CASE WHEN ledger.checked_at IS NULL AND catalog.track_id = ANY($3::bigint[])
		 THEN 0 ELSE 1 END ASC,
		 ledger.checked_at ASC NULLS FIRST, catalog.track_id ASC
		 LIMIT $2`,
		[[...trackIds], limit, priorityTrackIds],
	)) as { rows: { track_id: number | string }[] };
	return result.rows.map(({ track_id }) => Number(track_id));
}

/** One network request/decode at a time, with each result saved before moving on. */
export async function checkNextSongPreviews(
	db: QueryDb,
	limit = 3,
	report?: (details: Record<string, unknown>, message: string) => void,
): Promise<void> {
	const trackIds = await getSongPreviewCheckCandidates(db, limit);
	for (const trackId of trackIds) {
		let failure: unknown;
		try {
			await checkSongPreview(trackId);
		} catch (error) {
			failure = error ?? new Error("Preview check failed");
		}
		await recordSongPreviewResult(db, trackId, failure);
		if (failure !== undefined) {
			const error = failure instanceof SongPreviewError ? failure : undefined;
			report?.(
				{
					trackId,
					code: error?.code ?? "PREVIEW_CHECK_FAILED",
					stage: error?.stage ?? "validation",
					retryable: error?.retryable ?? true,
				},
				"Song preview check failed",
			);
		}
	}
}
