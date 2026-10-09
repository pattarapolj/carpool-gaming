import type { GameSnapshot } from "@carpool/contracts";
import { Countdown } from "./Countdown";
import { formatAnswer } from "./QuestionScreen";

export function Leaderboard({ snapshot }: { snapshot: GameSnapshot }) {
	return (
		<section className="roster-card" aria-labelledby="leaderboard-heading">
			<h2 id="leaderboard-heading">
				{snapshot.game.status === "COMPLETE"
					? "Final leaderboard"
					: "Leaderboard"}
			</h2>
			<ol className="team-list">
				{snapshot.leaderboard.map((team) => (
					<li className="team-row" key={team.id}>
						<span
							className="team-number"
							role="img"
							aria-label={`Rank ${team.rank}`}
						>
							{team.rank}
						</span>
						<span className="team-name">
							{team.name}
							{team.status === "LEFT" ? (
								<span className="left-label"> · Left</span>
							) : null}
						</span>
						<span className="team-score">{team.score} pts</span>
					</li>
				))}
			</ol>
			{snapshot.leaderboard.length === 0 ? (
				<p>No cars joined this game.</p>
			) : null}
		</section>
	);
}

export function ResultsScreen({
	snapshot,
	receivedAt,
	waiting = true,
}: {
	snapshot: GameSnapshot;
	receivedAt: number;
	waiting?: boolean;
}) {
	const round = snapshot.round;
	const complete = snapshot.game.status === "COMPLETE";
	const reasons = {
		HOST_ENDED: "The host ended the game.",
		TIME_LIMIT: "The two-hour game is complete.",
		QUESTION_BANK_EXHAUSTED: "You've played every available question.",
		NO_ACTIVE_TEAMS: "All cars have left the game.",
	};
	// A schedule at the hard limit closes the game; it cannot promise another question.
	const nextQuestion =
		snapshot.game.nextRoundAt &&
		snapshot.game.startedAt &&
		Date.parse(snapshot.game.nextRoundAt) <
			Date.parse(snapshot.game.startedAt) + 7200000
			? snapshot.game.nextRoundAt
			: null;
	return (
		<>
			{complete ? (
				<section className="game-card">
					<p className="eyebrow">JOURNEY COMPLETE</p>
					<h2>Thanks for playing together.</h2>
					<p>
						{snapshot.game.completionReason
							? reasons[snapshot.game.completionReason]
							: "The game is complete."}
					</p>
				</section>
			) : null}
			{round?.status === "REVEALED" ? (
				<section className="game-card" aria-labelledby="results-heading">
					<p className="eyebrow">ROUND {round.sequence} RESULTS</p>
					<h2 id="results-heading">{round.question.prompt}</h2>
					<p className="revealed-answer">
						Answer: <strong>{formatAnswer(round.correctAnswer)}</strong>
					</p>
					<p>{round.explanation}</p>
					{round.results ? (
						<ul className="team-list">
							{round.results.map((result) => (
								<li className="result-row" key={result.teamId}>
									<strong>{result.name}</strong>
									<span>
										{formatAnswer(result.value)} ·{" "}
										{result.isCorrect ? "Correct" : "No point"} · +
										{result.pointsAwarded} pts
									</span>
								</li>
							))}
						</ul>
					) : (
						<p>Historical round results are unavailable.</p>
					)}
				</section>
			) : null}
			<Leaderboard snapshot={snapshot} />
			{!complete && waiting ? (
				<section className="wait-panel">
					<div>
						<strong>Enjoy the miles between rounds.</strong>
						<Countdown
							target={nextQuestion}
							serverTime={snapshot.serverTime}
							receivedAt={receivedAt}
							label="Next scheduled round"
						/>
					</div>
				</section>
			) : null}
		</>
	);
}
