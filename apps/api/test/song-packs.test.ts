import { expect, it } from "vitest";
import { catalog } from "../src/services/puzzle-catalog";
import { songPacks } from "../src/services/song-packs";

it("offers 100 distinct K-pop recordings and at least 100 animal trivia questions", () => {
	expect(songPacks.kpop).toHaveLength(100);
	expect(new Set(songPacks.kpop.map((t) => t[0])).size).toBe(100);
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
