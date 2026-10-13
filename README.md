# Carpool Quiz League

Carpool Quiz League is a slow-paced, passenger-operated trivia game for groups travelling in separate cars. Each car competes as a team, represented in the application by a car captain. Drivers participate verbally while passengers operate the device.

## Game model

Movie and TV trivia focuses on story facts: character choices, relationships, powers, objects and memorable scenes. Breaking Bad and Marvel production-credit and episode-lookup questions are retired, and Harry Potter includes corrections and clearer book context. Each category still has 300 playable questions; historical questions remain stored for existing rounds. See the [story trivia guidelines](docs/story-trivia-guidelines.md).

Choose **Timed puzzle rounds** under **Game style** when creating a game to play the new format. The host selects the opening theme/game type and a 5, 10 or 15-minute round duration. Each car works independently through the same shuffled puzzles, guessing until correct. Music rounds offer **Give up & reveal**: the title and artist stay visible to that car until **Next song**, earn zero points, and cannot be answered again. Unavailable song clips offer **Skip unavailable song** without revealing the answer; skipped songs and other puzzles can be revisited with saved clues. Searchable answer suggestions accept alternate names without charging spelling mistakes. Each guess shows correct/incorrect feedback, including after advancing to the next puzzle. The trip leaderboard includes one point per solved puzzle immediately; round-end scoring commits those points without counting them again.

Last place chooses the next theme, then second-last chooses a supported game type and starts the next round. Equal scores share a placing; saved random tie ordering assigns two distinct chooser roles. Solo practice chooses both. If a chooser leaves, an active car takes over. Host end, reconnect and the two-hour trip limit still apply.

Starter packs include eight original animal pictures and 300 animal trivia questions, K-pop (300 recordings across 26 artists), four international decade song packs (300 songs each), Hit Songs (300 familiar singles across decades), Pop Hits (150), Rock Hits (100), Dance & EDM (100), Taylor Swift (322 songs across 16 albums including Taylor’s Version releases), Ed Sheeran (148 songs across eight studio albums and the Tour Collection), Adele (46 songs across 19, 21, 25 and 30), and Imagine Dragons (141 songs from studio albums, early EPs, demos and collaborations), using Deezer previews. Deluxe tracks are included and repeated titles within an artist pack are deduplicated. Every pack is shuffled for each new round without duplicate puzzle IDs. Naruto is no longer selectable; existing rounds remain readable. Wrong picture guesses reveal finer detail; wrong song guesses unlock 2, 4, 8, then 15 seconds of the same preview. Search by song title or artist and select an answer to avoid typos. Packs are finite: after reaching the end, revisit skipped puzzles or wait for the timer. Existing synthesized-melody rounds remain playable; new music rounds use real recordings.

Song clues require outbound HTTPS access to `api.deezer.com` and `cdnt-preview.dzcdn.net`, plus `ffmpeg` on the API host (included in Docker). No API key is required. The server validates the team's current puzzle, clips audio outside database locks, strips metadata, and returns only the unlocked audio; signed provider URLs and track IDs stay private. Music rounds prepare the first clip before starting their timer, then prefetch the next two recordings. Previews are cached in memory for one hour with a 90-preview cap (about 43 MB); temporary provider failures retry once, and failures offer manual retry or skip/revisit. A persistent availability ledger and a serialized background check every 30 seconds exclude confirmed unavailable recordings from new rounds while preserving existing game IDs. Appended song-bank entries are checked first; see [preview operations](docs/song-preview-operations.md) for a manual catalog scan. Songs may become unavailable by region or provider policy. Confirm Deezer's permission before wider/public or commercial distribution; API availability alone does not grant game usage rights.

The existing **Scheduled trivia** style remains available:

- A host creates a private game, names their car, selects one or more quiz topics and shares its join code.
- Each car joins as one team and designates a passenger as captain.
- Every car receives the same question at the same scheduled time.
- Questions are chosen randomly without repeats from the game’s selected topics. The bank currently contains 300 questions per topic across 18 categories; ordinary questions allow 60 seconds and logic, lateral-thinking and probability puzzles allow 180 seconds.
- Captains submit one team answer before the deadline.
- Multiple-choice and true/false submissions immediately show correct/incorrect feedback and count points. Closest-estimate points wait until every car answers or the deadline; the closest answer wins. The server reveals the answer and publishes final round results to every car without counting points twice.
- When every car confirms an answer, the next round starts immediately. Otherwise, the configured schedule applies. Previous results remain visible below the next question.

The [2026-10-09 behavior amendment](docs/delivery/two-phone-gameplay.md) supersedes earlier spectator-host and fixed-wait rules. Topic selection is saved with the game and restored from the server snapshot.

