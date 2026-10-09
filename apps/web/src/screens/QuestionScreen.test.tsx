// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { gameSnapshot, session } from "../test/game-fixtures";
import { QuestionScreen } from "./QuestionScreen";

afterEach(cleanup);
it("requires separate confirmation, sends actual false, and restores controls on failed submission", async () => {
	const user = userEvent.setup();
	const submit = vi
		.fn()
		.mockRejectedValueOnce(
			new ApiError("Lost response", 409, "ANSWER_ALREADY_LOCKED"),
		)
		.mockResolvedValueOnce(undefined);
	const refresh = vi.fn();
	render(
		<QuestionScreen
			session={session}
			snapshot={gameSnapshot()}
			receivedAt={performance.now()}
			onSubmit={submit}
			onRefresh={refresh}
		/>,
	);
	await user.click(screen.getByLabelText("False"));
	expect(submit).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Confirm team answer" }));
	await screen.findByRole("alert");
	expect(submit).toHaveBeenCalledWith(false);
	expect(refresh).toHaveBeenCalledOnce();
	expect((screen.getByLabelText("False") as HTMLInputElement).checked).toBe(
		true,
	);
	await user.click(screen.getByRole("button", { name: "Confirm team answer" }));
	await screen.findByText("Answer locked");
	expect(screen.queryByRole("radio")).toBeNull();
});

it("recovers caller's locked answer after a lost HTTP success without automatic retry", async () => {
	const submit = vi.fn().mockRejectedValue(new Error("Connection lost"));
	const refresh = vi.fn();
	const snapshot = gameSnapshot();
	const { rerender } = render(
		<QuestionScreen
			session={session}
			snapshot={snapshot}
			receivedAt={0}
			onSubmit={submit}
			onRefresh={refresh}
		/>,
	);
	fireEvent.click(screen.getByLabelText("True"));
	fireEvent.click(screen.getByRole("button", { name: "Confirm team answer" }));
	await screen.findByRole("alert");
	rerender(
		<QuestionScreen
			session={session}
			snapshot={{
				...snapshot,
				ownAnswer: {
					answerId: "94ae7f94-042a-446a-b523-b7b45d84e929",
					value: true,
					submittedAt: snapshot.serverTime,
				},
			}}
			receivedAt={0}
			onSubmit={submit}
			onRefresh={refresh}
		/>,
	);
	await screen.findByText("Answer locked");
	expect(submit).toHaveBeenCalledOnce();
});

it("renders a legacy spectator host without answer controls", () => {
	const snapshot = gameSnapshot();
	snapshot.callerTeam = null;
	render(
		<QuestionScreen
			session={{ ...session, role: "HOST" }}
			snapshot={snapshot}
			receivedAt={0}
			onSubmit={vi.fn()}
			onRefresh={vi.fn()}
		/>,
	);
	expect(screen.getByText(snapshot.round?.question.prompt ?? "")).toBeTruthy();
	expect(screen.queryByRole("radio")).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Confirm team answer" }),
	).toBeNull();
});

it("lets the host's active car confirm an answer", async () => {
	const submit = vi.fn().mockResolvedValue(undefined);
	render(
		<QuestionScreen
			session={{ ...session, role: "HOST" }}
			snapshot={gameSnapshot()}
			receivedAt={0}
			onSubmit={submit}
			onRefresh={vi.fn()}
		/>,
	);
	fireEvent.click(screen.getByLabelText("False"));
	fireEvent.click(screen.getByRole("button", { name: "Confirm team answer" }));
	await screen.findByText("Answer locked");
	expect(submit).toHaveBeenCalledWith(false);
});

it("submits decimal estimates and rejects non-finite values", async () => {
	const snapshot = gameSnapshot();
	if (!snapshot.round) throw Error("fixture");
	snapshot.round.question = {
		...snapshot.round.question,
		type: "ESTIMATE",
		choices: null,
	};
	const submit = vi.fn().mockResolvedValue(undefined);
	render(
		<QuestionScreen
			session={session}
			snapshot={snapshot}
			receivedAt={0}
			onSubmit={submit}
			onRefresh={vi.fn()}
		/>,
	);
	const input = screen.getByLabelText("Team estimate");
	fireEvent.change(input, { target: { value: "1e309" } });
	fireEvent.click(screen.getByRole("button", { name: "Confirm team answer" }));
	expect(submit).not.toHaveBeenCalled();
	fireEvent.change(input, { target: { value: "12.75" } });
	fireEvent.click(screen.getByRole("button", { name: "Confirm team answer" }));
	await waitFor(() => expect(submit).toHaveBeenCalledWith(12.75));
});

it("sends the listed multiple-choice string and restores a stored false lock", async () => {
	const snapshot = gameSnapshot();
	if (!snapshot.round) throw Error("fixture");
	snapshot.round.question = {
		...snapshot.round.question,
		type: "MULTIPLE_CHOICE",
		choices: ["Venus", "Mars"],
	};
	const submit = vi.fn().mockResolvedValue(undefined);
	const { rerender } = render(
		<QuestionScreen
			session={session}
			snapshot={snapshot}
			receivedAt={0}
			onSubmit={submit}
			onRefresh={vi.fn()}
		/>,
	);
	fireEvent.click(screen.getByLabelText("Mars"));
	fireEvent.click(screen.getByRole("button", { name: "Confirm team answer" }));
	await waitFor(() => expect(submit).toHaveBeenCalledWith("Mars"));
	const restored = gameSnapshot();
	restored.ownAnswer = {
		answerId: "94ae7f94-042a-446a-b523-b7b45d84e929",
		value: false,
		submittedAt: restored.serverTime,
	};
	rerender(
		<QuestionScreen
			session={session}
			snapshot={restored}
			receivedAt={0}
			onSubmit={submit}
			onRefresh={vi.fn()}
		/>,
	);
	expect(screen.getByText("False")).toBeTruthy();
	expect(screen.queryByRole("radio")).toBeNull();
});
