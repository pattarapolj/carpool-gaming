import { z } from "zod";

export const CreateGameSchema = z.object({
	name: z.string().trim().min(1).max(60),
	roundIntervalSeconds: z.union([
		z.literal(300),
		z.literal(600),
		z.literal(900),
	]),
});

export const JoinGameSchema = z.object({
	name: z.string().trim().min(1).max(60),
});

export const StartGameSchema = z.object({
	practice: z.boolean().optional().default(false),
});
