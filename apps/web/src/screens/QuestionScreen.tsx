import {
	type GameSnapshot,
	type SubmitAnswerInput,
	SubmitAnswerResponseSchema,
} from "@carpool/contracts";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { GameSession } from "../session";
import { Countdown } from "./Countdown";

type AnswerValue = SubmitAnswerInput["value"];
export function formatAnswer(value: AnswerValue | null) {
	return value === null
		? "No answer"
		: typeof value === "boolean"
			? value
				? "True"
				: "False"
			: String(value);
}

export function QuestionScreen({
	snapshot,
	receivedAt,
	onSubmit,
	onRefresh,
}: {
	session: GameSession;
	snapshot: GameSnapshot;
	receivedAt: number;
	onSubmit: (value: AnswerValue) => Promise<unknown>;
	onRefresh: () => void;
}) {
	const [selection, setSelection] = useState<AnswerValue | null>(null);
	const [estimate, setEstimate] = useState("");
	const [confirmed, setConfirmed] = useState<AnswerValue | null>(null);
	const [correctness, setCorrectness] = useState<boolean | null | undefined>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const active = useRef(true);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const round = snapshot.round;
	if (round?.status !== "OPEN") return null;
	const canAnswer = snapshot.callerTeam?.status === "ACTIVE";
	const locked = canAnswer ? (snapshot.ownAnswer?.value ?? confirmed) : null;
	const isCorrect = snapshot.ownAnswer
		? snapshot.ownAnswer.isCorrect
		: correctness;
	const choices: AnswerValue[] =
		round.question.type === "TRUE_FALSE"
			? [true, false]
			: (round.question.choices ?? []);
	const value =
		round.question.type === "ESTIMATE"
			? estimate.trim() !== "" && Number.isFinite(Number(estimate))
				? Number(estimate)
				: null
			: selection;

	async function confirm(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || value === null || !canAnswer || locked !== null) return;
		setBusy(true);
		setError(null);
		try {
			const result = SubmitAnswerResponseSchema.safeParse(
				await onSubmit(value),
			);
			if (active.current) {
				setConfirmed(value);
				if (result.success) setCorrectness(result.data.isCorrect);
			}
		} catch (cause) {
			if (active.current)
				setError(
					cause instanceof Error
						? cause.message
						: "Couldn't submit your answer. Try again.",
				);
		} finally {
			if (active.current) {
				setBusy(false);
				onRefresh();
			}
		}
	}
	return (
		<section className="game-card" aria-labelledby="question-heading">
			<div className="round-heading">
				<p className="round-meta">
					ROUND {round.sequence} · {snapshot.callerTeam?.name ?? "HOST VIEW"}
				</p>
				<Countdown
					target={round.endsAt}
					serverTime={snapshot.serverTime}
					receivedAt={receivedAt}
					label="Answer window"
				/>
			</div>
			<h2 id="question-heading">{round.question.prompt}</h2>
			{locked !== null ? (
				<div className="wait-panel answer-locked" role="status">
					<svg
						className="lock-check"
						viewBox="0 0 32 32"
						fill="none"
						aria-hidden="true"
					>
						<circle cx="16" cy="16" r="14" />
						<path d="m9 16 5 5 9-10" />
					</svg>
					<div>
						<h3>Answer locked</h3>
						{isCorrect !== undefined && isCorrect !== null ? (
							<p
								className={`answer-feedback ${isCorrect ? "feedback-correct" : "feedback-incorrect"}`}
							>
								{isCorrect ? "Correct · +1 point" : "Incorrect · 0 points"}
							</p>
						) : null}
						<p>
							Your team answer: <strong>{formatAnswer(locked)}</strong>
						</p>
						<p>
							{round.question.type === "ESTIMATE"
								? "Closest estimate wins. Points are awarded after all cars answer."
								: "Your points are counted. Waiting for the other cars."}
						</p>
					</div>
				</div>
			) : canAnswer ? (
				<form onSubmit={confirm} aria-busy={busy}>
					<fieldset className="answer-options" disabled={busy}>
						<legend>Choose your team's answer, then confirm</legend>
						{round.question.type === "ESTIMATE" ? (
							<label className="estimate-label">
								Team estimate
								<input
									type="number"
									inputMode="decimal"
									step="any"
									required
									value={estimate}
									onChange={(event) => setEstimate(event.currentTarget.value)}
								/>
							</label>
						) : (
							choices.map((choice, index) => (
								<label className="answer-choice" key={String(choice)}>
									<input
										type="radio"
										name="team-answer"
										checked={selection === choice}
										onChange={() => setSelection(choice)}
										value={index}
									/>
									{formatAnswer(choice)}
								</label>
							))
						)}
					</fieldset>
					{error ? (
						<p className="form-error" role="alert">
							{error}
						</p>
					) : null}
					<div className="play-actions">
						<button
							className="primary-button"
							aria-busy={busy}
							disabled={busy || value === null}
							type="submit"
						>
							{busy ? "Confirming…" : "Confirm team answer"}
						</button>
					</div>
				</form>
			) : (
				<p className="sync-note">
					The car captains answer. You can follow the question here.
				</p>
			)}
		</section>
	);
}
