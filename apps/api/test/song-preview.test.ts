import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { songPacks } from "../src/services/song-packs";
import { songPreview } from "../src/services/song-preview";
import { previewFixture, songRecording } from "./fixtures/song-recording";

afterEach(() => vi.unstubAllGlobals());

it("decodes a 30-second preview into only the unlocked audio without metadata", async () => {
	vi.stubGlobal("fetch", async (url: string | URL) =>
		String(url).startsWith("https://api.deezer.com/")
			? Response.json({
					id: 13141170,
					preview: "https://cdnt-preview.dzcdn.net/test.mp3",
				})
			: new Response(songRecording()),
	);
	const clips: Buffer[] = [];
	for (const seconds of [2, 4, 8, 15]) {
		const media = await songPreview(13141170, seconds);
		const wav = Buffer.from(media.split(",")[1], "base64");
		expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
		expect(wav.readUInt32LE(40) / wav.readUInt32LE(28)).toBe(seconds);
		expect(wav.length).toBe(44 + seconds * 32000);
		expect(wav.includes(Buffer.from("dzcdn"))).toBe(false);
		clips.push(wav.subarray(44));
	}
	expect(clips[3].subarray(0, clips[0].length)).toEqual(clips[0]);
});

it("rejects provider URLs outside Deezer's preview host and permits a retry", async () => {
	vi.stubGlobal("fetch", async () =>
		Response.json({ id: 540175, preview: "http://127.0.0.1/private" }),
	);
	await expect(songPreview(540175, 2)).rejects.toThrow("Invalid preview host");
	vi.stubGlobal("fetch", async (url: string | URL) =>
		String(url).startsWith("https://api.deezer.com/")
			? Response.json({
					id: 540175,
					preview: "https://cdnt-preview.dzcdn.net/test.mp3",
				})
			: new Response(songRecording()),
	);
	expect(await songPreview(540175, 2)).toMatch(/^data:audio\/wav;base64,/);
});

it("rejects arbitrary tracks and unsupported clip durations", async () => {
	await expect(songPreview(1, 2)).rejects.toThrow("Invalid song clue");
	await expect(songPreview(13141170, 30)).rejects.toThrow("Invalid song clue");
});

it("evicts old previews as the expanded catalog is played", async () => {
	vi.resetModules();
	vi.doMock("node:child_process", () => ({
		spawn: () => {
			const decoder = Object.assign(new EventEmitter(), {
				stdin: new PassThrough(),
				stdout: new PassThrough(),
				stderr: new PassThrough(),
			});
			decoder.stdin.resume();
			decoder.stdin.on("finish", () => {
				decoder.stdout.end(Buffer.alloc(480000));
				decoder.emit("close", 0);
			});
			return decoder;
		},
	}));
	const { songPreview: preview } = await import("../src/services/song-preview");
	const fetchPreview = vi.fn(previewFixture);
	vi.stubGlobal("fetch", fetchPreview);
	const tracks = Object.values(songPacks).flat().slice(0, 91);
	for (const [id] of tracks) await preview(id, 2);
	const calls = fetchPreview.mock.calls.length;
	await preview(tracks[0][0], 2);
	expect(fetchPreview.mock.calls.length).toBe(calls + 2);
});

async function freshPreviewService() {
	vi.resetModules();
	vi.doUnmock("node:child_process");
	return import("../src/services/song-preview");
}

it.each([408, 429, 500, 503])(
	"recovers from transient metadata HTTP %i with one retry",
	async (status) => {
		const service = await freshPreviewService();
		let metadataAttempts = 0;
		vi.stubGlobal("fetch", async (url: string | URL) => {
			if (
				String(url).startsWith("https://api.deezer.com/") &&
				++metadataAttempts === 1
			)
				return new Response(null, { status });
			return previewFixture(url);
		});
		const media = await service.songPreview(13141170, 15);
		expect(Buffer.from(media.split(",")[1], "base64").length).toBe(480044);
		expect(metadataAttempts).toBe(2);
	},
);

it("reports exhausted provider timeouts safely and allows a later fresh attempt", async () => {
	const service = await freshPreviewService();
	let attempts = 0;
	const providerError = new DOMException(
		"signed-url?secret=answer",
		"TimeoutError",
	);
	vi.stubGlobal("fetch", async () => {
		attempts++;
		throw providerError;
	});
	const error = await service
		.songPreview(13141170, 2)
		.catch((error: unknown) => error);
	expect(error).toBeInstanceOf(service.SongPreviewError);
	expect(service.describeSongPreviewError(error)).toEqual({
		stage: "metadata",
		code: "PROVIDER_TIMEOUT",
		retryable: true,
	});
	expect(attempts).toBe(2);
	expect(String(error)).not.toContain("secret");
	expect(JSON.stringify(error)).not.toContain("secret");
	vi.stubGlobal("fetch", previewFixture);
	expect(await service.songPreview(13141170, 2)).toMatch(
		/^data:audio\/wav;base64,/,
	);
});

