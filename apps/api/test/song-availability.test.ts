import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadMigrations } from "../src/migrations";
import { songPacks } from "../src/services/song-packs";
import { SongPreviewError } from "../src/services/song-preview";

vi.mock("../src/services/song-preview", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/services/song-preview")>()),
	checkSongPreview: vi.fn(),
}));

let db: PGlite;
beforeEach(async () => {
	db = new PGlite();
	const migration = (await loadMigrations()).find(
		(m) => m.name === "015_song_preview_availability.sql",
	);
	expect(migration, "availability migration exists").toBeDefined();
	await db.exec(migration?.sql ?? "");
});
afterEach(async () => {
	vi.clearAllMocks();
	await db?.close();
});

const ids: number[] = [
	...new Set(
		Object.values(songPacks)
			.flat()
			.map(([id]) => id),
	),
];
const unavailable = () =>
	new SongPreviewError("metadata", "TRACK_UNAVAILABLE", false);
const temporary = () =>
	new SongPreviewError("download", "PROVIDER_TIMEOUT", true);
async function service() {
	return import("../src/services/song-availability");
}
async function rows() {
	return (
		await db.query<{
			track_id: number;
			available: boolean | null;
			checked_at: Date;
			last_error_code: string | null;
			last_error_stage: string | null;
		}>("SELECT * FROM song_preview_availability ORDER BY track_id")
	).rows;
}

it("records successful previews without retaining audio or provider URLs", async () => {
	const { recordSongPreviewResult, getUnavailableSongTrackIds } =
		await service();
	await recordSongPreviewResult(db, ids[0]);
	expect(await rows()).toEqual([
		expect.objectContaining({
			track_id: ids[0],
			available: true,
			checked_at: expect.any(Date),
			last_error_code: null,
			last_error_stage: null,
		}),
	]);
	expect(await getUnavailableSongTrackIds(db)).toEqual(new Set());
});

it("keeps a confirmed missing track excluded until a successful recovery check", async () => {
	const { recordSongPreviewResult, getUnavailableSongTrackIds } =
		await service();
	await recordSongPreviewResult(db, ids[0], unavailable());
	await db.query(
		"UPDATE song_preview_availability SET checked_at = now() - interval '8 days'",
		[],
	);
	expect(await getUnavailableSongTrackIds(db)).toEqual(new Set([ids[0]]));
	await recordSongPreviewResult(db, ids[0]);
	expect(await getUnavailableSongTrackIds(db)).toEqual(new Set());
	expect((await rows())[0]).toMatchObject({
		available: true,
		last_error_code: null,
		last_error_stage: null,
	});
});

it("preserves available, unavailable, and unknown states through temporary failures", async () => {
	const { recordSongPreviewResult, getUnavailableSongTrackIds } =
		await service();
	await recordSongPreviewResult(db, ids[0]);
	await recordSongPreviewResult(db, ids[1], unavailable());
	for (const id of ids.slice(0, 3))
		await recordSongPreviewResult(db, id, temporary());
	const ledger = await rows();
	for (const [id, state] of [
		[ids[0], true],
		[ids[1], false],
		[ids[2], null],
	]) {
		expect(ledger.find((row) => row.track_id === id)).toMatchObject({
			available: state,
			last_error_code: "PROVIDER_TIMEOUT",
			last_error_stage: "download",
		});
	}
	expect(await getUnavailableSongTrackIds(db)).toEqual(new Set([ids[1]]));
});

it("does not blacklist an arbitrary error claiming to be a missing track", async () => {
	const { recordSongPreviewResult, getUnavailableSongTrackIds } =
		await service();
	await recordSongPreviewResult(db, ids[0], {
		code: "TRACK_UNAVAILABLE",
		stage: "metadata",
		message: "secret URL",
	});
	expect(await getUnavailableSongTrackIds(db)).toEqual(new Set());
	expect((await rows())[0]).toMatchObject({
		available: null,
		last_error_code: "PREVIEW_CHECK_FAILED",
		last_error_stage: "validation",
	});
});

it("checks actual unchecked catalog IDs in a bounded serialized batch", async () => {
	const { checkNextSongPreviews, getSongPreviewCheckCandidates } =
		await service();
	const { checkSongPreview } = await import("../src/services/song-preview");
	const first = (await getSongPreviewCheckCandidates(db, 1))[0];
	let active = 0;
	let maximum = 0;
	vi.mocked(checkSongPreview).mockImplementation(async (id) => {
		active++;
		maximum = Math.max(maximum, active);
		await Promise.resolve();
		active--;
		if (id === first) throw unavailable();
	});
	await checkNextSongPreviews(db);
	const ledger = await rows();
	expect(ledger).toHaveLength(3);
	expect(ledger.every((row) => ids.includes(Number(row.track_id)))).toBe(true);
	expect(ledger.filter((row) => row.available === false)).toHaveLength(1);
	expect(maximum).toBe(1);
	await checkNextSongPreviews(db, 2);
	expect(await rows()).toHaveLength(5);
});

