import { z } from "zod";

export const PuzzleFormatSchema = z.enum([
	"CHARACTER",
	"PICTURE",
	"MUSIC",
	"TRIVIA",
]);
export type PuzzleFormat = z.infer<typeof PuzzleFormatSchema>;
export const PUZZLE_FORMATS: Record<PuzzleFormat, string> = {
	CHARACTER: "Character detective",
	PICTURE: "Picture reveal",
	MUSIC: "Guess the Song",
	TRIVIA: "Trivia",
};
export const PuzzleThemeSchema = z.enum([
	"naruto",
	"animals",
	"melodies",
	"taylor-swift",
	"ed-sheeran",
	"adele",
	"kpop",
	"songs-2000s",
	"songs-2010s",
	"songs-2020s",
]);
export const PUZZLE_PACKS = [
	{ id: "animals", name: "Animals", formats: ["PICTURE", "TRIVIA"] },
	{ id: "kpop", name: "K-pop · 100 songs", formats: ["MUSIC"] },
	{ id: "melodies", name: "International ’90s songs", formats: ["MUSIC"] },
	{ id: "songs-2000s", name: "International 2000s songs", formats: ["MUSIC"] },
	{ id: "songs-2010s", name: "International 2010s songs", formats: ["MUSIC"] },
	{ id: "songs-2020s", name: "International 2020s songs", formats: ["MUSIC"] },
	{ id: "taylor-swift", name: "Taylor Swift", formats: ["MUSIC"] },
	{ id: "ed-sheeran", name: "Ed Sheeran", formats: ["MUSIC"] },
	{ id: "adele", name: "Adele", formats: ["MUSIC"] },
] as const;
export const PuzzleSetupSchema = z
	.object({ theme: PuzzleThemeSchema, format: PuzzleFormatSchema })
	.strict()
	.refine(
		(value) =>
			PUZZLE_PACKS.some(
				(p) =>
					p.id === value.theme &&
					(p.formats as readonly string[]).includes(value.format),
			),
		"That theme does not support this game type",
	);
export type PuzzleSetup = z.infer<typeof PuzzleSetupSchema>;
const RoundIdSchema = z.string().uuid();
const PuzzleIdSchema = z.string().min(1).max(80);
export const SongClipRequestSchema = z
	.object({ puzzleId: PuzzleIdSchema })
	.strict();
export const SongClipResponseSchema = z
	.object({ media: z.string().startsWith("data:audio/wav;base64,") })
	.strict();
export const PuzzleActionSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("guess"),
			roundId: RoundIdSchema,
			puzzleId: PuzzleIdSchema,
			answerId: PuzzleIdSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("skip"),
			roundId: RoundIdSchema,
			puzzleId: PuzzleIdSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("revisit"),
			roundId: RoundIdSchema,
			puzzleId: PuzzleIdSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("theme"),
			roundId: RoundIdSchema,
			theme: PuzzleThemeSchema.refine(
				(theme) => theme !== "naruto",
				"That theme is no longer available",
			),
		})
		.strict(),
	z
		.object({
			kind: z.literal("format"),
			roundId: RoundIdSchema,
			format: PuzzleFormatSchema,
		})
		.strict(),
]);
export type PuzzleAction = z.infer<typeof PuzzleActionSchema>;
export const PuzzleActionResponseSchema = z
	.object({
		ok: z.literal(true),
		result: z
			.object({
				name: z.string(),
				correct: z.boolean(),
				pointsAwarded: z.union([z.literal(0), z.literal(1)]),
			})
			.optional(),
	})
	.strict();
export const PuzzleViewSchema = z
	.object({
		round: z
			.object({
				id: RoundIdSchema,
				sequence: z.number().int().positive(),
				theme: PuzzleThemeSchema,
				format: PuzzleFormatSchema,
				status: z.enum(["OPEN", "RESULTS"]),
				startsAt: z.string().datetime(),
				endsAt: z.string().datetime(),
				total: z.number().int().positive(),
			})
			.strict(),
		solved: z.number().int().nonnegative(),
		puzzle: z
			.object({
				id: PuzzleIdSchema,
				number: z.number().int().positive(),
				prompt: z.string(),
				media: z.string().nullable(),
				guesses: z.array(
					z
						.object({
							name: z.string(),
							correct: z.boolean(),
							feedback: z.array(
								z
									.object({
										attribute: z.string(),
										value: z.string(),
										match: z.enum(["MATCH", "PARTIAL", "MISS"]),
									})
									.strict(),
							),
						})
						.strict(),
				),
			})
			.strict()
			.nullable(),
		skipped: z.array(
			z
				.object({ id: PuzzleIdSchema, number: z.number().int().positive() })
				.strict(),
		),
		options: z.array(
			z
				.object({
					id: PuzzleIdSchema,
					name: z.string(),
					aliases: z.array(z.string()),
				})
				.strict(),
		),
		results: z.array(
			z
				.object({
					teamId: z.string().uuid(),
					name: z.string(),
					solved: z.number().int().nonnegative(),
					rank: z.number().int().positive(),
				})
				.strict(),
		),
		selection: z
			.object({
				themeTeamId: z.string().uuid().nullable(),
				formatTeamId: z.string().uuid().nullable(),
				theme: PuzzleThemeSchema.nullable(),
			})
			.strict(),
	})
	.strict();
export type PuzzleView = z.infer<typeof PuzzleViewSchema>;
