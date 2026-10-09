# Timed puzzle rounds implementation plan

**Goal:** Ship the agreed puzzle competition and open a reviewable PR.
**Architecture:** Reuse game sessions, game-first transactions, coordinator, snapshots, countdown and existing screen styles. Add a bounded content catalog, persistent puzzle rounds/progress, validated actions and a puzzle screen. Preserve scheduled trivia as an available mode.
**Tech stack:** Existing TypeScript, Zod, PostgreSQL, Fastify, React, Vitest and Testing Library; no new dependencies.
**Spec:** ../specs/2026-10-09-timed-puzzles-design.md

## Constraints and review focus

- Server deadlines and canonical answer IDs determine outcomes.
- Retry, reconnect and concurrent expiry must not duplicate points.
- Stale round/puzzle IDs cannot affect newer progress or choices.
- Left teams cannot guess or choose; selector departure needs a replacement.
- Media must contain only the current clue stage, without a target name in metadata.
- Finite pack exhaustion preserves skipped-puzzle access and avoids repeating scores.

## Tasks (execute in this session)

- [x] Write and run failing persistence tests for timed puzzles and permissions.
- [x] Add contracts in `packages/contracts/src/puzzles.ts`, catalog/media in `apps/api/src/services/puzzle-catalog.ts`, migration `007_puzzle_rounds.sql`, and engine `puzzle-service.ts`. Expose `advancePuzzleRound`, `finishPuzzleRound`, `getPuzzleView`, `puzzleAction` under the existing game lock.
- [x] Integrate create/start/snapshot/coordinator/end and authenticated routes; update migration fixtures. Run focused persistence tests.
- [x] Write failing React tests; implement `PuzzleScreen.tsx`, mode/setup controls, API action and existing game-screen integration. Keep feedback accessible and actions serialized.
- [x] Run all existing tests, lint, types and build; review the branch diff. Verified 247 tests, eight browser acceptance tests, PostgreSQL transaction checks, and migration checks. Publish against topic-selection after verification.
