# Carpool Quiz League

A passenger-operated trivia game for groups travelling in separate cars. The planned MVP uses a React PWA, Fastify, Socket.IO, and PostgreSQL. Drivers participate verbally only.

## Current state

This is an early, test-first project, not a playable game yet.

| Available | Intentionally left for implementation |
|---|---|
| pnpm workspace, API package and contracts package | `POST /v1/games` and every other game route |
| Fastify `buildServer()` with `GET /health` | PostgreSQL connection, migrations and repositories |
| Red create-game route and contract tests | Create-game validation, persistence and error handling |
| Vitest, Biome and TypeScript scripts | Authentication, scoring, timers, sockets and browser app |

`packages/contracts/src/index.ts` contains an intentionally empty `CreateGameSchema` placeholder. It exists only so the contract tests can compile; filling it in is your first TDD implementation exercise. No create-game route, service, token code, database code, migration, listener or Docker setup is included.

## Install and check

Use Node.js 22 and pnpm **10.23.0**.

```powershell
pnpm install --frozen-lockfile
pnpm --filter @carpool/api test test/health.test.ts
pnpm --filter @carpool/contracts test
pnpm --filter @carpool/api test test/routes/games.create.test.ts
pnpm lint
pnpm typecheck
```

Expected state:

- Health test: green.
- Contract tests: red because `CreateGameSchema` is only a placeholder.
- Create-game route tests: red because `POST /v1/games` does not exist.
- One persistence case is explicitly `todo` until you create the migration and guarded test-database helper.
- Lint and type checking: green.

For the smallest TDD loop, run one named test:

```powershell
pnpm --filter @carpool/contracts test -t "accepts supported round interval 300"
pnpm --filter @carpool/api test test/routes/games.create.test.ts -t "creates a game with a normalized join code"
```

Study [the contract tests](packages/contracts/test/create-game.test.ts), then [the HTTP route tests](apps/api/test/routes/games.create.test.ts). The first HTTP test is labeled Arrange → Act → Assert. The [test catalog](docs/testing/test-spec.md) explains what each named case proves and which test should come next.

## Read in this order

1. [Product requirements](docs/specs/product.md)
2. [High-level design](docs/specs/design.md)
3. [Low-level design](docs/specs/lld.md)
4. [API and behavior contracts](docs/specs/contracts.md)
5. [Test specification](docs/testing/test-spec.md)
6. [Implementation plan](docs/delivery/implementation-plan.md)
7. [Quality and release guide](docs/delivery/quality-and-release.md)

Use [CONTRIBUTING](CONTRIBUTING.md) for Git and teamwork and the [learning guide](docs/testing/learning-guide.md) for the red → green sequence.
