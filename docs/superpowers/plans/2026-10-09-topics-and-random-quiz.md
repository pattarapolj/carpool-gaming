# Topics and Random Quiz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let hosts select trivia topics and play 25 randomly selected, nonrepeating questions per topic with answer windows suited to the question.

**Architecture:** Keep the finite topic catalog and schemas in `packages/contracts`; persist question topic/window and game selection through the existing migration and SQL question bank. Choose each game's next unused eligible question in the existing game-first transaction, then show saved selections in the create form and lobby.

**Tech Stack:** TypeScript, Zod, React, Fastify, Socket.IO, PostgreSQL 16, SQL seeds, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-topics-and-random-quiz-design.md`

## Global Constraints

- Exactly 13 selectable topic IDs; 25 questions per ID (325 total), 25 in the Mixed Topics selection pool per topic rather than a separate duplicate bank.
- Ordinary questions use 60-second windows; logic, lateral-thinking and probability puzzles use 180 seconds.
- Keep the 24 existing question IDs, wording, answers and source attribution stable; backfill them to Science & Space.
- Game topic selection is immutable after game creation; old API callers omitting topics default to all topics.
- Only unused questions from the selected topics enter random choice. Use game-first locks and keep question opening, scoring and progression transactional.
- Keep answer keys private for OPEN rounds; use established contract, migration, SQL seed and React form patterns.
- No external trivia API, runtime AI, new dependency, account system, mid-game topic change or multiple-choice option shuffle.
- Taylor Swift uses original questions about released music/career; Breaking Bad uses full-series spoilers; Marvel scope is MCU.

## Review Focus

- Empty, unknown, duplicate and omitted topic IDs: validate and persist deterministically; covered by contract and create-route tests in Tasks 1–2.
- Question-bank exhaustion for selected topics: finish based on the selected pool, not unrelated topics; covered in Task 3.
- Random choice and duplicate prevention under overlapping transactions: one eligible unused question per sequence; covered with real independent Postgres connections in Task 3.
- A long question near the two-hour cap: select only windows that fit and do not open a partial window; covered in Task 3.
- Reload/reconnect and OPEN answer privacy: restore selected topics without leaking answers; covered in Tasks 2 and 4.

---

### Task 1: Topic catalog, database defaults and create/snapshot contracts

**Files:** `packages/contracts/src/index.ts`; `packages/contracts/test/create-game.test.ts`; `packages/contracts/test/game-snapshot.test.ts`; `apps/api/migrations/006_question_topics.sql`; `apps/api/src/migrations.ts`; `apps/api/src/services/games-services.ts`; `apps/api/src/routes/games.ts`; `apps/api/test/routes/games.create.test.ts`; `apps/api/test/migrations-check.ts`.

**Interfaces:** Produce a shared `QuestionTopicIds` tuple and `QuestionTopicSchema`, names `QUESTION_TOPICS`, and `CreateGameSchema.topics?: QuestionTopicId[]`; normalize omitted to all 13 and deduplicate supplied IDs. Add `selectedTopics` to snapshot `game`, with all-topics default when older rows/callers omit it. Exclude the derived Mixed Topics label from persisted IDs.

- [x] Write failing contract tests for all 13 IDs, omitted/all default, empty rejection, unknown rejection and duplicate de-duplication.
- [x] Run `pnpm --filter @carpool/contracts test`; expected the new tests fail on missing topic contract.
- [x] Add migration tests proving questions gain `topic_id` and `answer_window_seconds`, old questions backfill to `science`/60, games gain `selected_topics`, and old games default to all 13.
- [x] Run `pnpm --filter @carpool/api test:migrations`; expected the new migration test fails before migration 006 exists.
- [x] Add migration 006 and verify the existing ordered migration loader/checksum discovers it; keep the existing SQL question bank/load behavior compatible.
- [x] Add the shared catalog and create/snapshot schemas with the specified defaults.
- [x] Add API create tests proving normalized selections persist and appear in the saved game without token disclosure.
- [x] Run contract and focused create-route tests; expected all pass.
- [x] Commit `feat(contracts): define game topic selection`.

### Task 2: Reviewed question bank

**Files:** `apps/api/seeds/questions.sql`; question bank/migration tests; `docs/delivery/question-bank-review.md`.

**Interfaces:** Consume Task 1's topic IDs and migrated `questions.topic_id`/`answer_window_seconds`. Seed remains checksum/reload-safe and uses existing source metadata columns. Insert 325 questions total, 25 per topic: retain 24 released science items, add one science item, and add 25 each for the other 12 IDs. Each row stores 180 seconds only for `logic`, `lateral` and `probability`, otherwise 60.

- [x] Add seed reload tests proving the new rows are repeat-safe and legacy question IDs/contents stay unchanged.
- [x] Run the focused question-bank suite; expected it fails on topic counts and missing content.
- [x] Author/review source-backed, original wording in 25-item topic batches. Preserve existing science IDs/text/source metadata. Verify 25 items per topic, globally unique IDs, no duplicates, valid answer shapes, exact durations, citation reachability, fandom canon and reasoning proofs. Record source and review result per batch.
- [x] Run seed tests twice against PostgreSQL; expected existing rows remain unchanged and every topic has exactly 25 questions.
- [x] Commit `feat(content): add the reviewed topic question bank`.

### Task 3: Topic-filtered random round selection and timing

**Files:** `apps/api/src/services/round-service.ts`; `apps/api/test/round-engine.test.ts`; `apps/api/test/postgres-check.ts`; `apps/api/test/lifecycle.test.ts`.

**Interfaces:** A question can open only when it matches `topic_id = ANY(game.selected_topics)`, is unused in the game, and its answer window fits the remaining game time. Select uniformly using PostgreSQL `ORDER BY random()` within the game-first transaction. Use each selected question's answer window for `round.ends_at`. Exhaustion checks the whole saved-topic pool: if unused questions remain but none fit, wait until the hard cap, then complete with `TIME_LIMIT`.

- [x] Add failing tests for filtered topic selection, exclusion of used/unselected questions, selected-pool exhaustion, 60/180-second deadline and no-fitting-window behavior.
- [x] Run focused round-engine tests; expected they fail on fixed ID ordering and game-wide window.
- [x] Add independent Postgres overlapping-opener verification proving one sequence and no repeated question for the game.
- [x] Implement parameterized topic-filtered selection and database-computed deadline eligibility without changing atomic immediate advancement or answer privacy.
- [x] Run focused unit tests and `pnpm --filter @carpool/api test:postgres`; expected all pass.
- [x] Commit `feat(api): select random unused questions by topic`.

### Task 4: Host topic picker and restored lobby display

**Files:** `apps/web/src/App.tsx`; `apps/web/src/api.ts`; `apps/web/src/screens/LobbyScreen.tsx`; `apps/web/src/test/game-fixtures.ts`; `apps/web/src/App.test.tsx`; `apps/api/browser/game-flow.test.ts`.

**Interfaces:** Create form submits `topics: QuestionTopicId[]`; label 13 named options and present Mixed Topics when every option is checked. Require at least one option. Lobby displays persisted topic names. API snapshots remain the source of truth through refresh/reconnect. Keep car name/host-car behavior and round interval unchanged.

- [x] Add failing React tests for multi-select, all-topic Mixed label, empty selection prevention, create payload and lobby restoration.
- [x] Run focused web tests; expected fail on absent picker/display.
- [x] Implement accessible labeled checkboxes and lobby topic list using shared catalog.
- [x] Add Chromium acceptance for selected topic persistence after refresh and two-phone topic-filtered play.
- [x] Run web tests and the focused browser journey; expected pass without viewport overflow.
- [x] Commit `feat(web): let hosts choose quiz topics`.

### Task 5: Full acceptance, review and local rollout

**Files:** existing package tests, PostgreSQL and browser suites, `README.md`, `docs/delivery/two-phone-gameplay.md`, and the quality/release notes.

- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm --filter @carpool/api test:postgres`, `pnpm --filter @carpool/api test:migrations` and `pnpm test:browser` with the dedicated `carpool_test` database.
- [x] Update feature docs for topic selection, random no-repeat behavior, windows and the 325-question bank.
- [x] Obtain independent contract/implementation review and content review; fix blocking findings.
- [x] Commit final docs/fixes, push one reviewable PR based on the host-game PR, and confirm all hosted checks pass.
- [x] Apply the verified Docker build to localhost without deleting volumes; verify health and a newly created selected-topic game.

## Completion

All five tasks are committed; bank audit proves 325 distinct questions at 25 per topic; the full local and hosted suites pass; the local app serves the selected-topic flow with preserved database; public hosting and physical-device trials remain separate. PR #17 is open for final review and approval; it has not been merged.
