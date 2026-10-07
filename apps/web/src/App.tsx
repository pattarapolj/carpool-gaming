import type { GameSnapshot } from "@carpool/contracts";
import { type FormEvent, useEffect, useState } from "react";
import { createGame, getGameSnapshot, joinGame, startGame } from "./api";
import {
	clearSession,
	type GameSession,
	loadSession,
	saveSession,
} from "./session";

type AccessMode = "create" | "join";
type RoundInterval = 300 | 600 | 900;

export default function App() {
	const [session, setSession] = useState<GameSession | null>(loadSession);
	const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
	const [mode, setMode] = useState<AccessMode>("create");
	const [gameName, setGameName] = useState("");
	const [roundIntervalSeconds, setRoundIntervalSeconds] =
		useState<RoundInterval>(300);
	const [joinCode, setJoinCode] = useState("");
	const [teamName, setTeamName] = useState("");
	const [practice, setPractice] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [syncError, setSyncError] = useState<string | null>(null);
	const [storageWarning, setStorageWarning] = useState<string | null>(null);

	useEffect(() => {
		if (!session) return;
		let active = true;
		let timer: number | undefined;

		const refresh = async () => {
			try {
				const next = await getGameSnapshot(session);
				if (active) {
					setSnapshot(next);
					setSyncError(null);
				}
			} catch {
				if (active) setSyncError("Can't reach the game right now. Retrying…");
			} finally {
				if (active) timer = window.setTimeout(refresh, 4000);
			}
		};

		void refresh();
		return () => {
			active = false;
			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, [session]);

	async function handleCreate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const created = await createGame({
				name: gameName,
				roundIntervalSeconds,
			});
			activateSession({
				gameId: created.game.id,
				role: "HOST",
				token: created.hostToken,
			});
		} catch (cause) {
			setError(getErrorMessage(cause));
		} finally {
			setBusy(false);
		}
	}

	async function handleJoin(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const joined = await joinGame(joinCode, teamName);
			activateSession({
				gameId: joined.game.id,
				role: "CAPTAIN",
				token: joined.captainToken,
			});
		} catch (cause) {
			setError(getErrorMessage(cause));
		} finally {
			setBusy(false);
		}
	}

	async function handleStart() {
		if (!session || !snapshot) return;
		setBusy(true);
		setError(null);
		try {
			await startGame(session, snapshot.teams.length === 1 && practice);
			setSnapshot(await getGameSnapshot(session));
		} catch (cause) {
			setError(getErrorMessage(cause));
		} finally {
			setBusy(false);
		}
	}

	function activateSession(next: GameSession) {
		setSession(next);
		setSnapshot(null);
		setSyncError(null);
		try {
			saveSession(next);
			setStorageWarning(null);
		} catch {
			setStorageWarning(
				"This browser can't save your session. Keep this tab open to stay connected.",
			);
		}
	}

	function returnToWelcome() {
		try {
			clearSession();
		} finally {
			setSession(null);
			setSnapshot(null);
		}
	}

	if (session) {
		return (
			<main className="app-frame">
				<Brand />
				{snapshot ? (
					<Lobby
						session={session}
						snapshot={snapshot}
						error={error}
						syncError={syncError}
						storageWarning={storageWarning}
						practice={practice}
						busy={busy}
						onPracticeChange={setPractice}
						onStart={handleStart}
					/>
				) : (
					<section className="loading-card" aria-live="polite">
						<div className="loading-mark" aria-hidden="true">
							···
						</div>
						<h1>{syncError ? "Reconnecting" : "Opening your game"}</h1>
						<p>{syncError ?? "Getting the latest game state…"}</p>
						<button
							className="quiet-button"
							onClick={returnToWelcome}
							type="button"
						>
							Use another game
						</button>
					</section>
				)}
			</main>
		);
	}

	return (
		<main className="app-frame">
			<Brand />
			<div className="welcome-layout">
				<section className="welcome-copy">
					<p className="eyebrow">A GAME FOR THE ROAD</p>
					<h1>
						Make the miles
						<br />
						more memorable.
					</h1>
					<p className="welcome-description">
						One phone per car. Everyone plays together. Drivers keep their eyes
						on the road.
					</p>
					<div className="route-stamp" aria-hidden="true">
						<span>PASSENGER PICKS</span>
						<span>·</span>
						<span>TEAM ANSWERS</span>
						<span>·</span>
						<span>GOOD COMPANY</span>
					</div>
				</section>

				<section className="access-card" aria-label="Create or join a game">
					<fieldset className="mode-switch">
						<legend className="visually-hidden">Choose game access</legend>
						<button
							aria-pressed={mode === "create"}
							className={mode === "create" ? "mode-active" : ""}
							onClick={() => {
								setMode("create");
								setError(null);
							}}
							type="button"
						>
							Host a game
						</button>
						<button
							aria-pressed={mode === "join"}
							className={mode === "join" ? "mode-active" : ""}
							onClick={() => {
								setMode("join");
								setError(null);
							}}
							type="button"
						>
							Join a car
						</button>
					</fieldset>

					{mode === "create" ? (
						<form className="access-form" onSubmit={handleCreate}>
							<div>
								<p className="eyebrow form-eyebrow">START THE CONVOY</p>
								<h2>Set up your game</h2>
							</div>
							<label htmlFor="game-name">Game name</label>
							<input
								autoComplete="off"
								id="game-name"
								maxLength={60}
								name="gameName"
								onChange={(event) => setGameName(event.currentTarget.value)}
								placeholder="Saturday coast drive"
								required
								value={gameName}
							/>
							<label htmlFor="round-interval">New round every</label>
							<select
								id="round-interval"
								name="roundIntervalSeconds"
								onChange={(event) =>
									setRoundIntervalSeconds(
										Number(event.currentTarget.value) as RoundInterval,
									)
								}
								value={roundIntervalSeconds}
							>
								<option value={300}>5 minutes</option>
								<option value={600}>10 minutes</option>
								<option value={900}>15 minutes</option>
							</select>
							{error && (
								<p className="form-error" role="alert">
									{error}
								</p>
							)}
							<button className="primary-button" disabled={busy} type="submit">
								{busy ? "Creating game…" : "Create game"}
								<span aria-hidden="true">↗</span>
							</button>
						</form>
					) : (
						<form className="access-form" onSubmit={handleJoin}>
							<div>
								<p className="eyebrow form-eyebrow">YOUR CAR, YOUR TEAM</p>
								<h2>Join the game</h2>
							</div>
							<label htmlFor="join-code">Six-character join code</label>
							<input
								autoCapitalize="characters"
								autoComplete="off"
								className="join-code-input"
								id="join-code"
								maxLength={6}
								minLength={6}
								name="joinCode"
								onChange={(event) =>
									setJoinCode(event.currentTarget.value.toUpperCase())
								}
								pattern="[A-Za-z0-9]{6}"
								placeholder="AB12CD"
								required
								value={joinCode}
							/>
							<label htmlFor="team-name">Car name</label>
							<input
								autoComplete="off"
								id="team-name"
								maxLength={60}
								name="teamName"
								onChange={(event) => setTeamName(event.currentTarget.value)}
								placeholder="Blue Sedan"
								required
								value={teamName}
							/>
							{error && (
								<p className="form-error" role="alert">
									{error}
								</p>
							)}
							<button className="primary-button" disabled={busy} type="submit">
								{busy ? "Joining game…" : "Join game"}
								<span aria-hidden="true">↗</span>
							</button>
						</form>
					)}
					<p className="form-footnote">
						No accounts. Your car captain keeps this phone.
					</p>
				</section>
			</div>
			<Footer />
		</main>
	);
}

function Brand() {
	return (
		<header className="topbar">
			<a className="brand" href="/" aria-label="Carpool Quiz League home">
				<img alt="" height="72" src="/brand/horizontal.svg" width="240" />
			</a>
			<span className="topbar-note">PASSENGER-POWERED PLAY</span>
		</header>
	);
}

function Lobby({
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
		<>
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
								Roster refreshes automatically.
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
			<Footer />
		</>
	);
}

function Footer() {
	return (
		<footer className="footer">
			<span>GOOD QUESTIONS. BETTER COMPANY.</span>
			<span>TAKE THE SCENIC ROUTE</span>
		</footer>
	);
}

function getErrorMessage(cause: unknown) {
	return cause instanceof Error
		? cause.message
		: "Something went wrong. Please try again.";
}