it.each([
	{ error: { code: 800, message: "Unknown track" } },
	{ id: 13141170, preview: "" },
	{ id: 13141170 },
	{ id: 13141170, preview: null },
])("does not retry confirmed unavailable recordings: %j", async (metadata) => {
	const service = await freshPreviewService();
	let attempts = 0;
	vi.stubGlobal("fetch", async () => {
		attempts++;
		return Response.json(metadata);
	});
	const error = await service
		.songPreview(13141170, 2)
		.catch((error: unknown) => error);
	expect(service.describeSongPreviewError(error)).toEqual({
		stage: "metadata",
		code: "TRACK_UNAVAILABLE",
		retryable: false,
	});
	expect(attempts).toBe(1);
});

it("never retries an untrusted preview host", async () => {
	const service = await freshPreviewService();
	let attempts = 0;
	vi.stubGlobal("fetch", async () => {
		attempts++;
		return Response.json({
			id: 13141170,
			preview: "https://evil.example/private?title=answer",
		});
	});
	const error = await service
		.songPreview(13141170, 2)
		.catch((error: unknown) => error);
	expect(service.describeSongPreviewError(error)).toEqual({
		stage: "validation",
		code: "INVALID_PREVIEW",
		retryable: false,
	});
	expect(attempts).toBe(1);
	expect(String(error)).not.toContain("answer");
});

it("recovers from a download network failure with a fresh provider URL", async () => {
	const service = await freshPreviewService();
	let downloads = 0;
	let metadata = 0;
	vi.stubGlobal("fetch", async (url: string | URL) => {
		if (String(url).startsWith("https://api.deezer.com/")) metadata++;
		else if (++downloads === 1) throw new TypeError("Network failed");
		return previewFixture(url);
	});
	expect(await service.songPreview(13141170, 2)).toMatch(
		/^data:audio\/wav;base64,/,
	);
	expect(metadata).toBe(2);
	expect(downloads).toBe(2);
});

it("rejects a short recording even when the requested clue is only two seconds", async () => {
	const service = await freshPreviewService();
	vi.stubGlobal("fetch", async (url: string | URL) =>
		String(url).startsWith("https://api.deezer.com/")
			? previewFixture(url)
			: new Response(songRecording(8)),
	);
	const error = await service
		.songPreview(13141170, 2)
		.catch((error: unknown) => error);
	expect(service.describeSongPreviewError(error)).toEqual({
		stage: "validation",
		code: "TRACK_UNAVAILABLE",
		retryable: false,
	});
});

it("reports corrupt downloaded audio as a decode failure", async () => {
	const service = await freshPreviewService();
	vi.stubGlobal("fetch", async (url: string | URL) =>
		String(url).startsWith("https://api.deezer.com/")
			? previewFixture(url)
			: new Response("not audio"),
	);
	const error = await service
		.songPreview(13141170, 2)
		.catch((error: unknown) => error);
	expect(service.describeSongPreviewError(error)).toEqual({
		stage: "decode",
		code: "DECODE_FAILED",
		retryable: false,
	});
});

it("deduplicates concurrent clue requests for the same recording", async () => {
	const service = await freshPreviewService();
	let metadata = 0;
	vi.stubGlobal("fetch", async (url: string | URL) => {
		if (String(url).startsWith("https://api.deezer.com/")) metadata++;
		return previewFixture(url);
	});
	const clips = await Promise.all([
		service.songPreview(13141170, 2),
		service.songPreview(13141170, 15),
	]);
	expect(
		clips.map((clip) => Buffer.from(clip.split(",")[1], "base64").length),
	).toEqual([64044, 480044]);
	expect(metadata).toBe(1);
});