## Architecture

| Component | Responsibility |
|---|---|
| React PWA | Passenger-facing game screens and session recovery. |
| Fastify API | HTTP validation, authorization and game operations. |
| Socket.IO | Synchronized round, answer and leaderboard events. |
| PostgreSQL | Durable games, teams, questions, rounds and answers. |
| `packages/contracts` | Shared runtime schemas and TypeScript types used by clients and the API. |

Server time is authoritative for deadlines, scoring and reveals. Clients display server state but do not determine game outcomes.

## Repository structure

```text
apps/api/             Fastify API and API tests
apps/web/             React PWA for lobby, passenger gameplay and recovery
packages/contracts/   Shared Zod schemas and contract tests
docs/specs/           Product, architecture, detailed design and API contracts
docs/testing/         Test strategy and acceptance catalog
docs/delivery/        Implementation and release processes
```

## Requirements

- Node.js 22
- pnpm 10.23.0

## Setup

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
docker compose up --build
```

The built app is available at `http://localhost:3000`; check `/health`. One unprivileged Fastify process serves the PWA, API and Socket.IO. Compose keeps PostgreSQL private, applies journaled migrations on startup and idempotently loads the 5,400 playable-question bank. The app port is bound to localhost; use the documented HTTPS proxy before public hosting.

Set `FRONTEND_ORIGIN` to the exact browser origin (default example `http://localhost:3000`). HTTP and both Socket.IO transports enforce it; authenticated native clients without Origin remain supported. Sessions retain read access after COMPLETE/LEFT while their game/team exists. Refresh and automatic reconnect restore the authoritative snapshot, and connected clients reconcile every 15 seconds.

`docker compose down` stops services while keeping data. Existing pre-journal databases require explicit verified adoption after backup and restore rehearsal; startup refuses to guess migration history. Follow the [production runbook](docs/delivery/production-runbook.md) for adoption, upgrades, backups/restores, recovery, HTTPS and the single-process limit. Never delete a production volume to make migrations run.

The lobby offers the join code, a token-free invite URL, clipboard copying and native sharing where available. A fresh `?join=AB12CD` invite prefills the join form without automatically joining. Captains select an answer and confirm separately; only a successful server confirmation or their stored own answer locks the controls. Hosts follow the public question without answer controls. Revealed results and rankings come from the server, including left cars. Countdown displays use server time plus elapsed performance time and never open, reveal or score a round locally. Leave/end require explicit confirmation; returning home clears only this browser's game session.

For development, provision a reachable PostgreSQL database and set `DATABASE_URL` explicitly. The production Compose database has no host port. For example, create a separate local development database:

```powershell
docker run --name carpool-dev-db -e POSTGRES_USER=carpool_dev -e POSTGRES_PASSWORD=local-dev-only -e POSTGRES_DB=carpool_dev -p 127.0.0.1:54330:5432 -d postgres:16-alpine
$env:DATABASE_URL='postgres://carpool_dev:local-dev-only@127.0.0.1:54330/carpool_dev'
$env:FRONTEND_ORIGIN='http://localhost:5173'
pnpm dev
```

Open `http://localhost:5173`; Vite proxies API and live traffic to port 3000. `pnpm build` assembles compiled API, SQL and PWA assets; set `NODE_ENV=production` and a matching `FRONTEND_ORIGIN` before `pnpm start` to serve them together. Environment variables must be supplied to the process; `.env` is read by Compose, not automatically by Node.

