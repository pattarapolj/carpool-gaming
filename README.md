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

The API is available at `http://localhost:3000`; check `http://localhost:3000/health`. Compose starts PostgreSQL with a persistent named volume and applies the numbered SQL migrations when creating a new database volume. The database is not exposed on the host.

Run `pnpm dev:web` in another terminal and open `http://localhost:5173` to play with the Compose API. Vite proxies browser API requests and Socket.IO polling/WebSocket traffic to port 3000.

`docker compose down` stops the services and keeps the database. `docker compose down -v` also deletes its local data. PostgreSQL's init scripts only run on a new volume; add a migration runner before deploying later schema changes to an existing database.

Socket.IO uses the same API listener at `/socket.io`. Set `FRONTEND_ORIGIN` to the exact browser origin (default `http://localhost:5173`); polling and WebSocket handshakes enforce it. Tokens retain read access after COMPLETE/LEFT while their game/team exists. The browser registers listeners before connecting, subscribes before requesting subsequent snapshots, coalesces events during reads and reconciles every 15 seconds. Acknowledgements time out after 5 seconds; HTTP operations time out after 10 seconds. Reconnection preserves the last good state and repeats subscription, ignoring responses from previous connections/sessions.

The lobby offers the join code, a token-free invite URL, clipboard copying and native sharing where available. A fresh `?join=AB12CD` invite prefills the join form without automatically joining. Captains select an answer and confirm separately; only a successful server confirmation or their stored own answer locks the controls. Hosts follow the public question without answer controls. Revealed results and rankings come from the server, including left cars. Countdown displays use server time plus elapsed performance time and never open, reveal or score a round locally. Leave/end require explicit confirmation; returning home clears only this browser's game session.

For local development without the API container, set `DATABASE_URL` and run `pnpm dev` to start the API and browser app. `pnpm build` compiles both; `pnpm start` runs the compiled API. The example database password is for local development only; replace it before hosting publicly.

The workspace persistence tests use PGlite and do not need a running server. Implemented slices include create, join, atomic first-round start, full authorized snapshots, passenger gameplay, the one-second coordinator and server round transitions with answer/leave routes. Completion/capacity policy and authenticated live delivery/recovery are implemented. React Testing Library tests exercise visible gameplay/access/lifecycle flows and recovery races; actual multi-context browser and phone/device acceptance remains Task 9. The installed CI workflow runs workspace checks and a separate PostgreSQL 16 check with independent connections; [hosted live-delivery baseline CI](https://github.com/pattarapolj/carpool-gaming/actions/runs/37724585885) passed at `f6bfdc3`. This UI slice awaits fresh review and its hosted run. Main branch protection remains unavailable for the current private repository (GitHub API returns 403 requiring GitHub Pro or public visibility); no settings were changed. No public hosting or production rehearsal is claimed.

Migration `003_round_storage.sql` adds attributed questions, rounds and immutable team submissions. Migration `004_round_participants.sql` captures the original round roster for unanswered/left-team results; older rows retain NULL for unknown historical rosters. The round service opens due rounds with a full window, locks answers, scores/reveals atomically and skips missed schedule slots while preserving the start-time anchor. Starting a game opens the first available question atomically. The listening API reveals expired rounds and opens subsequent due questions every second; shutdown drains coordinator work before closing storage. Snapshots recover the latest public round, caller-only locked answer, original reveal results and all-team competition ranks under a shared game lock. Migration `005_game_completion.sql` saves nullable completion metadata without inventing legacy timestamps. Owning-host end force-reveals and completes atomically; automatic completion enforces the two-hour limit, unused-bank exhaustion and no-ACTIVE policy. Lobby admission caps ACTIVE teams at 20 with duplicate-name precedence. `apps/api/seeds/questions.sql` contains the reviewed first-release solar-system bank: 24 distinct, originally worded questions (8 multiple choice, 8 true/false, 8 estimates), with internal NASA attribution. Facts were assessed against NASA primary pages on 2026-10-08; this is a solar-system bank, with no broad topic-coverage claim. At five-minute cadence it supports 24 distinct rounds, with starts from minute 0 through minute 115 before exhaustion and no spare questions beyond that session. The seed is not automatically loaded. After applying all numbered migrations, load it from the repository root:

```powershell
Get-Content -Raw apps/api/seeds/questions.sql | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Reloading uses `ON CONFLICT (id) DO NOTHING`, retaining stored content and scores. Revised released questions need a new ID; the original three fixture IDs and content remain unchanged. Existing database volumes require applying the new migration explicitly; Compose initialization only covers new volumes.

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
```

The example port must match your dedicated PostgreSQL 16 instance. The command rejects absent/unsafe URLs before connecting, applies every migration and the sample questions inside a generated schema, then removes only that schema in `finally`. It neither creates nor drops databases. On 2026-10-08, PostgreSQL 16.14 passed overlapping same-team HTTP answers (one immutable answer and duplicate `409`), deadline/final-answer races in both orders (points once), overlapping round openers, deadline rechecking after a real row-lock wait, scoring rollback, atomic snapshots waiting for a scoring commit, and overlapping coordinator ticks. These checks use separate connections and observed lock waits; PGlite alone does not establish those guarantees. The same check also passes competing final-slot joins, host end/answer/deadline races in both orders, hard-limit rejection after lock waits and snapshots waiting for atomic completion. Real Socket.IO tests cover the listening API with PGlite; PostgreSQL also passes authenticated WebSocket reveal/completion delivery during independently locked HTTP answer/end contention. Gameplay UI acceptance remains later work.

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
7. [Quality and release guide](docs/delivery/quality-and-release.md)

See [CONTRIBUTING](CONTRIBUTING.md) for the branch, review and commit workflow.
