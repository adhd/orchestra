import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@anthropic-ai/claude-code": path.resolve(
        __dirname,
        "test/__mocks__/@anthropic-ai/claude-code.ts",
      ),
    },
  },
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 10_000,
  },
});