The implemented app includes lobby operations, immutable answers, server scoring/reveal, durable snapshots, lifecycle/capacity policy, live delivery and passenger gameplay. Component checks and actual Chromium host/three-car journeys pass; see the [acceptance checklist](docs/testing/manual-three-car-checklist.md). Implementation and shared contracts through `87472fc` are reviewed; its [hosted PR verify run](https://github.com/pattarapolj/carpool-gaming/actions/runs/37885006560) passed, including build, 195 ordinary tests, PostgreSQL, migration safety and three browser tests. Subsequent heads require their own hosted checks and scoped review. Main protection is unavailable on the current private-repository plan (GitHub returned 403 requiring Pro or public visibility); no settings were changed. The October 8 local production rehearsal is recorded in the [quality guide](docs/delivery/quality-and-release.md); no public deployment, physical phone/PWA/cellular acceptance or permanent Docker-host repair is claimed.

Migrations `003_round_storage.sql` through `006_question_topics.sql` add attributed questions, rounds, immutable team submissions, original round participants, completion metadata, question topics/windows and saved game topic selections. Migration `014_nba_quiz_topic.sql` adds NBA. Migration `013_expanded_quiz_topics.sql` adds four quiz categories and updates the default for new games while preserving saved selections. Existing questions are backfilled to Science & Space with 60-second windows, and existing games default to all topics. The finite catalog is Around the World, Thailand, Food & Drinks, Weird but True, Animals & Nature, Science & Space, Taylor Swift, Breaking Bad, Marvel, Logic & Clever Strategies, Lateral Thinking, Probability Puzzles, Closest Estimate, Harry Potter (seven-book spoilers), History, Sports, Video Games and NBA. Each has 300 questions. Mixed Topics means the selected topics together; it has no duplicate bank. A game selects uniformly from unused eligible questions in those topics, never repeats a question within that game, and waits at the two-hour boundary when no full answer window remains. Question sources and content-review notes are in [the bank review](docs/delivery/question-bank-review.md). Startup and the explicit `db-command.js seed` command load the bank idempotently with `ON CONFLICT (id) DO NOTHING`, preserving existing records and released question IDs.

The round service locks answers, scores/reveals atomically and skips missed schedule slots while preserving the start-time anchor. When all original-roster cars answer, it opens the next eligible round immediately with a full answer window. The listening API reveals expired rounds and opens subsequent due questions every second; shutdown drains coordinator work before closing storage. Snapshots recover the latest public round, caller-only locked answer, saved topic selection, original reveal results and all-team competition ranks under a shared game lock. Owning-host end force-reveals and completes atomically; automatic completion enforces the two-hour limit, selected-pool exhaustion and no-ACTIVE policy. Lobby admission caps ACTIVE teams at 20 with duplicate-name precedence. Reloading question seeds retains stored content and scores; revised released questions need new IDs.

## Quality checks

```powershell
pnpm --filter @carpool/api test test/health.test.ts
pnpm --filter @carpool/contracts test
pnpm --filter @carpool/api test test/routes/games.create.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the separate PostgreSQL check against an explicitly provisioned disposable database named exactly `carpool_test` (never your application database):

```powershell
$env:TEST_DATABASE_URL='postgres://carpool_test:carpool-test-only@127.0.0.1:54329/carpool_test'
pnpm --filter @carpool/api test:postgres
pnpm --filter @carpool/api test:migrations
pnpm test:browser
```

The example port must match your dedicated PostgreSQL 16 instance. The command rejects absent/unsafe URLs before connecting, applies every migration and the sample questions inside a generated schema, then removes only that schema in `finally`. It neither creates nor drops databases. On 2026-10-08, PostgreSQL 16.14 passed overlapping same-team HTTP answers (one immutable answer and duplicate `409`), deadline/final-answer races in both orders (points once), overlapping round openers, deadline rechecking after a real row-lock wait, scoring rollback, atomic snapshots waiting for a scoring commit, and overlapping coordinator ticks. These checks use separate connections and observed lock waits; PGlite alone does not establish those guarantees. The same check also passes competing final-slot joins, host end/answer/deadline races in both orders, hard-limit rejection after lock waits and snapshots waiting for atomic completion. Real Socket.IO tests cover the listening API with PGlite; PostgreSQL also passes authenticated WebSocket reveal/completion delivery during independently locked HTTP answer/end contention. Chromium acceptance covers three-car synchronization, reconnect, capacity and the two-hour boundary; physical phone checks remain unverified.

Final local Task 10 verification on 2026-10-08 passed 195 ordinary tests (139 API, 25 contracts, 31 web), all 15 real PostgreSQL scenarios, the migration safety check and all 3 browser-suite tests, plus lint/typecheck/build. The built-container two-car journey, automatic reconnect after process restart, explicit legacy adoption/upgrade and backup/restore into a separate runnable app all passed. These local observations do not establish release-head hosted CI or external/physical-device acceptance.

Run one named test with Vitest's `-t` option:

```powershell
pnpm --filter @carpool/contracts test -t "accepts supported round interval 300"
pnpm --filter @carpool/api test test/routes/games.create.test.ts -t "creates a game with a normalized join code"
```

## Documentation

The web app uses the approved Shared Answer logo in its header, browser tabs and install icons. See the [brand asset guide](docs/branding.md) for reusable SVGs and usage notes.

1. [Product requirements](docs/specs/product.md)
2. [High-level design](docs/specs/design.md)
3. [Low-level design](docs/specs/lld.md)
4. [API and behavior contracts](docs/specs/contracts.md)
5. [Test specification](docs/testing/test-spec.md)
6. [Implementation plan](docs/delivery/implementation-plan.md)
7. [Production runbook](docs/delivery/production-runbook.md)
8. [Quality and release guide](docs/delivery/quality-and-release.md)

See [CONTRIBUTING](CONTRIBUTING.md) for the branch, review and commit workflow.
