import { defineConfig } from "vitest/config";

// Contract self-tests. Pure functions, node environment, zero runtime deps.
export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
  },
});
