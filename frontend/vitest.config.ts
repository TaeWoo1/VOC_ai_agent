import { defineConfig } from "vitest/config";

// Minimal, additive test harness. Pure-function unit tests run in the default node
// environment (no jsdom) — they do not touch the dev/build/typecheck flow.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
