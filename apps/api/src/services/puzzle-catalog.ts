import { deflateSync } from "node:zlib";
import type {
	PuzzleFormat,
	PuzzleView,
} from "../../../../packages/contracts/src/puzzles";

type Entry = {
	id: string;
	name: string;
	aliases: string[];
	attributes?: Record<string, string[]>;
	icon?: number;
	notes?: number[];
};
export type Puzzle = {
	id: string;
	theme: string;
	format: PuzzleFormat;
	answerId: string;
	prompt: string;
};
const characters: Entry[] = [
	// shortcut: Array positions are persistent IDs; append entries, or migrate IDs before reordering.
	["Naruto Uzumaki", "Male", "Leaf", "Team 7", "Wind", "naruto"],
	["Sasuke Uchiha", "Male", "Leaf", "Team 7", "Fire,Lightning", "sasuke"],
	["Sakura Haruno", "Female", "Leaf", "Team 7", "Medical", "sakura"],
	["Kakashi Hatake", "Male", "Leaf", "Team 7", "Lightning", "kakashi"],
	["Hinata Hyuga", "Female", "Leaf", "Team 8", "Byakugan", "hinata"],
	["Shino Aburame", "Male", "Leaf", "Team 8", "Insects", "shino"],
	["Kiba Inuzuka", "Male", "Leaf", "Team 8", "Canine", "kiba"],
	["Shikamaru Nara", "Male", "Leaf", "Team 10", "Shadow", "shikamaru"],
	["Ino Yamanaka", "Female", "Leaf", "Team 10", "Mind", "ino"],
	["Choji Akimichi", "Male", "Leaf", "Team 10", "Expansion", "choji"],
	["Rock Lee", "Male", "Leaf", "Team Guy", "Taijutsu", "lee"],
	["Neji Hyuga", "Male", "Leaf", "Team Guy", "Byakugan", "neji"],
	["Tenten", "Female", "Leaf", "Team Guy", "Weapons", "tenten"],
	["Gaara", "Male", "Sand", "Sand siblings", "Sand", "gaara"],
	["Temari", "Female", "Sand", "Sand siblings", "Wind", "temari"],
	["Kankuro", "Male", "Sand", "Sand siblings", "Puppets", "kankuro"],
].map(([name, gender, village, team, skill, alias], i) => ({
	id: `character-${i}`,
	name,
	aliases: [
		alias,
		name
			.replaceAll("Hyuga", "Hyūga")
			.replaceAll("Choji", "Chōji")
			.replaceAll("Kankuro", "Kankurō"),
	],
	attributes: {
		Gender: [gender],
		Village: [village],
		"Original team": [team],
		"Signature skills": skill.split(","),
	},
}));
const animals: Entry[] = [
	"Cat",
	"Dog",
	"Fox",
	"Rabbit",
	"Panda",
	"Bear",
	"Owl",
	"Frog",
].map((name, i) => ({
	id: `animal-${i}`,
	name,
	aliases: name === "Rabbit" ? ["Bunny"] : name === "Dog" ? ["Puppy"] : [],
	icon: i,
}));
// Original synthesized arrangements, no recordings or external media requests.
const songs: Entry[] = [
	{
		id: "song-0",
		name: "Twinkle Twinkle Little Star",
		aliases: ["Alphabet song", "ABC song"],
		notes: [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60],
	},
	{
		id: "song-1",
		name: "Mary Had a Little Lamb",
		aliases: ["Mary"],
		notes: [64, 62, 60, 62, 64, 64, 64, 62, 62, 62, 64, 67, 67],
	},
	{
		id: "song-2",
		name: "Frère Jacques",
		aliases: ["Frere Jacques", "Brother John"],
		notes: [60, 62, 64, 60, 60, 62, 64, 60, 64, 65, 67, 64, 65, 67],
	},
	{
		id: "song-3",
		name: "Ode to Joy",
		aliases: ["Beethoven"],
		notes: [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62],
	},
	{
		id: "song-4",
		name: "Row Row Row Your Boat",
		aliases: ["Row your boat"],
		notes: [60, 60, 60, 62, 64, 64, 62, 64, 65, 67, 72, 72, 72, 67, 67, 67],
	},
	{
		id: "song-5",
		name: "Old MacDonald Had a Farm",
		aliases: ["Old MacDonald", "Old McDonald"],
		notes: [67, 67, 67, 62, 64, 64, 62, 71, 71, 69, 69, 67],
	},
	{
		id: "song-6",
		name: "London Bridge Is Falling Down",
		aliases: ["London Bridge"],
		notes: [67, 69, 67, 65, 64, 65, 67, 62, 64, 65, 64, 65, 67],
	},
	{
		id: "song-7",
		name: "Jingle Bells",
		aliases: [],
		notes: [
			64, 64, 64, 64, 64, 64, 64, 67, 60, 62, 64, 65, 65, 65, 65, 65, 64, 64,
		],
	},
	{
		id: "song-8",
		name: "When the Saints Go Marching In",
		aliases: ["The Saints"],
		notes: [60, 64, 65, 67, 60, 64, 65, 67, 60, 64, 65, 67, 64, 60, 64, 62],
	},
	{
		id: "song-9",
		name: "Amazing Grace",
		aliases: [],
		notes: [60, 65, 69, 65, 69, 67, 65, 62, 60, 60, 65, 69, 65, 67],
	},
];
export const entries: Record<string, Entry[]> = {
	naruto: characters,
	animals,
	melodies: songs,
};
const animalPrompts = [
	"Which animal purrs and retracts its claws?",
	"Which animal is famous for barking?",
	"Which animal has a bushy tail and is often called cunning?",
	"Which animal has long ears and hops?",
	"Which black-and-white bear mainly eats bamboo?",
	"Which large, shaggy mammal is associated with hibernation?",
	"Which bird has large forward-facing eyes and a reputation for hooting?",
	"Which amphibian starts life as a tadpole?",
];
export const catalog: Puzzle[] = [
	...characters.map((e) => ({
		id: `detect-${e.id}`,
		theme: "naruto",
		format: "CHARACTER" as const,
		answerId: e.id,
		prompt:
			"Find the Naruto character. Each guess compares their original team and signature skills.",
	})),
	...animals.flatMap((e, i) => [
		{
			id: `picture-${e.id}`,
			theme: "animals",
			format: "PICTURE" as const,
			answerId: e.id,
			prompt:
				"Which animal is in this picture? Wrong guesses reveal more detail.",
		},
		{
			id: `trivia-${e.id}`,
			theme: "animals",
			format: "TRIVIA" as const,
			answerId: e.id,
			prompt: animalPrompts[i],
		},
	]),
	...songs.map((e) => ({
		id: `music-${e.id}`,
		theme: "melodies",
		format: "MUSIC" as const,
		answerId: e.id,
		prompt: "Name this melody. Wrong guesses unlock a longer clip.",
	})),
];
export function feedback(
	puzzle: Puzzle,
	answerId: string,
): NonNullable<PuzzleView["puzzle"]>["guesses"][number] {
	const roster = entries[puzzle.theme];
	const guess = roster.find((e) => e.id === answerId);
	const target = roster.find((e) => e.id === puzzle.answerId);
	if (!guess || !target) throw new Error("Invalid catalog answer");
	return {
		name: guess.name,
		correct: guess.id === target.id,
		feedback:
			puzzle.format === "CHARACTER"
				? Object.entries(guess.attributes ?? {}).map(([attribute, values]) => {
						const expected = target.attributes?.[attribute] ?? [];
						const common = values.filter((v) => expected.includes(v)).length;
						return {
							attribute,
							value: values.join(", "),
							match:
								common === values.length && common === expected.length
									? ("MATCH" as const)
									: common > 0
										? ("PARTIAL" as const)
										: ("MISS" as const),
						};
					})
				: [],
	};
}

