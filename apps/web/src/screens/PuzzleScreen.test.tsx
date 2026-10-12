// @vitest-environment jsdom

import type { PuzzleView } from "@carpool/contracts";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { gameSnapshot, session } from "../test/game-fixtures";
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
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
it("keeps supporting lists collapsed and accessible during play", () => {
	show();
	for (const label of ["Leaderboard", "Skipped puzzles (1)"]) {
		const summary = screen.getByText(label, { selector: "summary" });
		expect(summary.closest("details")?.open).toBe(false);
		fireEvent.click(summary);
		expect(summary.closest("details")?.open).toBe(true);
	}
});
it("opens the latest guess feedback while keeping older feedback expandable", () => {
	if (!view.puzzle) throw new Error("Missing fixture puzzle");
	show({
		...view,
		puzzle: {
			...view.puzzle,
			guesses: [
				{ name: "Older guess", correct: false, feedback: [] },
				{ name: "Latest guess", correct: false, feedback: [] },
			],
		},
	});
	expect(screen.getByText("Older guess").closest("details")?.open).toBe(false);
	expect(screen.getByText("Latest guess").closest("details")?.open).toBe(true);
});
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

it("offers give up and reveal in music mode instead of skip", () => {
	const act = show({
		...view,
		round: { ...view.round, theme: "kpop", format: "MUSIC" },
	});
	expect(screen.queryByRole("button", { name: "Skip puzzle" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Give up & reveal" }));
	expect(act).toHaveBeenCalledWith({
		kind: "give-up",
		roundId,
		puzzleId: view.puzzle?.id,
	});
});

it("keeps a revealed song visible with zero points until Next song", () => {
	if (!view.puzzle) throw new Error("Missing fixture puzzle");
	const act = show({
		...view,
		round: { ...view.round, theme: "kpop", format: "MUSIC" },
		puzzle: { ...view.puzzle, revealedAnswer: "Dynamite — BTS" },
	});
	expect(screen.getByText("Dynamite — BTS")).toBeTruthy();
	expect(screen.getByText(/0 points/)).toBeTruthy();
	expect(screen.queryByLabelText("Search answers")).toBeNull();
	expect(screen.queryByRole("button", { name: "Guess" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Give up & reveal" })).toBeNull();
	expect(act).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Next song" }));
	expect(act).toHaveBeenCalledWith({
		kind: "next",
		roundId,
		puzzleId: view.puzzle.id,
	});
});
it("shows answer suggestions only while searching for an unselected answer", () => {
	show();
	expect(screen.queryByRole("button", { name: "Naruto Uzumaki" })).toBeNull();
	fireEvent.change(screen.getByLabelText("Search answers"), {
		target: { value: "Naru" },
	});
	const suggestion = screen.getByRole("button", { name: "Naruto Uzumaki" });
	suggestion.focus();
	fireEvent.click(suggestion);
	expect(document.activeElement).toBe(screen.getByLabelText("Search answers"));
	expect(screen.queryByRole("button", { name: "Naruto Uzumaki" })).toBeNull();
	expect(
		(screen.getByRole("button", { name: "Guess" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
});
it("does not offer a revisit button for the puzzle already being played", () => {
	if (!view.puzzle) throw new Error("Missing fixture puzzle");
	show({ ...view, skipped: [{ id: view.puzzle.id, number: 1 }] });
	expect(screen.queryByRole("button", { name: "Revisit puzzle 1" })).toBeNull();
});

it("keeps songs by the same artist ambiguous until a title is chosen", () => {
	show({
		...view,
		options: [
			{
				id: "taylor-1",
				name: "Blank Space — Taylor Swift",
				aliases: ["Blank Space", "Taylor Swift"],
			},
			{
				id: "taylor-2",
				name: "Cruel Summer — Taylor Swift",
				aliases: ["Cruel Summer", "Taylor Swift"],
			},
		],
	});
	fireEvent.change(screen.getByLabelText("Search answers"), {
		target: { value: "Taylor Swift" },
	});
	expect(
		screen.getByRole("button", { name: "Blank Space — Taylor Swift" }),
	).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Cruel Summer — Taylor Swift" }),
	).toBeTruthy();
	expect(
		(screen.getByRole("button", { name: "Guess" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	fireEvent.click(
		screen.getByRole("button", { name: "Cruel Summer — Taylor Swift" }),
	);
	expect(
		(screen.getByRole("button", { name: "Guess" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
});
it("shows one final score list when a puzzle game completes", () => {
	render(
		<PuzzleScreen
			snapshot={{
				...gameSnapshot(),
				game: { ...gameSnapshot().game, status: "COMPLETE" },
				puzzles: {
					...view,
					round: { ...view.round, status: "RESULTS" },
					puzzle: null,
				},
			}}
			receivedAt={performance.now()}
			onAction={vi.fn(async () => true)}
			busy={false}
			disconnected={false}
		/>,
	);
	expect(screen.getAllByRole("list")).toHaveLength(1);
	expect(
		screen.getByRole("heading", { name: "Final leaderboard" }),
	).toBeTruthy();
});
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
	fireEvent.click(
		screen.getByText("Skipped puzzles (1)", { selector: "summary" }),
	);
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
	expect(screen.queryByRole("button", { name: "Guess the Song" })).toBeNull();
});

it("lets passengers retry a failed song clip without losing the puzzle", async () => {
	let attempts = 0;
	vi.stubGlobal("fetch", async () =>
		++attempts === 1
			? Response.json(
					{
						error: {
							code: "CLIP_UNAVAILABLE",
							message: "Song clip unavailable. Retry or skip this puzzle.",
						},
					},
					{ status: 503 },
				)
			: Response.json({ media: "data:audio/wav;base64,UklGRg==" }),
	);
	if (!view.puzzle) throw new Error("Missing fixture puzzle");
	const music: PuzzleView = {
		...view,
		round: { ...view.round, theme: "melodies", format: "MUSIC" },
		puzzle: { ...view.puzzle, media: "song-clip:2" },
	};
	const { container } = render(
		<PuzzleScreen
			session={{
				gameId: gameSnapshot().game.id,
				role: "HOST",
				token: "test-token",
			}}
			snapshot={{ ...gameSnapshot(), puzzles: music }}
			receivedAt={performance.now()}
			onAction={vi.fn(async () => true)}
			busy={false}
			disconnected={false}
		/>,
	);
	await screen.findByRole("alert");
	fireEvent.click(screen.getByRole("button", { name: "Retry song clip" }));
	await screen.findByText("Your browser cannot play this clip.");
	expect(container.querySelector("audio")?.getAttribute("src")).toBe(
		"data:audio/wav;base64,UklGRg==",
	);
	expect(screen.getByRole("button", { name: "Give up & reveal" })).toBeTruthy();
});

function musicView(media = "song-clip:2"): PuzzleView {
	if (!view.puzzle) throw new Error("Missing fixture puzzle");
	return {
		...view,
		round: { ...view.round, theme: "melodies", format: "MUSIC" },
		puzzle: { ...view.puzzle, media },
	};
}
function musicScreen(
	puzzles = musicView(),
	busy = false,
	disconnected = false,
	onAction = vi.fn(async () => true),
) {
	return (
		<PuzzleScreen
			session={session}
			snapshot={{ ...gameSnapshot(), puzzles }}
			receivedAt={performance.now()}
			onAction={onAction}
			busy={busy}
			disconnected={disconnected}
		/>
	);
}
function unavailableClip() {
	return Response.json(
		{
			error: {
				code: "CLIP_TEMPORARILY_UNAVAILABLE",
				message:
					"Song preview is temporarily unavailable. Retry or skip this song.",
			},
		},
		{ status: 503 },
	);
}
it("lets passengers skip a failed preview without revealing the answer", async () => {
	const fetchClip = vi.fn(async () => unavailableClip());
	vi.stubGlobal("fetch", fetchClip);
	const onAction = vi.fn(async () => true);
	render(musicScreen(musicView(), false, false, onAction));
	await screen.findByRole("alert");
	fireEvent.click(
		screen.getByRole("button", { name: "Skip unavailable song" }),
	);
	expect(onAction).toHaveBeenCalledWith({
		kind: "skip",
		roundId,
		puzzleId: view.puzzle?.id,
	});
	expect(screen.queryByLabelText("Revealed song")).toBeNull();
	expect(fetchClip).toHaveBeenCalledOnce();
	expect(
		screen.getByText(/Skipping earns 0 points and does not reveal/),
	).toBeTruthy();
});
it.each(["song-clip:2", "data:audio/wav;base64,UklGRg=="])(
	"removes broken audio and offers a skip after playback fails for %s",
	async (media) => {
		vi.stubGlobal("fetch", async () =>
			Response.json({ media: "data:audio/wav;base64,UklGRg==" }),
		);
		const { container } = render(musicScreen(musicView(media)));
		await screen.findByText("Your browser cannot play this clip.");
		const audio = container.querySelector("audio");
		if (!audio) throw new Error("Missing audio player");
		fireEvent.error(audio);
		expect(container.querySelector("audio")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Skip unavailable song" }),
		).toBeTruthy();
		expect(screen.getByRole("alert").textContent).not.toMatch(
			/give up|reveal/i,
		);
	},
);
it.each(["busy", "disconnected", "expired"])(
	"disables recovery actions when %s",
	async (condition) => {
		vi.stubGlobal("fetch", async () => unavailableClip());
		let puzzles = musicView();
		if (condition === "expired")
			puzzles = {
				...puzzles,
				round: { ...puzzles.round, endsAt: new Date(0).toISOString() },
			};
		render(
			musicScreen(puzzles, condition === "busy", condition === "disconnected"),
		);
		await screen.findByRole("alert");
		for (const name of [
			"Retry song clip",
			"Skip unavailable song",
			"Give up & reveal",
		]) {
			expect(
				(screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
			).toBe(true);
		}
	},
);
it("explains clip preparation while letting passengers move past a slow preview", () => {
	vi.stubGlobal("fetch", () => new Promise(() => {}));
	render(musicScreen());
	expect(screen.getByText("Preparing song clip…")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Skip unavailable song" }),
	).toBeTruthy();
});
it("does not request a clip for a revealed song", () => {
	const fetchClip = vi.fn(async () => unavailableClip());
	vi.stubGlobal("fetch", fetchClip);
	const music = musicView();
	if (!music.puzzle) throw new Error("Missing fixture puzzle");
	render(
		musicScreen({
			...music,
			puzzle: { ...music.puzzle, revealedAnswer: "Dynamite — BTS" },
		}),
	);
	expect(fetchClip).not.toHaveBeenCalled();
});
it("keeps an older request from replacing the next unlocked clue", async () => {
	let finishFirst: ((response: Response) => void) | undefined;
	let calls = 0;
	vi.stubGlobal("fetch", () =>
		++calls === 1
			? new Promise<Response>((resolve) => {
					finishFirst = resolve;
				})
			: Promise.resolve(Response.json({ media: "data:audio/wav;base64,TkVX" })),
	);
	const { container, rerender } = render(musicScreen());
	rerender(musicScreen(musicView("song-clip:4")));
	await waitFor(() =>
		expect(container.querySelector("audio")?.getAttribute("src")).toBe(
			"data:audio/wav;base64,TkVX",
		),
	);
	await act(async () => {
		finishFirst?.(Response.json({ media: "data:audio/wav;base64,T0xE" }));
	});
	expect(container.querySelector("audio")?.getAttribute("src")).toBe(
		"data:audio/wav;base64,TkVX",
	);
	expect(screen.getByText(/4-second clip/)).toBeTruthy();
});
