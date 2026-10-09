import assert from "node:assert/strict";
import { join } from "node:path";
import type { Page, WebSocketRoute } from "playwright";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { GameSnapshotSchema } from "../../../packages/contracts/src/index";
import { browserHarness } from "./harness";

let harness: Awaited<ReturnType<typeof browserHarness>>;
const origin = new Date("2026-10-08T10:00:00Z");

beforeAll(async () => {
	// Vitest replaces Date only when timers are not faked. Chromium's clock and
	// real network/reconnect timers continue normally in the separate browser.
	vi.setSystemTime(origin);
	harness = await browserHarness();
}, 30000);
afterAll(async () => {
	try {
		await harness?.close();
	} finally {
		vi.useRealTimers();
	}
});

async function client(width = 390) {
	const context = await harness.browser.newContext({
		viewport: { width, height: 844 },
	});
	const page = await context.newPage();
	const events: { name: string; payload: unknown }[] = [];
	let server: WebSocketRoute | undefined;
	let browserSocket: WebSocketRoute | undefined;
	let connections = 0;
	// Forward real server bytes unchanged; retain only incoming public/private
	// game data in memory. Never record outgoing authentication or storage state.
	await page.routeWebSocket(/\/socket\.io\//, (socket) => {
		server = socket.connectToServer();
		browserSocket = socket;
		const connectedServer = server;
		let ready = false;
		function connected() {
			if (!ready) connections++;
			ready = true;
		}
		socket.onMessage((message) => {
			if (message === "5") connected(); // Initial polling-to-WebSocket upgrade.
			connectedServer.send(message);
		});
		server.onMessage((message) => {
			const frame = String(message);
			if (frame.startsWith("40")) connected(); // WebSocket-only reconnect auth.
			if (frame.startsWith("42[")) {
				const [name, payload] = JSON.parse(frame.slice(2));
				events.push({ name, payload });
			}
			if (/^43\d*\[/.test(frame)) {
				const [ack] = JSON.parse(frame.slice(frame.indexOf("[")));
				if (ack.snapshot)
					events.push({ name: "snapshot", payload: ack.snapshot });
			}
			socket.send(message);
		});
	});
	return {
		page,
		context,
		events,
		connections: () => connections,
		cut: async () => {
			assert(server && browserSocket);
			await server.close();
			await browserSocket.close();
		},
	};
}
type Client = Awaited<ReturnType<typeof client>>;

async function visible(page: Page, text: string) {
	await page.getByText(text, { exact: true }).waitFor({ state: "visible" });
}

async function snapshot(page: Page) {
	// Read the production HTTP snapshot using the browser's own session, without
	// passing its credential into assertion messages or any persistent artifact.
	const result = await page.evaluate(async () => {
		const session = JSON.parse(
			localStorage.getItem("carpool-game-session") ?? "null",
		);
		const response = await fetch(`/v1/games/${session.gameId}/snapshot`, {
			headers: { authorization: `Bearer ${session.token}` },
		});
		return response.json();
	});
	assertNoKeys(result, [
		"hostToken",
		"captainToken",
		"host_token_hash",
		"captain_token_hash",
	]);
	if (result.round?.status === "OPEN")
		assertNoKeys(result.round, [
			"correctAnswer",
			"correct_answer",
			"explanation",
			"results",
			"source_url",
			"sourceUrl",
		]);
	return GameSnapshotSchema.parse(result);
}

function assertNoKeys(value: unknown, forbidden: string[]) {
	if (typeof value !== "object" || value === null) return;
	for (const [key, child] of Object.entries(value)) {
		assert(!forbidden.includes(key), `Unexpected private field: ${key}`);
		assertNoKeys(child, forbidden);
	}
}

