# Carpool Quiz League

Carpool Quiz League is a slow-paced, passenger-operated trivia game for groups travelling in separate cars. Each car competes as a team, represented in the application by a car captain. Drivers participate verbally while passengers operate the device.

## Game model

- A host creates a private game and shares its join code.
- Each car joins as one team and designates a passenger as captain.
- Every car receives the same question at the same scheduled time.
- Captains submit one team answer before the deadline.
- The server reveals the answer, awards points and publishes the same leaderboard to every car.
- Rounds are intentionally spaced several minutes apart so the game remains suitable for travel.

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

The built app is available at `http://localhost:3000`; check `/health`. One unprivileged Fastify process serves the PWA, API and Socket.IO. Compose keeps PostgreSQL private, applies journaled migrations on startup and idempotently loads the reviewed 24-question bank. The app port is bound to localhost; use the documented HTTPS proxy before public hosting.

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

The implemented app includes lobby operations, immutable answers, server scoring/reveal, durable snapshots, lifecycle/capacity policy, live delivery and passenger gameplay. Component checks and actual Chromium host/three-car journeys pass; see the [acceptance checklist](docs/testing/manual-three-car-checklist.md). The latest observed historical [hosted baseline CI](https://github.com/pattarapolj/carpool-gaming/actions/runs/37753549147) passed at `ec7b081`, including Linux Chromium acceptance. Release-head hosted checks and fresh review remain separate gates. Main protection is unavailable on the current private-repository plan (GitHub returned 403 requiring Pro or public visibility); no settings were changed. Local production rehearsal is recorded in the [quality guide](docs/delivery/quality-and-release.md); no public deployment or physical phone/PWA/cellular acceptance is claimed.

Migration `003_round_storage.sql` adds attributed questions, rounds and immutable team submissions. Migration `004_round_participants.sql` captures the original round roster for unanswered/left-team results; older rows retain NULL for unknown historical rosters. The round service opens due rounds with a full window, locks answers, scores/reveals atomically and skips missed schedule slots while preserving the start-time anchor. Starting a game opens the first available question atomically. The listening API reveals expired rounds and opens subsequent due questions every second; shutdown drains coordinator work before closing storage. Snapshots recover the latest public round, caller-only locked answer, original reveal results and all-team competition ranks under a shared game lock. Migration `005_game_completion.sql` saves nullable completion metadata without inventing legacy timestamps. Owning-host end force-reveals and completes atomically; automatic completion enforces the two-hour limit, unused-bank exhaustion and no-ACTIVE policy. Lobby admission caps ACTIVE teams at 20 with duplicate-name precedence. `apps/api/seeds/questions.sql` contains the reviewed first-release solar-system bank: 24 distinct, originally worded questions (8 multiple choice, 8 true/false, 8 estimates), with internal NASA attribution. Facts were assessed against NASA primary pages on 2026-10-08; this is a solar-system bank, with no broad topic-coverage claim. At five-minute cadence it supports 24 distinct rounds, with starts from minute 0 through minute 115 before exhaustion and no spare questions beyond that session. Startup and the explicit `db-command.js seed` command load this bank idempotently. Reloading uses `ON CONFLICT (id) DO NOTHING`, retaining stored content and scores. Revised released questions need a new ID; the original three fixture IDs and content remain unchanged.

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
