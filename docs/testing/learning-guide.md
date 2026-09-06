# Testing learning guide: follow one behavior at a time

**Optional exercise guide.** Read the [create-game behavior contract](../specs/contracts.md) first for the actual agreement your tests verify. You write the tests and application code. This guide gives you exercises, expected outcomes and review checkpoints without providing implementation solutions.

Use the [test catalog](test-spec.md) to find behaviors, the [contract specification](../specs/contracts.md) to check their rules, and [CONTRIBUTING](../../CONTRIBUTING.md) for Git commands and collaboration. This guide supplies the order in which to practice; it does not replace those contracts.

## 1. Your next session

Work on **the existing successful create-game test only**. Do not create another test with the same purpose.

- [ ] Read the contract specification for the `POST /v1/games` request and success response.
- [ ] Open `apps/api/test/routes/games.create.test.ts` and find “creates a game with a normalized join code”.
- [ ] Identify its setup, action and assertions.
- [ ] Write down what it currently proves and what it does not prove.
- [ ] Strengthen it to check the returned game ID and host token as well as the existing name, lobby status and join code checks. You choose and write the assertions.
- [ ] Run only that case and record its actual failure.
- [ ] Explain the failure to your teammate before beginning the implementation.

Run from the repository root:

```sh
pnpm --filter @carpool/api test test/routes/games.create.test.ts -t "creates a game with a normalized join code"
```

**Stop for this session when:** you can explain the requirement, why each assertion matters, and why the test fails. A correctly written red test completes this exercise; it does not complete the feature.

The previous review found an absent route returning `404`. Run the test yourself rather than copying that result: the code may have changed. A missing route is a useful first failure, but it does not yet demonstrate game creation or validation.

## 2. Turn a catalog row into a test

Before writing assertions, answer these questions in your issue or notes:

| Question | Example: successful create game |
|---|---|
| Which rule am I checking? | A host can create a lobby and receive credentials to manage it. |
| What must already be true? | A test app is ready; a dedicated test database is ready when exercising persistence. |
| What action happens? | Submit a valid create request through the HTTP interface. |
| What should I observe? | `201`, a game ID, the submitted name, `LOBBY`, a six-character uppercase/digit code and a host token. |
| What must not happen? | The response must not expose stored token hashes. |
| What bug would make this test fail? | The route returns success but omits the host credential, for example. |
| What does this test leave unproven? | A response alone does not establish that the game was stored or that a credential is unpredictable. |

This is **Arrange → Act → Assert**: establish the situation, perform the action, inspect the result. A test can have several assertions when they jointly describe one outcome. “One behavior” does not mean “one assertion”.

Agree with your teammate on the interface under test: HTTP for a route, an exported calculation for a scoring rule, the database for a constraint, or visible controls for a screen. Avoid tests of private helper calls merely because those helpers exist.

Expected results come from the agreed rule and independently worked examples. Do not calculate the expected result by calling the same implementation you are testing.

## 3. Understand what a test result tells you

| Result | What to do |
|---|---|
| No matching tests | Fix the path/name filter and confirm the runner selected the intended case. |
| Import, configuration or database connection error | Repair the setup before treating the result as evidence about the feature. |
| Missing route returns `404` | First red for an unimplemented endpoint; begin that behavior's real implementation when ready. |
| Registered route returns the wrong status or data | Inspect which assertion failed and trace that behavior. |
| Passes immediately | Check whether the behavior already exists, or whether the assertion is too weak to detect a defect. |
| Focused test passes but another test fails | Read that failure; decide whether it is an unfinished behavior or a regression. Both must be resolved before the feature PR is ready. |

Keep the existing red create-game cases. Select the next case using the command-line filter; do not delete them, change their expectations to `404`, or commit `.only`/`.skip` just to obtain a green report.

Lint and typecheck now pass. Keep tooling failures separate from expected red feature tests: a missing route may produce `404`, but an unrelated compiler failure is not part of the exercise.

## 4. Complete create game in small exercises

For each exercise: **describe → write or improve one test → observe red → implement that behavior yourself → observe green → review**. If a test already exists, inspect and reuse it. Do not write all the remaining tests before implementing the first behavior.

