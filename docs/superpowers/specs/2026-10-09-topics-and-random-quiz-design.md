# Topic selection and randomized question bank

## Intent and success criteria

The host chooses specific topics before creating a game. Questions are randomly selected from those topics without repeating within that game. Each selectable topic starts with 25 distinct, reviewed questions (325 total). Two-phone host participation, immediate advancement after all confirmed answers, private answer locking and authoritative scoring remain intact.

Mixed Topics combines the host's selected topics; it has no duplicate question bank. Topic selections are saved with the game and shown in its lobby. Existing games default to all topics. Existing records, credentials, scores and released question IDs are preserved.

## Topic catalog

| ID | Display name | Scope |
|---|---|---|
| world | Around the World | Geography, landmarks and cultures |
| thailand | Thailand | Geography, culture and local knowledge |
| food | Food & Drinks | Ingredients, cuisines and origins |
| weird | Weird but True | Surprising, verified facts |
| nature | Animals & Nature | Animals, ecosystems and natural phenomena |
| science | Science & Space | Everyday science and astronomy |
| taylor-swift | Taylor Swift | Her released music and career; no lyric excerpts |
| breaking-bad | Breaking Bad | The series itself; spoiler scope pending user choice |
| marvel | Marvel | MCU or comics scope pending user choice |
| logic | Logic & Clever Strategies | Binary/bottles, hats/parity, deduction, weighing and coordination |
| lateral | Lateral Thinking | Fully specified puzzles with an objectively gradeable solution |
| probability | Probability Puzzles | Clear assumptions, probability and combinatorics |
| estimate | Closest Estimate | Explicit units and a documented reference quantity |

Logic & Deduction is consolidated into Logic & Clever Strategies to avoid overlapping selectable labels. Poisoned-bottle and prisoner-hat puzzles are families within that topic, not separate topics.

## User flow

The existing create form adds a labeled topic selection group. At least one topic must be selected; selecting all provides Mixed Topics. Named fandoms are directly selectable, never hidden behind a generic TV/music category. Topic labels describe spoiler scope where applicable.

The host supplies game name and car name as today, chooses topics and the existing round interval, then creates the game. All cars receive the same randomly selected question. The lobby shows the selection. Refresh/reconnect restores it from the server.

No mid-game topic editing, free-text grading, external trivia API, AI generation during play or accounts are introduced.

## Data and selection

Add a forward-only migration for a topic identifier and answer-window duration on questions, and selected topic identifiers on games. Backfill the 24 released astronomy questions into Science & Space; add one more there and 25 in each other topic. Those 24 released IDs and texts are not rewritten.

Use a shared finite topic catalog/schema for create validation and display. Omitted topic selections from older API callers mean all topics; explicit empty selections and unknown IDs are rejected, and repeated valid IDs are deduplicated before persistence. Topic identifiers are server-validated rather than trusted from browser labels. Snapshots include the saved topic selection with a backwards-compatible default for older fixtures/clients.

Within the existing game-first locked transaction, choose an active unused question belonging to the saved topic set with PostgreSQL random ordering. The unused-question/exhaustion check uses that same topic filter; questions outside the selection cannot keep an exhausted game alive. A question already used in this game remains excluded. Games may independently receive the same question.

Randomness is uniform across eligible questions, not round-robin across topics. With 25 per topic, starting topic weighting is balanced and naturally changes as questions are used. Multiple-choice answer order need not change in this slice.

## Timing and answer formats

Standard trivia keeps a 60-second window. Logic, lateral-thinking and probability puzzles default to 180 seconds, with the duration stored on each question. The UI displays the authoritative round deadline using the existing countdown.

Keep the existing multiple-choice, true/false and numeric estimate formats. Discussion puzzles ask for a strategy, conclusion or number that those formats can grade. Every puzzle includes all necessary rules; its reveal explains the reasoning. Avoid ambiguous riddles and merely restating the same puzzle with different names to reach the count.

The immediate next-round rule still applies when every original-roster car confirms. Unanswered cars retain existing timeout/scheduled behavior. A full question window must fit within the two-hour limit. Selection considers eligible windows before random choice so a long puzzle cannot exclude a shorter eligible question near the limit. If unused questions remain but none fits, preserve the current neutral waiting behavior until completion at the time limit.

## Content quality

Use original wording for prompts and explanations. Verify factual items against authoritative sources and retain source title/URL with each question. Prefer temporally stable facts; avoid current rankings, latest release counts and unstable records. Fandom items use a clearly stated canon and spoiler scope. Do not copy lyrics, scripts or long source passages.

Original mathematical/puzzle items may cite their written reasoning instead of claiming an external source. Independently verify numerical answers and strategy proofs. Include easy, medium and challenging items without introducing a difficulty picker in this slice. Audit the bank for duplicates, answer ambiguity, valid choices, finite estimates, units, topic counts and unique IDs.

## Verification and release

Write failing tests before production changes. Test topic validation and persistence, backwards compatibility, real PostgreSQL topic filtering/non-repetition/exhaustion, per-question deadlines and the hard limit, atomic last-answer progression, safe OPEN snapshots, and seed reload preservation. Keep deterministic isolated question fixtures in existing timing/browser tests rather than depending on the old ID order.

Exercise the host picker and restored lobby selection in Chromium, including a two-phone game. Run the whole unit/component suite, lint, typecheck, build, PostgreSQL and migration checks, and browser checks. Obtain independent implementation/contract and content reviews, resolve findings, create a PR and wait for CI. Apply the verified build locally while preserving the database. Public hosting and physical phones remain separate.

## Review gate

User review of this written design and the pending fandom scope choice are required before writing the implementation plan. The plan will then be reviewed and its execution method selected, as required by the brainstorming skill. No implementation has begun.
