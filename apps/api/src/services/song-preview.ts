import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { entries } from "./puzzle-catalog";

export type SongPreviewStage =
	| "metadata"
	| "download"
	| "decode"
	| "validation";
export type SongPreviewErrorCode =
	| "TRACK_UNAVAILABLE"
	| "PROVIDER_TIMEOUT"
	| "PROVIDER_ERROR"
	| "INVALID_PREVIEW"
	| "DECODE_FAILED"
	| "DECODE_TIMEOUT";

const messages: Record<SongPreviewErrorCode, string> = {
	TRACK_UNAVAILABLE: "Song preview unavailable",
	PROVIDER_TIMEOUT: "Song preview provider timed out",
	PROVIDER_ERROR: "Song preview provider unavailable",
	INVALID_PREVIEW: "Invalid preview host or audio",
	DECODE_FAILED: "Cannot decode song preview",
	DECODE_TIMEOUT: "Song preview decoding timed out",
};

export class SongPreviewError extends Error {
	constructor(
		readonly stage: SongPreviewStage,
		readonly code: SongPreviewErrorCode,
		readonly retryable: boolean,
		cause?: unknown,
	) {
		super(messages[code], { cause });
		this.name = "SongPreviewError";
	}
}

export function describeSongPreviewError(error: unknown): {
	stage: string;
	code: string;
	retryable: boolean;
} {
	return error instanceof SongPreviewError
		? { stage: error.stage, code: error.code, retryable: error.retryable }
		: { stage: "validation", code: "INVALID_PREVIEW", retryable: false };
}

// Retain only successful 15-second recordings: at most 90 / about 43 MB for one hour.
const cache = new Map<number, { expires: number; pcm: Buffer }>();
const inFlight = new Map<number, Promise<Buffer>>();
const warmSlots: Promise<void>[] = [Promise.resolve(), Promise.resolve()];
const warmJobs = new Map<number, { epoch: number; promise: Promise<void> }>();
let nextWarmSlot = 0;
let acceptingWarm = true;
let warmEpoch = 0;

function validateTrack(trackId: number) {
	if (
		!Object.values(entries).some((pack) =>
			pack.some((entry) => entry.trackId === trackId),
		)
	)
		throw new SongPreviewError(
			"validation",
			"INVALID_PREVIEW",
			false,
			new Error("Invalid song clue"),
		);
}

function cachedPreview(trackId: number) {
	const cached = cache.get(trackId);
	if (cached && cached.expires > Date.now()) return cached.pcm;
	if (cached) cache.delete(trackId);
	return undefined;
}

function decodedPreview(trackId: number): Promise<Buffer> {
	const cached = cachedPreview(trackId);
	if (cached) return Promise.resolve(cached);
	const pending = inFlight.get(trackId);
	if (pending) return pending;
	const load = loadPreview(trackId).finally(() => {
		if (inFlight.get(trackId) === load) inFlight.delete(trackId);
	});
	inFlight.set(trackId, load);
	return load;
}

export async function songPreview(
	trackId: number,
	seconds: number,
): Promise<string> {
	// This input error remains compatible with callers that validate clue requests.
	if (![2, 4, 8, 15].includes(seconds)) throw new Error("Invalid song clue");
	try {
		validateTrack(trackId);
	} catch {
		throw new Error("Invalid song clue");
	}
	const decoded = await decodedPreview(trackId);
	if (!cache.has(trackId)) {
		if (cache.size >= 90) {
			const oldest = cache.keys().next().value;
			if (oldest !== undefined) cache.delete(oldest);
		}
		cache.set(trackId, { expires: Date.now() + 3600000, pcm: decoded });
	}
	const pcm = decoded.subarray(0, seconds * 16000 * 2);
	const wav = Buffer.alloc(44 + pcm.length);
	wav.write("RIFF");
	wav.writeUInt32LE(36 + pcm.length, 4);
	wav.write("WAVEfmt ", 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(16000, 24);
	wav.writeUInt32LE(32000, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(pcm.length, 40);
	pcm.copy(wav, 44);
	return `data:audio/wav;base64,${wav.toString("base64")}`;
}

export async function checkSongPreview(trackId: number): Promise<void> {
	validateTrack(trackId);
	// Share active loads and successful gameplay recordings without inserting or evicting.
	await decodedPreview(trackId);
}

export function startSongPreviewWarming(): void {
	acceptingWarm = true;
}

export async function stopSongPreviewWarming(): Promise<void> {
	acceptingWarm = false;
	warmEpoch++;
	await Promise.all(warmSlots);
}

export async function warmSongPreviews(trackIds: number[]): Promise<void> {
	if (!acceptingWarm) return;
	const epoch = warmEpoch;
	const jobs = new Set<Promise<void>>();
	for (const trackId of trackIds) {
		if (cachedPreview(trackId)) continue;
		const pending = warmJobs.get(trackId);
		if (pending?.epoch === epoch) {
			jobs.add(pending.promise);
			continue;
		}
		// Best-effort prefetch must not create an unbounded queue or exceed the cache capacity.
		if (warmJobs.size >= 90 && !pending) continue;
		const slot = nextWarmSlot;
		nextWarmSlot = (nextWarmSlot + 1) % warmSlots.length;
		const job = warmSlots[slot]
			.then(async () => {
				if (!acceptingWarm || epoch !== warmEpoch) return;
				await songPreview(trackId, 2);
			})
			.catch(() => {})
			.finally(() => {
				if (warmJobs.get(trackId)?.promise === job) warmJobs.delete(trackId);
			});
		warmSlots[slot] = job;
		warmJobs.set(trackId, { epoch, promise: job });
		jobs.add(job);
	}
	await Promise.all(jobs);
}

function providerFailure(stage: "metadata" | "download", cause: unknown) {
	if (cause instanceof SongPreviewError) return cause;
	const timedOut =
		cause instanceof Error &&
		(cause.name === "TimeoutError" || cause.name === "AbortError");
	return new SongPreviewError(
		stage,
		timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
		true,
		cause,
	);
}

function checkResponse(response: Response, stage: "metadata" | "download") {
	if (response.ok) return;
	const missing = response.status === 404 || response.status === 410;
	const timedOut = response.status === 408;
	throw new SongPreviewError(
		stage,
		missing
			? "TRACK_UNAVAILABLE"
			: timedOut
				? "PROVIDER_TIMEOUT"
				: "PROVIDER_ERROR",
		!missing && (timedOut || response.status === 429 || response.status >= 500),
	);
}

async function loadPreview(trackId: number): Promise<Buffer> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await loadPreviewAttempt(trackId);
		} catch (error) {
			if (
				!(error instanceof SongPreviewError) ||
				!error.retryable ||
				attempt === 1
			)
				throw error;
			await new Promise((resolve) => setTimeout(resolve, 150));
		}
	}
}

