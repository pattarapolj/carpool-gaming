# Task 2b implementation report

Status: DONE. Branch: `pattarapolj/question-bank`; baseline: `a92584e`.

## Implemented

- Expanded the existing SQL seed to 24 distinct solar-system questions, eight per supported type, interleaved under UUID ordering. Added deterministic IDs ending 004 through 024; retained the original 001 through 003 IDs and exact content.
- Used the assessed proposal wording, choices, answer keys, explanations and NASA attribution for all 21 additions. No factual alterations. The proposal's clarified Neptune wording was not adopted because the binding brief explicitly preserves the original three fixtures; its existing Earth-year unit and whole-number instruction remain unchanged.
- Added native `ON CONFLICT (id) DO NOTHING`. Reload neither duplicates rows nor overwrites previously stored wording. No separate fixture bank, dependencies, helper/validator layer, contract edits, scoring/timing/locking/reveal changes, driver interactions or runtime behavior changes.
- Updated README with dated NASA source assessment, scope, 24-round capacity at five-minute cadence (starts 0 through 115 minutes), no spare bank, reload semantics and new-ID policy for revised released questions.

## Seed-consumer trace

Read every reference to `questions.sql`: storage, round-engine, lifecycle, live-events, coordinator-snapshot, start persistence, answer routes and PostgreSQL check. Coordinator/start consumers already use the preserved first fixture/order and required no edits. Answer-route fixture previously selected every question of a type; now it explicitly chooses the first by ID.

Round-engine all-answer/type scoring retains its three-question exhaustion assertion through an explicit three-ACTIVE-question fixture; the overflow case has one ACTIVE estimate and changes/restores only that key. Lifecycle final-bank scoring and live deadline delivery use one ACTIVE question, retaining completion/reveal assertions. PostgreSQL overlapping ticks now also assert `COMPLETE`, `QUESTION_BANK_EXHAUSTED`, null next time and points once with one ACTIVE question. All temporary bank restrictions restore ACTIVE state in `finally`. No completion assertion was weakened or skipped.

## TDD evidence

RED, before seed implementation:

`pnpm --filter @carpool/api test test/database/round-storage.test.ts`

Exit 1: 1 failed, 6 passed. New bank integration check failed with `expected ... length of 24 but got 3`, the intended missing-bank failure.

GREEN, after seed implementation: same command, exit 0; 7/7 passed. Expanded test checks 24 rows, 8/type, interleaving, typed valid keys/distinct MC choices, attribution, nonblank content, distinct prompts, original fixture IDs/keys and reload equality after deliberately changing an existing explanation.

Focused consumer regression command:

`pnpm --filter @carpool/api test test/database/round-storage.test.ts test/routes/rounds.answers.test.ts test/round-engine.test.ts test/lifecycle.test.ts test/live-events.test.ts`

Exit 0: five files, 69/69 tests passed.

## Final verification (one complete workspace pass)

| Command | Result |
| --- | --- |
| `pnpm lint` | Exit 0; 72 files checked, no fixes |
| `pnpm typecheck` | Exit 0; API, contracts and web |
| `pnpm test` | Exit 0; API 135, contracts 25, web 31: 191/191 tests |
| `pnpm build` | Exit 0; API compiled, Vite/PWA generated |
| `pnpm --filter @carpool/api test:postgres` | Exit 0; PostgreSQL 16.14, all 15 PASS scenarios |
| `git diff --check` | Exit 0 |

PostgreSQL used the explicitly provided synthetic task-only `TEST_DATABASE_URL` on `127.0.0.1:54329/carpool_test`; the existing runnable check owns and cleans its generated schema and does not fall back to production configuration. Output includes bank load/reload, last-bank concurrent tick completion, answer/deadline races, atomic snapshots, rollback/retry and real authenticated WebSocket delivery. No browser/device, hosting, or new hosted CI acceptance claimed.

Formatting command: `pnpm exec biome check --write apps/api/test/database/round-storage.test.ts apps/api/test/lifecycle.test.ts apps/api/test/live-events.test.ts apps/api/test/round-engine.test.ts apps/api/test/routes/rounds.answers.test.ts apps/api/test/postgres-check.ts` (exit 0; five modified test files formatted). pnpm and Git metadata mutations used benign escalations for the Windows realpath/common-gitdir restriction.

## Exact files changed

- `README.md`
- `apps/api/seeds/questions.sql`
- `apps/api/test/database/round-storage.test.ts`
- `apps/api/test/lifecycle.test.ts`
- `apps/api/test/live-events.test.ts`
- `apps/api/test/postgres-check.ts`
- `apps/api/test/round-engine.test.ts`
- `apps/api/test/routes/rounds.answers.test.ts`
- `.superpowers/sdd/implementation-plan/question-bank-report.md`

## Self-review and concerns

Reviewed complete diff and SQL against the assessed proposal and binding brief. Existing fixture content is preserved, additions match the proposal, and SQL apostrophes are escaped. Final output is clean. No unresolved implementation concerns; the bank is deliberately solar-system focused with no spare questions past the stated 24-round capacity. Independent content/code review and PR belong to the parent. No push performed.
