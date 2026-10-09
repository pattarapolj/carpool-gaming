# Three-car browser acceptance — 2026-10-08

Application revision tested: `19fadab` (Task9 changes only acceptance tooling, CI and documentation). Branch: `pattarapolj/browser-acceptance`. The acceptance runner is committed with this checklist. Browser: actual headless Chromium **143.0.7499.4**, Playwright **1.57.0**, Windows desktop; viewports **320 × 844** and **390 × 844** CSS pixels. PostgreSQL **16.14**, dedicated `carpool_test`, generated schema per run.

These are observed results from automated browser interaction and direct visual inspection of its screenshots. This is desktop viewport emulation, not a physical phone, touch-device, driving or cellular-network trial.

## Reproduce

Install workspace dependencies, provision only the dedicated test database, and set `TEST_DATABASE_URL` to its connection URL. Never substitute `DATABASE_URL` or a production database. The runner fails if the explicit URL does not name `carpool_test`; migrations and fixture questions live in a generated schema that cleanup drops.

```powershell
pnpm --filter @carpool/api exec playwright install chromium
# Set TEST_DATABASE_URL in your local shell to the dedicated carpool_test URL.
pnpm test:browser
```

The Vite app needs free local port **5174**; the listening API uses an ephemeral port. CI installs Chromium with its system dependencies and runs this command unconditionally after the existing PostgreSQL checks. Normal `pnpm test` and focused package test commands remain separate from browser acceptance.

## Observed checklist

| Check | Result | Observation |
|---|---|---|
| Host creates; three fresh captain contexts join | PASS | Distinct localStorage sessions; live roster reaches three cars. Captain pages do not expose host start controls. |
| Invite link in a fresh context | PASS | Join mode and six-character code prefilled; car name starts empty. |
| Native create validation | PASS | Empty game name prevents submission through the required HTML input. |
| Shared OPEN question/deadline | PASS | Host and all captains receive identical `round.started` payloads and identical authoritative OPEN round snapshots. |
| Pre-reveal privacy | PASS | Raw incoming events/snapshot acknowledgments and raw HTTP OPEN round data contain no answer-key, explanation, result or source fields. Snapshot responses contain no credentials/hashes. Assertions run before schema parsing can discard fields. |
| Select then confirm | PASS | MC confirmation starts disabled; Space and arrow keys select radios without submitting; database still has zero answers until confirmation. |
| Visible keyboard focus | PASS | Native radio reports `:focus-visible`, 3px outline; inspected focus screenshot shows the orange outline. |
| Lost answer response | PASS | A real answer commits, then its HTTP response is aborted. Private live invalidation/authoritative refresh restores `Answer locked`. |
| Immutable MC answer | PASS | Second HTTP submission gets `409 ANSWER_ALREADY_LOCKED`; persisted ID, answer and timestamp stay identical. Another captain cannot see the locked value. |
| Final answer and scoring | PASS | Final captain produces one identical reveal for each of the four clients, equal leaderboard data/rendering; repeated real coordinator ticks produce no second reveal. Correct/wrong MC scores are 1/0. |
| Boolean false | PASS | False submits and restores as the boolean `false`, including locked refresh/reconnect. |
| Decimal estimate and finite guard | PASS | Overflowing `1e309` leaves confirmation disabled. 90.5 and 109.5 submit; target 100 awards both equal-distance teams one point. |
| Leave confirmation | PASS | Focus moves to Confirm leave; Cancel restores focus to Leave game. Confirmation text names immediate answer stop and retained score. |
| Immediate LEFT denial | PASS | Confirmed leave removes answer controls; actual HTTP submission returns `409 TEAM_LEFT`. Original OPEN roster remains three and does not reveal early after the other two answer. |
| Unanswered deadline | PASS | At the exact server deadline, actual tick reveals the unanswered LEFT participant with null answer and 0 points. Repeated tick does not reveal twice. |
| Subsequent roster | PASS | Next round contains two active participants; the LEFT score remains in the final leaderboard. |
| Refresh/reconnect | PASS | Host and three captains restore lobby, OPEN, results and COMPLETE. Locked captain restores MC and false answer. Tests close the actual forwarded WebSocket, observe loss UI, wait for a new upgraded/authenticated connection and recovered subscription. |
| Host end confirmation | PASS | Confirm end receives focus and Enter activates it. All four clients display COMPLETE and the same final leaderboard after refresh/reconnect. |
| Driver/passenger wording | PASS | Lobby and game screens say a passenger runs the phone and drivers join hands-free. Drivers have no application interaction role. |
| 48px targets | PASS | All visible controls measured at least 48px in each direction; radio/checkbox targets use their clickable labels. |
| Narrow-screen wrapping | PASS | 320px and 390px screens have no document horizontal overflow. Long answer option, 60-character car name, results, confirmations and footer wrap visibly. |
| Last fitting slot/hard limit | PASS with contract note | Actual late tick at start +119 minutes opens a full 60-second window. Early reveal returns `nextRoundAt` at exactly two hours. UI neutral-waits; the tick at two hours completes TIME_LIMIT without another round. |

## Visual evidence and defects

All **27** screenshots were opened and visually inspected. They are ignored local artifacts under `output/playwright/`: welcome, invite join, host/captain lobby, MC, boolean, locked, results, estimate, leave/end confirmations, COMPLETE and final-slot wait, each at 320px/390px, plus `keyboard-focus-390.png`. Screenshots include no session tokens. Input scrolling inside the readonly invite field is normal native input behavior; the page itself does not overflow.

No application defect was observed and no production screen, timing, scoring, locking, reveal, seed or shared-contract code changed. Harness synchronization defects encountered during setup are recorded in the implementation report.

The [completion contract](../specs/contracts.md#8-other-game-operations) clarifies that `nextRoundAt` is a scheduling boundary: it can represent hard-limit closure or remain overdue during a final no-fit gap, without promising another playable question. The existing UI handles the observed hard-limit boundary neutrally. This October 8 run proves the fitting last window and its completion; it did not exercise every delayed/no-fit schedule.

Unverified here: physical-device tap accuracy, mobile OS share sheets/clipboard permissions, installed PWA/service-worker behavior, cellular loss/latency, and passenger/driver use in a moving vehicle. Native controls and desktop Chromium keyboard behavior were exercised; lifecycle confirmations are the app's HTML controls, not OS confirmation dialogs.
