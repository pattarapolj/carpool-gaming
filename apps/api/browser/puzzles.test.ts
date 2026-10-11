import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page } from "playwright";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
	CreateGameResponseSchema,
	type GameSnapshot,
	GameSnapshotSchema,
	PUZZLE_PACKS,
} from "../../../packages/contracts/src/index";
import { catalog } from "../src/services/puzzle-catalog";
import { previewFixture } from "../test/fixtures/song-recording";
import { browserHarness } from "./harness";

let harness: Awaited<ReturnType<typeof browserHarness>>;

it("serializes duplicate guesses, next-round starts and expiry/end contention in real PostgreSQL", async () => {
	const context = await harness.browser.newContext();
	try {
		const created = CreateGameResponseSchema.parse(
			await (
				await context.request.post(`${harness.url}/v1/games`, {
					data: {
						name: "Concurrent puzzles",
						teamName: "Solo car",
						roundIntervalSeconds: 300,
						puzzleSetup: { theme: "animals", format: "TRIVIA" },
					},
				})
			).json(),
		);
		const root = `${harness.url}/v1/games/${created.game.id}`;
		const headers = { authorization: `Bearer ${created.hostToken}` };
		assert.equal(
			(
				await context.request.post(`${root}/start`, {
					headers,
					data: { practice: true },
				})
			).status(),
			200,
		);
		const read = async () =>
			GameSnapshotSchema.parse(
				await (
					await context.request.get(`${root}/snapshot`, { headers })
				).json(),
			);
		const send = async (data: object) =>
			context.request.post(`${root}/puzzles/actions`, { headers, data });
		let view = await read();
		assert(view.puzzles?.puzzle);
		const name = await target(view);
		const answerId = view.puzzles.options.find((o) => o.name === name)?.id;
		const guess = {
			kind: "guess",
			roundId: view.puzzles.round.id,
			puzzleId: view.puzzles.puzzle.id,
			answerId,
		};
		const guesses = await Promise.all([send(guess), send(guess)]);
		expect(guesses.map((r) => r.status()).sort()).toEqual([200, 409]);
		expect((await read()).puzzles?.solved).toBe(1);
		await harness.control.query(
			"UPDATE puzzle_rounds SET starts_at=now()-interval '10 minutes',ends_at=now()-interval '1 second' WHERE id=$1",
			[view.puzzles.round.id],
		);
		await Promise.all([harness.tick(), harness.tick()]);
		expect((await read()).callerTeam?.score).toBe(1);
		assert.equal(
			(
				await send({
					kind: "theme",
					roundId: view.puzzles.round.id,
					theme: "animals",
				})
			).status(),
			200,
		);
		const next = {
			kind: "format",
			roundId: view.puzzles.round.id,
			format: "TRIVIA",
		};
		const starts = await Promise.all([send(next), send(next)]);
		expect(starts.map((r) => r.status()).sort()).toEqual([200, 409]);
		view = await read();
		assert(view.puzzles?.puzzle);
		expect(view.puzzles.round.sequence).toBe(2);
		const nextName = await target(view);
		assert.equal(
			(
				await send({
					kind: "guess",
					roundId: view.puzzles.round.id,
					puzzleId: view.puzzles.puzzle.id,
					answerId: view.puzzles.options.find((o) => o.name === nextName)?.id,
				})
			).status(),
			200,
		);
		await harness.control.query(
			"UPDATE puzzle_rounds SET starts_at=now()-interval '10 minutes',ends_at=now()-interval '1 second' WHERE id=$1",
			[view.puzzles.round.id],
		);
		const ended = context.request.post(`${root}/end`, { headers, data: {} });
		await Promise.all([ended, harness.tick(), harness.tick()]);
		expect((await ended).status()).toBe(200);
		const final = await read();
		expect(final.game.status).toBe("COMPLETE");
		expect(final.callerTeam?.score).toBe(2);
	} finally {
		await context.close();
	}
}, 30000);
beforeAll(async () => {
	harness = await browserHarness();
}, 30000);
afterAll(async () => {
	await harness?.close();
});
async function snapshot(page: Page): Promise<GameSnapshot> {
	const session = await page.evaluate(
		() =>
			JSON.parse(localStorage.getItem("carpool-game-session") ?? "null") as {
				gameId: string;
				token: string;
			},
	);
	const response = await page.request.get(
		`${harness.url}/v1/games/${session.gameId}/snapshot`,
		{ headers: { authorization: `Bearer ${session.token}` } },
	);
	assert.equal(response.status(), 200);
	return GameSnapshotSchema.parse(await response.json());
}
async function target(view: GameSnapshot) {
	const puzzle = view.puzzles?.puzzle;
	assert(puzzle);
	const result = await harness.control.query(
		"SELECT puzzle_ids FROM puzzle_rounds WHERE id=$1",
		[view.puzzles?.round.id],
	);
	const id = result.rows[0].puzzle_ids[Number(puzzle.id.split("/").at(-1))];
	const answerId = catalog.find((p) => p.id === id)?.answerId;
	const option = view.puzzles?.options.find((o) => o.id === answerId);
	assert(option);
	return option.name;
}

