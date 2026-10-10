import { spawn } from "node:child_process";
import { entries } from "./puzzle-catalog";

// Keep decoded audio below about 43 MB as the catalog grows.
const cache = new Map<number, { expires: number; pcm: Promise<Buffer> }>();

export async function songPreview(trackId: number, seconds: number) {
	if (
		!Object.values(entries).some((pack) =>
			pack.some((entry) => entry.trackId === trackId),
		) ||
		![2, 4, 8, 15].includes(seconds)
	)
		throw new Error("Invalid song clue");
	let cached = cache.get(trackId);
	if (!cached || cached.expires <= Date.now()) {
		if (cache.size >= 90) {
			const oldest = cache.keys().next().value;
			if (oldest !== undefined) cache.delete(oldest);
		}
		const pcm = loadPreview(trackId).catch((error) => {
			if (cache.get(trackId)?.pcm === pcm) cache.delete(trackId);
			throw error;
		});
		cached = { expires: Date.now() + 3600000, pcm };
		cache.set(trackId, cached);
	}
	const pcm = (await cached.pcm).subarray(0, seconds * 16000 * 2);
	if (pcm.length < seconds * 16000 * 2) throw new Error("Preview is too short");
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

async function loadPreview(trackId: number) {
	const signal = AbortSignal.timeout(8000);
	const metadata = await fetch(`https://api.deezer.com/track/${trackId}`, {
		signal,
		redirect: "error",
	});
	if (!metadata.ok) throw new Error("Song metadata unavailable");
	const track = (await metadata.json()) as { preview?: unknown; id?: unknown };
	if (track.id !== trackId || typeof track.preview !== "string")
		throw new Error("Song preview unavailable");
	const url = new URL(track.preview);
	if (
		url.protocol !== "https:" ||
		url.hostname !== "cdnt-preview.dzcdn.net" ||
		url.port ||
		url.username ||
		url.password
	)
		throw new Error("Invalid preview host");
	const audio = await fetch(url, { signal, redirect: "error" });
	if (!audio.ok || !audio.body) throw new Error("Song preview unavailable");
	const reader = audio.body.getReader();
	const chunks: Buffer[] = [];
	let size = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > 2000000) throw new Error("Preview is too large");
			chunks.push(Buffer.from(value));
		}
	} finally {
		await reader.cancel();
	}
	return new Promise<Buffer>((resolve, reject) => {
		const decoder = spawn(
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
			{ windowsHide: true, timeout: 5000 },
		);
		const output: Buffer[] = [];
		let bytes = 0;
		decoder.stdout.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > 480000) {
				decoder.kill();
				reject(new Error("Invalid decoded preview"));
			} else output.push(chunk);
		});
		decoder.stderr.resume();
		decoder.on("error", reject);
		// FFmpeg closes input once the 15-second cut is decoded; the remaining preview is unnecessary.
		decoder.stdin.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code !== "EPIPE" && error.code !== "EOF") reject(error);
		});
		decoder.on("close", (code) =>
			code === 0
				? resolve(Buffer.concat(output))
				: reject(new Error("Cannot decode song preview")),
		);
		decoder.stdin.end(Buffer.concat(chunks));
	});
}
