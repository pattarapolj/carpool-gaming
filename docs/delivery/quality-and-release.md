# Quality, release and maintenance guide

**Purpose:** Make local verification, installed CI and hosted merge-gate requirements explicit. For commits, collaboration and SDLC, read [CONTRIBUTING.md](../../CONTRIBUTING.md).

## 1. Current implementation versus target

As of 2026-10-09, the built PWA, Fastify API and Socket.IO run together as one unprivileged process. Lobby, full snapshots, coordinator, scoring, completion/capacity policy, live synchronization, passenger gameplay and saved topic selection are implemented and reviewed. Journaled migrations upgrade existing databases; pre-journal schemas require explicit verified adoption. The reviewed 325-question bank is seeded idempotently, with 25 questions in each of 13 topics. The [production runbook](production-runbook.md) contains executable installation, adoption, upgrade, backup/restore and recovery commands. The topic-selection PR's current hosted checks passed at `9051ea9`; final review and approval are still needed before merge.

Tests live in ordinary source files. CI runs those files on a clean machine for pull requests and pushes to `main`; writing a workflow does not create tests or prove unimplemented behavior.

## 2. Local commands that exist now

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @carpool/api test test/health.test.ts
pnpm --filter @carpool/contracts test
pnpm --filter @carpool/api test test/routes/games.create.test.ts
pnpm --filter @carpool/api test:watch test/routes/games.create.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dev
pnpm start
```

Use `-t "test name"` after the file path for one case. pnpm forwards arguments after the script name; these commands do not need an extra `--`. See [pnpm run](https://pnpm.io/cli/run).

The [README](../../README.md) records the last observed test, lint and typecheck results. Docker Compose runs the checksum-verified migration runner before listening; existing pre-journal volumes require the explicit adoption procedure.

## 3. Change workflow

1. Agree on one issue and its acceptance criteria.
2. Branch from the shared baseline and write one focused failing test.
3. Make the real behavior pass, then simplify.
4. Run the affected suite and all existing workspace checks.
5. Review the staged diff and commit code, tests and relevant contract/docs together.
6. Push and request review.
7. Merge after checks and review pass; release separately when ready.

## 4. Installed Foundation CI

The installed [workflow](../../.github/workflows/ci.yml) runs the existing lint, typecheck, test and build scripts, then `pnpm --filter @carpool/api test:postgres`. It runs on pull requests against any branch and pushes to `main` with `contents: read` permission. Feature branches rely on local checks until a PR exists; subsequent PR updates run one full verification job rather than duplicate push/PR jobs. Node is pinned to 22; pnpm **10.23.0** comes from root `package.json`; installation uses `--frozen-lockfile`. Current official docs specify [checkout v7](https://github.com/actions/checkout), [setup-node v7](https://github.com/actions/setup-node) and [pnpm/action-setup v6](https://github.com/pnpm/action-setup). The [GitHub PostgreSQL service guide](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers) describes the service port and readiness healthcheck used here.

The `postgres:16` service uses synthetic credentials and the dedicated `carpool_test` database. `pg_isready` must pass before steps start. `test:postgres` requires an explicit `TEST_DATABASE_URL` naming that database with no query parameters/fragments, never falls back to `DATABASE_URL`, isolates migrations/seeds in a generated schema and cleans only that schema. Run it locally using the [README instructions](../../README.md#quality-checks); a real PostgreSQL 16 instance is required. The ordinary Vitest suite remains available without PostgreSQL.

Local PostgreSQL 16.14 passes 15 scenarios: immutable duplicate submissions; deadline/final-answer races in both lock orders; single sequence opening; post-lock deadline checks; scoring rollback; atomic snapshots and overlapping coordinator ticks; final-slot admission; end/answer/deadline contention; hard-limit completion; authenticated live publication; and the full reviewed bank. Separate migration checks cover concurrent application, checksums, rollback/retry, stored game/answer preservation, exact-prefix adoption and drift rejection. Chromium acceptance contains two real multi-context journeys and one cleanup failure-path test. Physical phones, installed PWA/background behavior and cellular networks are not covered by desktop Chromium.

The [hosted PR verify run](https://github.com/pattarapolj/carpool-gaming/actions/runs/37885006560) passed on `87472fc`, including build, 195 ordinary tests, PostgreSQL, migration safety and three browser tests. Topic-selection [PR #17](https://github.com/pattarapolj/carpool-gaming/pull/17) passed the hosted `verify` job on `9051ea9`, including the full browser suite. Verify the actual `verify` job for each subsequent PR head before merge readiness. Do not add `continue-on-error`, skip failing acceptance tests, or invent no-op checks. A local command run does not prove a hosted workflow passed.

## 5. Hosted merge gates

The current private repository plan rejects protection setup (403 requiring GitHub Pro or public visibility); no settings or visibility changed. When the hosting plan permits, configure `main` to require the `verify` job, resolved review conversations, and **one approval**. Prevent direct pushes and force pushes through the repository's available protection/ruleset settings. A document or workflow alone does not enforce those settings. Availability depends on hosting and plan. See [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

Contract changes require an approving review. Recheck substantial changes after review. CI complements human review; neither replaces acceptance criteria.

## 6. Definition of done

- The issue's observable acceptance criteria pass.
- Meaningful behavior has automated evidence; visual/mobile behavior has a relevant manual check when needed.
- The focused suite, full suite, lint and typecheck pass. Build passes once implemented.
- Implementation, tests, migrations and affected documentation agree.
- CI passes once configured, and the change is approved.
- Any remaining work is explicitly tracked; it is not described as implemented or verified.

Release additionally needs the deployment and smoke-test evidence described in this guide. The implementation and shared contracts through `87472fc` are reviewed and its hosted checks passed; each subsequent head requires scoped review and actual hosted CI before merge readiness.

## 7. Release rehearsal and execution

**Status:** The [production runbook](production-runbook.md) provides executable commands for a fresh Compose install, verified legacy adoption, upgrade, health, backup/restore and recovery. Task 10 exercised these against task-owned local containers and synthetic data on October 8. No external target has been selected; HTTPS proxy configuration is documented but not externally exercised.

Observed local rehearsal on 2026-10-08 used `carpool-release-b3f4` (localhost33081) and `carpool-restore-b3f4` (localhost33082), synthetic databases and PostgreSQL16.14. Final image `sha256:f2dfc039964f920d86987698a7892db66212329609c57116e6aca70f91401397` ran as UID1000. Fresh bootstrap produced 5 journal entries and 24 questions; explicit legacy003 adoption applied004/005 while preserving the game and immutable answer. Chromium143 completed a built-app two-car game: same locked answer/round after process restart, all three clients automatically reconnected, one reveal each, matching scores1/1. A binary pg_dump restored into the second project's fresh database, and its running app returned the same completed game, answer, revealed round and leaderboard. Both databases had4 synthetic games/6 answers (including earlier defect-reproduction journeys),5 journal entries and24 questions. Containers, labeled volumes/networks and image tags owned by both rehearsal projects were removed afterward; the parent's dedicated test database was retained.

Final local checks passed195 ordinary tests,15 PostgreSQL scenarios, migration safety and3 browser-suite tests, lint/typecheck/build. The initial container restart exposed an explicit server-disconnect packet preventing automatic reconnect; transport-only shutdown corrected it, with a real same-port reconnect/subscribed-snapshot regression. Final built-image rehearsal passed again after the correction. The October 9 review approved the implementation/shared contracts through `87472fc`, and its [hosted PR checks](https://github.com/pattarapolj/carpool-gaming/actions/runs/37885006560) passed. Proxy/TLS/public-host and physical-phone/PWA/cellular behavior remain unverified; temporary Docker recovery does not establish permanent host repair. Subsequent heads still need scoped review and hosted CI.

| Step | Action | Verification |
|---|---|---|
| Select revision | Record the reviewed commit/tag, changes and release environment. | Required tests/checks and acceptance evidence match that revision. |
| Check readiness | Resolve release-blocking contract gaps; confirm configured environment and database target. | No pending completion/capacity/reconnect requirement is silently considered delivered. |
| Prepare recovery | Record the previous runnable revision and database-compatible recovery procedure; confirm backup and restore rehearsal. | A restore/recovery test exists; reverting code alone is not assumed to undo migrations. |
| Rehearse migrations | Apply the same migrations to disposable production-like data. | Existing data is preserved and the target revision can start against the resulting schema. |
| Deploy | Execute the documented migration/deploy sequence on the intended environment. | Actual revision, configuration and health response are correct. |
| Smoke test | Create a host, join cars, start, answer, reveal and reconnect. | Expected public behavior, permissions and consistent leaderboard hold. |
| Record outcome | Capture date, revision, environment, checks, defects and recovery actions. | Mark pass/fail from observations; pause promotion or use the rehearsed recovery procedure on failure. |

Do not store environment credentials or real session tokens in release evidence. Use the runbook commands only against the explicitly selected project. Keep production data intact; remove only verified task-owned rehearsal resources.

## 8. Operation and maintenance

Record a bug's expected versus actual behavior, reproduction steps, affected revision/environment and a safe request identifier. Trace its requirement/contract and add a regression case to the test specification when needed. The fix follows the same branch, verification and review process as a feature.

For a live incident, coordinate mitigation and independently verify observed behavior and recovery. Keep a short timeline, impact, cause, resolution and one or two concrete prevention actions. Never label an incident resolved solely because the process restarted; confirm the failed user behavior works.

Review dependencies and runtime compatibility as an explicit maintenance change with lockfile and check evidence. Update root README status after tooling or features become verified. Keep release records in the release/PR discussion rather than duplicating them across every specification.
