import { z } from "zod";
import { PuzzleSetupSchema, PuzzleViewSchema } from "./puzzles";

export * from "./puzzles";

export const QuestionTopicIds = [
	"world",
	"thailand",
	"food",
	"weird",
	"nature",
	"science",
	"taylor-swift",
	"breaking-bad",
	"marvel",
	"logic",
	"lateral",
	"probability",
	"estimate",
	"harry-potter",
	"history",
	"sports",
	"video-games",
	"nba",
	"disney-pixar",
] as const;
export const QuestionTopicSchema = z.enum(QuestionTopicIds);
export type QuestionTopicId = z.infer<typeof QuestionTopicSchema>;
export const QUESTION_TOPICS = {
	world: "Around the World",
	thailand: "Thailand",
	food: "Food & Drinks",
	weird: "Weird but True",
	nature: "Animals & Nature",
	science: "Science & Space",
	"taylor-swift": "Taylor Swift",
	"breaking-bad": "Breaking Bad (full-series spoilers)",
	marvel: "Marvel (MCU film spoilers)",
	logic: "Logic & Clever Strategies",
	lateral: "Lateral Thinking",
	probability: "Probability Puzzles",
	estimate: "Closest Estimate",
	"harry-potter": "Harry Potter (seven-book spoilers)",
	history: "History",
	sports: "Sports",
	"video-games": "Video Games",
	nba: "NBA",
	"disney-pixar": "Disney & Pixar (animated-film spoilers)",
} satisfies Record<QuestionTopicId, string>;
const SelectedTopicsSchema = z
	.array(QuestionTopicSchema)
	.min(1)
	.transform((topics) => [...new Set(topics)])
	.default([...QuestionTopicIds]);

export const SubmitAnswerSchema = z.object({
	value: z.union([z.string(), z.boolean(), z.number().finite()]),
});

export const SubmitAnswerResponseSchema = z.object({
	answerId: z.string().uuid(),
	status: z.literal("locked"),
	roundEndsAt: z.string().datetime(),
	isCorrect: z.boolean().nullable().optional(),
	pointsAwarded: z.union([z.literal(0), z.literal(1)]).optional(),
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
	puzzleSetup: PuzzleSetupSchema.optional(),
	topics: SelectedTopicsSchema,
	teamName: z.string().trim().min(1).max(60).optional(),
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
		status: z.enum(["WAITING", "COMPLETE"]),
		startedAt: z.string().datetime(),
		nextRoundAt: z.string().datetime().nullable(),
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

const AnswerValueSchema = z.union([
	z.string(),
	z.boolean(),
	z.number().finite(),
]);
const SnapshotTeamSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	status: z.enum(["ACTIVE", "LEFT"]),
	score: z.number().int(),
});
export const LeaderboardSchema = z.array(
	SnapshotTeamSchema.extend({ rank: z.number().int().positive() }),
);
export const CompletionReasonSchema = z.enum([
	"HOST_ENDED",
	"TIME_LIMIT",
	"QUESTION_BANK_EXHAUSTED",
	"NO_ACTIVE_TEAMS",
]);
export const EndGameSchema = z.object({}).strict();
export const EndGameResponseSchema = z
	.object({
		game: z
			.object({
				id: z.string().uuid(),
				status: z.literal("COMPLETE"),
				completedAt: z.string().datetime().nullable(),
				completionReason: CompletionReasonSchema.nullable(),
			})
			.strict(),
		leaderboard: LeaderboardSchema,
	})
	.strict();
export type EndedGame = z.infer<typeof EndGameResponseSchema>;
export type CompletionReason = z.infer<typeof CompletionReasonSchema>;
export const RoundResultsSchema = z
	.array(
		z.object({
			teamId: z.string().uuid(),
			name: z.string(),
			value: AnswerValueSchema.nullable(),
			isCorrect: z.boolean(),
			pointsAwarded: z.union([z.literal(0), z.literal(1)]),
		}),
	)
	.nullable();
export type RoundResult = NonNullable<
	z.infer<typeof RoundResultsSchema>
