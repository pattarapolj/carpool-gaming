# Two-phone gameplay — 2026-10-09

This approved behavior amendment supersedes older spectator-host and fixed-wait rules in the product, design, LLD, contracts and test specification.

- Creating a game in the web app requires a car name. The host's car counts toward the two-car minimum, answers and earns points using the host's existing session. The host retains Start/End permissions. Leave remains captain-only.
- The create API accepts optional `teamName` (trimmed, 1–60 characters). When present, game and host car are created in one transaction. Existing callers that omit it and existing stored games retain their spectator host. No database migration or data reset is needed.
- Once every car in the round's original roster confirms its answer, the server scores and reveals that round and opens the successor in the same transaction. An unanswered car that leaves remains counted for that round until timeout, as before.
- The next question receives a full answer window. If a car misses an answer, the original configured schedule applies. The two-hour limit, unused-question requirement and completion rules still apply; no partial final window is opened.
- Snapshots include optional nullable `previousRound`, containing only a REVEALED round. The previous answer, explanation, results and current leaderboard remain visible below a new question after refresh/reconnect. OPEN questions still omit answer keys.

## Topic selection and randomized questions

- The host selects one or more named topics before creating the game. Selecting all 13 is labeled Mixed Topics; the saved selection appears in the lobby and returns from the game snapshot after refresh/reconnect.
- Each topic contains 25 questions. The server chooses uniformly from unused questions in the selected topics, so a question never repeats within a game.
- Ordinary trivia uses a 60-second answer window. Logic, lateral-thinking and probability puzzles use 180 seconds. Near the two-hour cap, the game waits if no unused question has a full window left, then ends at the cap.
- Topics are Around the World, Thailand, Food & Drinks, Weird but True, Animals & Nature, Science & Space, Taylor Swift, Breaking Bad, Marvel, Logic & Clever Strategies, Lateral Thinking, Probability Puzzles and Closest Estimate. See the [question-bank review](question-bank-review.md) for the content/source audit.

Run `pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm build`. With an isolated PostgreSQL 16 database named `carpool_test`, run `pnpm --filter @carpool/api test:postgres` and `pnpm test:browser`. The browser suite includes a host-plus-one-captain journey, simultaneous answers, immediate progression and restored results.

For the local Docker app, rebuild with `docker compose -p carpool-prod up -d --build --wait`, refresh the page and create a new game with your car name and topic selection. Existing databases and sessions are preserved; startup applies migration 006 before the API queries topic data.
