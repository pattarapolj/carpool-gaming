# Production runbook

Run commands from the repository root using PowerShell, Docker Compose v2, and a reviewed revision. This release supports one application process with PostgreSQL 16. No public host, DNS, certificates, or external deployment has been selected. The local rehearsal evidence is in the quality guide; local success is not an external deployment claim.

## Fresh installation

```powershell
Copy-Item .env.example .env
# Edit .env: use a new strong URI-safe password (letters/digits), database/user names,
# API_PORT=3000 and FRONTEND_ORIGIN=http://localhost:3000 for local use.
docker compose -p carpool-prod up -d --build --wait
Invoke-RestMethod http://localhost:3000/health
docker compose -p carpool-prod ps
```

Open http://localhost:3000. The unprivileged Node process serves the built PWA, HTTP API, and Socket.IO on that origin. PostgreSQL is private to the Compose network; the app listener is published only on the host's loopback address. Startup validates DATABASE_URL, integer PORT 1–65535, canonical FRONTEND_ORIGIN and built index before listening, then applies migrations and seeds the reviewed 24-question bank. Database URLs must use postgres/postgresql with a hostname and database, without query/fragment; the bundled Compose deployment uses its private database connection. Errors identify configuration fields without printing values.

FRONTEND_ORIGIN must equal the browser origin exactly, including scheme/port, without trailing slash, path, credentials, query or fragment. HTTP browser requests and both live transports reject other origins. Authenticated native clients without Origin remain supported. HOST defaults to 127.0.0.1 outside Compose; Compose uses 0.0.0.0 inside the container. NODE_ENV=production requires web assets; `pnpm build` assembles the compiled API, SQL and web files together.

One process is required: coordinator scheduling, Socket.IO rooms and publication live in memory. Do not scale replicas. Database locks protect durable transitions but do not provide cross-process event distribution. Normal graceful restart closes the transport so browsers automatically reconnect and resubscribe; stored answers and scores remain authoritative.

## Migrations and verified legacy adoption

Numbered SQL files are immutable after application. The runner serializes with a PostgreSQL advisory transaction lock, checks an ordered checksum journal, and commits all pending schema changes and journal rows together. CRLF/LF file line endings have equivalent checksums. Failures roll back, allowing retry after diagnosing the cause. Never edit an applied migration or journal to bypass an error; add a new migration. The seed uses stable IDs and ON CONFLICT DO NOTHING; revised released questions need new IDs.

An existing database initialized by the old Compose init mount has no journal. Normal startup refuses it. Before adoption, stop all writers, create a backup, and restore/test that backup in an isolated project using the following recovery procedure. Identify the last migration actually installed from your deployment record. Do not try successive prefixes to guess history.

```powershell
docker compose -p carpool-prod stop api
docker compose -p carpool-prod build api
# Example ONLY for an independently verified 003 legacy database:
docker compose -p carpool-prod run --rm --no-deps api node apps/api/dist/apps/api/src/db-command.js adopt --through 003_round_storage.sql
docker compose -p carpool-prod run --rm --no-deps api node apps/api/dist/apps/api/src/db-command.js migrate
docker compose -p carpool-prod run --rm --no-deps api node apps/api/dist/apps/api/src/db-command.js seed
docker compose -p carpool-prod up -d --no-build --wait api
```

Adoption creates the selected exact prefix in a transient reference schema inside the same transaction. It compares app tables, columns/defaults, constraints, indexes, functions, triggers and their enabled states; unexpected app objects or drift fail closed. Owners, ACLs, builtins and extension-owned objects are not migration history. Success journals checksums only; it does not run CREATE against the stored app tables or change stored rows. The reference schema is dropped before commit and rolled back on failure. The database user needs permission to create the temporary reference schema. Historical roster/completion fields added by later migrations stay NULL rather than inventing history.

If verification fails, keep the old database and backup intact. Investigate the mismatch against the recorded release before retrying; do not drop tables, delete the volume, or manufacture journal entries. The automatic app startup message is deliberately safe; the CLI reports a safe command/connection/schema/checksum failure without dumping SQL or secrets.

## Upgrade, health and smoke test

