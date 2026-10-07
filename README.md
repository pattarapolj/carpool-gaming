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
apps/web/             React PWA for creating, joining and managing a lobby
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

Run `pnpm dev:web` in another terminal and open `http://localhost:5173` to use the lobby with the Compose API. Vite proxies browser API requests to port 3000.

`docker compose down` stops the services and keeps the database. `docker compose down -v` also deletes its local data. PostgreSQL's init scripts only run on a new volume; add a migration runner before deploying later schema changes to an existing database.

For local development without the API container, set `DATABASE_URL` and run `pnpm dev` to start the API and browser app. `pnpm build` compiles both; `pnpm start` runs the compiled API. The example database password is for local development only; replace it before hosting publicly.

The persistence tests use an in-memory PostgreSQL engine and do not need a running server. As of 2026-09-24, `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass for create, join, start, lobby snapshot, and the PWA lobby. Live round gameplay and CI remain pending.

## Quality checks

```powershell
pnpm --filter @carpool/api test test/health.test.ts
pnpm --filter @carpool/contracts test
pnpm --filter @carpool/api test test/routes/games.create.test.ts
pnpm lint
pnpm typecheck
```

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
