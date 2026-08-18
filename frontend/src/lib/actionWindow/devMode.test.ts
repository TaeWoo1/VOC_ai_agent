import { afterEach, describe, it, expect, vi } from "vitest";
import { isBridgeModeEnabled, isFixturePreviewEnabled, resolveAdapterMode, resolveBridgeSession } from "./devMode";

describe("fixture preview mode (dev-only, opt-in)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off by default — a plain `npm run dev` shows the product, not the developer chrome (A6)", () => {
    // vitest runs with DEV=true; without the opt-in the scenario nav, diagnostics and the fixture
    // escape hatch stay hidden. A demo or a supervised live run is done from `npm run dev`, and a
    // seller-facing surface with dashed 개발용 boxes on it is not the product.
    expect(isFixturePreviewEnabled()).toBe(false);
  });

  it("turns on only with DEV and the explicit VITE_AW_FIXTURE_PREVIEW=1 opt-in", () => {
    vi.stubEnv("VITE_AW_FIXTURE_PREVIEW", "1");
    expect(isFixturePreviewEnabled()).toBe(import.meta.env.DEV === true);
    vi.stubEnv("DEV", false);
    // The production build sets DEV=false, so the opt-in alone can never bring the chrome back.
    expect(isFixturePreviewEnabled()).toBe(false);
  });
});

describe("adapter mode selection (mock vs bridge)", () => {
  it("defaults to mock when the bridge opt-in flag is absent", () => {
    // The test env does not set VITE_AW_BRIDGE=1, so bridge mode is off by default.
    expect(isBridgeModeEnabled()).toBe(false);
    expect(resolveAdapterMode()).toBe("mock");
  });

  it("refuses as `bridge-disabled` when bridge mode is off (no network attempted)", async () => {
    // With bridge mode off, resolveBridgeSession must short-circuit to null — this is the structural
    // guarantee that the shipped screen stays on the mock without ever touching the agent.
    await expect(resolveBridgeSession()).resolves.toEqual({ ok: false, reason: "bridge-disabled" });
  });
});