async function loadPreviewAttempt(trackId: number): Promise<Buffer> {
	// Each attempt has a shared 8-second network budget plus a 5-second decode budget.
	const signal = AbortSignal.timeout(8000);
	let track: { preview?: unknown; id?: unknown; error?: { code?: unknown } };
	try {
		const metadata = await fetch(`https://api.deezer.com/track/${trackId}`, {
			signal,
			redirect: "error",
		});
		checkResponse(metadata, "metadata");
		track = await metadata.json();
	} catch (error) {
		throw providerFailure("metadata", error);
	}
	if (!track || typeof track !== "object" || Array.isArray(track))
		throw new SongPreviewError("metadata", "PROVIDER_ERROR", true);
	if (track.error) {
		if (track.error.code === 800)
			throw new SongPreviewError("metadata", "TRACK_UNAVAILABLE", false);
		throw new SongPreviewError(
			"metadata",
			"PROVIDER_ERROR",
			track.error.code === 4 || track.error.code === 700,
		);
	}
	if (typeof track.id !== "number" || track.id !== trackId)
		throw new SongPreviewError("metadata", "PROVIDER_ERROR", true);
	if (
		track.preview == null ||
		(typeof track.preview === "string" && !track.preview.trim())
	)
		throw new SongPreviewError("metadata", "TRACK_UNAVAILABLE", false);
	if (typeof track.preview !== "string")
		throw new SongPreviewError("metadata", "PROVIDER_ERROR", true);
	let url: URL;
	try {
		url = new URL(track.preview);
	} catch (error) {
		throw new SongPreviewError("validation", "INVALID_PREVIEW", false, error);
	}
	if (
		url.protocol !== "https:" ||
		url.hostname !== "cdnt-preview.dzcdn.net" ||
		url.port ||
		url.username ||
		url.password
	)
		throw new SongPreviewError("validation", "INVALID_PREVIEW", false);
	const chunks: Buffer[] = [];
	try {
		const audio = await fetch(url, { signal, redirect: "error" });
		checkResponse(audio, "download");
		if (!audio.body)
			throw new SongPreviewError("download", "INVALID_PREVIEW", false);
		const reader = audio.body.getReader();
		let size = 0;
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > 2000000)
					throw new SongPreviewError("validation", "INVALID_PREVIEW", false);
				chunks.push(Buffer.from(value));
			}
		} finally {
			void reader.cancel().catch(() => {});
		}
	} catch (error) {
		throw providerFailure("download", error);
	}
	const pcm = await decodePreview(Buffer.concat(chunks));
	if (pcm.length < 480000)
		throw new SongPreviewError("validation", "TRACK_UNAVAILABLE", false);
	return pcm;
}

function decodePreview(audio: Buffer): Promise<Buffer> {
	return new Promise<Buffer>((resolve, reject) => {
		let decoder: ChildProcessWithoutNullStreams;
		try {
			decoder = spawn(
				"ffmpeg",
				[
					"-hide_banner",
					"-loglevel",
					"error",
					"-i",
					"pipe:0",
					"-t",
					"15",
					"-map_metadata",
					"-1",
					"-f",
					"s16le",
					"-ar",
					"16000",
					"-ac",
					"1",
					"pipe:1",
				],
				{ windowsHide: true },
			);
		} catch (error) {
			reject(new SongPreviewError("decode", "DECODE_FAILED", false, error));
			return;
		}
		const output: Buffer[] = [];
		let bytes = 0;
		let settled = false;
		const finish = (error?: SongPreviewError) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (error) {
				decoder.kill();
				reject(error);
			} else resolve(Buffer.concat(output));
		};
		const timeout = setTimeout(
			() => finish(new SongPreviewError("decode", "DECODE_TIMEOUT", false)),
			5000,
		);
		decoder.stdout.on("data", (chunk: Buffer) => {
			if (settled) return;
			bytes += chunk.length;
			if (bytes > 480000)
				finish(new SongPreviewError("validation", "INVALID_PREVIEW", false));
			else output.push(chunk);
		});
		decoder.stderr.resume();
		decoder.on("error", (error) =>
			finish(new SongPreviewError("decode", "DECODE_FAILED", false, error)),
		);
		// FFmpeg closes input once the 15-second cut is decoded.
		decoder.stdin.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code !== "EPIPE" && error.code !== "EOF")
				finish(new SongPreviewError("decode", "DECODE_FAILED", false, error));
		});
		decoder.on("close", (code) =>
			finish(
				code === 0
					? undefined
					: new SongPreviewError("decode", "DECODE_FAILED", false),
			),
		);
		decoder.stdin.end(audio);
	});
}
