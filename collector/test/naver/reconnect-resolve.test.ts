import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import type {
  ContinueOutcome,
  ContinuePostClick,
  ContinueResult,
} from "../../src/naver/account-store-continue";
import {
  resolveReconnectIfNeeded,
  type ReconnectResolveDeps,
} from "../../src/naver/reconnect-resolve";
import type { PostContinueStabilization } from "../../src/naver/post-continue-stabilize";
import type { PwPage } from "../../src/profile";
import type { SessionVerdict } from "../../src/naver/session-verdict";

// The helper passes page/ctx straight to continueFn (the spy ignores them), so opaque stubs suffice.
const PAGE = {} as unknown as Page;
const CTX = {} as unknown as BrowserContext;

/** The stabilize config is never exercised by the spy paths; opaque readers suffice. */
const STABILIZE_DEPS: ReconnectResolveDeps["stabilize"] = {
  timeoutMs: 20,
  intervalMs: 5,
  settleFn: () => Promise.resolve(),
  checkVerdictFn: () => Promise.resolve<SessionVerdict>("UNKNOWN"),
  readExportPlanFn: () =>
    Promise.resolve({
      layout: "LAYOUT_UNRECOGNIZED",
      hasActionableExportCandidate: false,
      actionableExportCandidateCount: "none",
      triggerSelectorCount: "none",
      asyncMarkerPresent: false,
    }),
};

/** A stabilization spy that resolves to a fixed outcome (READY/TIMEOUT). */
function stubStabilize(
  kind: PostContinueStabilization["kind"],
  verdict: SessionVerdict = kind === "READY" ? "LOGGED_IN" : "UNKNOWN",
): (page: PwPage) => Promise<PostContinueStabilization> {
  return () => Promise.resolve({ kind, verdict, reachedExportSurface: kind === "READY", checks: 1 });
}

/** Deps with the continue prerequisites satisfied (the reconnect branch is reachable). */
function readyDeps(over: Partial<ReconnectResolveDeps> = {}): ReconnectResolveDeps {
  return {
    expected: { expectedChannelCode: "NAVER" },
    salt: "salt",
    expectedContinueCard: { expectedCardFingerprint: "946efc69b1022bcb" },
    fingerprintConfigured: true,
    stabilize: STABILIZE_DEPS,
    ...over,
  };
}

/**
 * Build a `ContinueResult` for the spy. The helper only reads `.outcome` and `.postClick`,
 * so the heavier sanitized fields (`preClick: CollectedSelection`) are elided via the cast.
 */
function continueResult(
  outcome: ContinueOutcome,
  postClick?: Partial<ContinuePostClick> & { verdict: SessionVerdict },
): ContinueResult {
  return {
    outcome,
    clicked: postClick !== undefined,
    preClickVerdict: "RECONNECT_REQUIRED",
    safeContinueControlCountBucket: "one",
    postClick: postClick
      ? {
          surface: "review-ready",
          urlCategory: "seller-center",
          advanced: true,
          postClickReadStatus: "observed",
          continuationDecision: "READY_TO_CONTINUE",
          exportLayout: "SYNC_DOWNLOAD",
          exportActionable: true,
          exportTriggerSelectorCount: "one",
          reachedExportSurface: false,
          ...postClick,
        }
      : undefined,
    detail: "test",
  } as unknown as ContinueResult;
}

