import { defineConfig } from "vitest/config";

// Minimal, additive test harness. Pure-function unit tests run in the default node
// environment (no jsdom) — they do not touch the dev/build/typecheck flow.
//
// FE-6: component DOM/a11y tests live in `*.test.tsx` and opt into jsdom per-file
// with a `// @vitest-environment jsdom` pragma, so the node-env default (and every
// existing `*.test.ts`) is unchanged. `setupFiles` registers jest-dom matchers and
// RTL cleanup; the jest-dom import is inert until a DOM matcher is actually used.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
