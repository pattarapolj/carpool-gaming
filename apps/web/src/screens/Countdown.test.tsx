// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { gameSnapshot, session } from "../test/game-fixtures";
import { QuestionScreen } from "./QuestionScreen";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});
it("counts from server time and elapsed performance time, never revealing locally", () => {
	vi.useFakeTimers({
		toFake: ["setInterval", "clearInterval", "performance", "Date"],
	});
	vi.setSystemTime("2099-01-01T00:00:00Z");
	const snapshot = gameSnapshot();
	render(
		<QuestionScreen
			session={session}
			snapshot={snapshot}
			receivedAt={performance.now()}
			onSubmit={vi.fn()}
			onRefresh={vi.fn()}
		/>,
	);
	expect(screen.getByText("Answer window 1:00")).toBeTruthy();
	act(() => vi.advanceTimersByTime(30000));
	expect(screen.getByText("Answer window 0:30")).toBeTruthy();
	expect(screen.getByText("Answer window 0:30").className).not.toContain(
		"countdown-urgent",
	);
	act(() => vi.advanceTimersByTime(20000));
	expect(screen.getByText("Answer window 0:10").className).toContain(
		"countdown-urgent",
	);
	act(() => vi.advanceTimersByTime(10000));
	expect(
		screen.getByText("Waiting for the server's next update…"),
	).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Confirm team answer" }),
	).toBeTruthy();
	expect(snapshot.round?.status).toBe("OPEN");
	expect(screen.queryByText("Answer:")).toBeNull();
});
