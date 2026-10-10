import type { EndedGame, PuzzleAction } from "@carpool/contracts";
import { useEffect, useRef, useState } from "react";
import {
	endGame,
	leaveGame,
	sendPuzzleAction,
	startGame,
	submitAnswer,
} from "../api";
import type { GameSession } from "../session";
import { useGameSnapshot } from "../useGameSnapshot";
import { LobbyScreen } from "./LobbyScreen";
import { PuzzleScreen } from "./PuzzleScreen";
import { formatAnswer, QuestionScreen } from "./QuestionScreen";
import { Leaderboard, ResultsScreen } from "./ResultsScreen";

export function GameScreen({
	session,
	storageWarning,
	onHome,
}: {
	session: GameSession;
	storageWarning: string | null;
	onHome: () => void;
}) {
	const { snapshot, receivedAt, syncError, refresh } = useGameSnapshot(session);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [answerFeedback, setAnswerFeedback] = useState<{
		roundId: string;
		correct: boolean;
		message: string;
	} | null>(null);
	const [confirmation, setConfirmation] = useState<"leave" | "end" | null>(
		null,
	);
	const [left, setLeft] = useState(false);
	const [ended, setEnded] = useState<EndedGame | null>(null);
	const active = useRef(true);
	const actionPending = useRef(false);
	const confirmationButton = useRef<HTMLButtonElement>(null);
	const lifecycleButton = useRef<HTMLButtonElement>(null);
	const wasConfirming = useRef(false);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	useEffect(() => {
		if (confirmation) confirmationButton.current?.focus();
		else if (wasConfirming.current) lifecycleButton.current?.focus();
		wasConfirming.current = confirmation !== null;
	}, [confirmation]);
	const view =
		snapshot && ended
			? {
					...snapshot,
					game: { ...snapshot.game, ...ended.game, nextRoundAt: null },
					leaderboard: ended.leaderboard,
				}
			: snapshot;
	const hasLeft = left || view?.callerTeam?.status === "LEFT";
	const complete = view?.game.status === "COMPLETE";
	const host = session.role === "HOST";

	async function act(action: "start" | "leave" | "end") {
		if (actionPending.current || !view) return;
		actionPending.current = true;
		setBusy(true);
		setError(null);
		try {
			if (action === "start") await startGame(session, view.teams.length === 1);
			else if (action === "leave") {
				await leaveGame(session);
				if (active.current) setLeft(true);
			} else {
				const result = await endGame(session);
				if (active.current) setEnded(result);
			}
			if (active.current) setConfirmation(null);
		} catch (cause) {
			if (active.current)
				setError(
					cause instanceof Error
						? cause.message
						: "Couldn't complete that request. Try again.",
				);
		} finally {
			actionPending.current = false;
			if (active.current) {
				setBusy(false);
				refresh();
			}
		}
	}
	async function playPuzzle(action: PuzzleAction) {
		if (actionPending.current) return false;
		actionPending.current = true;
		setBusy(true);
		setError(null);
		try {
			const response = await sendPuzzleAction(session, action);
			if (active.current) {
				setAnswerFeedback(
					response.result
						? {
								roundId: action.roundId,
								correct: response.result.correct,
								message: response.result.correct
									? `Correct — ${response.result.name}. +${response.result.pointsAwarded} point.`
									: `Incorrect — ${response.result.name}. Try again.`,
							}
						: null,
				);
			}
			return true;
		} catch (cause) {
			if (active.current)
				setError(
					cause instanceof Error
						? cause.message
						: "Couldn't submit. Try again.",
				);
			return false;
		} finally {
			actionPending.current = false;
			if (active.current) {
				setBusy(false);
				refresh();
			}
		}
	}
	function cancelConfirmation() {
		setConfirmation(null);
	}
	const status = syncError ? (
		<div className="reconnect-panel" role="status">
			<p>{syncError}</p>
			<button className="quiet-button" type="button" onClick={refresh}>
				Retry connection
			</button>
		</div>
	) : null;
	if (!view)
		return (
			<section className="loading-card">
				<h1>Opening your game</h1>
				{status ?? <p role="status">Getting the latest game state…</p>}
				<button className="quiet-button" type="button" onClick={onHome}>
					Return home
				</button>
			</section>
		);
	return (
		<>
			{status}
			{view.game.status === "LOBBY" && !hasLeft ? (
				<LobbyScreen
					session={session}
					snapshot={view}
					error={error}
					syncError={null}
					storageWarning={storageWarning}
					busy={busy}
					onStart={() => void act("start")}
				/>
			) : (
				<section className="lobby-layout gameplay-layout">
					<div className="lobby-heading">
						<p className="round-meta">YOUR TRIP · {view.game.joinCode}</p>
						<h1>{view.game.name}</h1>
						{view.callerTeam ? (
							<p className="trip-score">
								{view.callerTeam.name} · {view.callerTeam.score} pts
							</p>
						) : null}
					</div>
					{hasLeft ? (
						<section className="wait-panel" role="status">
							<div>
								<h2>Your car has left the game.</h2>
								<p>
									Answers stop immediately. Your score stays on the leaderboard.
								</p>
							</div>
						</section>
					) : null}
					{answerFeedback &&
					!complete &&
					!hasLeft &&
					(view.puzzles
						? answerFeedback.roundId === view.puzzles.round.id
						: answerFeedback.roundId !== view.round?.id) ? (
						<p
							className={`answer-feedback ${answerFeedback.correct ? "feedback-correct" : "feedback-incorrect"}`}
							role="status"
						>
							{answerFeedback.message}
						</p>
					) : null}
					{view.puzzles && !hasLeft ? (
						<PuzzleScreen
							session={session}
							snapshot={view}
							receivedAt={receivedAt}
							onAction={playPuzzle}
							busy={busy}
							disconnected={Boolean(syncError)}
						/>
					) : complete ? (
						<ResultsScreen snapshot={view} receivedAt={receivedAt} />
					) : hasLeft ? (
						<Leaderboard snapshot={view} />
					) : view.round?.status === "OPEN" ? (
						<>
							<QuestionScreen
								key={view.round.id}
								session={session}
								snapshot={view}
								receivedAt={receivedAt}
								onSubmit={async (value) => {
									const roundId = view.round?.id as string;
									const response = await submitAnswer(session, roundId, value);
									if (active.current && response?.isCorrect != null)
										setAnswerFeedback({
											roundId,
											correct: response.isCorrect,
											message: `Last answer: ${formatAnswer(value)} — ${response.isCorrect ? "Correct. +1 point." : "Incorrect. 0 points."}`,
										});
									return response;
								}}
								onRefresh={refresh}
							/>
							{view.previousRound ? (
								<details className="play-disclosure previous-results">
									<summary>Previous round & leaderboard</summary>
									<ResultsScreen
										snapshot={{ ...view, round: view.previousRound }}
										receivedAt={receivedAt}
										waiting={false}
									/>
								</details>
							) : null}
						</>
					) : (
						<ResultsScreen snapshot={view} receivedAt={receivedAt} />
					)}
					{storageWarning ? (
						<p className="storage-warning" role="status">
							{storageWarning}
						</p>
					) : null}
					{error ? (
						<p className="form-error" role="alert">
							{error}
						</p>
					) : null}
					<p className="driver-note">
						A passenger runs the phone. Drivers join the conversation
						hands-free.
					</p>
				</section>
			)}
			<section className="lifecycle-controls">
				{confirmation && !hasLeft && !complete ? (
					<fieldset
						className="confirmation-panel"
						aria-labelledby="confirmation-heading"
					>
						<h2 id="confirmation-heading">
							{confirmation === "leave"
								? "Leave this game?"
								: "End the game for every car?"}
						</h2>
						<p>
							{confirmation === "leave"
								? "Answers stop immediately. Your locked answers and score remain in the game."
								: view.puzzles
									? "Solved puzzles will be scored. Every car will see the final leaderboard."
									: "Locked answers will be scored. Unanswered teams receive 0 points. Every car will see the final leaderboard."}
						</p>
						<div className="action-row">
							<button
								ref={confirmationButton}
								className="primary-button"
								aria-busy={busy}
								type="button"
								disabled={busy}
								onClick={() => void act(confirmation)}
							>
								{busy
									? "Confirming…"
									: confirmation === "leave"
										? "Confirm leave"
										: "Confirm end"}
							</button>
							<button
								className="quiet-button"
								type="button"
								disabled={busy}
								onClick={cancelConfirmation}
							>
								Cancel
							</button>
						</div>
					</fieldset>
				) : !hasLeft && !complete ? (
					<button
						ref={lifecycleButton}
						className="quiet-button"
						type="button"
						disabled={busy}
						onClick={() => {
							setError(null);
							setConfirmation(host ? "end" : "leave");
						}}
					>
						{host ? "End game" : "Leave game"}
					</button>
				) : (
					<button className="quiet-button" type="button" onClick={onHome}>
						Return home
					</button>
				)}
			</section>
		</>
	);
}
