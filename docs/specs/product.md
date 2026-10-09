# Product requirements

**Status:** Approved design  
**Date:** 2026-08-31  
**Version:** 1.0

**Implementation note:** This is the approved product direction, not the current implementation status. See [README](../../README.md) for working features and the [LLD decision list](lld.md#decisions-to-settle-before-implementation) for contract gaps to settle before building the affected features.

## 1. Overview

Carpool Quiz League is a mobile web game for groups travelling in separate cars. Cars compete as teams by answering the same slow-paced trivia questions at the same scheduled time.

The goal is shared conversation and friendly competition without distracting the driver. One passenger, the car captain, operates a shared phone; the driver participates aloud only.

### Goals

- Let a host create a private multi-car game in under two minutes.
- Give every car the same question at the same time.
- Keep the driver engaged without any screen interaction.
- Make game state, timing, answers, and scores fair across cars.

### Non-goals for version 1

- Individual player accounts or profiles.
- In-game chat, notifications, location tracking, or contacts.
- Native iOS/Android apps.
- Speed bonuses, streaks, wagers, or social-media features.

### Success criteria

- A group can create and join a game in under two minutes.
- A passenger can play a round while the driver needs no screen interaction.
- Reconnecting does not lose a car's game state or answer.

## 2. Users and safety

| Role | Responsibility |
|---|---|
| Trip host | Creates the game, shares its join code, starts and ends the game. |
| Car captain | Joins one car team, reads questions aloud, confirms the team's answer. |
| Passengers | Discuss answers with their car team. |
| Driver | Participates verbally only; never reads, taps, or holds the phone. |

The interface must use large type, high contrast, large touch targets, a readable timer, and restrained animation. It has no driver-oriented interaction, chat, or attention-grabbing push notifications.

## 3. Game rules

1. The host creates a private room and shares a six-character join code or link.
2. Each car joins as one team through its captain's phone.
3. The host starts the game after at least two teams join. One-team practice games are allowed.
4. The first round opens immediately when the host starts the game. Subsequent rounds open automatically every five minutes by default.
5. Every car receives the same question at the same time and has 45–60 seconds to answer.
6. A captain locks one answer for their team. Locked answers cannot change.
7. A round reveals early when every active team has answered; otherwise it reveals at the deadline.
8. The reveal shows the answer, a short explanation, each team's result, and the leaderboard.
9. The standby screen shows when the next round starts. The gap between rounds is intentional trip downtime.

### Question types and scoring

| Type | Answer | Points |
|---|---|---|
| Multiple choice | One listed choice | 1 for correct |
| True/false | True or false | 1 for correct |
| Closest-number estimate | A number | 1 for the closest team; exact ties each receive 1 |

No speed bonuses, streaks, or wagers are included. A reviewed question bank supplies age-appropriate questions and records source attribution internally.

## 4. User flows and screens

### Create and join

1. The host opens the app, names the game, chooses the round interval (default: five minutes), and creates a room.
2. The host sees a join code and share link.
3. Each captain enters the code, chooses a car/team name, and waits in the lobby.
4. The host starts the game.

### Play a round

1. At the scheduled time, all connected teams see the question.
2. The captain reads it aloud; the car discusses it.
3. The captain selects and confirms an answer.
4. The phone shows `Answer locked — waiting for other cars`.
5. When all active teams answer or the clock expires, the backend reveals the outcome.
6. All teams see the correct answer, explanation, scores, and the next-round time.

### Required screens

- Welcome: create or join a game.
- Host lobby: join code, team list, start control.
- Join lobby: team name and waiting state.
- Question: prompt, choices, timer, confirmation.
- Locked answer: neutral wait state.
- Results: answer, explanation, leaderboard, next round.
- Reconnect: restores the current game and round.

## 5. Reliability requirements

The server owns deadlines, answer locking, scores and reveal. It saves durable state before announcing success. A reconnect must restore the authoritative state and must not expose a correct answer before reveal.

The early-reveal participant count is fixed when a round opens; leaving cannot reduce it. Explicit leave immediately prevents new answers while preserving any locked answer; disconnect alone does not change eligibility. Teams with no answer receive zero points.

Architecture diagrams, database choices and wire examples belong in [design](design.md), [LLD](lld.md) and [contracts](contracts.md). These documents implement the product requirements; they do not redefine the user need.

## 6. Release scope and acceptance criteria

### First-release ceiling

- Private games of up to 20 cars.
- Games up to two hours long.
- Mobile web only; normal internet is required during rounds.

### Acceptance criteria

- Three cars receive identical question content and answer key timing from the server.
- The final answer submitted triggers one, and only one, reveal.
- Deadline expiry scores unanswered teams as zero and gives all connected teams the same leaderboard.
- Refreshing or reconnecting in every game phase restores the correct screen.
- Retrying an answer request cannot award a second point.
- A passenger can complete a round while a driver needs no phone interaction.

## 7. Later, only if needed

- Chat only after user evidence shows a need to communicate between cars; it requires moderation, privacy, and distraction controls.
- Native apps only if PWA installation or device features become a demonstrated limitation.
- Additional question modes only after the core scheduled trivia loop is validated.

## 8. Requirement IDs for traceability

These IDs identify the product intent above. They are stable references for design, tests and PRs; implementation status is tracked with evidence, not assumed here.

| ID | Required capability | Acceptance focus |
|---|---|---|
| PR-01 | Host creates and shares a private lobby. | Valid creation yields a durable lobby and join code. |
| PR-02 | A captain joins one car team. | The team joins the correct lobby with its own session. |
| PR-03 | Only the owning host starts a ready game. | Two teams by default; explicit one-team practice; first round eligible immediately. |
| PR-04 | All cars play the same scheduled round. | Same public question and server deadline; fixed subsequent interval. |
| PR-05 | A captain locks one immutable answer for their team. | Unauthorized/invalid/late attempts fail; duplicates cannot replace the answer. |
| PR-06 | The documented scoring rules determine points. | Correct choices, booleans, closest-number ties and unanswered teams. |
| PR-07 | Reveal is fair and scores are applied once. | All expected answers or expiry trigger results without duplicate points. |
| PR-08 | Refresh/reconnect restores the authoritative state. | Current phase, own answer and results survive reconnect. Synchronization detail pending. |
| PR-09 | Sessions and unrevealed answers remain private. | Roles and game isolation enforced; no credentials/hashes/answer keys in inappropriate views. |
| PR-10 | Leaving cannot force an early reveal. | Open-round participant count is unchanged; explicit leave immediately prevents new answers and excludes future participation. |
| PR-11 | Passengers can operate the app without driver screen use. | Mobile readability, focus, adequate touch targets and confirmation. |
| PR-12 | Games respect the first-release limits and reach completion. | Up to 20 cars and two hours; limit enforcement, host end and question-exhaustion contracts pending. |

PR-08 and PR-12 have unresolved detailed behavior in the contract decision register. They must not be called fully specified or verified yet.
