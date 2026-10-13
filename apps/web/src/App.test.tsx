// @vitest-environment jsdom

import { QuestionTopicIds } from "@carpool/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { gameSnapshot, session } from "./test/game-fixtures";

const mocks = vi.hoisted(() => ({
	view: vi.fn(),
	start: vi.fn(),
	leave: vi.fn(),
	end: vi.fn(),
	join: vi.fn(),
	create: vi.fn(),
	submit: vi.fn(),
	puzzle: vi.fn(),
}));
vi.mock("./useGameSnapshot", () => ({ useGameSnapshot: mocks.view }));
vi.mock("./api", () => ({
	startGame: mocks.start,
	leaveGame: mocks.leave,
	endGame: mocks.end,
	joinGame: mocks.join,
	createGame: mocks.create,
	submitAnswer: mocks.submit,
	sendPuzzleAction: mocks.puzzle,
}));
let snapshot = gameSnapshot();
const refresh = vi.fn();

it("keeps correct puzzle feedback visible after advancing to the next puzzle", async () => {
	const roundId = "a6775a41-50ab-4d61-b1fa-f9f07a28c62b";
	snapshot.puzzles = {
		round: {
			id: roundId,
			sequence: 1,
			theme: "animals",
			format: "TRIVIA",
			status: "OPEN",
			startsAt: snapshot.serverTime,
			endsAt: "2099-10-08T10:05:00.000Z",
			total: 100,
		},
		solved: 0,
		puzzle: {
			id: "round/0",
			number: 1,
			prompt: "Which pet barks?",
			media: null,
			guesses: [],
		},
		skipped: [],
		options: [{ id: "dog", name: "Dog", aliases: [] }],
		results: [],
		selection: { theme: null, themeTeamId: null, formatTeamId: null },
	};
	mocks.puzzle.mockImplementationOnce(async () => {
		if (!snapshot.puzzles) throw new Error("Missing fixture puzzles");
		snapshot = {
			...snapshot,
			puzzles: {
				...snapshot.puzzles,
				solved: 1,
				puzzle: {
					id: "round/1",
					number: 2,
					prompt: "Which pet purrs?",
					media: null,
					guesses: [],
				},
			},
		};
		return {
			ok: true,
			result: { name: "Dog", correct: true, pointsAwarded: 1 },
		};
	});
	resume();
	fireEvent.change(screen.getByLabelText("Search answers"), {
		target: { value: "Dog" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Guess" }));
	expect(await screen.findByText("Correct — Dog. +1 point.")).toBeTruthy();
	expect(screen.getByText("Which pet purrs?")).toBeTruthy();
});

it("keeps the previous result visible while the next question accepts answers", () => {
	const previous = gameSnapshot().round;
	if (!previous) throw new Error("Missing fixture round");
	snapshot = {
		...gameSnapshot(),
		previousRound: {
			...previous,
			status: "REVEALED",
			revealedAt: "2026-10-08T10:00:02.000Z",
			correctAnswer: false,
			explanation: "Previous round explanation",
			results: [],
		},
	};
	resume();
	expect(
		screen.getByRole("button", { name: "Confirm team answer" }),
	).toBeTruthy();
	expect(screen.getByText("Previous round explanation")).toBeTruthy();
	expect(screen.queryByText("Enjoy the miles between rounds.")).toBeNull();
});
beforeEach(() => {
	localStorage.clear();
	window.history.replaceState({}, "", "/");
	snapshot = gameSnapshot();
	mocks.view.mockImplementation(() => ({
		snapshot,
		receivedAt: performance.now(),
		syncError: null,
		refresh,
	}));
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});
function resume(role = session.role) {
	localStorage.setItem(
		"carpool-game-session",
		JSON.stringify({ ...session, role }),
	);
	render(<App />);
}

it("opens a validated invite in the join form without automatically joining", () => {
	window.history.replaceState({}, "", "/?join=ab12cd");
	render(<App />);
	expect(
		(screen.getByLabelText("Six-character join code") as HTMLInputElement)
			.value,
	).toBe("AB12CD");
	expect(mocks.join).not.toHaveBeenCalled();
});
it("ignores malformed invite codes", () => {
	window.history.replaceState({}, "", "/?join=AB12CD-token");
	render(<App />);
	expect(screen.getByLabelText("Game name")).toBeTruthy();
});
it("keeps mixed topics collapsed until the host wants to customize them", () => {
	render(<App />);
	expect(document.querySelector("details")?.open).toBe(false);
	fireEvent.click(screen.getByText("Quiz topics", { exact: true }));
	expect(document.querySelector("details")?.open).toBe(true);
	expect(
		screen.getByRole("checkbox", { name: "Around the World" }),
	).toBeTruthy();
});
it("shows a game-type choice only when the selected theme supports several", () => {
	render(<App />);
	fireEvent.change(screen.getByLabelText("Game style"), {
		target: { value: "puzzles" },
	});
	expect(screen.queryByLabelText("Game type")).toBeNull();
	fireEvent.change(screen.getByLabelText("Theme"), {
		target: { value: "animals" },
	});
	expect(screen.getByLabelText("Game type")).toBeTruthy();
	fireEvent.change(screen.getByLabelText("Theme"), {
		target: { value: "melodies" },
	});
	expect(screen.queryByLabelText("Game type")).toBeNull();
});
it("creates with named topic selections and labels the full selection Mixed Topics", async () => {
	mocks.create.mockResolvedValue({
		game: { id: session.gameId },
		hostToken: "new-host",
	});
	snapshot.game.status = "LOBBY";
	snapshot.round = null;
	render(<App />);
	expect(screen.getByText("Mixed Topics")).toBeTruthy();
	fireEvent.click(screen.getByText("Quiz topics", { exact: true }));
	for (const topic of [
		"Around the World",
		"Thailand",
		"Food & Drinks",
		"Weird but True",
		"Animals & Nature",
		"Science & Space",
		"Taylor Swift",
		"Breaking Bad (full-series spoilers)",
		"Logic & Clever Strategies",
		"Lateral Thinking",
		"Probability Puzzles",
		"Closest Estimate",
		"Harry Potter (seven-book spoilers)",
		"History",
		"Sports",
		"Video Games",
		"NBA",
		"Disney & Pixar (animated-film spoilers)",
	]) {
		fireEvent.click(screen.getByRole("checkbox", { name: topic }));
	}
	expect(screen.queryByText("Mixed Topics")).toBeNull();
	fireEvent.change(screen.getByLabelText("Game name"), {
		target: { value: "Marvel trip" },
	});
	fireEvent.change(screen.getByLabelText("Car name"), {
		target: { value: "Blue Sedan" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Create game" }));
	await screen.findByText("Share this join code");
	expect(mocks.create).toHaveBeenCalledWith({
		name: "Marvel trip",
		teamName: "Blue Sedan",
		roundIntervalSeconds: 300,
		topics: ["marvel"],
	});
});
it("prevents creating a game with no selected topics", () => {
	render(<App />);
	fireEvent.click(screen.getByText("Quiz topics", { exact: true }));
	for (const topic of [
		"Around the World",
		"Thailand",
		"Food & Drinks",
		"Weird but True",
		"Animals & Nature",
		"Science & Space",
		"Taylor Swift",
		"Breaking Bad (full-series spoilers)",
		"Marvel (MCU film spoilers)",
		"Logic & Clever Strategies",
		"Lateral Thinking",
		"Probability Puzzles",
		"Closest Estimate",
		"Harry Potter (seven-book spoilers)",
		"History",
		"Sports",
		"Video Games",
		"NBA",
		"Disney & Pixar (animated-film spoilers)",
	]) {
		fireEvent.click(screen.getByRole("checkbox", { name: topic }));
	}
	expect(screen.getByText("Choose at least one topic.")).toBeTruthy();
	expect(
		(screen.getByRole("button", { name: "Create game" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(mocks.create).not.toHaveBeenCalled();
});
it("restores saved topic names in the lobby snapshot", () => {
	snapshot.game.status = "LOBBY";
	snapshot.game.selectedTopics = ["science", "marvel"];
	snapshot.round = null;
	resume("HOST");
	expect(
		screen.getByRole("group", { name: "Selected quiz topics" }).textContent,
	).toContain("Science & Space, Marvel (MCU film spoilers)");
});

it("creates a puzzle round after switching from an empty trivia topic selection", async () => {
	mocks.create.mockResolvedValue({
		game: { id: session.gameId },
		hostToken: "new-host",
	});
	snapshot.game.status = "LOBBY";
	snapshot.round = null;
	render(<App />);
	for (const checkbox of screen.getAllByRole("checkbox"))
		fireEvent.click(checkbox);
	fireEvent.change(screen.getByLabelText("Game style"), {
		target: { value: "puzzles" },
	});
	fireEvent.change(screen.getByLabelText("Game name"), {
		target: { value: "Puzzle trip" },
	});
	fireEvent.change(screen.getByLabelText("Car name"), {
		target: { value: "Blue Sedan" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Create game" }));
	await screen.findByText("Share this join code");
	expect(mocks.create).toHaveBeenCalledWith({
		name: "Puzzle trip",
		teamName: "Blue Sedan",
		roundIntervalSeconds: 300,
		puzzleSetup: { theme: "melodies", format: "MUSIC" },
	});
});
it("keeps join inputs after an error", async () => {
	mocks.join.mockRejectedValue(new Error("Game not found"));
	render(<App />);
	fireEvent.click(screen.getByRole("button", { name: "Join a car" }));
	fireEvent.change(screen.getByLabelText("Six-character join code"), {
		target: { value: "AB12CD" },
	});
	fireEvent.change(screen.getByLabelText("Car name"), {
		target: { value: "Blue Sedan" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Join game" }));
	await screen.findByText("Game not found");
	expect((screen.getByLabelText("Car name") as HTMLInputElement).value).toBe(
		"Blue Sedan",
	);
});
it("requires leave confirmation then shows readonly LEFT and clears only this browser on home", async () => {
	mocks.leave.mockResolvedValue({
		team: { id: snapshot.callerTeam?.id, status: "LEFT" },
	});
	resume();
	fireEvent.click(screen.getByRole("button", { name: "Leave game" }));
	expect(screen.getByText(/Answers stop immediately/)).toBeTruthy();
	expect(mocks.leave).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Confirm leave" }));
	await screen.findByText("Your car has left the game.");
	expect(screen.queryByRole("radio")).toBeNull();
	localStorage.setItem("other-browser-data", "keep");
	fireEvent.click(screen.getByRole("button", { name: "Return home" }));
	expect(localStorage.getItem("carpool-game-session")).toBeNull();
	expect(localStorage.getItem("other-browser-data")).toBe("keep");
});
it("confirms host end and displays the server's final leaderboard", async () => {
	mocks.end.mockResolvedValue({
		game: {
			id: session.gameId,
			status: "COMPLETE",
			completedAt: snapshot.serverTime,
			completionReason: "HOST_ENDED",
		},
		leaderboard: [
			{ ...snapshot.leaderboard[0], score: 7, rank: 2, status: "LEFT" },
		],
	});
	resume("HOST");
	fireEvent.click(screen.getByRole("button", { name: "End game" }));
	expect(screen.getByText(/Locked answers will be scored/)).toBeTruthy();
	expect(mocks.end).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Confirm end" }));
	await screen.findByRole("heading", { name: "Final leaderboard" });
	expect(screen.getByText("7 pts")).toBeTruthy();
	expect(screen.getByLabelText("Rank 2")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "End game" })).toBeNull();
});
it("restores revealed results and server ranks on refresh", () => {
	if (!snapshot.round) throw Error("fixture");
	snapshot.round = {
		...snapshot.round,
		status: "REVEALED",
		revealedAt: snapshot.serverTime,
		correctAnswer: false,
		explanation: "A very thin atmosphere.",
		results: [
			{
				teamId: snapshot.leaderboard[0].id,
				name: "Blue Sedan",
				value: null,
				isCorrect: false,
				pointsAwarded: 0,
			},
		],
	};
	snapshot.leaderboard[0].rank = 3;
	resume();
	expect(screen.getByText("False")).toBeTruthy();
	expect(screen.getByText("A very thin atmosphere.")).toBeTruthy();
	expect(screen.getByLabelText("Rank 3")).toBeTruthy();
	expect(screen.getByText(/No answer/)).toBeTruthy();
});
it("offers a token-free invite URL and visible clipboard fallback", async () => {
	snapshot.game.status = "LOBBY";
	snapshot.round = null;
	resume("HOST");
	expect(screen.queryByLabelText("Invite link")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
	await screen.findByText(/Copy the invite link above/);
	const input = screen.getByLabelText("Invite link") as HTMLInputElement;
	expect(input.value).toBe(`${location.origin}/?join=AB12CD`);
	expect(input.value).not.toContain(session.token);
	expect(document.activeElement).toBe(input);
});
it.each([null, "2026-10-08T09:59:00.000Z", "2026-10-08T12:00:00.000Z"])(
	"shows neutral standby for schedule %s",
	(schedule) => {
		snapshot.round = null;
		snapshot.game.nextRoundAt = schedule;
		resume();
		expect(
			screen.getByText("Waiting for the server's next update…"),
		).toBeTruthy();
	},
);

it("retains game-name input after failure, then creates with the default interval and host-only practice start", async () => {
	mocks.create
		.mockRejectedValueOnce(new Error("Try again"))
		.mockResolvedValueOnce({
			game: { id: session.gameId },
			hostToken: "new-host",
		});
	snapshot.game.status = "LOBBY";
	snapshot.round = null;
	render(<App />);
	fireEvent.change(screen.getByLabelText("Game name"), {
		target: { value: "Coast drive" },
	});
	fireEvent.change(screen.getByLabelText("Car name"), {
		target: { value: "Host car" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Create game" }));
	await screen.findByText("Try again");
	expect((screen.getByLabelText("Game name") as HTMLInputElement).value).toBe(
		"Coast drive",
	);
	fireEvent.click(screen.getByRole("button", { name: "Create game" }));
	await screen.findByText("Share this join code");
	expect(mocks.create).toHaveBeenLastCalledWith({
		name: "Coast drive",
		teamName: "Host car",
		topics: [...QuestionTopicIds],
		roundIntervalSeconds: 300,
	});
	expect(screen.queryByLabelText("Play solo practice")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Start practice game" }));
	expect(mocks.start).toHaveBeenCalledWith(
		{ gameId: session.gameId, role: "HOST", token: "new-host" },
		true,
	);
});

it("leaves controls available after a failed leave and restores keyboard focus when cancelled", async () => {
	mocks.leave.mockRejectedValue(new Error("Can't leave yet"));
	resume();
	fireEvent.click(screen.getByRole("button", { name: "Leave game" }));
	expect(document.activeElement).toBe(
		screen.getByRole("button", { name: "Confirm leave" }),
	);
	fireEvent.click(screen.getByRole("button", { name: "Confirm leave" }));
	await screen.findByText("Can't leave yet");
	expect(screen.getByLabelText("False")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(document.activeElement).toBe(
		screen.getByRole("button", { name: "Leave game" }),
	);
});

it("restores a completed LEFT captain without answer or leave controls", () => {
	snapshot.game.status = "COMPLETE";
	snapshot.game.nextRoundAt = null;
	if (!snapshot.callerTeam) throw Error("fixture");
	snapshot.callerTeam.status = "LEFT";
	snapshot.leaderboard[0].status = "LEFT";
	resume();
	expect(screen.getByText("Your car has left the game.")).toBeTruthy();
	expect(
		screen.getByRole("heading", { name: "Final leaderboard" }),
	).toBeTruthy();
	expect(screen.queryByRole("radio")).toBeNull();
	expect(screen.queryByRole("button", { name: "Leave game" })).toBeNull();
});

it("uses native sharing and clipboard with the same token-free URL", async () => {
	const share = vi.fn().mockRejectedValue(new Error("Sharing unavailable"));
	const writeText = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { share, clipboard: { writeText } });
	snapshot.game.status = "LOBBY";
	snapshot.round = null;
	resume("HOST");
	expect(screen.queryByRole("button", { name: "Copy invite link" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Share invite" }));
	expect(share).toHaveBeenCalledWith({
		title: "Carpool Quiz League",
		text: "Join our game with code AB12CD",
		url: `${location.origin}/?join=AB12CD`,
	});
	await screen.findByText("Invite link copied.");
	expect(writeText).toHaveBeenCalledWith(`${location.origin}/?join=AB12CD`);
});

it("creates a Disney & Pixar only trip from the topic selector", async () => {
	mocks.create.mockResolvedValue({
		game: { id: session.gameId },
		hostToken: "new-host",
	});
	snapshot.game.status = "LOBBY";
	snapshot.game.selectedTopics = ["disney-pixar"];
	snapshot.round = null;
	render(<App />);
	fireEvent.click(screen.getByText("Quiz topics", { exact: true }));
	const disney = screen.getByRole("checkbox", {
		name: "Disney & Pixar (animated-film spoilers)",
	});
	for (const checkbox of screen.getAllByRole("checkbox"))
		if (checkbox !== disney) fireEvent.click(checkbox);
	fireEvent.change(screen.getByLabelText("Game name"), {
		target: { value: "Animated adventure" },
	});
	fireEvent.change(screen.getByLabelText("Car name"), {
		target: { value: "Disney fans" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Create game" }));
	await screen.findByText("Share this join code");
	expect(mocks.create).toHaveBeenCalledWith({
		name: "Animated adventure",
		teamName: "Disney fans",
		roundIntervalSeconds: 300,
		topics: ["disney-pixar"],
	});
	expect(
		screen.getByRole("group", { name: "Selected quiz topics" }).textContent,
	).toContain("Disney & Pixar");
});