async function post(page: Page, path: string, value: unknown) {
	return page.evaluate(
		async ({ path, value }) => {
			const session = JSON.parse(
				localStorage.getItem("carpool-game-session") ?? "null",
			);
			const response = await fetch(path, {
				method: "POST",
				headers: {
					authorization: `Bearer ${session.token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(value),
			});
			return { status: response.status, body: await response.json() };
		},
		{ path, value },
	);
}

async function restore(person: Client, text: string) {
	const before = person.connections();
	await person.page.reload();
	await visible(person.page, text);
	await expect
		.poll(person.connections, { timeout: 10000 })
		.toBeGreaterThan(before);
	await reconnect(person, text);
}

async function reconnect(person: Client, text: string) {
	await expect.poll(person.connections, { timeout: 10000 }).toBeGreaterThan(0);
	const before = person.connections();
	await person.cut();
	await visible(person.page, "Connection lost. Reconnecting to your game…");
	await person.page.getByRole("button", { name: "Retry connection" }).click();
	await expect
		.poll(person.connections, { timeout: 10000 })
		.toBeGreaterThan(before);
	await expect
		.poll(() =>
			person.page.getByRole("button", { name: "Retry connection" }).count(),
		)
		.toBe(0);
	await visible(person.page, text);
}

async function mobile(page: Page, stage: string) {
	for (const width of [320, 390]) {
		await page.setViewportSize({ width, height: 844 });
		const layout = await page.evaluate(() => ({
			width: window.innerWidth,
			scroll: document.documentElement.scrollWidth,
			targets: [
				...document.querySelectorAll<HTMLElement>("button,input,select,a"),
			]
				.filter((element) => element.getClientRects().length)
				.map((element) => {
					const target = element.matches(
						"input[type=radio],input[type=checkbox]",
					)
						? (element.closest("label") ?? element)
						: element;
					const rect = target.getBoundingClientRect();
					return {
						label:
							element.getAttribute("aria-label") ??
							element.textContent ??
							element.tagName,
						width: rect.width,
						height: rect.height,
					};
				}),
		}));
		assert.equal(layout.scroll, layout.width, `${stage} ${width}px overflow`);
		for (const target of layout.targets) {
			assert(
				target.width >= 48 && target.height >= 48,
				`${stage}: ${target.label} target ${target.width}x${target.height}`,
			);
		}
		await page.screenshot({
			path: join(harness.artifacts, `${stage}-${width}.png`),
			fullPage: true,
		});
	}
}

async function choose(page: Page, value: string | number) {
	if (typeof value === "number")
		await page.getByLabel("Team estimate").fill(String(value));
	else await page.getByRole("radio", { name: value, exact: true }).check();
	await page.getByRole("button", { name: "Confirm team answer" }).click();
}

it("three isolated captains restore every phase, lock all answer types and receive one authoritative reveal", async () => {
	const host = await client();
	const cars = await Promise.all([client(320), client(), client()]);
	const people = [host, ...cars];
	try {
		await host.page.goto(harness.url);
		await mobile(host.page, "welcome");
		await host.page.getByRole("button", { name: "Create game" }).click();
		assert.equal(
			await host.page
				.getByLabel("Game name")
				.evaluate((input: HTMLInputElement) => input.validity.valueMissing),
			true,
		);
		await host.page.getByLabel("Game name").fill("Acceptance convoy");
		await host.page.getByRole("button", { name: "Create game" }).click();
		await visible(host.page, "Share this join code");
		const invite = await host.page.getByLabel("Invite link").inputValue();
		const code = new URL(invite).searchParams.get("join");
		assert(code);
		for (const [index, car] of cars.entries()) {
			await car.page.goto(invite);
			assert.equal(
				await car.page.getByLabel("Six-character join code").inputValue(),
				code,
			);
			assert.equal(await car.page.getByLabel("Car name").inputValue(), "");
			if (index === 0) await mobile(car.page, "invite-join");
			await car.page
				.getByLabel("Car name")
				.fill(index === 2 ? "C".repeat(60) : `Car ${index + 1}`);
			await car.page.getByRole("button", { name: "Join game" }).click();
			await visible(car.page, "Waiting for the host");
			assert.equal(
				await car.page
					.getByRole("button", { name: "Start game", exact: true })
					.count(),
				0,
			);
		}
		await visible(host.page, "3 cars");
		await mobile(host.page, "lobby-host");
		await mobile(cars[2].page, "lobby-captain");
		await Promise.all(
			people.map((person) => restore(person, "Share this join code")),
		);
		await host.page
			.getByRole("button", { name: "Start game", exact: true })
			.click();
		await Promise.all(
			people.map((person) =>
				visible(person.page, "Which ocean is the largest on Earth?"),
			),
		);
		const open = await Promise.all(
			people.map((person) => snapshot(person.page)),
		);
		for (const view of open) {
			assert.deepEqual(view.round, open[0].round);
			assert(view.round?.status === "OPEN");
			assert.equal("correctAnswer" in view.round, false);
			assert.equal("explanation" in view.round, false);
			assert.equal("correct_answer" in view.round.question, false);
		}
		const roundId = open[0].round?.id;
		assert(roundId);
		assert.equal(await host.page.getByRole("radio").count(), 0);
		await mobile(cars[0].page, "open-mc");
		await Promise.all(
			people.map((person) =>
				restore(person, "Which ocean is the largest on Earth?"),
			),
		);
		const confirm = cars[0].page.getByRole("button", {
			name: "Confirm team answer",
		});
		assert.equal(await confirm.isDisabled(), true);
		const radio = cars[0].page.getByRole("radio", {
			name: "Pacific Ocean",
			exact: true,
		});
		await radio.focus();
		await cars[0].page.keyboard.press("Space");
		assert.equal(await radio.isChecked(), true);
		assert.equal(
			await radio.evaluate((element) => getComputedStyle(element).outlineWidth),
			"3px",
		);
		assert.equal(
			await radio.evaluate((element) => element.matches(":focus-visible")),
			true,
		);
		await cars[0].page.screenshot({
			path: join(harness.artifacts, "keyboard-focus-390.png"),
			fullPage: true,
		});
		await cars[0].page.keyboard.press("ArrowDown");
		assert.equal(
			await cars[0].page
				.getByRole("radio", { name: "Atlantic Ocean", exact: true })
				.isChecked(),
			true,
		);
		await cars[0].page.keyboard.press("ArrowUp");
		assert.equal(
			(
				await harness.control.query(
					"SELECT count(*)::int AS count FROM answers WHERE round_id=$1",
					[roundId],
				)
			).rows[0].count,
			0,
		);
		// Commit a real answer but drop its HTTP response. Private live invalidation
		// and a fresh snapshot must recover the server's immutable lock.
		await cars[0].page.route(
			"**/v1/rounds/*/answers",
			async (route) => {
				const response = await route.fetch();
				assert.equal(response.status(), 200);
				await route.abort("failed");
			},
			{ times: 1 },
		);
		await confirm.click();
		await visible(cars[0].page, "Answer locked");
		await mobile(cars[0].page, "locked");
		await restore(cars[0], "Answer locked");
		const locked = await snapshot(cars[0].page);
		const stored = (
			await harness.control.query(
				"SELECT id,value,submitted_at FROM answers WHERE round_id=$1",
				[roundId],
			)
		).rows;
		assert.equal(locked.ownAnswer?.value, "Pacific Ocean");
		assert.equal((await snapshot(cars[1].page)).ownAnswer, null);
		const duplicate = await post(
			cars[0].page,
			`/v1/rounds/${roundId}/answers`,
			{ value: "Atlantic Ocean" },
		);
		assert.equal(duplicate.status, 409);
		assert.equal(duplicate.body.error.code, "ANSWER_ALREADY_LOCKED");
		assert.deepEqual(
			(
				await harness.control.query(
					"SELECT id,value,submitted_at FROM answers WHERE round_id=$1",
					[roundId],
				)
			).rows,
			stored,
		);
		assert.equal(
			(await snapshot(cars[0].page)).ownAnswer?.value,
			"Pacific Ocean",
		);
		await choose(cars[1].page, "Atlantic Ocean");
		await visible(cars[1].page, "Answer locked");
		assert.equal((await snapshot(host.page)).round?.status, "OPEN");
		for (const person of people) {
			assert.equal(
				person.events.filter((event) => event.name === "round.revealed").length,
				0,
			);
			assertNoKeys(person.events, [
				"correctAnswer",
				"correct_answer",
				"explanation",
				"results",
				"source_url",
				"sourceUrl",
				"hostToken",
				"captainToken",
				"host_token_hash",
				"captain_token_hash",
			]);
			const starts = person.events.filter(
				(event) => event.name === "round.started",
			);
			assert.equal(starts.length, 1);
			assert.deepEqual(
				starts[0].payload,
				host.events.find((event) => event.name === "round.started")?.payload,
			);
		}
		await choose(cars[2].page, "Pacific Ocean");
		await Promise.all(
			people.map((person) => visible(person.page, "Leaderboard")),
		);
		await harness.tick();
		await harness.tick();
		const revealed = await Promise.all(
			people.map((person) => snapshot(person.page)),
		);
		for (const [index, view] of revealed.entries()) {
			assert.equal(view.round?.status, "REVEALED");
			assert.deepEqual(view.leaderboard, revealed[0].leaderboard);
			assert.equal(
				people[index].events.filter((event) => event.name === "round.revealed")
					.length,
				1,
			);
			assert.deepEqual(
				people[index].events.find((event) => event.name === "round.revealed")
					?.payload,
				host.events.find((event) => event.name === "round.revealed")?.payload,
			);
			assert.deepEqual(
				await people[index].page.locator(".team-row").allTextContents(),
				await host.page.locator(".team-row").allTextContents(),
			);
		}
		assert.equal(
			revealed[0].leaderboard.find((team) => team.name === "Car 1")?.score,
			1,
		);
		assert.equal(
			revealed[0].leaderboard.find((team) => team.name === "Car 2")?.score,
			0,
		);
		await mobile(cars[0].page, "results");
		await Promise.all(people.map((person) => restore(person, "Leaderboard")));
		vi.setSystemTime(new Date(origin.getTime() + 300000));
		await harness.tick();
		await Promise.all(
			people.map((person) => visible(person.page, "The Sun orbits the Earth.")),
		);
		const second = (await snapshot(host.page)).round;
		assert(second?.status === "OPEN");
		await mobile(cars[0].page, "open-boolean");
		await choose(cars[0].page, "False");
		await visible(cars[0].page, "Answer locked");
		assert.equal((await snapshot(cars[0].page)).ownAnswer?.value, false);
		await restore(cars[0], "Answer locked");
		await choose(cars[1].page, "True");
		await visible(cars[1].page, "Answer locked");
		await cars[2].page
			.getByRole("button", { name: "Leave game", exact: true })
			.click();
		const leave = cars[2].page.getByRole("button", { name: "Confirm leave" });
		assert.equal(
			await leave.evaluate((element) => element === document.activeElement),
			true,
		);
		await mobile(cars[2].page, "leave-confirmation");
		await cars[2].page
			.getByRole("button", { name: "Cancel", exact: true })
			.click();
		assert.equal(
			await cars[2].page
				.getByRole("button", { name: "Leave game", exact: true })
				.evaluate((element) => element === document.activeElement),
			true,
		);
		await cars[2].page
			.getByRole("button", { name: "Leave game", exact: true })
			.click();
		await leave.click();
		await visible(cars[2].page, "Your car has left the game.");
		assert.equal(await cars[2].page.getByRole("radio").count(), 0);
		const rejected = await post(
			cars[2].page,
			`/v1/rounds/${second.id}/answers`,
			{ value: false },
		);
		assert.equal(rejected.body.error.code, "TEAM_LEFT");
		assert.equal(rejected.status, 409);
		assert.equal(
			(
				await harness.control.query(
					"SELECT expected_team_count,status FROM rounds WHERE id=$1",
					[second.id],
				)
			).rows[0].expected_team_count,
			3,
		);
		await harness.tick();
		assert.equal((await snapshot(host.page)).round?.status, "OPEN");
		vi.setSystemTime(new Date(second.endsAt));
		await harness.tick();
		await Promise.all(
			[host, cars[0], cars[1]].map((person) =>
				visible(person.page, "Answer: False"),
			),
		);
		const deadline = await snapshot(host.page);
		assert(deadline.round?.status === "REVEALED");
		const missing = deadline.round.results?.find(
			(result) => result.name === "C".repeat(60),
		);
		assert(missing);
		assert.deepEqual(
			{ value: missing.value, points: missing.pointsAwarded },
			{ value: null, points: 0 },
		);
		await harness.tick();
		assert.equal(
			host.events.filter((event) => event.name === "round.revealed").length,
			2,
		);
		vi.setSystemTime(new Date(origin.getTime() + 600000));
		await harness.tick();
		await Promise.all(
			[host, cars[0], cars[1]].map((person) =>
				visible(person.page, "Estimate the fixture target."),
			),
		);
		const third = (await snapshot(host.page)).round;
		assert(third);
		assert.equal(
			(
				await harness.control.query(
					"SELECT expected_team_count FROM rounds WHERE id=$1",
					[third.id],
				)
			).rows[0].expected_team_count,
			2,
		);
		await mobile(cars[0].page, "estimate");
		await cars[0].page.getByLabel("Team estimate").fill("1e309");
		assert.equal(
			await cars[0].page
				.getByRole("button", { name: "Confirm team answer" })
				.isDisabled(),
			true,
		);
		await choose(cars[0].page, 90.5);
		await visible(cars[0].page, "Answer locked");
		await choose(cars[1].page, 109.5);
		await visible(host.page, "Answer: 100");
		const estimate = (await snapshot(host.page)).round;
		assert(estimate?.status === "REVEALED");
		assert.deepEqual(
			estimate.results?.map((result) => result.pointsAwarded),
			[1, 1],
		);
		await host.page
			.getByRole("button", { name: "End game", exact: true })
			.click();
		const end = host.page.getByRole("button", { name: "Confirm end" });
		assert.equal(
			await end.evaluate((element) => element === document.activeElement),
			true,
		);
		await mobile(host.page, "end-confirmation");
		await end.press("Enter");
		await Promise.all(
			people.map((person) =>
				visible(person.page, "Thanks for playing together."),
			),
		);
		await mobile(cars[0].page, "complete");
		await Promise.all(
			people.map((person) => restore(person, "Final leaderboard")),
		);
		const final = await Promise.all(
			people.map((person) => snapshot(person.page)),
		);
		for (const view of final) {
			assert.equal(view.game.status, "COMPLETE");
			assert.equal(view.game.completionReason, "HOST_ENDED");
			assert.deepEqual(view.leaderboard, final[0].leaderboard);
		}
		assert.equal(
			await cars[0].page
				.getByText(
					"A passenger runs the phone. Drivers join the conversation hands-free.",
					{ exact: true },
				)
				.count(),
			1,
		);
	} finally {
		await Promise.all(people.map((person) => person.context.close()));
	}
}, 120000);

it("the last fitting slot neutral-waits at the hard limit and the real coordinator completes it", async () => {
	vi.setSystemTime(origin);
	const host = await client();
	const car = await client();
	try {
		await host.page.goto(harness.url);
		await host.page.getByLabel("Game name").fill("Final slot convoy");
		await host.page.getByRole("button", { name: "Create game" }).click();
		await visible(host.page, "Share this join code");
		await car.page.goto(await host.page.getByLabel("Invite link").inputValue());
		await car.page.getByLabel("Car name").fill("Last car");
		await car.page.getByRole("button", { name: "Join game" }).click();
		await host.page.getByLabel("Play solo practice").check();
		await host.page
			.getByRole("button", { name: "Start practice game" })
			.click();
		await visible(car.page, "Which ocean is the largest on Earth?");
		await choose(car.page, "Pacific Ocean");
		await visible(host.page, "Leaderboard");
		vi.setSystemTime(new Date(origin.getTime() + 7140000));
		await harness.tick();
		await visible(car.page, "The Sun orbits the Earth.");
		const last = (await snapshot(host.page)).round;
		assert(last?.status === "OPEN");
		assert.equal(Date.parse(last.endsAt), origin.getTime() + 7200000);
		await choose(car.page, "False");
		await visible(host.page, "Leaderboard");
		const view = await snapshot(host.page);
		assert.equal(view.game.status, "WAITING");
		assert.equal(
			view.game.nextRoundAt,
			new Date(origin.getTime() + 7200000).toISOString(),
		);
		await visible(host.page, "Waiting for the server's next update…");
		assert.equal(await host.page.getByText(/Next scheduled round/).count(), 0);
		await mobile(host.page, "final-slot-wait");
		vi.setSystemTime(new Date(origin.getTime() + 7200000));
		await harness.tick();
		await visible(host.page, "The two-hour game is complete.");
		assert.equal(
			(await snapshot(host.page)).game.completionReason,
			"TIME_LIMIT",
		);
		assert.equal(
			(
				await harness.control.query(
					"SELECT count(*)::int AS count FROM rounds WHERE game_id=$1",
					[view.game.id],
				)
			).rows[0].count,
			2,
		);
	} finally {
		await Promise.all([host.context.close(), car.context.close()]);
	}
}, 60000);
