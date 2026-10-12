import {
	type GameSnapshot,
	PUZZLE_FORMATS,
	PUZZLE_PACKS,
	type PuzzleAction,
	type PuzzleView,
} from "@carpool/contracts";
import { useEffect, useRef, useState } from "react";
import { getSongClip } from "../api";
import type { GameSession } from "../session";
import { Countdown } from "./Countdown";
import { Leaderboard } from "./ResultsScreen";

export function PuzzleScreen({
	session,
	snapshot,
	receivedAt,
	onAction,
	busy,
	disconnected,
}: {
	session?: GameSession;
	snapshot: GameSnapshot;
	receivedAt: number;
	onAction: (action: PuzzleAction) => Promise<boolean>;
	busy: boolean;
	disconnected: boolean;
}) {
	const view = snapshot.puzzles;
	const [now, setNow] = useState(() => performance.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(performance.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);
	if (!view) return null;
	const pack = PUZZLE_PACKS.find((p) => p.id === view.round.theme);
	const complete = snapshot.game.status === "COMPLETE";
	const expired =
		Date.parse(snapshot.serverTime) + Math.max(0, now - receivedAt) >=
		Date.parse(view.round.endsAt);
	const disabled = busy || disconnected || complete;
	const nameFor = (id: string | null) =>
		snapshot.teams.find((t) => t.id === id)?.name ?? "an active car";
	const myId = snapshot.callerTeam?.id;
	const nextPack = PUZZLE_PACKS.find((p) => p.id === view.selection.theme);
	const skipped = view.skipped.filter((p) => p.id !== view.puzzle?.id);
	return (
		<section className="puzzle-round" aria-labelledby="puzzle-round-heading">
			<div className="round-heading">
				<div>
					<p className="round-meta">
						Round {view.round.sequence} · {pack?.name}
					</p>
					<h2 id="puzzle-round-heading">{PUZZLE_FORMATS[view.round.format]}</h2>
				</div>
				{view.round.status === "OPEN" && !complete ? (
					<Countdown
						target={view.round.endsAt}
						serverTime={snapshot.serverTime}
						receivedAt={receivedAt}
						label="Round ends in"
					/>
				) : null}
			</div>
			{view.round.status === "OPEN" && !complete ? (
				<>
					<p className="puzzle-score" role="status">
						Your car solved {view.solved} of {view.round.total} puzzles
					</p>
					<p className="puzzle-instructions">
						One point per solve. Keep guessing until time runs out.
					</p>
					{view.puzzle ? (
						<GuessPuzzle
							session={session}
							key={`${view.round.id}:${view.puzzle.id}`}
							puzzle={view.puzzle}
							options={view.options}
							roundId={view.round.id}
							format={view.round.format}
							disabled={disabled || expired}
							onAction={onAction}
						/>
					) : (
						<p role="status">
							{myId
								? view.skipped.length
									? "You've reached the end of this pack. Revisit skipped puzzles while time remains."
									: "You've reached the end of this pack. Wait for the round results."
								: "Your host session has no car. Watch the round and leaderboard here."}
						</p>
					)}
					{expired ? (
						<p role="status">Time is up. Waiting for the server's results…</p>
					) : null}
					{skipped.length ? (
						<details className="play-disclosure">
							<summary>Skipped puzzles ({skipped.length})</summary>
							<fieldset className="skipped-puzzles">
								<legend className="visually-hidden">
									Choose a puzzle to revisit
								</legend>
								<div className="action-row">
									{skipped.map((p) => (
										<button
											className="quiet-button"
											type="button"
											key={p.id}
											disabled={
												disabled ||
												expired ||
												Boolean(view.puzzle?.revealedAnswer)
											}
											onClick={() =>
												void onAction({
													kind: "revisit",
													roundId: view.round.id,
													puzzleId: p.id,
												})
											}
										>
											Revisit puzzle {p.number}
										</button>
									))}
								</div>
								<p>
									Guesses and clues are saved. Skipping does not reveal more.
								</p>
							</fieldset>
						</details>
					) : null}
				</>
			) : (
				<>
					<h3>{complete ? "Trip complete" : "Round results"}</h3>
					{!complete ? (
						<>
							<ol className="team-list">
								{view.results.map((t) => (
									<li className="team-row" key={t.teamId}>
										<span className="team-number">{t.rank}</span>
										<span className="team-name">{t.name}</span>
										<span className="team-score">{t.solved} solved</span>
									</li>
								))}
							</ol>
							<p>
								Equal solved counts share a placing. Tied chooser roles are
								assigned randomly.
							</p>
						</>
					) : null}
					{!complete ? (
						<section className="next-picks">
							<h3>Pick the next round</h3>
							<p>
								{nameFor(view.selection.themeTeamId)} chooses the theme.{" "}
								{nameFor(view.selection.formatTeamId)} chooses the game type.
							</p>
							{!view.selection.theme && myId === view.selection.themeTeamId ? (
								<fieldset>
									<legend>Your car chooses the theme</legend>
									<div className="action-row">
										{PUZZLE_PACKS.map((p) => (
											<button
												className="quiet-button"
												key={p.id}
												type="button"
												disabled={disabled}
												onClick={() =>
													void onAction({
														kind: "theme",
														roundId: view.round.id,
														theme: p.id,
													})
												}
											>
												{p.name}
											</button>
										))}
									</div>
								</fieldset>
							) : null}
							{view.selection.theme ? (
								<p>
									Next theme: <strong>{nextPack?.name}</strong>
								</p>
							) : (
								<p role="status">Waiting for the theme choice.</p>
							)}
							{nextPack && myId === view.selection.formatTeamId ? (
								<fieldset>
									<legend>Your car chooses the game type</legend>
									<div className="action-row">
										{nextPack.formats.map((format) => (
											<button
												className="primary-button"
												type="button"
												key={format}
												disabled={disabled}
												onClick={() =>
													void onAction({
														kind: "format",
														roundId: view.round.id,
														format,
													})
												}
											>
												{PUZZLE_FORMATS[format]}
											</button>
										))}
									</div>
									<p>
										Choosing a game type starts the next timed round for every
										car.
									</p>
								</fieldset>
							) : null}
						</section>
					) : null}
				</>
			)}
			{view.round.status === "OPEN" && !complete ? (
				<details className="play-disclosure">
					<summary>Leaderboard</summary>
					<Leaderboard snapshot={snapshot} />
				</details>
			) : (
				<Leaderboard snapshot={snapshot} />
			)}
		</section>
	);
}

function normalize(value: string) {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();
}
function GuessPuzzle({
	session,
	puzzle,
	options,
	roundId,
	format,
	disabled,
	onAction,
}: {
	session?: GameSession;
	puzzle: NonNullable<PuzzleView["puzzle"]>;
	options: PuzzleView["options"];
	roundId: string;
	format: PuzzleView["round"]["format"];
	disabled: boolean;
	onAction: (action: PuzzleAction) => Promise<boolean>;
}) {
	const [query, setQuery] = useState("");
	const [answerId, setAnswerId] = useState("");
	const answerInput = useRef<HTMLInputElement>(null);
	const available = options.filter(
		(o) => !puzzle.guesses.some((g) => g.name === o.name),
	);
	const matches = available.filter((o) =>
		[o.name, ...o.aliases].some((name) =>
			normalize(name).includes(normalize(query)),
		),
	);
	return (
		<div className="guess-puzzle">
			<div className="puzzle-clue">
				<h3>Puzzle {puzzle.number}</h3>
				<p>{puzzle.prompt}</p>
				{format === "PICTURE" && puzzle.media ? (
					<img
						className="puzzle-image"
						src={puzzle.media}
						width="320"
						height="320"
						alt="Partially revealed mystery animal"
					/>
				) : null}
				{format === "MUSIC" && puzzle.media && !puzzle.revealedAnswer ? (
					<SongClip
						key={`${puzzle.id}:${puzzle.media}`}
						session={session}
						puzzleId={puzzle.id}
						source={puzzle.media}
						disabled={disabled}
						onSkip={() =>
							void onAction({ kind: "skip", roundId, puzzleId: puzzle.id })
						}
					/>
				) : null}
			</div>
			{puzzle.revealedAnswer ? (
				<section
					className="song-reveal"
					aria-label="Revealed song"
					aria-live="polite"
				>
					<h4>{puzzle.revealedAnswer}</h4>
					<p>0 points · Your car gave up on this song.</p>
					<button
						type="button"
						className="primary-button"
						disabled={disabled}
						onClick={() =>
							void onAction({ kind: "next", roundId, puzzleId: puzzle.id })
						}
					>
						Next song
					</button>
				</section>
			) : (
				<form
					className="access-form puzzle-answer-form"
					onSubmit={(event) => {
						event.preventDefault();
						if (
							answerId &&
							!disabled &&
							available.some((o) => o.id === answerId)
						)
							void onAction({
								kind: "guess",
								roundId,
								puzzleId: puzzle.id,
								answerId,
							}).then((accepted) => {
								if (accepted) {
									setQuery("");
									setAnswerId("");
								}
							});
					}}
				>
					<label htmlFor="puzzle-answer">Search answers</label>
					<input
						id="puzzle-answer"
						ref={answerInput}
						autoComplete="off"
						maxLength={100}
						value={query}
						disabled={disabled}
						aria-describedby="answer-help"
						placeholder={
							format === "MUSIC" ? "Song title or artist" : "Type a name…"
						}
						onChange={(event) => {
							const value = event.currentTarget.value;
							setQuery(value);
							const exact = available.filter((o) =>
								[o.name, ...o.aliases].some(
									(name) => normalize(name) === normalize(value),
								),
							);
							setAnswerId(exact.length === 1 ? exact[0].id : "");
						}}
					/>
					<p id="answer-help">Choose a matching name, then Guess.</p>
					{query.trim() && !answerId ? (
						<fieldset className="answer-suggestions" disabled={disabled}>
							<legend className="visually-hidden">Answer suggestions</legend>
							{matches.map((o) => (
								<button
									key={o.id}
									type="button"
									className="suggestion-button"
									aria-pressed={answerId === o.id}
									onClick={() => {
										setQuery(o.name);
										setAnswerId(o.id);
										answerInput.current?.focus();
									}}
								>
									{o.name}
								</button>
							))}
							{!matches.length ? (
								<p>No unused answers match. Try part of a name.</p>
							) : null}
						</fieldset>
					) : null}
					<div className="action-row play-actions">
						<button
							type="submit"
							className="primary-button"
							disabled={disabled || !available.some((o) => o.id === answerId)}
						>
							Guess
						</button>
						<button
							type="button"
							className="quiet-button"
							disabled={disabled}
							onClick={() =>
								void onAction({
									kind: format === "MUSIC" ? "give-up" : "skip",
									roundId,
									puzzleId: puzzle.id,
								})
							}
						>
							{format === "MUSIC" ? "Give up & reveal" : "Skip puzzle"}
						</button>
					</div>
				</form>
			)}
			{format === "MUSIC" && !puzzle.revealedAnswer ? (
				<p className="answer-help">
					Giving up reveals the song for your car and earns 0 points.
				</p>
			) : null}
			{puzzle.guesses.length ? (
				<section aria-label="Your guesses" aria-live="polite">
					<h4>Your guesses</h4>
					<ol className="guess-history">
						{puzzle.guesses.map((g, index) => (
							<li key={g.name}>
								<details open={index === puzzle.guesses.length - 1}>
									<summary>
										<strong>{g.name}</strong>
										<span>{g.correct ? " — Correct" : " — Try again"}</span>
									</summary>
									<ul className="attribute-feedback">
										{g.feedback.map((f) => (
											<li
												className={`feedback-${f.match.toLowerCase()}`}
												key={f.attribute}
											>
												{f.attribute}: {f.value} —{" "}
												{f.match === "MATCH"
													? "Match"
													: f.match === "PARTIAL"
														? "Partial match"
														: "Mismatch"}
											</li>
										))}
									</ul>
								</details>
							</li>
						))}
					</ol>
				</section>
			) : null}
		</div>
	);
}

function SongClip({
	session,
	puzzleId,
	source,
	disabled,
	onSkip,
}: {
	session?: GameSession;
	puzzleId: string;
	source: string;
	disabled: boolean;
	onSkip: () => void;
}) {
	const [media, setMedia] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [retry, setRetry] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly reloads the clip.
	useEffect(() => {
		let active = true;
		setMedia(null);
		setError(null);
		if (!source.startsWith("song-clip:")) setMedia(source);
		else if (session)
			void getSongClip(session, puzzleId)
				.then((clip) => {
					if (active) setMedia(clip);
				})
				.catch((reason: unknown) => {
					if (active)
						setError(
							reason instanceof Error
								? reason.message
								: "Song clip unavailable. Retry or skip this song.",
						);
				});
		else setError("Sign in to load the song clip, or skip this song.");
		return () => {
			active = false;
		};
	}, [session, puzzleId, source, retry]);
	return (
		<div>
			{source.startsWith("song-clip:") ? (
				<p>{source.slice(10)}-second clip · Preview supplied by Deezer</p>
			) : null}
			{media ? (
				<audio
					controls={!disabled}
					preload="metadata"
					src={media}
					onError={() => {
						setMedia(null);
						setError(
							"Your browser cannot play this clip. Retry or skip this song.",
						);
					}}
				>
					<track kind="captions" />
					Your browser cannot play this clip.
				</audio>
			) : !error ? (
				<p role="status">Preparing song clip…</p>
			) : null}
			{error ? (
				<>
					<p role="alert">{error}</p>
					<button
						type="button"
						className="quiet-button"
						disabled={disabled}
						onClick={() => setRetry((attempt) => attempt + 1)}
					>
						Retry song clip
					</button>
				</>
			) : null}
			{!media ? (
				<>
					<p>
						Skip if needed. Skipping earns 0 points and does not reveal the
						song. You can revisit it while time remains.
					</p>
					<button
						type="button"
						className="quiet-button"
						disabled={disabled}
						onClick={onSkip}
					>
						Skip unavailable song
					</button>
				</>
			) : null}
		</div>
	);
}