These are learning steps inside a feature; they are not instructions to merge incomplete game creation into the shared branch.

| Order | Your exercise | Evidence needed before checking it off |
|---|---|---|
| A | Return the successful response from section 1. | The focused test verifies the agreed public response. Record persistence as incomplete until B. |
| B | Make creation durable using the planned PostgreSQL database. | The created game is stored with the expected values; only the token hash is stored. Test against a dedicated database. A fabricated response is insufficient. |
| C | Accept boundary values and normalize names. | Supported intervals and names of 1 and 60 trimmed characters succeed; surrounding whitespace is removed. |
| D | Reject invalid field values. | Missing/blank/too-long names, missing/unsupported intervals and a string interval are rejected according to the contract. |
| E | Distinguish invalid JSON from invalid values. | A broken JSON body returns `400 MALFORMED_JSON`; a valid JSON body containing a string interval returns `422 VALIDATION_ERROR`. |
| F | Verify the error and credential boundaries. | Errors contain the agreed code, message and request ID. Public success data does not expose stored hashes. Unexpected failures do not reveal internals. |
| G | Review the completed feature. | Focused and full checks pass, acceptance evidence exists and the other developer approves. |

Progress: [ ] A · [ ] B · [ ] C · [ ] D · [ ] E · [ ] F · [ ] G

For B, first establish the database setup and migrations needed for this behavior. Read the relevant foundation/database tasks in the [implementation plan](../delivery/implementation-plan.md). Do not call an in-memory substitute database integration coverage. Validate the test database target before any cleanup, and prevent parallel tests from clearing each other's records.

For C and D, let shared-schema tests own the full field matrix once that schema exists. Retain representative route cases proving validation is connected, along with parsing, error response and persistence tests. The catalog lists required outcomes; each outcome does not need a duplicate test at every level.

For E, a string containing “300” is still legal JSON. A malformed-JSON test needs an actually broken JSON body and a JSON content type. Explain that distinction in your own words before writing the test.

For F, distinguish a database assertion about storage from a public response assertion about disclosure. Checking that a credential is nonempty does not prove it was generated securely; its generation also needs code review against the LLD.

**Create-game exit checkpoint:** demonstrate a real request, persistence and invalid-input handling. Run the create suite, all tests, lint and typecheck. Add the build check when a build exists. An incomplete exercise may be a draft checkpoint, but mark this feature ready only when its full agreed acceptance passes.

## 5. Continue through the catalog

After create game, use this order. Each row can contain several small exercises or PRs; use the exact cases in the linked catalog sections rather than inventing a file for every sentence. The API column follows dependency order. Your teammate can work on the UI alongside it after the relevant contracts are agreed.

| Stage and catalog reference | First behavior to practice | Expand to | Exit checkpoint |
|---|---|---|---|
| Join: catalog §4, `games.join` | A captain joins an existing lobby. | Invalid code/name, normalized code, duplicate name, join after start and safe token handling; prove required uniqueness in §3. | The team belongs to the correct persisted game; rejected joins add no team. |
| Start: §4, `games.start` | The owning host starts a game with two active teams. | Missing/wrong-role/cross-game token, explicit one-team practice, zero teams and repeated start. | Authorized state transition and rejected transitions are verified. |
| Snapshot: §4, `games.snapshot` | An authorized caller restores lobby state. | Other-game access and credential exclusion; add open/revealed/locked cases when rounds exist. | Each implemented phase exposes only its allowed data. |
| Scoring: §5, `round-service.scoring` | One correct multiple-choice answer earns one point. | Wrong answer, true/false, closest estimate, tied estimates and unanswered teams. | Independently worked examples produce the agreed points. |
| Scheduling: §5, `round-service.scheduling` | The first round becomes eligible when the game starts. | Deadline, fixed next-round time and eligible-team capture. | Controlled timestamps determine outcomes; tests do not wait through real rounds. |
| Answer locking: §§3–5, answer constraint and `rounds.answers` | A captain locks one valid answer to an open round. | Wrong role/game/value, before/at/after deadline, duplicate and simultaneous requests. | One immutable persisted answer; invalid requests make no unintended change. |
| Leave: §4, `games.leave` | A captain leaves their own team. | Repeated leave, authorization, open-round count and future eligibility. | Agreed leave semantics hold during and between rounds. Resolve the design conflict first. |
| Coordinator: §5, `coordinator` | All expected answers cause reveal. | Deadline expiry, early reveal, overlapping operations and failed transactions. | Scores change once and failed transactions emit no success event. |
| Live events: §6 | Authorized members receive a public round event. | Private lock confirmation, cross-game isolation and equal reveal data. | Real connected clients receive only their permitted events. |
| Browser screens: §8 | A user completes a create/join interaction. | Loading/errors, input preservation, role-specific controls, answer confirmation and results. | Tests interact through visible controls and assert user-visible outcomes. |
| Reconnect: §§7–8 | A reconnecting captain restores current state. | Event during synchronization, same-round stale events and the caller's locked answer. | The agreed synchronization protocol misses no transition and leaks no answer key. |
| Three-car flow: §7 | Host creates; three cars join, start, answer and see results. | An unanswered car and a reconnecting car. | The actual components work together; everyone sees the same leaderboard. |
| Release/manual: §1 and implementation Tasks 9–10 | Play a full passenger-operated game in mobile-sized browsers. | Readability, focus/touch controls, refresh, reconnect and completion. | Record environments, observations, defects and both developers' review. |

