# Contributing

This repository is intentionally test-first. The create-game contract and route tests are red because you are expected to implement them.

## Work one behavior at a time

1. Choose one named case from [the test catalog](docs/testing/test-spec.md).
2. Run only that case and confirm why it fails.
3. Write the smallest implementation that makes it pass.
4. Run the related suite, lint and typecheck.
5. Commit the behavior, its test and any contract change together.

Do not change an expected `201` or `422` to the current accidental `404`. Do not add `.skip` or `.only` merely to make a report green. A red specification commit is allowed on a draft branch; implemented work is ready to merge only when its required checks pass.

## Commit the initial repository

Before the first commit, every file is untracked, so ordinary `git diff` does not show it. Review the explicit file list and staged content:

```powershell
git status --short
git add .gitignore README.md CONTRIBUTING.md package.json pnpm-lock.yaml pnpm-workspace.yaml biome.json
git add apps packages docs
git diff --cached --stat
git diff --cached
git commit -m "test: establish create-game specification"
```

Never commit `node_modules`, `.pnpm-store`, `.env`, credentials, raw session tokens, database files, logs, coverage or build output.

## Branch workflow

Use one short-lived branch per behavior. Shared contracts and migrations require review because both the browser and API depend on them.

```powershell
git switch main
git pull --ff-only
git switch -c pattarapolj/create-game

# After implementing one behavior:
pnpm lint
pnpm typecheck
pnpm test
git status --short
git diff
git add <only-the-files-for-this-behavior>
git diff --cached
git commit -m "feat(api): create lobby game"
git push -u origin pattarapolj/create-game
```

The full test command is expected to fail in the initial red-specification commit. Once implementation starts, do not merge the feature branch until the tests required by that slice are green.