it("rechecks daily, retries temporary failures hourly, and prioritizes unchecked tracks", async () => {
	const { getSongPreviewCheckCandidates, recordSongPreviewResult } =
		await service();
	const subset = ids.slice(0, 6);
	for (const id of subset.slice(0, 5)) await recordSongPreviewResult(db, id);
	await recordSongPreviewResult(db, subset[1], temporary());
	await recordSongPreviewResult(db, subset[2], unavailable());
	await recordSongPreviewResult(db, subset[3], temporary());
	await db.query(
		"UPDATE song_preview_availability SET checked_at = now() - interval '25 hours' WHERE track_id = ANY($1::bigint[])",
		[[subset[0], subset[2]]],
	);
	await db.query(
		"UPDATE song_preview_availability SET checked_at = now() - interval '61 minutes' WHERE track_id = $1",
		[subset[1]],
	);
	expect(await getSongPreviewCheckCandidates(db, 20, subset)).toEqual([
		subset[5],
		...[subset[0], subset[2]].sort((a, b) => a - b),
		subset[1],
	]);
});

it("rejects invalid checker limits before any provider request", async () => {
	const { checkNextSongPreviews } = await service();
	await expect(checkNextSongPreviews(db, 0)).rejects.toThrow(
		"Invalid preview check limit",
	);
	await expect(checkNextSongPreviews(db, 1.5)).rejects.toThrow(
		"Invalid preview check limit",
	);
});

it("offers an offline themed dry run without database credentials or network requests", async () => {
	const { runSongPreviewChecks } = await import(
		"../scripts/check-song-previews"
	);
	vi.stubEnv("DATABASE_URL", "");
	const outputLog = vi.spyOn(console, "log").mockImplementation(() => {});
	try {
		await runSongPreviewChecks(["--theme", "adele", "--all", "--dry-run"]);
		const stdout = outputLog.mock.calls
			.map(([line]) => String(line))
			.join("\n");
		const output = stdout
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const checkedIds = output
			.filter((row) => row.status === "WOULD_CHECK")
			.map((row) => row.trackId);
		expect(new Set(checkedIds)).toEqual(
			new Set(songPacks.adele.map(([id]) => id)),
		);
		expect(output.at(-1)).toMatchObject({
			dryRun: true,
			checked: 0,
			planned: checkedIds.length,
		});
		expect(stdout).not.toContain("DATABASE_URL");
	} finally {
		outputLog.mockRestore();
		vi.unstubAllEnvs();
	}
});

it("targets the requested Alan Walker recording even when --all is supplied", async () => {
	const { runSongPreviewChecks } = await import(
		"../scripts/check-song-previews"
	);
	vi.stubEnv("DATABASE_URL", "");
	const outputLog = vi.spyOn(console, "log").mockImplementation(() => {});
	try {
		await runSongPreviewChecks([
			"--theme",
			"songs-2010s",
			"--track",
			"141822951",
			"--all",
			"--dry-run",
		]);
		const output = outputLog.mock.calls.map(([line]) =>
			JSON.parse(String(line)),
		);
		expect(output).toEqual([
			{
				trackId: 141822951,
				title: "Alone",
				artist: "Alan Walker",
				themes: ["songs-2010s"],
				status: "WOULD_CHECK",
			},
			{ dryRun: true, checked: 0, planned: 1 },
		]);
	} finally {
		outputLog.mockRestore();
		vi.unstubAllEnvs();
	}
});

it.each([
	["--track", "141822951", "--theme", "adele", "--dry-run"],
	["--track", "1", "--dry-run"],
	["--track", "1.5", "--dry-run"],
	["--track", "9007199254740992", "--dry-run"],
	["--track"],
])(
	"rejects a target outside the selected catalog or an invalid track ID (%s %s)",
	async (...args) => {
		const { runSongPreviewChecks } = await import(
			"../scripts/check-song-previews"
		);
		await expect(runSongPreviewChecks(args)).rejects.toThrow(
			"check-song-previews",
		);
	},
);

it("prioritizes unchecked appended decade and K-pop entries over the older catalog", async () => {
	const { getSongPreviewCheckCandidates } = await service();
	const newTracks = new Set<number>([
		...songPacks.kpop.slice(100).map(([id]) => Number(id)),
		...songPacks.melodies.slice(80).map(([id]) => Number(id)),
		...songPacks["songs-2000s"].slice(80).map(([id]) => Number(id)),
		...songPacks["songs-2010s"].slice(80).map(([id]) => Number(id)),
		...songPacks["songs-2020s"].slice(80).map(([id]) => Number(id)),
	]);
	const candidates = await getSongPreviewCheckCandidates(
		db,
		newTracks.size + 1,
	);
	expect(
		candidates.slice(0, newTracks.size).every((id) => newTracks.has(id)),
	).toBe(true);
	expect(newTracks.has(candidates[newTracks.size])).toBe(false);
});

it("reports safe failure details after persisting each periodic check", async () => {
	const { checkNextSongPreviews } = await service();
	const { checkSongPreview } = await import("../src/services/song-preview");
	vi.mocked(checkSongPreview).mockRejectedValueOnce(
		new SongPreviewError(
			"download",
			"PROVIDER_TIMEOUT",
			true,
			new Error("https://secret.example"),
		),
	);
	const reports: { details: Record<string, unknown>; message: string }[] = [];
	await checkNextSongPreviews(db, 1, (details, message) =>
		reports.push({ details, message }),
	);
	expect(reports).toEqual([
		{
			details: {
				trackId: (await rows())[0].track_id,
				code: "PROVIDER_TIMEOUT",
				stage: "download",
				retryable: true,
			},
			message: "Song preview check failed",
		},
	]);
	expect(JSON.stringify(reports)).not.toContain("secret.example");
});
