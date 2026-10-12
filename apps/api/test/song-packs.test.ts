import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { catalog } from "../src/services/puzzle-catalog";
import { songPacks } from "../src/services/song-packs";

it.each(["melodies", "songs-2000s", "songs-2010s", "songs-2020s"] as const)(
	"offers exactly 300 distinct recordings in %s",
	(theme) => {
		const pack = songPacks[theme];
		expect(pack).toHaveLength(300);
		expect(new Set(pack.map(([id]) => id)).size).toBe(pack.length);
		expect(
			new Set(
				pack.map(
					([, title, artist]) =>
						`${title.toLowerCase()}/${artist.toLowerCase()}`,
				),
			).size,
		).toBe(pack.length);
	},
);

it("covers Imagine Dragons albums, early EPs, bonus tracks and standalone singles", () => {
	const pack = songPacks["imagine-dragons"];
	expect(pack.length).toBeGreaterThan(100);
	for (const title of [
		"Tiptoe",
		"Smoke And Mirrors",
		"Dancing In The Dark",
		"Bullet In A Gun",
		"My Life",
		"They Don't Know You Like I Do",
		"Fire in These Hills",
		"Drive",
		"All Eyes",
		"Leave Me",
		"Woke",
		"Children of the Sky",
		"Roots",
	])
		expect(
			pack.some(([, name]) =>
				name.toLowerCase().startsWith(title.toLowerCase()),
			),
		).toBe(true);
});

it("offers 300 distinct K-pop recordings and at least 100 animal trivia questions", () => {
	expect(songPacks.kpop).toHaveLength(300);
	expect(new Set(songPacks.kpop.map((t) => t[0])).size).toBe(300);
	expect(
		new Set(songPacks.kpop.map(([, title, artist]) => `${title}/${artist}`))
			.size,
	).toBe(300);
	expect(
		new Set(songPacks.kpop.map(([, , artist]) => artist)).size,
	).toBeGreaterThanOrEqual(20);
	const trivia = catalog.filter(
		(p) => p.theme === "animals" && p.format === "TRIVIA",
	);
	expect(trivia.length).toBeGreaterThanOrEqual(100);
	expect(new Set(trivia.map((p) => p.id)).size).toBe(trivia.length);
	expect(new Set(trivia.map((p) => p.prompt)).size).toBe(trivia.length);
});

it.each([
	[
		"ed-sheeran",
		[
			"Autumn Leaves",
			"Tenerife Sea",
			"Barcelona",
			"Beautiful People",
			"Tides",
			"Boat",
			"Magical",
			"Sapphire",
			"Afterglow",
		],
	],
	[
		"taylor-swift",
		[
			"Tim McGraw",
			"Fifteen",
			"Enchanted",
			"State Of Grace",
			"Welcome To New York",
			"Getaway Car",
			"Cornelia Street",
			"the lakes",
			"right where you left me",
			"Would've, Could've, Should've",
			"The Manuscript",
			"The Fate of Ophelia",
			"Mr. Perfectly Fine",
			"All Too Well (10 Minute Version)",
			"I Can See You",
			"Is It Over Now?",
		],
	],
	["adele", ["Chasing Pavements", "Someone Like You", "Hello", "Easy On Me"]],
	[
		"imagine-dragons",
		["Radioactive", "Demons", "Believer", "Thunder", "Enemy"],
	],
] as const)("includes album tracks in %s", (theme, titles) => {
	const pack = songPacks[theme as keyof typeof songPacks];
	for (const title of titles)
		expect(
			pack.some((track) =>
				track[1].toLowerCase().startsWith(title.toLowerCase()),
			),
		).toBe(true);
	expect(new Set(pack.map((track) => track[0])).size).toBe(pack.length);
});

const curatedCounts = {
	"hit-songs": 300,
	"pop-hits": 150,
	"rock-hits": 100,
	"dance-edm": 100,
} as const;
const legacyFingerprints = {
	kpop: "778e50008697dfec048416e0f661ffc1265b7bc287dacf59440a30a294872ddb",
	melodies: "01cead31f8b3b3afd1892601cfc2e2a848998251bcb3e67766dff1d99a375bad",
	"taylor-swift":
		"2a04fa6cb54095809d6c478397e6748faa4bcda67783dba186a408741b61cf90",
	"ed-sheeran":
		"bd5fe32e70da0f872514ac7a8f801cadd3f6d77f7a11df38c70f9a2e4df020bd",
	adele: "a38c940b6847f9764e4197166be8c7c66801668fa3aaf7c82e12f2f97a01dfa6",
	"imagine-dragons":
		"0cd9efe630a48b4dd753f52e654df4426c4c07e36316762cde09bde0110bd4bc",
	"songs-2000s":
		"4ef6a59d184cc5909c649105fce2fb8e677cb81425a2a060cf72ce66132abb22",
	"songs-2010s":
		"f1bce547dde403d36610ea988499d87dae40ea3658e95aec501705083fd7b1ba",
	"songs-2020s":
		"852d7f46dcc70917e6d8a768236cf13d6fe57a5deb77cc4009909c62a37be19d",
} as const;

it("preserves every existing recording and persistent answer position", () => {
	for (const [theme, fingerprint] of Object.entries(legacyFingerprints)) {
		const pack = songPacks[theme as keyof typeof songPacks];
		expect(
			createHash("sha256").update(JSON.stringify(pack)).digest("hex"),
		).toBe(fingerprint);
	}
});

it.each(Object.entries(curatedCounts))(
	"offers %s as a distinct curated music pack",
	(theme, count) => {
		const packs: Record<
			string,
			readonly (readonly [number, string, string])[]
		> = songPacks;
		const pack = packs[theme];
		expect(pack).toHaveLength(count);
		const source = new Map<number, readonly [number, string, string]>();
		for (const key of Object.keys(legacyFingerprints))
			for (const recording of packs[key]) source.set(recording[0], recording);
		const normalized = pack.map(
			([, title, artist]) =>
				`${title
					.toLowerCase()
					.replace(/\([^)]*\)/g, "")
					.replace(
						/[^a-z0-9]/g,
						"",
					)}/${artist.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
		);
		expect(new Set(pack.map(([id]) => id)).size).toBe(count);
		expect(new Set(normalized).size).toBe(count);
		for (const recording of pack)
			expect(recording).toEqual(source.get(recording[0]));
		const puzzles = catalog.filter(
			(p) => p.theme === theme && p.format === "MUSIC",
		);
		expect(puzzles).toHaveLength(count);
		expect(new Set(puzzles.map((p) => p.id)).size).toBe(count);
	},
);

it.each([
	[
		"hit-songs",
		[
			"Toxic",
			"Uptown Funk",
			"Rolling in the Deep",
			"Shape of You",
			"Flowers",
			"Espresso",
		],
	],
	["pop-hits", ["I Want It That Way", "Blank Space", "Espresso"]],
	[
		"rock-hits",
		["Smells Like Teen Spirit", "In the End", "Mr. Brightside", "Wonderwall"],
	],
	["dance-edm", ["Wake Me Up", "Titanium (feat. Sia)", "Summer", "Faded"]],
] as const)("includes recognizable singles in %s", (theme, titles) => {
	const packs: Record<string, readonly (readonly [number, string, string])[]> =
		songPacks;
	for (const title of titles)
		expect(packs[theme]?.some(([, name]) => name === title)).toBe(true);
});
