import { z } from "zod";

// TDD starting point: implement the fields until the tests turn green.
export const CreateGameSchema = z.object({
	name: z.never(),
	roundIntervalSeconds: z.never(),
});
