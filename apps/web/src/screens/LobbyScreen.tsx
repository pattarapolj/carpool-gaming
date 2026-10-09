import type { GameSnapshot } from "@carpool/contracts";
import type { GameSession } from "../session";
import { SharingControls } from "./SharingControls";
export function LobbyScreen({
	session,
	snapshot,
	error,
	syncError,
	storageWarning,
	practice,
	busy,
	onPracticeChange,
	onStart,
}: {
	session: GameSession;
	snapshot: GameSnapshot;
	error: string | null;
	syncError: string | null;
	storageWarning: string | null;
	practice: boolean;
	busy: boolean;
	onPracticeChange: (value: boolean) => void;
	onStart: () => void;
}) {
	const host = session.role === "HOST";
	const waiting = snapshot.game.status === "LOBBY";
	const activeTeamCount = snapshot.teams.length;
	const practiceStart = activeTeamCount === 1 && practice;
	const canStart = activeTeamCount >= 2 || (activeTeamCount === 1 && practice);

	return (
		<section className="lobby-layout">
			<div className="lobby-heading">
				<p className="eyebrow">
					{host ? "YOUR CONVOY" : "YOU'RE ON THE ROSTER"}
				</p>
				<h1>{snapshot.game.name}</h1>
				<p className="lobby-subtitle">
					{waiting
						? host
							? "Invite the other cars, then start when everyone's ready."
							: "You're in. Settle in with your team while the host gets ready."
						: "The game has started. Your next round will appear here."}
				</p>
			</div>

			<div className="lobby-grid">
				<section className="invite-card" aria-labelledby="join-code-heading">
					<div className="invite-topline">
						<span className="eyebrow">INVITE ANOTHER CAR</span>
						<span
							className={`status-pill ${waiting ? "status-open" : "status-live"}`}
						>
							<span aria-hidden="true" className="status-dot" />
							{waiting ? "LOBBY OPEN" : "GAME STARTED"}
						</span>
					</div>
					<h2 id="join-code-heading">Share this join code</h2>
					<p>Each car joins as one team, with a passenger as captain.</p>
					<p className="join-code">{snapshot.game.joinCode}</p>
					<SharingControls joinCode={snapshot.game.joinCode} />
					<div className="invite-meta">
						<span>ROUND INTERVAL</span>
						<strong>{snapshot.game.roundIntervalSeconds / 60} MIN</strong>
					</div>
				</section>

				<section className="roster-card" aria-labelledby="roster-heading">
					<div className="roster-heading">
						<div>
							<p className="eyebrow">THE LINEUP</p>
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
					) : (
						<p className="sync-note" aria-live="polite">
							Roster updates automatically.
						</p>
					)}
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

			{host && waiting ? (
				<section className="start-panel" aria-label="Start the game">
					<div>
						<p className="eyebrow">WHEN YOU'RE READY</p>
						<h2>Take it from here.</h2>
					</div>
					<div className="start-actions">
						{activeTeamCount === 1 && (
							<label className="practice-option">
								<input
									checked={practice}
									onChange={(event) =>
										onPracticeChange(event.currentTarget.checked)
									}
									type="checkbox"
								/>
								Play solo practice
							</label>
						)}
						<button
							className="primary-button start-button"
							disabled={busy || !canStart}
							onClick={onStart}
							type="button"
						>
							{busy
								? "Starting…"
								: practiceStart
									? "Start practice game"
									: "Start game"}
							<span aria-hidden="true">↗</span>
						</button>
					</div>
				</section>
			) : (
				<section className="wait-panel" aria-live="polite">
					<span aria-hidden="true" className="wait-icon">
						✳
					</span>
					<div>
						<strong>{host ? "Game started" : "Waiting for the host"}</strong>
						<p>
							{host
								? "The next round will show here when the quiz begins."
								: "The host will start the game when every car is ready."}
						</p>
					</div>
				</section>
			)}

			<p className="driver-note">
				A passenger runs the phone. Drivers join the conversation hands-free.
			</p>
		</section>
	);
}