describe("resolveReconnectIfNeeded — LOGGED_IN never touches the continue boundary", () => {
  it("passes straight through and NEVER invokes continueFn", async () => {
    const spy = vi.fn();
    const res = await resolveReconnectIfNeeded(PAGE, CTX, "LOGGED_IN", readyDeps(), spy);
    expect(res.decision).toBe("PROCEED_LOGGED_IN");
    expect(res.resolvedVerdict).toBe("LOGGED_IN");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("resolveReconnectIfNeeded — RECONNECT_REQUIRED fail-closed prerequisites (no click)", () => {
  it("HALTs without calling continueFn when the fingerprint is not configured", async () => {
    const spy = vi.fn();
    const res = await resolveReconnectIfNeeded(
      PAGE,
      CTX,
      "RECONNECT_REQUIRED",
      readyDeps({ fingerprintConfigured: false }),
      spy,
    );
    expect(res.decision).toBe("HALT");
    expect(res.halt?.state).toBe("RECONNECT_REQUIRED");
    expect(spy).not.toHaveBeenCalled();
  });

  it("HALTs without calling continueFn when the salt is missing", async () => {
    const spy = vi.fn();
    const res = await resolveReconnectIfNeeded(
      PAGE,
      CTX,
      "RECONNECT_REQUIRED",
      readyDeps({ salt: undefined }),
      spy,
    );
    expect(res.decision).toBe("HALT");
    expect(res.halt?.state).toBe("RECONNECT_REQUIRED");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("resolveReconnectIfNeeded — RECONNECT_REQUIRED click outcomes", () => {
  it("a STRONG post-click read (LOGGED_IN + reached) proceeds at once; stabilize NOT called", async () => {
    const spy = vi
      .fn()
      .mockResolvedValue(continueResult("CONTINUED", { verdict: "LOGGED_IN", reachedExportSurface: true }));
    const stab = vi.fn(stubStabilize("READY"));
    const res = await resolveReconnectIfNeeded(PAGE, CTX, "RECONNECT_REQUIRED", readyDeps(), spy, stab);
    expect(res.decision).toBe("RESOLVED_PROCEED");
    expect(res.resolvedVerdict).toBe("LOGGED_IN");
    expect(res.reachedExportSurface).toBe(true);
    expect(res.continueOutcome).toBe("CONTINUED");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(stab).not.toHaveBeenCalled(); // already strong — no extra waiting
  });

  it("HALTs when the boundary's own gate refused (not clicked); stabilize NOT called", async () => {
    const spy = vi.fn().mockResolvedValue(continueResult("HALT_NOT_READY"));
    const stab = vi.fn(stubStabilize("READY"));
    const res = await resolveReconnectIfNeeded(PAGE, CTX, "RECONNECT_REQUIRED", readyDeps(), spy, stab);
    expect(res.decision).toBe("HALT");
    expect(res.continueOutcome).toBe("HALT_NOT_READY");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(stab).not.toHaveBeenCalled(); // a non-CONTINUED outcome never stabilizes
  });

  it("CONTINUED but post-click UNKNOWN → stabilization reaches READY → RESOLVED_PROCEED", async () => {
    // This is the exact live failure: continue advanced, but the post-click read settled as
    // UNKNOWN / LAYOUT_UNRECOGNIZED / reached:false before hydration finished.
    const spy = vi
      .fn()
      .mockResolvedValue(continueResult("CONTINUED", { verdict: "UNKNOWN", reachedExportSurface: false }));
    const stab = vi.fn(stubStabilize("READY"));
    const res = await resolveReconnectIfNeeded(PAGE, CTX, "RECONNECT_REQUIRED", readyDeps(), spy, stab);
    expect(res.decision).toBe("RESOLVED_PROCEED");
    expect(res.resolvedVerdict).toBe("LOGGED_IN");
    expect(res.reachedExportSurface).toBe(true);
    expect(res.continueOutcome).toBe("CONTINUED");
    expect(stab).toHaveBeenCalledTimes(1); // weak read → one stabilization pass
  });

  it("CONTINUED + LOGGED_IN but export surface not yet ready → stabilization READY → RESOLVED_PROCEED", async () => {
    const spy = vi
      .fn()
      .mockResolvedValue(continueResult("CONTINUED", { verdict: "LOGGED_IN", reachedExportSurface: false }));
    const stab = vi.fn(stubStabilize("READY"));
    const res = await resolveReconnectIfNeeded(PAGE, CTX, "RECONNECT_REQUIRED", readyDeps(), spy, stab);
    expect(res.decision).toBe("RESOLVED_PROCEED");
    expect(res.reachedExportSurface).toBe(true);
    expect(stab).toHaveBeenCalledTimes(1);
  });

  it("CONTINUED but stabilization never settles (TIMEOUT) → HALT honestly on the last verdict", async () => {
    const spy = vi
      .fn()
      .mockResolvedValue(continueResult("CONTINUED", { verdict: "UNKNOWN", reachedExportSurface: false }));
    const stab = vi.fn(stubStabilize("TIMEOUT", "UNKNOWN"));
    const res = await resolveReconnectIfNeeded(PAGE, CTX, "RECONNECT_REQUIRED", readyDeps(), spy, stab);
    expect(res.decision).toBe("HALT");
    expect(res.resolvedVerdict).toBe("UNKNOWN");
    expect(res.reachedExportSurface).toBe(false);
    expect(res.continueOutcome).toBe("CONTINUED");
    expect(res.halt?.state).toBe("SESSION_EXPIRED"); // haltForVerdict(UNKNOWN)
    expect(stab).toHaveBeenCalledTimes(1);
  });
});

describe("resolveReconnectIfNeeded — non-resolvable verdicts halt via the five-state mapping", () => {
  const cases: Array<[SessionVerdict, string]> = [
    ["ACCOUNT_LOGIN_REQUIRED", "ACCOUNT_LOGIN_REQUIRED"],
    ["AUTH_CHALLENGE_REQUIRED", "ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA"],
    ["UNKNOWN", "SESSION_EXPIRED"],
  ];
  for (const [verdict, state] of cases) {
    it(`${verdict} → HALT ${state}, continueFn never called`, async () => {
      const spy = vi.fn();
      const res = await resolveReconnectIfNeeded(PAGE, CTX, verdict, readyDeps(), spy);
      expect(res.decision).toBe("HALT");
      expect(res.halt?.state).toBe(state);
      expect(spy).not.toHaveBeenCalled();
    });
  }
});

describe("resolveReconnectIfNeeded — sanitized output (no leak)", () => {
  it("the resolution carries only enums/booleans — no raw text/id/url/token", async () => {
    const spy = vi
      .fn()
      .mockResolvedValue(continueResult("CONTINUED", { verdict: "LOGGED_IN", reachedExportSurface: true }));
    const res = await resolveReconnectIfNeeded(PAGE, CTX, "RECONNECT_REQUIRED", readyDeps(), spy);
    const json = JSON.stringify(res);
    // No URL, no obvious token/hash shapes, no angle-bracket HTML.
    expect(/https?:\/\//.test(json)).toBe(false);
    expect(/[<>]/.test(json)).toBe(false);
    expect(/[a-f0-9]{16,}/.test(json)).toBe(false);
  });
});

describe("reconnect-resolve.ts — source guards: the only continue is the boundary", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "src", "naver", "reconnect-resolve.ts");
  const raw = readFileSync(SRC, "utf8");
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("performs no DOM action, navigation, capture, upload, or status write itself", () => {
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent|tap)\s*\(/.test(code)).toBe(false);
    expect(/\.goto\s*\(/.test(code)).toBe(false);
    expect(/runExport/.test(code)).toBe(false);
    expect(/uploadReviewFile|\bupload\w*\s*\(/.test(code)).toBe(false);
    expect(/writeStatus/.test(code)).toBe(false);
  });

  it("delegates the single continue click to continueAtCardOnce (the validated boundary)", () => {
    expect(code.includes("continueAtCardOnce")).toBe(true);
  });
});
