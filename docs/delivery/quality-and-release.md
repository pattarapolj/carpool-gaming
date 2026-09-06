# Quality, release and maintenance guide

**Purpose:** Make local verification and the future GitHub merge gate explicit. For commits, collaboration and SDLC, read [CONTRIBUTING.md](../../CONTRIBUTING.md).

## 1. Current implementation versus target

As of 2026-09-06, the repository has API and shared-contract tests plus lint and typecheck scripts. It has no `.github/workflows/ci.yml`, `.nvmrc`, browser app, database setup, or build script. The workflow below is a future template, not installed automation. Hosted branch settings have not been configured.

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
```

Use `-t "test name"` after the file path for one case. pnpm forwards arguments after the script name; these commands do not need an extra `--`. See [pnpm run](https://pnpm.io/cli/run).

At this review the health test passes. The contract suite has 6 intentionally failing positive cases and 10 passing rejection cases; the route suite has 19 intentionally failing cases and 1 database case marked `todo`. Lint and typecheck pass. These failures are the starting TDD specification, not evidence of an implemented route.

## 3. Developer loop

1. Agree on one issue and its acceptance criteria.
2. Branch from the shared baseline and write one focused failing test.
3. Make the real behavior pass, then simplify.
4. Run the affected suite and all existing workspace checks.
5. Review the staged diff and commit code, tests and relevant contract/docs together.
6. Push and request the other developer's review.
7. Merge after checks and review pass; release separately when ready.

## 4. Foundation CI template

Create `.github/workflows/ci.yml` when delivering foundation CI. This template uses existing scripts and reads pnpm **10.23.0** from root `package.json`, rather than specifying a conflicting pnpm version. [pnpm action setup](https://github.com/pnpm/action-setup) supports this package-manager field.

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
```

This template has not run on GitHub. With today's intentionally red tests it will fail; keep those failures visible on the draft branch. Complete feature behavior before marking the corresponding PR ready. Do not add `continue-on-error`, skip failing acceptance tests, or invent a no-op build to satisfy a checklist.

When database tests arrive, add a PostgreSQL 16 service with readiness checking, apply real migrations, and provide a dedicated test database URL. Use synthetic data and prevent cleanup from targeting a development/production database. Tests sharing one database must run serially or use independent schemas.

When build scripts arrive, add `pnpm build` locally and to CI. Verify the built application starts in a smoke test. When the web app arrives, add its actual tests to workspace checks. Until then, neither command is a current requirement that can be claimed as passing.

## 5. Hosted merge gates

Once CI exists, configure `main` to require the `verify` job, resolved review conversations, and **one approval from the other developer**. Prevent direct pushes and force pushes through the repository's available protection/ruleset settings. A document or workflow alone does not enforce those settings. Availability depends on hosting and plan. See [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

For a contract change, both developers agree on the design, with the non-author providing the approving review. Recheck substantial changes after review. CI complements human review; neither replaces acceptance criteria.

## 6. Definition of done

- The issue's observable acceptance criteria pass.
- Meaningful behavior has automated evidence; visual/mobile behavior has a relevant manual check when needed.
- The focused suite, full suite, lint and typecheck pass. Build passes once implemented.
- Implementation, tests, migrations and affected documentation agree.
- CI passes once configured, and the other developer approves.
- Any remaining work is explicitly tracked; it is not described as implemented or verified.

Release additionally needs the deployment and smoke-test evidence described in the developer guide. Foundation Task 1 remains incomplete until its planned tooling exists and is verified.

## 7. Release rehearsal and execution

**Status:** Procedure and evidence checklist only. No deploy target, migration command, backup command or production start command exists yet. Task 10 must fill in environment-specific commands and rehearse them before this becomes an executable runbook. This document does not claim a release has happened.

| Step | Release owner does | Other developer verifies |
|---|---|---|
| Select revision | Record the reviewed commit/tag, changes and release environment. | Required tests/checks and acceptance evidence match that revision. |
| Check readiness | Resolve release-blocking contract gaps; confirm configured environment and database target. | No pending completion/capacity/reconnect requirement is silently considered delivered. |
| Prepare recovery | Record the previous runnable revision and database-compatible recovery procedure; confirm backup and restore rehearsal. | A restore/recovery test exists; reverting code alone is not assumed to undo migrations. |
| Rehearse migrations | Apply the same migrations to disposable production-like data. | Existing data is preserved and the target revision can start against the resulting schema. |
| Deploy | Execute the documented migration/deploy sequence on the intended environment. | Actual revision, configuration and health response are correct. |
| Smoke test | Create a host, join cars, start, answer, reveal and reconnect. | Expected public behavior, permissions and consistent leaderboard hold. |
| Record outcome | Capture date, revision, environment, both names, checks, defects and recovery actions. | Mark pass/fail from observations; pause promotion or use the rehearsed recovery procedure on failure. |

Do not store environment credentials or real session tokens in release evidence. Add the concrete commands here when the deployment mechanism is chosen; test them against an explicit non-production environment first.

## 8. Operation and maintenance

Record a bug's expected versus actual behavior, reproduction steps, affected revision/environment and a safe request identifier. Trace its requirement/contract and add a regression case to the test specification when needed. The fix follows the same branch, verification and review process as a feature.

For a live incident, one developer coordinates mitigation and the other verifies observed behavior and recovery. Keep a short timeline, impact, cause, resolution and one or two concrete prevention actions. Never label an incident resolved solely because the process restarted; confirm the failed user behavior works.

Review dependencies and runtime compatibility as an explicit maintenance change with lockfile and check evidence. Update root README status after tooling or features become verified. Keep release records in the release/PR discussion rather than duplicating them across every specification.
