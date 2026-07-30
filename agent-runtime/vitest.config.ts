import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Hermetic by default: no network, no backend, no browser. Every test injects a
    // FakeSpringClient — the runtime never reaches a real backend under `npm test`.
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
