import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { include: ["browser/*.test.ts"], maxWorkers: 1 },
});
