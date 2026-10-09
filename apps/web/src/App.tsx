import {
	PUZZLE_FORMATS,
	PUZZLE_PACKS,
	type PuzzleSetup,
	QUESTION_TOPICS,
	type QuestionTopicId,
	QuestionTopicIds,
} from "@carpool/contracts";
import { type FormEvent, useState } from "react";
import { createGame, joinGame } from "./api";
import { GameScreen } from "./screens/GameScreen";
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
	const [invite] = useState(() => {
		const code = new URLSearchParams(window.location.search).get("join");
		return code && /^[A-Za-z0-9]{6}$/.test(code) ? code.toUpperCase() : "";
	});
	const [mode, setMode] = useState<AccessMode>(invite ? "join" : "create");
	const [gameName, setGameName] = useState("");
	const [playStyle, setPlayStyle] = useState("trivia");
	const [puzzleSetup, setPuzzleSetup] = useState<PuzzleSetup>({
		theme: "naruto",
		format: "CHARACTER",
	});
	const [topics, setTopics] = useState<QuestionTopicId[]>([
		...QuestionTopicIds,
	]);
	const [roundIntervalSeconds, setRoundIntervalSeconds] =
		useState<RoundInterval>(300);
	const [joinCode, setJoinCode] = useState(invite);
	const [teamName, setTeamName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [storageWarning, setStorageWarning] = useState<string | null>(null);

	async function handleCreate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const created = await createGame({
				name: gameName,
				teamName,
				roundIntervalSeconds,
				...(playStyle === "puzzles" ? { puzzleSetup } : { topics }),
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

	function activateSession(next: GameSession) {
		setSession(next);
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
		clearSession();
		setSession(null);
		setError(null);
		setStorageWarning(null);
	}

	if (session) {
		return (
			<main className="app-frame">
				<Brand />
				<GameScreen
					key={session.token}
					session={session}
					storageWarning={storageWarning}
					onHome={returnToWelcome}
				/>
				<Footer />
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
							<label htmlFor="host-car-name">Car name</label>
							<input
								autoComplete="off"
								id="host-car-name"
								maxLength={60}
								name="teamName"
								onChange={(event) => setTeamName(event.currentTarget.value)}
								placeholder="Blue Sedan"
								required
								value={teamName}
							/>
							<label htmlFor="play-style">Game style</label>
							<select
								id="play-style"
								value={playStyle}
								onChange={(event) => setPlayStyle(event.currentTarget.value)}
							>
								<option value="trivia">Scheduled trivia</option>
								<option value="puzzles">Timed puzzle rounds</option>
							</select>
							{playStyle === "puzzles" ? (
								<fieldset className="topic-picker">
									<legend>Choose the opening round</legend>
									<label htmlFor="puzzle-theme">Theme</label>
									<select
										id="puzzle-theme"
										value={puzzleSetup.theme}
										onChange={(event) => {
											const pack = PUZZLE_PACKS.find(
												(p) => p.id === event.currentTarget.value,
											);
											if (pack)
												setPuzzleSetup({
													theme: pack.id,
													format: pack.formats[0],
												});
										}}
									>
										{PUZZLE_PACKS.map((p) => (
											<option key={p.id} value={p.id}>
												{p.name}
											</option>
										))}
									</select>
									<label htmlFor="puzzle-format">Game type</label>
									<select
										id="puzzle-format"
										value={puzzleSetup.format}
										onChange={(event) => {
											const format = PUZZLE_PACKS.find(
												(p) => p.id === puzzleSetup.theme,
											)?.formats.find((f) => f === event.currentTarget.value);
											if (format) setPuzzleSetup({ ...puzzleSetup, format });
										}}
									>
										{PUZZLE_PACKS.find(
											(p) => p.id === puzzleSetup.theme,
										)?.formats.map((f) => (
											<option key={f} value={f}>
												{PUZZLE_FORMATS[f]}
											</option>
										))}
									</select>
								</fieldset>
							) : (
								<fieldset className="topic-picker">
									<legend>Choose quiz topics</legend>
									<p aria-live="polite" className="topic-selection-summary">
										{topics.length === QuestionTopicIds.length
											? "Mixed Topics"
											: topics.length === 0
												? "Choose at least one topic."
												: `${topics.length} ${topics.length === 1 ? "topic" : "topics"} selected`}
									</p>
									<div className="topic-options">
										{QuestionTopicIds.map((topic) => (
											<label className="topic-option" key={topic}>
												<input
													checked={topics.includes(topic)}
													name="topics"
													onChange={(event) => {
														const checked = event.currentTarget.checked;
														setTopics((selected) =>
															checked
																? [...selected, topic]
																: selected.filter((item) => item !== topic),
														);
													}}
													type="checkbox"
												/>
												{QUESTION_TOPICS[topic]}
											</label>
										))}
									</div>
								</fieldset>
							)}
							<label htmlFor="round-interval">
								{playStyle === "puzzles" ? "Round duration" : "Round interval"}
							</label>
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
							<p className="form-footnote">
								{playStyle === "puzzles"
									? "Solve as many puzzles as possible before time runs out. Last place picks the next theme; second-last picks the game type."
									: "The next round starts immediately when every car confirms its answer. Otherwise, this interval applies."}
							</p>
							{error && (
								<p className="form-error" role="alert">
									{error}
								</p>
							)}
							<button
								className="primary-button"
								disabled={
									busy || (playStyle === "trivia" && topics.length === 0)
								}
								type="submit"
							>
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
