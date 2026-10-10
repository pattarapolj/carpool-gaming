import { expect, it } from "vitest";
import { songPacks } from "../src/services/song-packs";

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
