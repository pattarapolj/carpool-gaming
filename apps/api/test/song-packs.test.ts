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