Extend the catalog when an agreed requirement is missing. Completion, question exhaustion and restart recovery need explicit cases after their rules are settled; do not infer that the current catalog is exhaustive.

## 6. Pause only the behavior whose rule is unclear

Before leave, retry, reconnect, completion or restart exercises, read the [contract decision list](../specs/contracts.md#10-decisions-to-settle-before-implementation).

With your teammate, record the chosen outcome, the reason and one concrete example. Update conflicting contract/test-spec entries in the same change before making assertions. For example, agree whether a team that leaves during an open round can still submit to that round. A test cannot settle that product decision for you.

Mark that behavior **Needs decision** while you work on an independent, agreed behavior such as create-game validation. Do not quietly choose whichever contract is easiest to implement.

## 7. Keep a small evidence record

Copy this table into the relevant issue or PR; update it instead of adding another tracking system. The example is a blank exercise record, not a claim of completed work.

| Behavior | Contract | Test location/name | Evidence and next step | State |
|---|---|---|---|---|
| Create lobby | Contracts CG-01-CG-08 | Existing successful create case | Record the command, actual failure, then passing result when achieved. | Planned |

Use **Planned → Red → Green → Reviewed**, or **Needs decision**. Green means the particular test passes; it does not mean the entire feature is complete. Add a date or commit reference when recording results so stale evidence is recognizable.

Ask yourself before calling a behavior covered:

- [ ] Can I point to the requirement and the assertion that proves it?
- [ ] Does the test fail for a plausible wrong outcome, not only for a setup problem?
- [ ] Are expected values independent of the implementation?
- [ ] Does it test real storage/network behavior where the claim requires it?
- [ ] Are relevant boundaries, denied actions and unwanted side effects checked?
- [ ] Can it run alone and with the suite without leaked state?
- [ ] Would an internal refactor preserving the contract leave this test valid?

A passing test is evidence for its assertions. Neither the number of tests nor a line-coverage percentage proves all required behavior.

## 8. Review and commit with your teammate

For each exercise, one developer authors and the other reviews. Swap roles on a later exercise. Before coding, the reviewer checks the expected behavior; afterward, the reviewer asks which realistic defect the test would catch and which important behavior remains unproven.

- **Red checkpoint:** optionally commit the test on your feature branch and describe the expected failure; share a draft PR if feedback helps.
- **Completed behavior:** commit its implementation, tests and relevant contract/migration changes together. Separate unrelated cleanup.
- **Ready for merge:** all agreed feature acceptance and required checks pass, then the other developer approves. Do not merge the entire catalog as executable red tests.

Use the commands in [CONTRIBUTING](../../CONTRIBUTING.md) for staging and PR workflow, and the [CI guide](../delivery/quality-and-release.md) for the current checks. Keep dependency folders, local database data and secrets out of commits.

When asking for help, include the behavior, your test, the exact command, actual failure and your explanation of what you expected. Ask for a review or a hint first; you keep ownership of writing the solution.
