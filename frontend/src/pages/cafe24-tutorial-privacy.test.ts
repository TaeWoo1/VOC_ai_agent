import { describe, expect, it } from "vitest";
// Raw source scan (the repo's convention for contract assertions without a render harness).
import tutorialSource from "./Cafe24Tutorial.tsx?raw";
import stateSource from "../lib/cafe24Tutorial/state.ts?raw";
import mallIdSource from "../lib/cafe24Tutorial/mallId.ts?raw";
import resultSource from "./Cafe24ConnectResult.tsx?raw";

const ALL = tutorialSource + stateSource + mallIdSource;

describe("Cafe24 tutorial never surfaces secrets or OAuth material", () => {
  it("never reads OAuth code/state/token and never logs a secret", () => {
    for (const forbidden of [
      "console.log",
      "accessToken",
      "refresh_token",
      'get("code")',
      'get("state")',
      'get("token")',
      "clientSecret",
      "client_secret",
    ]) {
      expect(ALL).not.toContain(forbidden);
    }
  });

  it("only reads the sanitized callback params via the shared parser", () => {
    expect(tutorialSource).toContain("parseCafe24Result");
  });

  it("uses the read-only capability + order-summary sync, never a write/reply endpoint", () => {
    expect(tutorialSource).toContain("getCafe24Capability");
    expect(tutorialSource).toContain('"ORDER_SUMMARY"');
    // No reply / community-write / guided-handoff surface is reachable from the tutorial.
    for (const forbidden of ["guided-handoff", "/comments", "execution-enabled", "publish"]) {
      expect(tutorialSource).not.toContain(forbidden);
    }
  });
});

describe("Cafe24 result handoff stays stateless and sanitized", () => {
  it("forwards only status/accountId to the tutorial and never persists client state", () => {
    expect(resultSource).toContain("/connect/cafe24/tutorial");
    for (const forbidden of ["sessionStorage", "localStorage", 'get("code")', 'get("state")']) {
      expect(resultSource).not.toContain(forbidden);
    }
  });
});
