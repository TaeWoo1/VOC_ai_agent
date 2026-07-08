import { describe, it, expect } from "vitest";
import { isBridgeModeEnabled, isFixturePreviewEnabled, resolveAdapterMode, resolveBridgeSession } from "./devMode";

describe("fixture preview mode (dev-only)", () => {
  it("is gated on the Vite DEV flag, not shown in production", () => {
    expect(typeof isFixturePreviewEnabled()).toBe("boolean");
    // Derived solely from import.meta.env.DEV. The production build sets DEV=false,
    // so the scenario selector is tree-shaken out of the production UI.
    expect(isFixturePreviewEnabled()).toBe(import.meta.env.DEV === true);
  });
});

describe("adapter mode selection (mock vs bridge)", () => {
  it("defaults to mock when the bridge opt-in flag is absent", () => {
    // The test env does not set VITE_AW_BRIDGE=1, so bridge mode is off by default.
    expect(isBridgeModeEnabled()).toBe(false);
    expect(resolveAdapterMode()).toBe("mock");
  });

  it("resolves no live session when bridge mode is disabled (no network attempted)", async () => {
    // With bridge mode off, resolveBridgeSession must short-circuit to null — this is the structural
    // guarantee that the shipped screen stays on the mock without ever touching the agent.
    await expect(resolveBridgeSession()).resolves.toBeNull();
  });
});