export function clueMedia(puzzle: Puzzle, mistakes: number) {
	const target = entries[puzzle.theme].find((e) => e.id === puzzle.answerId);
	if (puzzle.format === "PICTURE" && target?.icon !== undefined)
		return animalPng(target.icon, mistakes);
	if (puzzle.format === "MUSIC" && target?.notes)
		return melodyWav(target.notes, mistakes);
	return null;
}

function melodyWav(notes: number[], mistakes: number) {
	const rate = 8000;
	const duration = 0.32;
	const audible = notes.slice(0, Math.min(notes.length, 3 + mistakes * 3));
	const samples = Math.ceil(audible.length * duration * rate);
	const wav = Buffer.alloc(44 + samples * 2);
	wav.write("RIFF");
	wav.writeUInt32LE(36 + samples * 2, 4);
	wav.write("WAVEfmt ", 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(rate, 24);
	wav.writeUInt32LE(rate * 2, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i++) {
		const position = i / rate / duration;
		const note = audible[Math.min(audible.length - 1, Math.floor(position))];
		const within = position % 1;
		const envelope = Math.min(1, within * 20) * Math.max(0, 1 - within);
		wav.writeInt16LE(
			Math.round(
				Math.sin((2 * Math.PI * 440 * 2 ** ((note - 69) / 12) * i) / rate) *
					9000 *
					envelope,
			),
			44 + i * 2,
		);
	}
	return `data:audio/wav;base64,${wav.toString("base64")}`;
}

// Rasterize original animal faces at progressively finer resolution. The full
// image and target name never travel inside an earlier clue's PNG metadata.
function animalPng(icon: number, mistakes: number) {
	const size = [8, 12, 20, 32, 64][Math.min(4, mistakes)];
	const raw = Buffer.alloc((size * 3 + 1) * size);
	const colors = [
		[218, 161, 70],
		[157, 100, 57],
		[226, 113, 40],
		[229, 204, 195],
		[244, 244, 232],
		[128, 84, 55],
		[153, 102, 56],
		[107, 174, 83],
	];
	const face = colors[icon];
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const px = (x + 0.5) / size;
			const py = (y + 0.5) / size;
			let color = [246, 241, 231];
			const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
				((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1;
			if (ellipse(0.5, 0.56, 0.35, 0.32)) color = face;
			if (
				icon === 3 &&
				(ellipse(0.32, 0.22, 0.09, 0.21) || ellipse(0.68, 0.22, 0.09, 0.21))
			)
				color = face;
			else if (
				(icon === 0 || icon === 2 || icon === 6) &&
				py >= 0.12 &&
				py < 0.4 &&
				(Math.abs(px - 0.25) < (py - 0.12) * 0.5 ||
					Math.abs(px - 0.75) < (py - 0.12) * 0.5)
			)
				color = face;
			else if (
				icon === 1 &&
				(ellipse(0.18, 0.48, 0.09, 0.27) || ellipse(0.82, 0.48, 0.09, 0.27))
			)
				color = [86, 56, 38];
			else if (
				(icon === 4 || icon === 5) &&
				(ellipse(0.25, 0.27, 0.11, 0.11) || ellipse(0.75, 0.27, 0.11, 0.11))
			)
				color = icon === 4 ? [35, 35, 35] : face;
			if (
				icon === 4 &&
				(ellipse(0.36, 0.48, 0.11, 0.13) || ellipse(0.64, 0.48, 0.11, 0.13))
			)
				color = [35, 35, 35];
			if (
				icon === 6 &&
				(ellipse(0.35, 0.49, 0.14, 0.16) || ellipse(0.65, 0.49, 0.14, 0.16))
			)
				color = [245, 225, 170];
			if (
				icon === 7 &&
				(ellipse(0.29, 0.32, 0.12, 0.12) || ellipse(0.71, 0.32, 0.12, 0.12))
			)
				color = face;
			const eyeY = icon === 7 ? 0.32 : 0.49;
			if (
				ellipse(icon === 7 ? 0.29 : 0.36, eyeY, 0.03, 0.04) ||
				ellipse(icon === 7 ? 0.71 : 0.64, eyeY, 0.03, 0.04) ||
				(icon !== 7 && ellipse(0.5, 0.63, 0.055, 0.035))
			)
				color = [30, 30, 30];
			if (icon === 7 && py > 0.65 && py < 0.67 && px > 0.35 && px < 0.65)
				color = [30, 30, 30];
			const offset = y * (size * 3 + 1) + 1 + x * 3;
			color.forEach((v, channel) => {
				raw[offset + channel] = v;
			});
		}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size);
	header.writeUInt32BE(size, 4);
	header[8] = 8;
	header[9] = 2;
	const png = Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
	return `data:image/png;base64,${png.toString("base64")}`;
}
function chunk(type: string, data: Buffer) {
	const body = Buffer.concat([Buffer.from(type), data]);
	let crc = 0xffffffff;
	for (const byte of body) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	const output = Buffer.alloc(body.length + 8);
	output.writeUInt32BE(data.length);
	body.copy(output, 4);
	output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4);
	return output;
}
