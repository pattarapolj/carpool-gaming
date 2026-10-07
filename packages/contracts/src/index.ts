import { z } from "zod";

export const SubmitAnswerSchema = z.object({
	value: z.union([z.string(), z.boolean(), z.number().finite()]),
});

export const SubmitAnswerResponseSchema = z.object({
	answerId: z.string().uuid(),
	status: z.literal("locked"),
	roundEndsAt: z.string().datetime(),
});

export const LeaveGameSchema = z.object({});
export const LeaveGameResponseSchema = z.object({
	team: z.object({ id: z.string().uuid(), status: z.literal("LEFT") }),
});
export type SubmittedAnswer = z.infer<typeof SubmitAnswerResponseSchema>;
export type SubmitAnswerInput = z.infer<typeof SubmitAnswerSchema>;
export type LeftGame = z.infer<typeof LeaveGameResponseSchema>;

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

export const StartGameResponseSchema = z.object({
	game: z.object({
		id: z.string().uuid(),
		status: z.literal("WAITING"),
		startedAt: z.string().datetime(),
		nextRoundAt: z.string().datetime(),
	}),
});

const PublicGameSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1).max(60),
	joinCode: z.string().regex(/^[A-Z0-9]{6}$/),
	status: z.enum(["LOBBY", "WAITING", "COMPLETE"]),
});

export const CreateGameResponseSchema = z.object({
	game: PublicGameSchema,
	hostToken: z.string().min(1),
});

export const JoinGameResponseSchema = z.object({
	game: PublicGameSchema,
	team: z.object({
		id: z.string().uuid(),
		name: z.string().min(1).max(60),
		status: z.literal("ACTIVE"),
		score: z.number().int(),
	}),
	captainToken: z.string().min(1),
});

export const GameSnapshotSchema = z.object({
	game: z.object({
		id: z.string().uuid(),
		name: z.string(),
		joinCode: z.string().length(6),
		status: z.enum(["LOBBY", "WAITING", "COMPLETE"]),
		roundIntervalSeconds: z.union([
			z.literal(300),
			z.literal(600),
			z.literal(900),
		]),
		startedAt: z.string().datetime().nullable(),
		nextRoundAt: z.string().datetime().nullable(),
	}),
	teams: z.array(
		z.object({
			id: z.string().uuid(),
			name: z.string(),
			status: z.literal("ACTIVE"),
			score: z.number().int(),
		}),
	),
});

export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;
export type CreatedGame = z.infer<typeof CreateGameResponseSchema>;
export type JoinedGame = z.infer<typeof JoinGameResponseSchema>;
export type CreateGameInput = z.input<typeof CreateGameSchema>;
export type JoinGameInput = z.input<typeof JoinGameSchema>;
export type StartedGame = z.infer<typeof StartGameResponseSchema>;