it("warms at most two recordings concurrently, swallows failures, and caches full clues", async () => {
	const service = await freshPreviewService();
	const ids = Object.values(songPacks)
		.flat()
		.slice(0, 4)
		.map(([id]) => id);
	let active = 0;
	let maxActive = 0;
	let metadata = 0;
	vi.stubGlobal("fetch", async (url: string | URL) => {
		if (String(url).startsWith("https://api.deezer.com/")) {
			metadata++;
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, 10));
			active--;
			if (String(url).endsWith(String(ids[3])))
				return Response.json({ error: { code: 800 } });
		}
		return previewFixture(url);
	});
	await Promise.all([
		service.warmSongPreviews(ids.slice(0, 2)),
		service.warmSongPreviews(ids.slice(2)),
	]);
	expect(maxActive).toBe(2);
	const before = metadata;
	expect(
		Buffer.from((await service.songPreview(ids[0], 15)).split(",")[1], "base64")
			.length,
	).toBe(480044);
	expect(metadata).toBe(before);
});

it("checks playable recordings without populating or evicting the gameplay cache", async () => {
	vi.resetModules();
	vi.doMock("node:child_process", () => ({
		spawn: () => {
			const decoder = Object.assign(new EventEmitter(), {
				stdin: new PassThrough(),
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				kill: vi.fn(),
			});
			decoder.stdin.resume();
			decoder.stdin.on("finish", () => {
				decoder.stdout.end(Buffer.alloc(480000));
				decoder.emit("close", 0);
			});
			return decoder;
		},
	}));
	const service = await import("../src/services/song-preview");
	const recording = songRecording(15);
	const ids = Object.values(songPacks)
		.flat()
		.slice(0, 92)
		.map(([id]) => id);
	const metadataRequests: number[] = [];
	vi.stubGlobal("fetch", async (url: string | URL) => {
		const match = String(url).match(/track\/(\d+)$/);
		if (match) metadataRequests.push(Number(match[1]));
		return match
			? Response.json({
					id: Number(match[1]),
					preview: "https://cdnt-preview.dzcdn.net/test.mp3",
				})
			: new Response(recording);
	});
	await service.songPreview(ids[0], 2);
	await service.checkSongPreview(ids[0]);
	expect(metadataRequests).toEqual([ids[0]]);
	for (const id of ids.slice(1)) await service.checkSongPreview(id);
	await service.songPreview(ids[0], 15);
	expect(metadataRequests.filter((id) => id === ids[0])).toHaveLength(1);
	await service.songPreview(ids[1], 2);
	expect(metadataRequests.filter((id) => id === ids[1])).toHaveLength(2);
	vi.doUnmock("node:child_process");
});

it("retries a provider quota error rather than marking the track permanently unavailable", async () => {
	const service = await freshPreviewService();
	let attempts = 0;
	vi.stubGlobal("fetch", async (url: string | URL) => {
		if (String(url).startsWith("https://api.deezer.com/") && ++attempts === 1)
			return Response.json({ error: { code: 4, message: "Quota exceeded" } });
		return previewFixture(url);
	});
	expect(await service.songPreview(13141170, 2)).toMatch(
		/^data:audio\/wav;base64,/,
	);
	expect(attempts).toBe(2);
});

it("preserves a nonretryable size validation failure if stream cancellation also fails", async () => {
	const service = await freshPreviewService();
	let downloads = 0;
	vi.stubGlobal("fetch", async (url: string | URL) => {
		if (String(url).startsWith("https://api.deezer.com/"))
			return previewFixture(url);
		downloads++;
		return new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(2000001));
				},
				cancel() {
					throw new Error("upstream connection closed");
				},
			}),
		);
	});
	const error = await service
		.songPreview(13141170, 2)
		.catch((error: unknown) => error);
	expect(service.describeSongPreviewError(error)).toEqual({
		stage: "validation",
		code: "INVALID_PREVIEW",
		retryable: false,
	});
	expect(downloads).toBe(1);
});

it("bounds queued prefetch work when a caller submits the whole catalog", async () => {
	vi.resetModules();
	vi.doMock("node:child_process", () => ({
		spawn: () => {
			const decoder = Object.assign(new EventEmitter(), {
				stdin: new PassThrough(),
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				kill: vi.fn(),
			});
			decoder.stdin.resume();
			decoder.stdin.on("finish", () => {
				decoder.stdout.end(Buffer.alloc(480000));
				decoder.emit("close", 0);
			});
			return decoder;
		},
	}));
	const service = await import("../src/services/song-preview");
	const ids = Object.values(songPacks)
		.flat()
		.slice(0, 150)
		.map(([id]) => id);
	let metadata = 0;
	vi.stubGlobal("fetch", async (url: string | URL) => {
		if (String(url).startsWith("https://api.deezer.com/")) metadata++;
		return previewFixture(url);
	});
	await service.warmSongPreviews(ids);
	expect(metadata).toBe(90);
	vi.doUnmock("node:child_process");
});

