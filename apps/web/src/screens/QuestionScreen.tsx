import type { GameSnapshot, SubmitAnswerInput } from "@carpool/contracts";
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
			await onSubmit(value);
			if (active.current) setConfirmed(value);
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
			<p className="eyebrow">
				ROUND {round.sequence} · {snapshot.callerTeam?.name ?? "HOST VIEW"}
			</p>
			<h2 id="question-heading">{round.question.prompt}</h2>
			<Countdown
				target={round.endsAt}
				serverTime={snapshot.serverTime}
				receivedAt={receivedAt}
				label="Answer window"
			/>
			{locked !== null ? (
				<div className="wait-panel" role="status">
					<div>
						<h3>Answer locked</h3>
						<p>
							Your team answer: <strong>{formatAnswer(locked)}</strong>
						</p>
						<p>Waiting for the server to reveal the results.</p>
					</div>
				</div>
			) : canAnswer ? (
				<form onSubmit={confirm}>
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
					<button
						className="primary-button"
						disabled={busy || value === null}
						type="submit"
					>
						{busy ? "Confirming…" : "Confirm team answer"}
					</button>
				</form>
			) : (
				<p className="sync-note">
					The car captains answer. You can follow the question here.
				</p>
			)}
		</section>
	);
}
