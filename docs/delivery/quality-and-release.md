# Quality, release and maintenance guide

**Purpose:** Make local verification, installed CI and hosted merge-gate requirements explicit. For commits, collaboration and SDLC, read [CONTRIBUTING.md](../../CONTRIBUTING.md).

## 1. Current implementation versus target

As of 2026-10-08, the API has a process entry point and build/start scripts. Docker Compose runs the API with PostgreSQL and applies numbered migrations when it initializes a new database volume. The browser lobby, lobby snapshot, answer/leave routes and server round transitions are implemented; full round snapshots, the coordinator, realtime and gameplay screens remain pending. `.github/workflows/ci.yml` is installed. Hosted execution and branch settings have not yet been verified; no complete Foundation or release claim follows from installing a workflow.

Tests live in ordinary source files. CI runs those files on a clean machine after a push; writing a workflow does not create tests or prove unimplemented behavior.

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

The [README](../../README.md) records the last observed test, lint and typecheck results. Docker Compose applies the migrations on a fresh volume; later schema changes to an existing volume need a migration runner before deployment.

## 3. Change workflow

1. Agree on one issue and its acceptance criteria.
2. Branch from the shared baseline and write one focused failing test.
3. Make the real behavior pass, then simplify.
4. Run the affected suite and all existing workspace checks.
5. Review the staged diff and commit code, tests and relevant contract/docs together.
6. Push and request review.
7. Merge after checks and review pass; release separately when ready.

## 4. Installed Foundation CI

The installed [workflow](../../.github/workflows/ci.yml) runs the existing lint, typecheck, test and build scripts, then `pnpm --filter @carpool/api test:postgres`. It runs on pushes and pull requests with `contents: read` permission. Node is pinned to 22; pnpm **10.23.0** comes from root `package.json`; installation uses `--frozen-lockfile`. Current official docs specify [checkout v7](https://github.com/actions/checkout), [setup-node v7](https://github.com/actions/setup-node) and [pnpm/action-setup v6](https://github.com/pnpm/action-setup). The [GitHub PostgreSQL service guide](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers) describes the service port and readiness healthcheck used here.

The `postgres:16` service uses synthetic credentials and the dedicated `carpool_test` database. `pg_isready` must pass before steps start. `test:postgres` requires an explicit `TEST_DATABASE_URL` naming that database with no query parameters/fragments, never falls back to `DATABASE_URL`, isolates migrations/seeds in a generated schema and cleans only that schema. Run it locally using the [README instructions](../../README.md#quality-checks); a real PostgreSQL 16 instance is required. The ordinary Vitest suite remains available without PostgreSQL.

Local PostgreSQL 16.14 evidence on 2026-10-08 passed six checks: overlapping same-team HTTP submissions produce one immutable answer and duplicate `409`; deadline reveal/final answer in both lock orders awards once; overlapping openers produce one sequence; an answer waiting on a real row lock rechecks its deadline; failed scoring rolls back answer/grades/scores/reveal and can retry. Contenders use separate pool connections and observed backend lock waits. Capacity admission, realtime publication and production container rehearsal are later work.

Hosted CI has not run for this revision yet. Verify the actual `verify` job after push before merge readiness. Do not add `continue-on-error`, skip failing acceptance tests, or invent no-op checks. A local command run does not prove a hosted workflow passed.

## 5. Hosted merge gates

After hosted CI passes, configure `main` to require the `verify` job, resolved review conversations, and **one approval**. Prevent direct pushes and force pushes through the repository's available protection/ruleset settings. A document or workflow alone does not enforce those settings. Availability depends on hosting and plan. See [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

Contract changes require an approving review. Recheck substantial changes after review. CI complements human review; neither replaces acceptance criteria.

## 6. Definition of done

- The issue's observable acceptance criteria pass.
- Meaningful behavior has automated evidence; visual/mobile behavior has a relevant manual check when needed.
- The focused suite, full suite, lint and typecheck pass. Build passes once implemented.
- Implementation, tests, migrations and affected documentation agree.
- CI passes once configured, and the change is approved.
- Any remaining work is explicitly tracked; it is not described as implemented or verified.

Release additionally needs the deployment and smoke-test evidence described in this guide. Foundation Task 1 remains incomplete until its planned tooling exists and is verified.

## 7. Release rehearsal and execution

**Status:** Procedure and evidence checklist only. No deploy target, migration command, backup command or production start command exists yet. Task 10 must fill in environment-specific commands and rehearse them before this becomes an executable runbook. This document does not claim a release has happened.

| Step | Action | Verification |
|---|---|---|
| Select revision | Record the reviewed commit/tag, changes and release environment. | Required tests/checks and acceptance evidence match that revision. |
| Check readiness | Resolve release-blocking contract gaps; confirm configured environment and database target. | No pending completion/capacity/reconnect requirement is silently considered delivered. |
| Prepare recovery | Record the previous runnable revision and database-compatible recovery procedure; confirm backup and restore rehearsal. | A restore/recovery test exists; reverting code alone is not assumed to undo migrations. |
| Rehearse migrations | Apply the same migrations to disposable production-like data. | Existing data is preserved and the target revision can start against the resulting schema. |
| Deploy | Execute the documented migration/deploy sequence on the intended environment. | Actual revision, configuration and health response are correct. |
| Smoke test | Create a host, join cars, start, answer, reveal and reconnect. | Expected public behavior, permissions and consistent leaderboard hold. |
| Record outcome | Capture date, revision, environment, checks, defects and recovery actions. | Mark pass/fail from observations; pause promotion or use the rehearsed recovery procedure on failure. |

Do not store environment credentials or real session tokens in release evidence. Add the concrete commands here when the deployment mechanism is chosen; test them against an explicit non-production environment first.

## 8. Operation and maintenance

Record a bug's expected versus actual behavior, reproduction steps, affected revision/environment and a safe request identifier. Trace its requirement/contract and add a regression case to the test specification when needed. The fix follows the same branch, verification and review process as a feature.

For a live incident, coordinate mitigation and independently verify observed behavior and recovery. Keep a short timeline, impact, cause, resolution and one or two concrete prevention actions. Never label an incident resolved solely because the process restarted; confirm the failed user behavior works.

Review dependencies and runtime compatibility as an explicit maintenance change with lockfile and check evidence. Update root README status after tooling or features become verified. Keep release records in the release/PR discussion rather than duplicating them across every specification.