it("plays a two-car timed round, restores guesses and skipped puzzles, and starts the loser-selected next format", async () => {
	const hostContext = await harness.browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	const guestContext = await harness.browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	const host = await hostContext.newPage();
	const guest = await guestContext.newPage();
	const pageErrors: string[] = [];
	host.on("pageerror", (e) => pageErrors.push(e.message));
	guest.on("pageerror", (e) => pageErrors.push(e.message));
	try {
		await host.goto(harness.url);
		await host.getByLabel("Game name", { exact: true }).fill("Puzzle convoy");
		await host.getByLabel("Car name", { exact: true }).fill("Blue car");
		await host.getByLabel("Game style").selectOption("puzzles");
		await host
			.getByRole("button", { name: "Create game", exact: true })
			.click();
		await host.getByRole("heading", { name: "Cars in the game" }).waitFor();
		const created = await snapshot(host);
		await guest.goto(`${harness.url}/?join=${created.game.joinCode}`);
		await guest.getByLabel("Car name", { exact: true }).fill("Red car");
		await guest.getByRole("button", { name: "Join game", exact: true }).click();
		await expect.poll(async () => (await snapshot(host)).teams.length).toBe(2);
		await host.getByRole("button", { name: "Start game", exact: true }).click();
		await host.getByLabel("Search answers").waitFor();
		await guest.getByLabel("Search answers").waitFor();
		const original = await snapshot(host);
		const answer = await target(original);
		const wrong = original.puzzles?.options.find((o) => o.name !== answer);
		assert(wrong);
		await host.getByLabel("Search answers").fill(wrong.name);
		await host.getByRole("button", { name: "Guess", exact: true }).click();
		await expect
			.poll(async () => (await snapshot(host)).puzzles?.puzzle?.guesses.length)
			.toBe(1);
		expect((await snapshot(guest)).puzzles?.puzzle?.guesses.length).toBe(0);
		await host
			.getByRole("button", { name: "Skip puzzle", exact: true })
			.click();
		await expect
			.poll(async () => (await snapshot(host)).puzzles?.puzzle?.number)
			.toBe(2);
		await host.reload();
		await host.getByText("Skipped puzzles (1)", { exact: true }).click();
		await host
			.getByRole("button", { name: "Revisit puzzle 1", exact: true })
			.click();
		await expect
			.poll(async () => (await snapshot(host)).puzzles?.puzzle?.guesses.length)
			.toBe(1);
		// Wait for the revisited screen, since the snapshot endpoint can lead the UI refresh.
		await host
			.getByRole("heading", { name: "Puzzle 1", exact: true })
			.waitFor();
		await host.getByLabel("Search answers").fill(answer);
		await host.getByRole("button", { name: "Guess", exact: true }).click();
		await expect
			.poll(async () => (await snapshot(host)).puzzles?.solved)
			.toBe(1);
		await host.screenshot({
			path: join(harness.artifacts, "puzzles-character-mobile.png"),
			fullPage: true,
		});
		await harness.control.query(
			"UPDATE puzzle_rounds SET starts_at=now()-interval '10 minutes',ends_at=now()-interval '1 second' WHERE id=$1",
			[original.puzzles?.round.id],
		);
		await harness.tick();
		await host
			.getByRole("heading", { name: "Round results", exact: true })
			.waitFor();
		await guest.getByRole("button", { name: "Animals", exact: true }).click();
		await host
			.getByRole("button", { name: "Picture reveal", exact: true })
			.click();
		await host.getByAltText("Partially revealed mystery animal").waitFor();
		expect(
			await host
				.getByAltText("Partially revealed mystery animal")
				.evaluate((img) => (img as HTMLImageElement).naturalWidth),
		).toBeGreaterThan(0);
		const picture = await snapshot(host);
		const pictureAnswer = await target(picture);
		const wrongPicture = picture.puzzles?.options.find(
			(o) => o.name !== pictureAnswer,
		);
		assert(wrongPicture);
		await host.getByLabel("Search answers").fill(wrongPicture.name);
		await host.getByRole("button", { name: "Guess", exact: true }).click();
		await expect
			.poll(async () => (await snapshot(host)).puzzles?.puzzle?.guesses.length)
			.toBe(1);
		expect((await snapshot(host)).puzzles?.puzzle?.media).not.toBe(
			picture.puzzles?.puzzle?.media,
		);
		await host.screenshot({
			path: join(harness.artifacts, "puzzles-picture-mobile.png"),
			fullPage: true,
		});
		await host.getByRole("button", { name: "End game", exact: true }).click();
		await host
			.getByRole("button", { name: "Confirm end", exact: true })
			.click();
		await host
			.getByRole("heading", { name: "Trip complete", exact: true })
			.waitFor();
		expect((await snapshot(host)).callerTeam?.score).toBe(1);
		expect(pageErrors).toEqual([]);
	} finally {
		await hostContext.close();
		await guestContext.close();
	}
}, 60000);

