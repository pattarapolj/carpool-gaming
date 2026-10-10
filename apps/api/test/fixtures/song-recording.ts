export function songRecording(seconds = 30) {
	const wav = Buffer.alloc(44 + seconds * 32000);
	wav.write("RIFF");
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write("WAVEfmt ", 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(16000, 24);
	wav.writeUInt32LE(32000, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(wav.length - 44, 40);
	for (let i = 44; i < wav.length; i += 2)
		wav.writeInt16LE(Math.round(Math.sin(i / 20) * 10000), i);
	return wav;
}

export async function previewFixture(url: string | URL | Request) {
	const metadata = String(url).match(
		/^https:\/\/api\.deezer\.com\/track\/(\d+)$/,
	);
	return metadata
		? Response.json({
				id: Number(metadata[1]),
				preview: "https://cdnt-preview.dzcdn.net/test.mp3",
			})
		: new Response(songRecording());
}
