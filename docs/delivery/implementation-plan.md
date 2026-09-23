# Carpool Quiz League Implementation Plan

**Document role:** Delivery milestones and dependency order. See the [engineering document map](../README.md) for the six lifecycle phases and the authoritative specification for each decision. These ten milestones are not ten SDLC phases.

**Goal:** Deliver the Carpool Quiz League MVP in small, reviewable changes.

**Progress note (2026-09-23):** Foundation is still partial: the API process/build commands and Docker Compose API/PostgreSQL stack now exist, while the browser app and CI do not. The create, join and start API slices are implemented; snapshot, leave, rounds and realtime remain pending. The ten milestones are not marked complete. See [README](../../README.md) for the last observed check results and [CONTRIBUTING](../../CONTRIBUTING.md) for the branch workflow.

The tasks are milestones, not mandatory PR sizes. Deliver one reviewable behavior per PR; a large milestone can take several PRs. Write tests for the next behavior and implement it before expanding to the next. Use the contract decision register before committing to an ambiguous contract.

**Architecture:** A React PWA calls one Fastify/Socket.IO backend, backed by PostgreSQL. [HLD](../specs/design.md) owns architectural choices; [LLD](../specs/lld.md) owns functions/schema; [contracts](../specs/contracts.md) own observable behavior; [test specification](../testing/test-spec.md) owns cases and expected results. This file owns sequencing.

**Tech Stack:** Node.js 22 LTS, TypeScript, pnpm workspace, React 19 + Vite + `vite-plugin-pwa`, Fastify, Socket.IO, PostgreSQL 16, `pg`, Zod, Vitest, Docker Compose.

**Spec:** `docs/specs/product.md`  
**LLD:** `docs/specs/lld.md`  
**CI guide:** `docs/delivery/quality-and-release.md`

## Global constraints

- Read the high-level design and LLD before starting any task.
- Preserve server-authoritative timing, scoring, answer locking, and reveal behavior.
- Keep the driver out of the app’s interaction model.
- A shared contract change in `packages/contracts` requires an approving review.
- One reviewable behavior equals one branch, one pull request, and one focused commit series; milestones may span several such changes.
- Do not merge until the checks in the CI guide pass.

---

## Delivery order

```mermaid
flowchart LR
    T1[1 Foundation] --> T2[2 Contracts + database]
    T1 --> T3[3 App shell]
    T2 --> T3
    T2 --> T4[4 Lobby API]
    T3 --> T5[5 Lobby UI]
    T4 --> T5
    T4 --> T6[6 Round engine]
    T6 --> T7[7 Live server]
    T5 --> T8[8 Live captain UI]
    T7 --> T8
    T7 --> T9[9 Three-car verification]
    T8 --> T9
    T9 --> T10[10 Release rehearsal]
```

### Task 1: Foundation

**Files:** Root workspace files; `apps/api` and `apps/web` starter projects; `.github/workflows/ci.yml`.  
**Depends on:** None.  
**LLD reference:** §§2–3; CI guide §4.

- [ ] Create the Node 22 pnpm workspace, API project, web project, Docker PostgreSQL service, and CI workflow.
- [ ] Add `GET /health` and its failing-then-passing Fastify inject test.
- [ ] Confirm `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` work locally.
- [ ] Commit `chore: create game workspace`.

**Done when:** a fresh clone can start PostgreSQL, run the health test, and execute the GitHub Actions commands.

### Task 2: Shared contracts and database

**Files:** `packages/contracts`, `apps/api/migrations/001_initial.sql`, `apps/api/src/db.ts`, database tests.  
**Depends on:** Task 1.  
**References:** LLD §§3-4 and 10; contracts common errors and §9 events.

- [ ] Define shared request, response, view and event schemas as each dependent feature needs them; do not scaffold the complete future contract package at once.
- [ ] Add migrations and constraints needed by each feature; complete the five-table schema by the round-engine milestone.
- [ ] Add a question seed fixture containing one example of each question type.
- [ ] Prove database duplicate-answer protection with an integration test.
- [ ] Commit `feat: add game contracts and schema`.

**Done when:** delivered contracts compile in their consumers and real database tests prove their constraints. This milestone grows with dependent features; the complete round schema must reject duplicate `(round_id, car_team_id)` answers before Task 6 completes. Lobby work can begin once its own contracts/schema are verified.

### Task 3: Captain app shell

**Files:** `apps/web/src/App.tsx`, `screens/`, `styles.css`, mock state, component tests.  
**Depends on:** Task 1 and the screen contracts from Task 2.  
**References:** LLD §§8 and 10; contracts §9 events and §10 synchronization decisions.

- [ ] Build Welcome, Lobby, Question, Locked, Results, and Reconnecting screens using mock contract data.
- [ ] Add semantic controls, visible focus, contrast, and 48px minimum touch targets.
- [ ] Add a component test for an open round’s prompt and answer controls.
- [ ] Check all screens at a phone-sized viewport.
- [ ] Commit `feat: add captain app shell`.

**Done when:** every LLD screen has a renderable component, and the open-round component test passes.

### Task 4: Game lobby API and sessions

**Files:** `auth.ts`, `game-service.ts`, `routes/games.ts`, API tests.  
**Depends on:** Task 2.  
**References:** Contracts §§2-4 and 8; LLD §10 lobby functions.