Back up and rehearse every upgrade against a restored copy first. Record the old image ID/revision, new reviewed revision, PostgreSQL version and backup path. Stop writers before schema changes; automatic startup migrations are a fresh-install convenience, not a zero-downtime rollout guarantee.

```powershell
docker compose -p carpool-prod stop api
# Check out the reviewed release before building.
docker compose -p carpool-prod build api
docker compose -p carpool-prod run --rm --no-deps api node apps/api/dist/apps/api/src/db-command.js migrate
docker compose -p carpool-prod run --rm --no-deps api node apps/api/dist/apps/api/src/db-command.js seed
docker compose -p carpool-prod up -d --no-build --wait api
Invoke-RestMethod http://localhost:3000/health
docker compose -p carpool-prod exec -T api node apps/api/dist/apps/api/src/db-command.js migrate
```

The second migrate must report `up to date`. `/health` confirms the process is listening after successful initialization; it is not a continuous database integrity check. Create a host in one browser profile and two passenger captains in separate profiles, join, start, submit, observe one shared reveal/leaderboard, restart `api`, and confirm automatic resubscription with the same stored answer. End the game and verify the final leaderboard. Never involve the driver in device operation.

## Backup and restore rehearsal

Use a timestamped, access-restricted backup destination. Dumps contain private game/session-hash data. These commands create the dump inside the database container and copy it as a file, avoiding binary corruption from shell redirection.

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
docker compose -p carpool-prod exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/carpool.dump'
docker compose -p carpool-prod cp db:/tmp/carpool.dump ./backups/carpool.dump
docker compose -p carpool-prod exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT id,name,status FROM games; SELECT game_id,round_id,car_team_id,value,is_correct,points_awarded FROM answers ORDER BY id;"'
```

Choose a NEW restore project name with no preexisting resources and a NEW `.env.restore` with a different localhost port/origin (for example API_PORT=3001 and FRONTEND_ORIGIN=http://localhost:3001). Keep the same database/user names or supply matching restore credentials. Do not point restore commands at the original project/volume.

```powershell
docker compose --env-file .env.restore -p carpool-restore up -d --wait db
docker compose --env-file .env.restore -p carpool-restore cp ./backups/carpool.dump db:/tmp/carpool.dump
docker compose --env-file .env.restore -p carpool-restore exec -T db sh -c 'pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/carpool.dump'
docker compose --env-file .env.restore -p carpool-restore exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT id,name,status FROM games; SELECT game_id,round_id,car_team_id,value,is_correct,points_awarded FROM answers ORDER BY id;"'
docker compose --env-file .env.restore -p carpool-restore up -d --build --wait api
Invoke-RestMethod http://localhost:3001/health
```

Compare recovered game/answer IDs, values, grades and scores with the recorded backup evidence. Open the restored app and run the two-car smoke test. With a retained synthetic session, fetch its restored authorized snapshot and compare the original answer and leaderboard; tokens should remain local and out of logs/reports. A successful pg_restore exit alone is not sufficient. A pre-journal backup needs the verified adoption step before starting the newer app.

Recover by switching to a verified restored database and its compatible application revision. Reverting code does not reverse migrations. If an old revision is not compatible with the upgraded schema, restore its pre-upgrade backup to a new database first; switching loses post-backup writes, so keep writers stopped and make that recovery decision explicitly. Never run `down -v` on the production project. To clean a disposable restore project, first inspect its project labels and volume names, then remove only resources you created for that rehearsal.

## HTTPS reverse proxy

For an explicitly selected host with provisioned certificates, set FRONTEND_ORIGIN to its exact HTTPS origin and leave the API on loopback. Example Nginx configuration (map in the http context):

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}
server {
    listen 80;
    server_name quiz.example.com;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name quiz.example.com;
    ssl_certificate /etc/ssl/quiz/fullchain.pem;
    ssl_certificate_key /etc/ssl/quiz/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 90s;
    }
}
```

Verify HTTPS, assets, polling-to-WebSocket upgrade and the smoke journey through the actual proxy before release. This configuration is documented, not deployed or externally verified. Physical phone installation, installed-PWA background behavior and cellular loss/recovery remain separate acceptance checks.