>[number];
const PublicRoundSchema = z.object({
	id: z.string().uuid(),
	sequence: z.number().int().positive(),
	startsAt: z.string().datetime(),
	endsAt: z.string().datetime(),
	question: z
		.object({
			id: z.string().uuid(),
			type: z.enum(["MULTIPLE_CHOICE", "TRUE_FALSE", "ESTIMATE"]),
			prompt: z.string(),
			choices: z.array(z.string()).nullable(),
		})
		.strict()
		.refine(
			(question) =>
				question.type === "MULTIPLE_CHOICE"
					? question.choices !== null && question.choices.length >= 2
					: question.choices === null,
			"Choices must match the question type",
		),
});
const RevealedRoundSchema = PublicRoundSchema.extend({
	status: z.literal("REVEALED"),
	revealedAt: z.string().datetime(),
	correctAnswer: AnswerValueSchema,
	explanation: z.string(),
	results: RoundResultsSchema,
}).strict();
export const SnapshotRoundSchema = z.discriminatedUnion("status", [
	PublicRoundSchema.extend({ status: z.literal("OPEN") }).strict(),
	RevealedRoundSchema,
]);
export const GameSnapshotSchema = z
	.object({
		game: z.object({
			id: z.string().uuid(),
			name: z.string(),
			puzzleSetup: PuzzleSetupSchema.optional(),
			selectedTopics: SelectedTopicsSchema,
			joinCode: z.string().length(6),
			status: z.enum(["LOBBY", "WAITING", "COMPLETE"]),
			roundIntervalSeconds: z.union([
				z.literal(300),
				z.literal(600),
				z.literal(900),
			]),
			startedAt: z.string().datetime().nullable(),
			nextRoundAt: z.string().datetime().nullable(),
			completedAt: z.string().datetime().nullable(),
			completionReason: CompletionReasonSchema.nullable(),
		}),
		teams: z.array(
			z.object({
				id: z.string().uuid(),
				name: z.string(),
				status: z.literal("ACTIVE"),
				score: z.number().int(),
			}),
		),
		round: SnapshotRoundSchema.nullable(),
		previousRound: RevealedRoundSchema.nullable().optional(),
		ownAnswer: z
			.object({
				answerId: z.string().uuid(),
				value: AnswerValueSchema,
				submittedAt: z.string().datetime(),
				isCorrect: z.boolean().nullable().optional(),
				pointsAwarded: z.union([z.literal(0), z.literal(1)]).optional(),
			})
			.strict()
			.nullable(),
		callerTeam: SnapshotTeamSchema.nullable(),
		leaderboard: LeaderboardSchema,
		serverTime: z.string().datetime(),
		puzzles: PuzzleViewSchema.optional(),
	})
	.strict();

export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;
export type CreatedGame = z.infer<typeof CreateGameResponseSchema>;
export type JoinedGame = z.infer<typeof JoinGameResponseSchema>;
export type CreateGameInput = z.input<typeof CreateGameSchema>;
export type JoinGameInput = z.input<typeof JoinGameSchema>;
export type StartedGame = z.infer<typeof StartGameResponseSchema>;

export const LiveGameRequestSchema = z
	.object({ gameId: z.string().uuid() })
	.strict();
export const LiveErrorSchema = z
	.object({
		code: z.enum([
			"UNAUTHENTICATED",
			"FORBIDDEN",
			"VALIDATION_ERROR",
			"GAME_NOT_FOUND",
			"INTERNAL_ERROR",
		]),
		message: z.string(),
		requestId: z.string().uuid(),
	})
	.strict();
export const LiveSnapshotAckSchema = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true), snapshot: GameSnapshotSchema }).strict(),
	z.object({ ok: z.literal(false), error: LiveErrorSchema }).strict(),
]);
export const GameUpdatedSchema = GameSnapshotSchema.pick({
	game: true,
	teams: true,
});
export const RoundStartedSchema = PublicRoundSchema.extend({
	status: z.literal("OPEN"),
}).strict();
export const AnswerLockedSchema = z
	.object({ roundId: z.string().uuid(), roundEndsAt: z.string().datetime() })
	.strict();
export const RoundRevealedSchema = z
	.object({
		roundId: z.string().uuid(),
		revealedAt: z.string().datetime(),
		correctAnswer: AnswerValueSchema,
		explanation: z.string(),
		results: RoundResultsSchema,
		leaderboard: LeaderboardSchema,
		nextRoundAt: z.string().datetime().nullable(),
	})
	.strict();
export const GameCompletedSchema = EndGameResponseSchema;
export type LiveError = z.infer<typeof LiveErrorSchema>;
export type LiveSnapshotAck = z.infer<typeof LiveSnapshotAckSchema>;
export type LiveGameRequest = z.infer<typeof LiveGameRequestSchema>;
export interface ClientToServerEvents {
	"game.subscribe": (
		request: LiveGameRequest,
		ack: (response: LiveSnapshotAck) => void,
	) => void;
	"game.snapshot": (
		request: LiveGameRequest,
		ack: (response: LiveSnapshotAck) => void,
	) => void;
}
export interface ServerToClientEvents {
	"game.updated": (payload: z.infer<typeof GameUpdatedSchema>) => void;
	"round.started": (payload: z.infer<typeof RoundStartedSchema>) => void;
	"answer.locked": (payload: z.infer<typeof AnswerLockedSchema>) => void;
	"round.revealed": (payload: z.infer<typeof RoundRevealedSchema>) => void;
	"game.completed": (payload: z.infer<typeof GameCompletedSchema>) => void;
}
