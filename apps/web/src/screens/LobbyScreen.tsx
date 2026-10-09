import {
	type GameSnapshot,
	PUZZLE_FORMATS,
	PUZZLE_PACKS,
	QUESTION_TOPICS,
	QuestionTopicIds,
} from "@carpool/contracts";
import type { GameSession } from "../session";
import { SharingControls } from "./SharingControls";
export function LobbyScreen({
	session,
	snapshot,
	error,
	syncError,
	storageWarning,
	busy,
	onStart,
}: {
	session: GameSession;
	snapshot: GameSnapshot;
	error: string | null;
	syncError: string | null;
	storageWarning: string | null;
	busy: boolean;
	onStart: () => void;
}) {
	const host = session.role === "HOST";
	const waiting = snapshot.game.status === "LOBBY";
	const activeTeamCount = snapshot.teams.length;
	const practiceStart = activeTeamCount === 1;
	const canStart = activeTeamCount >= 1;
	const selectedTopics = snapshot.game.selectedTopics;

	return (
		<section className="lobby-layout">
			<div className="lobby-heading">
				<h1>{snapshot.game.name}</h1>
				<p className="lobby-subtitle">
					{waiting
						? host
							? "Invite the other cars, then start when everyone's ready."
							: "You're in. Settle in with your team while the host gets ready."
						: "The game has started. Your next round will appear here."}
				</p>
			</div>

			{host && waiting ? (
				<section className="start-panel" aria-label="Start the game">
					<p className="start-hint">
						{practiceStart
							? "Start solo now, or wait for another car."
							: "Ready when your cars are."}
					</p>
					<button
						className="primary-button start-button"
						aria-busy={busy}
						disabled={busy || !canStart}
						onClick={onStart}
						type="button"
					>
						{busy
							? "Starting…"
							: practiceStart
								? "Start practice game"
								: "Start game"}
						<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<path d="M5 12h14m-6-6 6 6-6 6" />
						</svg>
					</button>
				</section>
			) : null}

			<div className="lobby-grid">
				<section className="invite-card" aria-labelledby="join-code-heading">
					<h2 id="join-code-heading">Share this join code</h2>
					<p>Each car joins as one team, with a passenger as captain.</p>
					<p className="join-code">{snapshot.game.joinCode}</p>
					<SharingControls joinCode={snapshot.game.joinCode} />
					<div className="invite-meta">
						<span>
							{snapshot.game.puzzleSetup ? "ROUND DURATION" : "ROUND INTERVAL"}
						</span>
						<strong>{snapshot.game.roundIntervalSeconds / 60} MIN</strong>
					</div>
					{snapshot.game.puzzleSetup ? (
						<fieldset className="lobby-topics">
							<legend>Opening puzzle round</legend>
							<strong>
								{
									PUZZLE_PACKS.find(
										(p) => p.id === snapshot.game.puzzleSetup?.theme,
									)?.name
								}{" "}
								· {PUZZLE_FORMATS[snapshot.game.puzzleSetup.format]}
							</strong>
							<p>Solve the most puzzles before the timer ends.</p>
						</fieldset>
					) : (
						<fieldset className="lobby-topics">
							<legend>Selected quiz topics</legend>
							<strong>
								{selectedTopics.length === QuestionTopicIds.length
									? "Mixed Topics"
									: selectedTopics
											.map((topic) => QUESTION_TOPICS[topic])
											.join(", ")}
							</strong>
						</fieldset>
					)}
				</section>

				<section className="roster-card" aria-labelledby="roster-heading">
					<div className="roster-heading">
						<div>
							<h2 id="roster-heading">Cars in the game</h2>
						</div>
						<span className="team-count">
							{activeTeamCount} {activeTeamCount === 1 ? "car" : "cars"}
						</span>
					</div>
					{activeTeamCount === 0 ? (
						<p className="empty-roster">
							No cars yet. Share your code to bring the convoy together.
						</p>
					) : (
						<ul className="team-list">
							{snapshot.teams.map((team, index) => (
								<li className="team-row" key={team.id}>
									<span className="team-number">
										{String(index + 1).padStart(2, "0")}
									</span>
									<span className="team-name">{team.name}</span>
									<span className="team-score">{team.score} pts</span>
								</li>
							))}
						</ul>
					)}
					{syncError ? (
						<p className="sync-error" role="status">
							{syncError}
						</p>
					) : null}
				</section>
			</div>

			{storageWarning && (
				<p className="storage-warning" role="status">
					{storageWarning}
				</p>
			)}
			{error && (
				<p className="form-error lobby-error" role="alert">
					{error}
				</p>
			)}

			{!host || !waiting ? (
				<section className="wait-panel" aria-live="polite">
					<div>
						<strong>{host ? "Game started" : "Waiting for the host"}</strong>
						<p>
							{host
								? "The next round will show here when the quiz begins."
								: "The host will start the game when every car is ready."}
						</p>
					</div>
				</section>
			) : null}

			<p className="driver-note">
				A passenger runs the phone. Drivers join the conversation hands-free.
			</p>
		</section>
	);
}
