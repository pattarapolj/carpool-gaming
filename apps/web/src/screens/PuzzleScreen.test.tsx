// @vitest-environment jsdom

import type { PuzzleView } from "@carpool/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { gameSnapshot } from "../test/game-fixtures";
import { PuzzleScreen } from "./PuzzleScreen";

const roundId = "a6775a41-50ab-4d61-b1fa-f9f07a28c62b";
const view: PuzzleView = {
	round: {
		id: roundId,
		sequence: 1,
		theme: "naruto",
		format: "CHARACTER",
		status: "OPEN",
		startsAt: new Date().toISOString(),
		endsAt: new Date(Date.now() + 300000).toISOString(),
		total: 16,
	},
	solved: 0,
	puzzle: {
		id: "detect-character-0",
		number: 1,
		prompt: "Find the character",
		media: null,
		guesses: [],
	},
	skipped: [{ id: "detect-character-1", number: 2 }],
	options: [
		{ id: "character-0", name: "Naruto Uzumaki", aliases: ["Naruto"] },
		{ id: "character-1", name: "Sasuke Uchiha", aliases: ["Sasuke"] },
	],
	results: [],
	selection: { theme: null, themeTeamId: null, formatTeamId: null },
};
afterEach(cleanup);
function show(puzzles = view, act = vi.fn(async () => true)) {
	const snapshot = { ...gameSnapshot(), puzzles };
	render(
		<PuzzleScreen
			snapshot={snapshot}
			receivedAt={performance.now()}
			onAction={act}
			busy={false}
			disconnected={false}
		/>,
	);
	return act;
}
it("uses canonical suggestions instead of submitting misspelled text", async () => {
	const act = show();
	fireEvent.change(screen.getByLabelText("Search answers"), {
		target: { value: "Naru" },
	});
	expect(
		(screen.getByRole("button", { name: "Guess" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "Naruto Uzumaki" }));
	fireEvent.click(screen.getByRole("button", { name: "Guess" }));
	expect(act).toHaveBeenCalledWith({
		kind: "guess",
		roundId,
		puzzleId: "detect-character-0",
		answerId: "character-0",
	});
});
it("offers skipped puzzles and sends a revisit without granting clues", () => {
	const act = show();
	fireEvent.click(screen.getByRole("button", { name: "Revisit puzzle 2" }));
	expect(act).toHaveBeenCalledWith({
		kind: "revisit",
		roundId,
		puzzleId: "detect-character-1",
	});
});

it("preserves the selected answer after a failed submission", async () => {
	const act = vi.fn(async () => false);
	show(view, act);
	fireEvent.change(screen.getByLabelText("Search answers"), {
		target: { value: "Naruto" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Guess" }));
	await screen.findByDisplayValue("Naruto");
	expect(
		(screen.getByRole("button", { name: "Guess" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
});
it("keeps feedback readable without color", () => {
	if (!view.puzzle) throw new Error("Missing fixture puzzle");
	const puzzle = {
		...view.puzzle,
		guesses: [
			{
				name: "Sasuke Uchiha",
				correct: false,
				feedback: [
					{
						attribute: "Original team",
						value: "Team 7",
						match: "MATCH" as const,
					},
				],
			},
		],
	};
	show({ ...view, puzzle });
	expect(screen.getByText("Original team: Team 7 — Match")).toBeTruthy();
});
it("lets only the assigned car choose a supported format after the theme", () => {
	const snapshot = gameSnapshot();
	if (!snapshot.callerTeam) throw new Error("Missing fixture team");
	const puzzles = {
		...view,
		puzzle: null,
		round: { ...view.round, status: "RESULTS" as const },
		results: [
			{
				teamId: snapshot.callerTeam.id,
				name: "Blue Sedan",
				solved: 0,
				rank: 1,
			},
		],
		selection: {
			themeTeamId: snapshot.callerTeam.id,
			formatTeamId: snapshot.callerTeam.id,
			theme: "animals" as const,
		},
	};
	show(puzzles);
	expect(screen.getByRole("button", { name: "Picture reveal" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Guess the melody" })).toBeNull();
});