it.each(
	PUZZLE_PACKS.filter((pack) =>
		pack.formats.some((format) => format === "MUSIC"),
	).map((pack) => pack.id),
)(
	"decodes and replays progressively longer %s song clues in Chromium",
	async (theme) => {
		// Keep CI independent of provider availability while exercising the real clip endpoint and decoder.
		vi.stubGlobal("fetch", previewFixture);
		const context = await harness.browser.newContext({
			viewport: { width: 390, height: 844 },
		});
		const page = await context.newPage();
		try {
			await page.goto(harness.url);
			await page.getByLabel("Game name", { exact: true }).fill("Melody trip");
			await page.getByLabel("Car name", { exact: true }).fill("Music car");
			await page.getByLabel("Game style").selectOption("puzzles");
			await page.getByLabel("Theme", { exact: true }).selectOption(theme);
			await page
				.getByRole("button", { name: "Create game", exact: true })
				.click();
			await page
				.getByRole("button", { name: "Start practice game", exact: true })
				.click();
			await page.locator("audio").waitFor();
			const duration = await page.locator("audio").evaluate(async (audio) => {
				const player = audio as HTMLAudioElement;
				await player.play();
				player.pause();
				return player.duration;
			});
			expect(duration).toBe(2);
			const original = await snapshot(page);
			const answer = await target(original);
			const wrong = original.puzzles?.options.find((o) => o.name !== answer);
			assert(wrong);
			// Exercise a valid action response that outlasts Vitest's default polling window.
			await page.route(
				"**/puzzles/actions",
				async (route) => {
					await new Promise((resolve) => setTimeout(resolve, 1500));
					await route.continue();
				},
				{ times: 1 },
			);
			await page.getByLabel("Search answers").fill(wrong.name);
			await page.getByRole("button", { name: "Guess", exact: true }).click();
			await expect
				.poll(
					async () =>
						page
							.locator("audio")
							.evaluate((audio) => (audio as HTMLAudioElement).duration),
					{ timeout: 10000 },
				)
				.toBe(4);
			await page.locator("audio").evaluate(async (audio) => {
				const player = audio as HTMLAudioElement;
				await player.play();
				player.pause();
			});
			await page.getByLabel("Search answers").fill(answer);
			await page.getByRole("button", { name: "Guess", exact: true }).click();
			await expect
				.poll(async () => (await snapshot(page)).puzzles?.solved)
				.toBe(1);
			await expect
				.poll(
					() =>
						page
							.locator("audio")
							.evaluate((audio) => (audio as HTMLAudioElement).duration),
					{ timeout: 10000 },
				)
				.toBe(2);
			// Giving up persists the reveal until the captain explicitly continues.
			const stuck = await snapshot(page);
			const revealedName = await target(stuck);
			await page
				.getByRole("button", { name: "Give up & reveal", exact: true })
				.click();
			await page
				.getByRole("heading", { name: revealedName, exact: true })
				.waitFor();
			await page.reload();
			await page
				.getByRole("heading", { name: revealedName, exact: true })
				.waitFor();
			expect((await snapshot(page)).puzzles?.solved).toBe(1);
			expect((await snapshot(page)).puzzles?.puzzle?.id).toBe(
				stuck.puzzles?.puzzle?.id,
			);
			await page
				.getByRole("button", { name: "Next song", exact: true })
				.click();
			await page.getByLabel("Search answers").waitFor();
			expect((await snapshot(page)).puzzles?.puzzle?.id).not.toBe(
				stuck.puzzles?.puzzle?.id,
			);
			expect((await snapshot(page)).puzzles?.solved).toBe(1);
			await page.screenshot({
				path: join(harness.artifacts, `puzzles-${theme}-mobile.png`),
				fullPage: true,
			});
		} finally {
			vi.unstubAllGlobals();
			await context.close();
		}
	},
	30000,
);
