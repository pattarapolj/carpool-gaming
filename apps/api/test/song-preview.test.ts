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