- [ ] Implement opaque host/captain tokens and hashed token storage.
- [ ] Implement create, join, start, snapshot, and leave routes with the documented response and error envelopes.
- [ ] Test all route acceptance criteria from the API contract, including no answer-key leakage through an open-round snapshot.
- [ ] Commit `feat: add lobby game API`.

**Done when:** every API-contract acceptance statement for these five routes has a passing API/database test.

### Task 5: Create, join, and lobby UI

**Files:** `api.ts`, `session.ts`, create/join/host/captain lobby screens, component tests.  
**Depends on:** Tasks 3 and 4.  
**LLD reference:** §8 Welcome through Captain lobby.

- [ ] Connect forms to Task 4 routes and persist only opaque session tokens plus game ID.
- [ ] Render host-only start controls and captain-only waiting controls.
- [ ] Surface invalid name/code and network errors inline without losing entered text.
- [ ] Test create-game request defaults and join-code validation.
- [ ] Commit `feat: add game lobby screens`.

**Done when:** three browser profiles can create a host and join two car teams through the real API.

### Task 6: Round engine and answer endpoint

**Files:** `round-service.ts`, `routes/rounds.ts`, round tests.  
**Depends on:** Task 4.  
**References:** LLD §§4-5 and 10; contracts §8 answer operation.

- [ ] Implement fixed scheduling, 60-second deadlines, expected-team capture, answer locking, and transaction-based scoring.
- [ ] Implement the submit-answer route with captain ownership, choice validation, deadline handling, and `409` duplicate behavior.
- [ ] Unit test multiple choice, true/false, estimate ties, wrong-team access, expiration, and duplicate attempts.
- [ ] Commit `feat: add authoritative round scoring`.

**Done when:** all scoring rules and answer-route criteria in LLD §5 and contracts §8 have passing tests.

### Task 7: Coordinator and Socket.IO server

**Files:** `coordinator.ts`, `realtime.ts`, coordinator/socket tests.  
**Depends on:** Task 6.  
**References:** LLD §§5 and 10; contracts §9 live events and §10 decisions.

- [ ] Add the one-second coordinator tick and expose a deterministic tick function for tests.
- [ ] Add authenticated game rooms, subscription, and the exact event payloads from the contract package.
- [ ] Broadcast only after the corresponding database transaction commits.
- [ ] Test immediate first round, deadline reveal, all-answers early reveal, one reveal only, and invalid socket token rejection.
- [ ] Commit `feat: add game realtime events`.

**Done when:** two connected test sockets receive the expected event sequence and never receive an answer key before reveal.

### Task 8: Live captain gameplay and reconnect

**Files:** `realtime.ts`, `useGameSnapshot.ts`, question/locked/results/reconnect screens and tests.  
**Depends on:** Tasks 5 and 7.  
**References:** LLD §§8 and 10; contracts §9 events and §10 synchronization decisions.

- [ ] Replace mock state with a typed snapshot plus Socket.IO event reducer.
- [ ] Submit exactly one selected answer; disable controls only after successful server confirmation.
- [ ] Agree on the gap-free snapshot/subscription protocol in contracts, then implement and test synchronization on reconnect.
- [ ] Test `round.started`, `answer.locked`, `round.revealed`, and reconnect state transitions.
- [ ] Commit `feat: add live captain gameplay`.

**Done when:** refreshing a question, locked, and results screen restores the correct server state and never exposes a pre-reveal answer key.

### Task 9: Three-car acceptance verification

**Files:** `game-flow.test.ts`, `docs/testing/manual-three-car-checklist.md`, any defect fixes.  
**Depends on:** Tasks 7 and 8.  
**References:** Test specification §§7 and 11; LLD §8 screen behavior.

- [ ] Add an automated flow test for host + three teams + one reveal + equal leaderboard data.
- [ ] Write and run the manual checklist for passenger-only operation, deadline expiry, refresh/reconnect, left-team behavior, and phone viewport readability.
- [ ] Fix only defects found by that evidence; rerun all checks.
- [ ] Commit `test: verify three car game flow`.

**Done when:** the automated flow passes and the dated manual checklist is reviewed.

### Task 10: Production rehearsal

**Files:** Dockerfiles, `.env.example`, deployment guide, README.  
**Depends on:** Task 9.  
**References:** HLD technical choices; quality and release guide §§4-8.

- [ ] Add validated environment variables, production Docker builds, and a production-like Compose launch.
- [ ] Restrict CORS to the configured browser origin; never use `*` with bearer tokens.
- [ ] Run a two-car game against built containers.
- [ ] Document migration, health check, environment variables, backups, and the single-process limit.
- [ ] Commit `chore: document production configuration`.

**Done when:** the deployment guide can be followed from a fresh checkout to run a working two-car game from built containers.

## Pull-request checklist

- [ ] The branch implements one reviewable behavior or tightly related defect fix and links its product requirement.
- [ ] Tests were added/updated for the behavior changed.
- [ ] Focused test, full test suite, lint and type check passed locally; build also passed once implemented (required to complete Foundation).
- [ ] LLD/API/event contract changes receive an approving review.
- [ ] GitHub Actions `verify` job is green.
- [ ] The pull request is approved.
