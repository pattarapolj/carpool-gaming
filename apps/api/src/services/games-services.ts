import { CreateGameSchema } from "../../../../packages/contracts/src/index";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

type CreateGameInput = z.infer<typeof CreateGameSchema>;

export async function createGame(_input: unknown) {
  // 1. Validate/receive typed input
  const parsedInput = CreateGameSchema.safeParse(_input);
  if (!parsedInput.success) {
    throw new Error("Invalid input");
  }
  const validatedInput: CreateGameInput = parsedInput.data;
  // 2. Generate game ID, join code and host token
  const game = {
    id: randomUUID(),
    name: validatedInput.name,
    status: "LOBBY",
    joinCode: generateJoinCode(),
  };
  const { token: hostToken, hash: hostTokenHash } = generateHostToken();
  // 3. Persist the game and token hash
  // 4. Return the public response
  const result = {
    game,
    hostToken,
  };

  return result;
}

function generateJoinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function generateHostToken() {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");

  return { token, hash };
}
