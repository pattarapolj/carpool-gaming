import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { GameSnapshotSchema } from "../../../packages/contracts/src";
import { browserHarness } from "./harness";

let harness: Awaited<ReturnType<typeof browserHarness>>;
beforeAll(async () => {
	harness = await browserHarness();
	await harness.control.query(
		await readFile(new URL("../seeds/questions.sql", import.meta.url), "utf8"),
	);
}, 30000);
afterAll(async () => {
	await harness?.close();
});

it("selects Disney & Pixar on a phone, restores it and scores a story answer before advancing", async () => {
	const context = await harness.browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	const page = await context.newPage();
	const read = async () => {
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
		expect(response.status()).toBe(200);
		return GameSnapshotSchema.parse(await response.json());
	};
	try {
		await page.goto(harness.url);
		await page.getByText("Quiz topics", { exact: true }).click();
		for (const checkbox of await page.getByRole("checkbox").all())
			await checkbox.uncheck();
		await page
			.getByRole("checkbox", {
				name: "Disney & Pixar (animated-film spoilers)",
				exact: true,
			})
			.check();
		await page.getByLabel("Game name").fill("Animated adventure");
		await page.getByLabel("Car name").fill("Disney fans");
		await page
			.getByRole("button", { name: "Create game", exact: true })
			.click();
		await page.getByText("Share this join code", { exact: true }).waitFor();
		expect((await read()).game.selectedTopics).toEqual(["disney-pixar"]);
		await page.reload();
		await page.getByText("Share this join code", { exact: true }).waitFor();
		expect((await read()).game.selectedTopics).toEqual(["disney-pixar"]);
		await page
			.getByRole("button", { name: "Start practice game", exact: true })
			.click();
		await expect.poll(async () => (await read()).round?.status).toBe("OPEN");
		const open = await read();
		const question = (
			await harness.control.query(
				"SELECT q.topic_id,q.correct_answer #>> '{}' AS answer FROM rounds r JOIN questions q ON q.id=r.question_id WHERE r.id=$1",
				[open.round?.id],
			)
		).rows[0];
		expect(question.topic_id).toBe("disney-pixar");
		await page
			.getByRole("radio", { name: question.answer, exact: true })
			.check();
		await page
			.getByRole("button", { name: "Confirm team answer", exact: true })
			.click();
		await expect.poll(async () => (await read()).round?.sequence).toBe(2);
		const next = await read();
		expect(next.callerTeam?.score).toBe(1);
		expect(next.round?.question.id).not.toBe(open.round?.question.id);
		const nextTopic = (
			await harness.control.query(
				"SELECT topic_id FROM questions WHERE id=$1",
				[next.round?.question.id],
			)
		).rows[0];
		expect(nextTopic.topic_id).toBe("disney-pixar");
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
		).toBe(true);
	} finally {
		await context.close();
	}
}, 30000);