it.each(
	[
		{},
		null,
		"temporary provider response",
		[],
		{
			id: "13141170",
			preview: "https://cdnt-preview.dzcdn.net/test.mp3?secret=answer",
		},
		{
			id: 540175,
			preview: "https://cdnt-preview.dzcdn.net/test.mp3?secret=answer",
		},
		{ id: 13141170, preview: 42 },
	].map((metadata) => ({ metadata })),
)(
	"does not confirm track unavailability from malformed metadata: %j",
	async ({ metadata }) => {
		const service = await freshPreviewService();
		let attempts = 0;
		vi.stubGlobal("fetch", async () => {
			attempts++;
			return Response.json(metadata);
		});
		const error = await service
			.songPreview(13141170, 2)
			.catch((error: unknown) => error);
		expect(error).toBeInstanceOf(service.SongPreviewError);
		expect(service.describeSongPreviewError(error)).toEqual({
			stage: "metadata",
			code: "PROVIDER_ERROR",
			retryable: true,
		});
		expect(attempts).toBe(2);
		expect(String(error)).not.toContain("answer");
		expect(JSON.stringify(error)).not.toContain("secret");
	},
);

it("reports the decoder watchdog distinctly without retrying the recording", async () => {
	vi.resetModules();
	let decodes = 0;
	vi.doMock("node:child_process", () => ({
		spawn: () => {
			decodes++;
			const decoder = Object.assign(new EventEmitter(), {
				stdin: new PassThrough(),
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				kill: vi.fn(),
			});
			decoder.stdin.resume();
			return decoder;
		},
	}));
	const service = await import("../src/services/song-preview");
	vi.stubGlobal("fetch", previewFixture);
	vi.useFakeTimers();
	try {
		const result = service
			.songPreview(13141170, 2)
			.catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(5000);
		const error = await result;
		expect(service.describeSongPreviewError(error)).toEqual({
			stage: "decode",
			code: "DECODE_TIMEOUT",
			retryable: false,
		});
		expect(decodes).toBe(1);
	} finally {
		vi.useRealTimers();
		vi.doUnmock("node:child_process");
	}
});

it("stops queued warmers, drains active warmers, and supports restarting", async () => {
	const service = await freshPreviewService();
	const ids = Object.values(songPacks)
		.flat()
		.slice(0, 8)
		.map(([id]) => id);
	let release: () => void = () => {};
	let notifyStarted: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const started = new Promise<void>((resolve) => {
		notifyStarted = resolve;
	});
	const requested: number[] = [];
	vi.stubGlobal("fetch", async (url: string | URL) => {
		const match = String(url).match(/track\/(\d+)$/);
		if (match) {
			requested.push(Number(match[1]));
			if (requested.length === 2) notifyStarted();
			await gate;
		}
		return previewFixture(url);
	});
	const warming = service.warmSongPreviews(ids);
	await started;
	let drained = false;
	const stopping = service.stopSongPreviewWarming().then(() => {
		drained = true;
	});
	await service.warmSongPreviews([ids[7]]);
	expect(drained).toBe(false);
	release();
	await Promise.all([warming, stopping]);
	expect(requested).toEqual(ids.slice(0, 2));
	expect(drained).toBe(true);
	expect(await service.songPreview(ids[2], 2)).toMatch(
		/^data:audio\/wav;base64,/,
	);
	await service.warmSongPreviews([ids[3]]);
	expect(requested).toEqual(ids.slice(0, 3));
	service.startSongPreviewWarming();
	await service.warmSongPreviews([ids[3]]);
	expect(requested).toEqual(ids.slice(0, 4));
});

it("does not revive old queued warmers when restarted before shutdown drains", async () => {
	const service = await freshPreviewService();
	const ids = Object.values(songPacks)
		.flat()
		.slice(0, 6)
		.map(([id]) => id);
	let release: () => void = () => {};
	let notifyStarted: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const started = new Promise<void>((resolve) => {
		notifyStarted = resolve;
	});
	const requested: number[] = [];
	vi.stubGlobal("fetch", async (url: string | URL) => {
		const match = String(url).match(/track\/(\d+)$/);
		if (match) {
			requested.push(Number(match[1]));
			if (requested.length === 2) notifyStarted();
			await gate;
		}
		return previewFixture(url);
	});
	const oldWarming = service.warmSongPreviews(ids);
	await started;
	const stopping = service.stopSongPreviewWarming();
	service.startSongPreviewWarming();
	const newWarming = service.warmSongPreviews([ids[2]]);
	release();
	await Promise.all([oldWarming, newWarming, stopping]);
	expect(requested).toEqual(ids.slice(0, 3));
});
