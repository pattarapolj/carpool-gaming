# Test specification

**Purpose:** Own the MVP test strategy, behavior catalog, test scenarios, expected results and traceability. This is the testing specification, not a report of passing tests. Public rules come from [contracts](../specs/contracts.md); proposed functions come from the [LLD](../specs/lld.md#10-proposed-modules-and-functions).

**Current feature contract:** Read the [create-game behavior contract](../specs/contracts.md) for the exact inputs, outputs, errors and state guarantees behind your current tests. It also identifies details still needing agreement.

**Implementation status:** The root [README](../../README.md) owns the last observed check results. Planned cases below are not implemented unless linked to source and run evidence. Implement one behavior at a time; this inventory is not an instruction to create every test file first.

**Related documents:**

- [Product requirements](../specs/product.md)
- [High-level design](../specs/design.md)
- [Low-level design](../specs/lld.md)
- [Implementation plan](../delivery/implementation-plan.md)
- [CI and quality guide](../delivery/quality-and-release.md)

## 1. Test levels

| Level | Uses | Does not use | Main purpose |
|---|---|---|---|
| Unit | Functions and small in-memory fakes | HTTP server, Socket.IO, PostgreSQL | Prove a game rule such as scoring or scheduling. |
| Integration | Fastify `app.inject()` and disposable PostgreSQL database | A real network port or browser | Prove one route, authentication, validation, and database behavior work together. |
| Component | React Testing Library + JSDOM | Real API/database/server | Prove a screen reacts correctly to typed data and user input. |
| Flow | API service, disposable PostgreSQL, real Socket.IO clients on a local ephemeral port | A real phone | Prove the important multi-car journey. |
| Manual | Real mobile-sized browser windows | Test doubles | Prove readability, touch controls, and reconnect behavior. |

Use Vitest for the first four levels. The runner is always Vitest; the difference is the dependencies each test is allowed to use.

## 2. Folder structure

```text
apps/api/test/
  helpers/
    build-test-app.ts            # Starts Fastify without listening on a network port
    test-db.ts                   # Connects to only carpool_test; migrates and truncates it
    factories.ts                 # Creates concise valid games, teams, questions, and rounds
  database/
    schema.test.ts               # Proves database uniqueness constraints
  routes/
    games.create.test.ts
    games.join.test.ts
    games.start.test.ts
    games.snapshot.test.ts
    games.leave.test.ts
    rounds.answers.test.ts
    error-handler.test.ts
  services/
    auth.test.ts
    round-service.scheduling.test.ts
    round-service.scoring.test.ts
    round-service.answers.test.ts
    coordinator.test.ts
  realtime/
    socket-auth.test.ts
    game-events.test.ts
  flows/
    game-flow.test.ts

packages/contracts/test/
  create-game.test.ts

apps/web/src/screens/
  WelcomeScreen.test.tsx
  CreateGameScreen.test.tsx
  JoinGameScreen.test.tsx
  HostLobbyScreen.test.tsx
  CaptainLobbyScreen.test.tsx
  QuestionScreen.test.tsx
  LockedScreen.test.tsx
  ResultsScreen.test.tsx
  ReconnectScreen.test.tsx
apps/web/src/
  realtime.test.ts

docs/testing/
  manual-three-car-checklist.md
```

This is a possible expanded layout. Start with the existing behavior suite and split only when setup or readability warrants it, following section 10 and the LLD. Do not create empty helpers or a test file for each decorative component.

## 3. Contract and database tests

### `packages/contracts/test/create-game.test.ts`

This unit suite proves the complete input boundary once at the shared Zod-schema seam. Route tests still keep representative requests to prove Fastify actually applies that schema. The suite passes for the implemented create-game input rules.

| Test name | Expected behavior |
|---|---|
| `accepts_supported_round_intervals` | `300`, `600`, and `900` each parse successfully. |
| `rejects_unsupported_round_intervals` | Representative values `123`, `400`, and `1800` fail parsing. |
| `accepts_game_name_boundary_lengths` | Trimmed names of exactly 1 and 60 characters parse successfully. |
| `trims_surrounding_game_name_whitespace` | `"  Beach convoy  "` parses to `"Beach convoy"`. |
| `rejects_missing_game_name` | Object without `name` fails parsing. |
| `rejects_blank_game_names` | Empty, spaces-only, and tab-only names fail parsing. |
| `rejects_game_name_over_60_characters` | A 61-character trimmed name fails parsing. |
| `rejects_missing_round_interval` | Object without `roundIntervalSeconds` fails parsing. |
| `rejects_non_numeric_round_interval` | A string such as `"300"` fails parsing rather than being coerced. |

### `apps/api/test/database/schema.test.ts`

This integration suite proves constraints that must remain true even if application code has a bug.

| Test name | Expected behavior |
|---|---|
| `rejects_duplicate_join_code` | Two games cannot persist the same `join_code`. |
| `rejects_duplicate_team_name_within_game` | Normalized team name is unique within one game. |
| `allows_same_team_name_in_different_games` | The uniqueness boundary does not cross games. |
| `rejects_duplicate_round_sequence_within_game` | One game cannot have two rounds with the same sequence. |
| `rejects_duplicate_team_answer_for_round` | One team cannot persist two answers for one round. |

### `apps/api/test/services/auth.test.ts`

| Test name | Expected behavior |
|---|---|
| `creates_opaque_session_token` | Generated host/captain token is a non-empty unpredictable string suitable for a bearer credential. |
| `hashes_session_token_with_sha256` | Hashing a fixed token returns the independently known SHA-256 digest. |
| `persists_hash_instead_of_raw_token` | Creating a session passes only the digest to persistence; the raw token is returned to the caller. |

## 4. Backend route tests

Create-game route tests call Fastify through `app.inject()`. They use a small query double for HTTP cases; `games.persistence.test.ts` applies the `games` migration to an in-memory PostgreSQL engine and checks stored values and join-code uniqueness. The health route needs no database connection.

Before any truncate/reset helper, validate the dedicated test connection target and fail closed when it is not explicitly configured for tests. Run suites sharing `carpool_test` serially, or isolate a database/schema per worker; concurrent `beforeEach` truncations can erase another test's state. Close apps and pools in cleanup hooks even after assertions fail.

The field cases below are acceptance inventory. Once shared-schema unit tests own the full input matrix, keep a representative valid/invalid route request plus HTTP-specific cases (parsing, status/envelope, authentication, persistence). Do not repeat every schema permutation at both layers.

### `routes/games.create.test.ts`

**Route:** `POST /v1/games`  
**Owns:** creating a lobby game and host session.

| Test name | Expected behavior |
|---|---|
| `creates_game_with_normalized_join_code` | Valid name and 300-second interval return `201`; game is `LOBBY`; code matches `^[A-Z0-9]{6}$`; host token is returned once. |
| `accepts_supported_round_intervals` | `300`, `600`, and `900` each return `201`; this proves the HTTP route uses the shared contract. |
| `accepts_game_name_boundary_lengths` | Names of exactly 1 and 60 trimmed characters return `201`. |
| `trims_surrounding_game_name_whitespace` | Surrounding whitespace is removed from the returned game name. |
| `rejects_missing_game_name` | Missing `name` returns `422 VALIDATION_ERROR`. |
| `rejects_blank_game_name` | Blank or whitespace-only name returns `422 VALIDATION_ERROR`. |
| `rejects_game_name_longer_than_60_characters` | Name of 61 characters returns `422 VALIDATION_ERROR`. |
| `rejects_unsupported_round_interval` | Interval other than 300, 600, or 900 returns `422 VALIDATION_ERROR`. |
| `rejects_string_round_interval` | Valid JSON containing `"roundIntervalSeconds": "300"` returns `422 VALIDATION_ERROR`. |
| `creates_persisted_game_with_host_hash` | The public game ID matches a stored lobby and interval; stored credential is the hash of the returned token, not the raw token. |
| `rejects_malformed_json` | Invalid JSON body returns `400 MALFORMED_JSON`. |
| `returns_standard_validation_error_envelope` | A validation error contains `error.code`, human-readable `error.message`, and non-empty `error.requestId`. |
| `does_not_return_token_hash` | Success JSON contains `hostToken` but never `host_token_hash`. |

`games.create.test.ts` covers the HTTP behavior and persistence failure. `games.persistence.test.ts` checks the stored lobby, interval, host-token hash, and unique join-code constraint against PostgreSQL semantics.

### `routes/games.join.test.ts`

**Route:** `POST /v1/games/:joinCode/teams`  
**Owns:** joining a car team while the room is open.

| Test name | Expected behavior |
|---|---|
| `joins_lobby_team` | Valid name in a `LOBBY` game returns `201`, active team, and captain token. |
| `normalizes_join_code_before_lookup` | Lowercase or surrounding whitespace resolves the same valid join code. |
| `rejects_unknown_join_code` | Missing game returns `404 GAME_NOT_FOUND`. |
| `rejects_duplicate_team_name_case_insensitively` | `Blue Sedan` then `blue sedan` returns `409 TEAM_NAME_TAKEN`. |
| `rejects_blank_team_name` | Blank name returns `422 VALIDATION_ERROR`. |
| `rejects_missing_team_name` | Missing `name` returns `422 VALIDATION_ERROR`. |
| `rejects_team_name_longer_than_60_characters` | A 61-character team name returns `422 VALIDATION_ERROR`. |
| `rejects_join_after_game_start` | `WAITING` game returns `409 GAME_NOT_JOINABLE`. |
| `does_not_return_captain_token_hash` | Success JSON exposes raw captain token only, not its stored hash. |

### `routes/games.start.test.ts`

**Route:** `POST /v1/games/:gameId/start`  
**Owns:** host authorization and game-start readiness.

| Test name | Expected behavior |
|---|---|
| `host_starts_two_team_game` | Host with two active teams receives `200`; game becomes `WAITING`; first `nextRoundAt` is server now. |
| `rejects_missing_token` | No bearer token returns `401 UNAUTHENTICATED`. |
| `rejects_captain_start` | Captain token returns `403 FORBIDDEN`. |
| `rejects_host_from_another_game` | Host token for another game returns `403 FORBIDDEN`. |
| `requires_practice_flag_for_one_team` | One active team with default body returns `422 GAME_NOT_READY`. |
| `allows_explicit_one_team_practice_game` | One active team with `{ "practice": true }` returns `200`. |
| `rejects_non_boolean_practice_value` | A non-boolean `practice` value returns `422 VALIDATION_ERROR`. |
| `rejects_unknown_game` | Unknown game ID returns `404 GAME_NOT_FOUND`. |
| `rejects_malformed_json` | Invalid JSON body returns `400 MALFORMED_JSON`. |
| `rejects_start_after_started` | Second start returns `409 GAME_ALREADY_STARTED`. |

### `routes/games.snapshot.test.ts`

**Route:** `GET /v1/games/:gameId/snapshot`  
**Owns:** safe state restoration after refresh/reconnect.

| Test name | Expected behavior |
|---|---|
| `returns_lobby_snapshot_to_host` | Authorized host receives game plus active teams. |
| `returns_open_round_without_answer_key` | Assert the public round fields and absence of answer-key/explanation fields. Do not ban the correct value from JSON text: it legitimately appears among the choices. |
| `returns_callers_locked_answer_only` | Captain receives own locked answer; does not receive other teams' answer values. |
| `does_not_return_session_tokens` | Snapshot contains neither raw session tokens nor token-hash fields. |
| `returns_revealed_round_with_explanation` | After reveal, response includes answer, explanation, and leaderboard. |
| `rejects_missing_token` | No token returns `401 UNAUTHENTICATED`. |
| `rejects_cross_game_snapshot` | Valid token from another game returns `403 FORBIDDEN`. |
| `rejects_unknown_game` | Unknown game ID returns `404 GAME_NOT_FOUND`. |

### `routes/games.leave.test.ts`

**Resolved Task 6a:** Explicit leave immediately prevents new answers, retains locked answers and the fixed expected count, and excludes the team from subsequent rounds. Disconnect alone does not change eligibility. Current evidence lives in `routes/rounds.answers.test.ts` and `round-engine.test.ts`.

**Route:** `POST /v1/games/:gameId/leave`  
**Owns:** leaving future rounds without altering an open round.

| Test name | Expected behavior |
|---|---|
| `captain_leaves_own_team` | Own captain token returns `200` and sets team to `LEFT`. |
| `leave_is_idempotent` | Repeating leave returns `200` and leaves status `LEFT`. |
| `does_not_change_open_round_expected_team_count` | Leaving during an open round retains the stored count. |
| `rejects_missing_token` | No bearer token returns `401 UNAUTHENTICATED`. |
| `rejects_host_leave` | Host token returns `403 CAPTAIN_REQUIRED`. |
| `rejects_cross_game_leave` | Other game's captain token returns `403 FORBIDDEN`. |
| `rejects_unknown_game` | Unknown game ID returns `404 GAME_NOT_FOUND`. |
| `rejects_leave_after_game_complete` | Complete game returns `409 GAME_COMPLETE`. |

### `routes/rounds.answers.test.ts`

**Route:** `POST /v1/rounds/:roundId/answers`  
**Owns:** HTTP validation, authorization, and immutable locked answers.

| Test name | Expected behavior |
|---|---|
| `captain_locks_valid_multiple_choice` | Active captain submits listed choice before deadline and receives `200 locked`. |
| `captain_locks_boolean_true_false_answer` | Boolean is accepted for a true/false question. |
| `captain_locks_numeric_estimate` | Finite number is accepted for an estimate. |
| `rejects_malformed_json` | Invalid JSON body returns `400 MALFORMED_JSON`. |
| `rejects_missing_token` | No bearer token returns `401 UNAUTHENTICATED`. |
| `rejects_host_answer_submission` | Host token returns `403 CAPTAIN_REQUIRED`. |
| `rejects_cross_game_answer` | Captain from another game returns `403 FORBIDDEN`. |
| `rejects_unknown_round` | Unknown round ID returns `404 ROUND_NOT_FOUND`. |
| `rejects_left_team_answer` | Left team returns `409 TEAM_LEFT`. |
| `rejects_invalid_choice_id` | Unknown multiple-choice ID returns `422 INVALID_ANSWER_VALUE`. |
| `rejects_wrong_value_type` | String for estimate or number for true/false returns `422 INVALID_ANSWER_VALUE`. |
| `rejects_expired_answer` | Server time at/after deadline returns `422 ROUND_EXPIRED`. |
| `rejects_answer_after_reveal` | Revealed round returns `409 ROUND_NOT_OPEN`. |
| `rejects_duplicate_answer` | Second answer from same team/round returns `409 ANSWER_ALREADY_LOCKED`; database has one row. |

### `routes/error-handler.test.ts`

This suite tests the shared error handler once instead of repeating unexpected-failure assertions for every route.

| Test name | Expected behavior |
|---|---|
| `returns_safe_internal_error_envelope` | An unexpected handler error returns `500 INTERNAL_ERROR` with `message` and `requestId`, without stack trace, SQL, token, or answer data. |
| `preserves_known_http_errors` | A known route error keeps its documented status and code instead of becoming `500`. |

## 5. Backend service unit tests

Pure scoring/scheduling tests use fixed inputs and a controlled clock without HTTP or PostgreSQL. Add fakes only where an existing dependency boundary requires them. Transaction, token lookup and persistence behavior need integration evidence; a fake does not prove a database constraint or lock.

### `services/round-service.scheduling.test.ts`

| Test name | Expected behavior |
|---|---|
| `opens_first_round_immediately` | Starting a game makes round 1 eligible at the same server timestamp. |
| `sets_round_deadline_to_window_after_start` | 60-second window gives exactly `endsAt = startsAt + 60 seconds`. |
| `schedules_next_round_at_fixed_interval` | Next time is based on original `startedAt`, not early reveal time. |
| `captures_active_team_count_when_round_opens` | Stored count equals active teams at open time. |
| `excludes_left_team_from_next_round` | A team that left before opening is absent from next count. |

### `services/round-service.scoring.test.ts`

| Test name | Expected behavior |
|---|---|
| `scores_correct_multiple_choice` | Matching choice earns one point. |
| `does_not_score_wrong_multiple_choice` | Different choice earns zero. |
| `scores_true_false` | Matching boolean earns one point. |
| `awards_single_closest_estimate` | Lowest numeric distance earns one point. |
| `awards_all_estimate_ties` | Equal lowest distances each earn one point. |
| `gives_unanswered_team_zero` | Team with no answer is present in result with zero points. |

### `services/round-service.answers.test.ts`

| Test name | Expected behavior |
|---|---|
| `locks_answer_once` | First valid answer is stored with a timestamp. |
| `rejects_second_locked_answer` | A second attempt returns `ANSWER_ALREADY_LOCKED`. |
| `checks_deadline_using_server_clock` | Client clock value cannot change the decision. |
| `checks_captain_team_from_token_identity` | Request body cannot select a different team. |
| `preserves_expected_team_count_after_leave` | Leave does not allow early reveal in an already open round. |

### `services/coordinator.test.ts`

| Test name | Expected behavior |
|---|---|
| `opens_waiting_round_when_next_time_arrives` | Tick at `nextRoundAt` creates and broadcasts one public round. |
| `reveals_when_all_expected_teams_answer` | Last expected answer causes one reveal. |
| `reveals_once_at_deadline` | Tick at deadline reveals once; repeated tick does not duplicate it. |
| `concurrent_reveal_attempts_award_points_once` | Overlap final-answer and deadline processing against PostgreSQL; stored points reflect one reveal transition. |
| `does_not_move_next_round_after_early_reveal` | Results screen duration does not alter scheduled next round. |
| `broadcasts_only_after_commit` | Failed score transaction emits no event. |

Also exercise overlapping deadline and final-answer operations against real PostgreSQL, then assert one scored transition and no duplicate points. Repeating a tick sequentially alone does not establish concurrency safety. One Node process can still interleave asynchronous handlers.

## 6. Real-time integration tests

### `realtime/socket-auth.test.ts`

| Test name | Expected behavior |
|---|---|
| `rejects_socket_without_token` | Connection without `auth.token` is rejected. |
| `rejects_socket_with_invalid_token` | Unknown token is rejected without joining a room. |
| `joins_only_authenticated_game_room` | Valid host/captain joins only its own `game:{gameId}` room. |
| `prevents_cross_game_subscription` | A valid token cannot subscribe to another game ID. |

### `realtime/game-events.test.ts`

| Test name | Expected behavior |
|---|---|
| `round_started_never_contains_answer_key` | Public event has prompt, choices, and deadline but no correct answer. |
| `answer_locked_reaches_only_submitting_captain` | Other cars do not receive the private lock event. |
| `round_revealed_reaches_every_game_member` | All connected members of that game receive the same reveal and leaderboard. |
| `game_event_does_not_leak_to_other_game` | A socket in another game receives no event. |

Implemented backend evidence lives in `apps/api/test/live-events.test.ts`: real auth/ack/rooms, both Origin transports, safe/public versus private payloads, rollback silence, final-answer/deadline/host-end/empty-bank transitions, post-commit recovery, subscribe races and pending auth/snapshot shutdown. Browser synchronization checks remain in the later UI slice.

## 7. Full game-flow test

### `flows/game-flow.test.ts`

This is intentionally a small number of longer tests. It proves the most important real journey; it must not repeat every validation case from route suites.

| Test name | Expected behavior |
|---|---|
| `three_cars_receive_one_reveal_and_identical_leaderboard` | Host creates game; three captains join; host starts; all receive the same public question; three answers lock; all receive exactly one reveal and identical ranking data. |
| `unanswered_car_scores_zero_at_deadline` | Two of three teams answer; coordinator reaches deadline; all receive results and the unanswered team gains zero. |
| `reconnecting_captain_restores_open_round_snapshot` | Captain disconnects/reconnects; snapshot restores question/lock state with no answer-key leak. |

## 8. Frontend component tests

Use React Testing Library. Test a screen’s visible behavior; do not test its private state variables or CSS class names.

| File | Required behaviors |
|---|---|
| `WelcomeScreen.test.tsx` | Create and join choices are visible and each navigates in one activation. |
| `CreateGameScreen.test.tsx` | Default interval is 5 minutes; blank name shows inline error; valid submit calls typed API client; failure preserves input. |
| `JoinGameScreen.test.tsx` | Join code is normalized; blank values fail inline; success saves opaque session only. |
| `HostLobbyScreen.test.tsx` | Shows share code/team list; start disabled under two teams unless practice enabled; captain does not see start button. |
| `CaptainLobbyScreen.test.tsx` | Shows team/game names and live team updates; never renders host start controls. |
| `QuestionScreen.test.tsx` | Renders prompt and choices; select then confirm is required; successful submit disables controls and renders locked state; invalid submit restores controls. |
| `LockedScreen.test.tsx` | Shows answer-locked confirmation and deadline; never reveals another team's answer; refresh snapshot restores the same state. |
| `ResultsScreen.test.tsx` | Shows correct answer, explanation, and same ordered leaderboard data provided by server. |
| `ReconnectScreen.test.tsx` | Shows reconnect status; retry reinstalls listeners, connects and subscribes before the acknowledged atomic snapshot. |

### `apps/web/src/realtime.test.ts`

**Resolved Task7b:** Contracts §9 specifies room-before-snapshot subscription and events as invalidations. The later UI must serialize/coalesce snapshot reads, buffer dirty events during reads, discard stale responses and reconcile every 15 seconds.

| Test name | Expected behavior |
|---|---|
| `synchronizes_snapshot_and_subscription_without_gap` | An event during the snapshot read marks it dirty and causes another authoritative read. |
| `ignores_event_older_than_loaded_snapshot` | An event for an older round cannot replace the state restored by the snapshot. |
| `reconciles_from_typed_server_event` | A typed event invalidates state; the serialized snapshot read moves the client to its server-owned phase. |

## 9. TDD workflow for one behavior

Example: `rejects_duplicate_answer`.

1. Add the test to `routes/rounds.answers.test.ts`.
2. Run only that file; read the actual failure. An absent route may initially return `404`; once the first submission works, prove the second submission violates the locked-answer rule.
3. Handle the specific unique `(round_id, car_team_id)` constraint violation as `409 ANSWER_ALREADY_LOCKED`; do not map every PostgreSQL `23505` error to an answer conflict.
4. Rerun that one test until it passes.
5. Run the complete API package test suite.
6. Commit the route change and the test together.

```bash
pnpm --filter @carpool/api test test/routes/rounds.answers.test.ts
pnpm --filter @carpool/api test
pnpm test
pnpm lint
pnpm typecheck
```

The round suite above is planned. Use `test/routes/games.create.test.ts` today. Add `pnpm build` to the checks when a real build script exists.

## 10. When to create a new test file

Create a new file only if one of these is true:

- The current suite is over roughly 200–300 lines and hard to scan.
- Tests need a substantially different database/app/clock setup.
- The behavior is independently understandable and reviewable.

Otherwise add a new `it(...)` to the existing suite. The smallest useful organization is correct.

## 11. Requirement → function → test → expected result

This table is the central traceability map. Requirement IDs come from [product](../specs/product.md#8-requirement-ids-for-traceability). Function names are proposals from the LLD, not existing code. File names below are suite labels from this document; the expanded paths are in section 2. A function can be covered through a route or flow rather than a separate function test.

| Requirement | Contract / design | Proposed function or module | Test to write or complete | Level and expected result |
|---|---|---|---|---|
| Foundation | Health baseline | `buildServer` | Existing `health`: returns ok | HTTP: `200` and `ok: true`; close the app after each test. |
| PR-01 | CG-01, CG-03 | `createGame` | `games.create`: `creates_game_with_normalized_join_code` | API/database: `201`, valid public game/token and corresponding persisted lobby. |
| PR-01 | CG-07; request rules | Create request schema and route | `create-game`: missing/blank/long names, wrong intervals; representative route validation case | Unit plus HTTP: schema rejects invalid values; route returns `422 VALIDATION_ERROR`. |
| PR-01 | CG-06, CG-08 | Shared error handling | `games.create`: malformed JSON; `error-handler`: safe internal error | HTTP: malformed JSON gives `400`; unexpected failure gives safe `500`, both with the agreed envelope. |
| PR-01, PR-09 | CG-02, CG-04, CG-05 | `createGame`, auth and migration | `schema`: duplicate join code; `games.create`: persisted hash and safe response | Database/HTTP: uniqueness enforced, hash stored, raw token returned only in authorized creation response. |
| PR-02 | Join contract | `joinGame` | `games.join`: join lobby, duplicate normalized name, join after start | API/database: `201` for valid join; documented `409` for name/state conflicts. |
| PR-03, PR-09 | Start contract | `resolveSession`, `startGame` | `games.start`: owner starts; captain/other host rejected; practice cases | API/database: authorized ready game starts; wrong role/game gives `403`; no/invalid token gives `401`. |
| PR-04 | LLD timing rules | `openDueRound`, `tick` | `round-service.scheduling`: immediate first round and fixed interval | Controlled clock plus database where persisted: first round eligible now, later rounds follow original schedule. |
| PR-05, PR-09 | Answer contract | `resolveSession`, `lockAnswer` | `rounds.answers`: valid choice, wrong role/game, invalid value | API/database: one locked result; contract-specific denial codes for unauthorized/invalid input. |
| PR-05 | Deadline and uniqueness | `lockAnswer`, database constraint | `rounds.answers`: deadline boundary and duplicate; `schema`: duplicate answer | API/database: before deadline may lock; at/after deadline returns `422` while still open; duplicate leaves one unchanged row. If already revealed, use `409 ROUND_NOT_OPEN`. |
| PR-06 | Scoring rules | `scoreAnswers` | `round-service.scoring`: correct/wrong, true/false, estimate ties, unanswered | Unit: exact known point totals; equal closest distances each earn one; unanswered earn zero. |
| PR-07 | Reveal state transition | `revealDueRound`, `tick` | `coordinator`: all answers, expiry, overlap, failed commit | Integration: one scored transition, fixed next schedule, no event for rolled-back work. |
| PR-08, PR-09 | Snapshot contract | `getGameSnapshot` | `games.snapshot`: lobby/open/revealed and own answer only | API/database: server phase restored with permitted fields and no pre-reveal answer key. COMPLETE retains final all-team leaderboard, latest revealed result and nullable completion metadata. |
| PR-08 | Contracts §9 synchronization protocol | `useGameSnapshot`, browser realtime | `realtime`: gap during reconnect and same-round stale event | Component/live integration: room-before-snapshot, dirty buffering, serialized reads, no stale-state regression and 15-second reconciliation. |
| PR-09 | Event recipients | `registerRealtime`, `publishGameEvent` | `socket-auth` and `game-events`: role/game isolation and private lock | Real sockets: authorized members only; private lock reaches its captain; answer key appears only after reveal. |
| PR-10 | Leave contract | `leaveGame`, `openDueRound` | `rounds.answers` and `round-engine`: repeat leave, retain current count, immediate rejection, next-round exclusion | API/database: LEFT cannot submit, locked answers still score, and unanswered former participants remain in current results. |
| PR-11 | Screen acceptance | Browser screens and request operations | `CreateGameScreen`, `QuestionScreen`, `ResultsScreen` and related screen suites | Component: visible controls/errors, explicit answer confirmation, correct role/phase. |
| PR-11 | Passenger operation | Screens | Manual three-car/mobile checklist | Manual: focus, readability, touch controls and no driver screen interaction. Record actual device/viewport and observations. |
| PR-04–PR-09 | End-to-end game loop | API, database, coordinator and real clients | `game-flow`: three cars, one reveal and identical leaderboard | Flow: actual modules agree on content, lock state, reveal and ranking; no mocked game engine. |
| PR-12 | Contracts §8 completion/capacity | Join, end, start, coordinator and snapshot | `lifecycle.test.ts`, `postgres-check.ts` | 20th/21st ACTIVE and competing final slot; duplicate/LEFT precedence; authorized/idempotent host end in lobby/OPEN/results; safe errors; hard boundary/full last window; after-lock late rejection; exhaustion/empty-bank start; no ACTIVE preserves OPEN deadline; completion/scoring rollback and atomic snapshot. |

### Worked scoring and time examples

These examples supply independent expected results; they are not function implementations.

| Scenario | Input situation | Expected result |
|---|---|---|
| Multiple choice | Key B; one car submits B, another A, another nothing. | Points 1, 0, 0. |
| True/false | Key false; one car submits false and another true. | Points 1, 0. |
| Estimate tie | Target 100; guesses 90, 110 and 130. | Points 1, 1, 0. |
| Deadline boundary | Open round ends at 10:01:00; valid requests evaluated at 10:00:59.999 and 10:01:00. | First eligible to lock; second expired. Keep the round open in setup to isolate expiry from already-revealed conflict. |
| Fixed interval | Game starts 10:00, interval 300 seconds; first round reveals at 10:00:20. | Next scheduled start remains 10:05, not 10:05:20 or immediately. |

### Scenario and evidence format

For a new case, record **requirement/contract → setup → one action → expected response/state → prohibited side effects → test level** in the issue or PR. The test name should describe the observable behavior. Expected results here are prescriptions; actual pass/fail results belong in the PR with the command, revision/date and reviewer.

Example: PR-03 → owning host and one active team in a lobby → start with explicit practice enabled → `200` and started state. A separate case uses the same single team without practice → `422 GAME_NOT_READY`. A third uses zero teams with practice → rejected as not ready; the contract requires at least one team. Avoid mixing several invalid conditions when their precedence is unspecified.

Mark pending requirements **Needs decision**, unimplemented cases **Planned**, then **Red**, **Green**, and **Reviewed** as evidence exists. A passing unit calculation does not mean its HTTP, persistence or multi-client integration is verified.
