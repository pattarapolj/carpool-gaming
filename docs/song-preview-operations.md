# Song preview checks

Apply database migrations before starting the updated API. Migration `015_song_preview_availability.sql` adds a durable per-recording ledger. The table stores availability, the last check time, and safe failure codes/stages; it stores no audio or provider URLs.

While the API is listening, it checks one due recording every 30 seconds. Checks run one at a time and use the same metadata, download, and full 15-second decode validation as player previews. Unchecked recordings come first, prioritizing the appended decade and K-pop entries, followed by the oldest due check. Successful and confirmed unavailable recordings are rechecked after 24 hours. Temporary failures retry after one hour, preserving the last known availability.

Only a typed `TRACK_UNAVAILABLE` result marks a recording unavailable. Metadata/download timeouts, provider outages, unsafe URLs, and decoder failures do not blacklist a previously available or unknown recording. New rounds omit confirmed unavailable recordings; saved rounds keep their original puzzle IDs. A confirmed unavailable recording remains excluded until a later check succeeds, including when its last check is older than a day.

Run commands from the repository root. The live commands require `DATABASE_URL`, applied migrations, `ffmpeg` on the API host, and outbound HTTPS access to `api.deezer.com` and `cdnt-preview.dzcdn.net`. Run them in the deployment's region and network to measure what players there can receive.

The production Docker image includes the compiled operator CLI. In a Render shell at `/app`, check the reported recording, **Alone — Alan Walker**, with:

```sh
node apps/api/dist/apps/api/scripts/check-song-previews.js --track 141822951
```

For a local production build, run `pnpm build` and then use the compiled command from the repository root:

```sh
pnpm --filter @carpool/api songs:check --track 141822951
pnpm --filter @carpool/api songs:check --theme songs-2010s --track 141822951 --dry-run
```

`--track` checks that catalog recording regardless of when it was last checked and limits the run to one recording even alongside `--all`. An optional `--theme` must contain that track. IDs outside the catalog or selected theme are rejected before database or provider access. A targeted dry run needs no database credentials or network access.

The following source commands are available in a development checkout with `tsx` installed:

```sh
# Inspect one theme without database access or external requests.
pnpm --filter @carpool/api exec tsx scripts/check-song-previews.ts --theme kpop --all --dry-run

# Check the next three due recordings and persist their results.
pnpm --filter @carpool/api exec tsx scripts/check-song-previews.ts

# Manually refresh every unique catalog recording, even if recently checked.
pnpm --filter @carpool/api exec tsx scripts/check-song-previews.ts --all

# Refresh only one theme.
pnpm --filter @carpool/api exec tsx scripts/check-song-previews.ts --theme adele --all
```

The CLI prints one JSON line per recording with track ID, title, artist, theme, progress, and safe status/code/stage. It continues after preview failures and exits with status 1 if any check fails. Database/argument failures also exit with status 1 without printing credentials, raw provider messages, or audio URLs. A dry run lists catalog entries only; it does not consult the ledger, so its default three entries are illustrative rather than the currently due database entries.

Useful read-only queries:

```sql
SELECT available, last_error_code, count(*)
FROM song_preview_availability
GROUP BY available, last_error_code
ORDER BY available, last_error_code;

SELECT track_id, checked_at, last_error_code, last_error_stage
FROM song_preview_availability
WHERE available = false
ORDER BY checked_at;
```

Use a successful live recheck to restore a recovered track. Do not clear confirmed unavailable rows to bypass a temporary provider outage. Ordinary automated tests use recorded audio and mocked network checks; they make no live Deezer requests. No periodic checker runs during import or test setup; the API starts it when listening and drains an active batch on shutdown.
