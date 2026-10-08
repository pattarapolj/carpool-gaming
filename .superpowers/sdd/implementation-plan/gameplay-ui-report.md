# Task 8 — passenger gameplay, recovery and sharing

Status: DONE. Base `f6bfdc3`; branch `pattarapolj/captain-gameplay`.

## Implemented

- Completed the existing approved cream/forest Shared Answer B app: welcome/create/join/lobby, host public question, captain selection and separate confirmation, caller-only locked answer, revealed results/leaderboard, next-round standby, reconnect/retry, readonly LEFT and final leaderboard. Reused the existing lobby by moving it into `screens/LobbyScreen.tsx`; App now owns access/session changes, GameScreen owns game/lifecycle actions, and the planned snapshot hook owns synchronization.
- Native radio inputs send listed multiple-choice strings and actual boolean true/false. Estimates use number input, `step="any"`, decimal keyboard and finite validation. Failure preserves selection and restores controls; success or the caller's stored answer locks them. HTTP failures/duplicate409 trigger snapshot reconciliation, never automatic answer retry. ApiError preserves HTTP status and contract code. Native HTTP abort bounds requests at 10 seconds.
- Registered all live listeners before connection. Each connection starts a room-before-snapshot `game.subscribe` handshake; only its successful acknowledgement permits `game.snapshot`. Full acknowledgements use the approved schema. Events invalidate serialized/coalesced reads; events during recovery mark dirty and trigger a subsequent read. Five-second Socket.IO acknowledgement timeout prevents a lost ack from permanently blocking reads. Session/connection epochs ignore old responses; cleanup removes listeners, disconnects the socket and clears reconciliation. A 15-second authoritative read also recovers dropped publications while connected. Last good state stays visible during failure with status and retry.
- Countdown uses snapshot serverTime plus elapsed performance time. It never opens/reveals/scores a round or supplies submission authority. Null/past schedules and schedules at/after startedAt+2h display neutral server-wait text; there is no promised new question at the hard ceiling.
- Separate leave/end confirmations explain immediate answer cutoff, retained locked answers, server scoring and unanswered0. Successful leave displays LEFT immediately from the server acknowledgement; a recovered LEFT snapshot does the same. Successful host end displays the response's final server leaderboard while reconciling the revealed snapshot. All roles including LEFT can view completion. Return home removes only this browser's game-session key.
- Lobby sharing includes code, token-free invite link, native Web Share and clipboard where available, and an always-visible selectable link/failure fallback. A validated six-character `?join=CODE` opens the prefilled join form without joining automatically. Create/join inputs survive errors.
- Preserved logo/palette/typography and existing layout, adding gameplay card styles, text wrapping, narrow-screen grid behavior, >=48px control targets, keyboard focus/confirmation focus restoration, higher-contrast muted text within the same palette, and reduced-motion behavior. No autoplay, QR library or visual redesign.
- Added Socket.IO polling/WebSocket Vite proxy and only the authorized socket client/RTL/user-event/jsdom dependencies. Updated README/implementation status and aligned the deferred LLD session-lifetime sentence with stored COMPLETE/LEFT read access.

Public contracts and backend implementation are unchanged. No PostgreSQL rerun was required for this frontend/docs slice; the parent's reviewed live-server baseline owns PostgreSQL evidence.

## TDD evidence

RED, before new hook/question implementation:

`pnpm --filter @carpool/web test src/useGameSnapshot.test.tsx src/screens/QuestionScreen.test.tsx`

Expected failure: 2 failed suites because `./useGameSnapshot` and `./QuestionScreen` did not exist. Tests described subscription/recovery ordering and the visible confirmation/value/lock flow.

GREEN after implementation, same command: 2 files / 8 tests passed, pristine output.

RED, before App/lifecycle/invite integration:

`pnpm --filter @carpool/web test src/App.test.tsx`

Expected failure: 6 failed / 2 passed. Missing invite-prefilled join form, leave/end confirmation, recovered results, invite fallback and neutral standby. Existing malformed-invite/error-input cases passed.

GREEN after integration, same command: 1 file / 8 tests passed, pristine output. Subsequent meaningful boundary cases expanded coverage.

Final focused command:

`pnpm --filter @carpool/web test src/App.test.tsx src/useGameSnapshot.test.tsx src/screens/QuestionScreen.test.tsx src/screens/Countdown.test.tsx src/api.test.ts`

Result: 5 files / 29 tests passed. Includes actual false/string/finite-decimal payloads, failed confirmation, lost HTTP success followed by own-answer recovery, host role, restored locked/revealed/COMPLETE/LEFT state, create/join input preservation, practice start, leave/end/cancel focus, native/fallback sharing, null/past/hard-limit standby, device-clock-independent countdown with no local reveal, event during subscribe/snapshot recovery, stale same-round event, coalescing, old responses after reconnect/session change, failed/lost subscribe ack, bounded request timeout and healthy 15-second reconciliation.

## Final verification

Ran the workspace suite once after implementation/self-review, alongside independent lint/typecheck/build checks:

- `pnpm test`: 191/191 passed — API135, contracts25, web31; 25 test files. Pristine output.
- `pnpm lint`: 72 files checked; no fixes or diagnostics.
- `pnpm typecheck`: all three packages passed.
- `pnpm build`: API compiled and browser/PWA built; service worker generated with12 precache entries. No build warning/error.
- `git diff --check`: passed.

Dependency install retained the existing transitive `glob@11.1.0` deprecation warning. Runtime/final checks emitted no warnings.

## Files changed

- `apps/web/src/App.tsx`, `App.test.tsx`, `api.ts`, `api.test.ts`, `realtime.ts`, `useGameSnapshot.ts`, `useGameSnapshot.test.tsx`, `styles.css`.
- `apps/web/src/screens/`: existing Lobby moved to `LobbyScreen.tsx`; new `GameScreen.tsx`, `QuestionScreen.tsx`, `QuestionScreen.test.tsx`, `ResultsScreen.tsx`, `Countdown.tsx`, `Countdown.test.tsx`, `SharingControls.tsx`.
- `apps/web/src/test/game-fixtures.ts` (test-only contract data).
- `apps/web/package.json`, `apps/web/vite.config.ts`, `pnpm-lock.yaml`.
- `README.md`, `docs/delivery/implementation-plan.md`, `docs/specs/lld.md`, this report.

## Self-review and limitations

Read the diff/new components against the binding brief and relevant React lifecycle/a11y guidance. Corrected listener cleanup and old-event guards, confirmation-cancel focus restoration, invalid-ack display text, finite estimate handling, and preserved false via nullish checks before final checks. Scores/ranks/revealed answers always come from the server. No schema gap or unresolved correctness concern found; no extra abstractions or framework migration.

Component tests use mocked sockets/HTTP operations with real React DOM interactions. They do **not** establish real browser, multi-session network, physical-phone, viewport rendering or production-hosting acceptance. Responsive CSS safeguards are implemented, but actual320/390px readability/no-overflow and clipboard/share behavior remain the parent's Task9 browser/phone gate. Parent also owns fresh independent review and hosted UI CI after push. No push, merge, deployment or subagent dispatch performed.
