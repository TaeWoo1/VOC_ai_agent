// Walkthrough environment-binding logic (pure). The 3-way run match + origin check is the machine proof
// that the operator's tab is bound to the bootstrapped run; every failure mode must fail closed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateBinding, frontendRunId, isWalkthroughMode, readUrlRunId } from "./walkthrough";

afterEach(() => vi.unstubAllEnvs());

const ORIGIN = "http://localhost:5173";
const base = {
  urlRunId: "wt-1",
  frontendRunId: "wt-1",
  contextRunId: "wt-1",
  contextFrontendOrigin: ORIGIN,
  currentOrigin: ORIGIN,
};

describe("evaluateBinding — matched only when everything agrees", () => {
  it("all three run ids equal + origin matches → matched", () => {
    expect(evaluateBinding(base)).toEqual({ status: "matched", reasons: [] });
  });

  it("missing URL run id → mismatch(MISSING_URL_RUN)", () => {
    expect(evaluateBinding({ ...base, urlRunId: null }).reasons).toContain("MISSING_URL_RUN");
  });

  it("missing frontend run id → mismatch(MISSING_FRONTEND_RUN)", () => {
    expect(evaluateBinding({ ...base, frontendRunId: null }).reasons).toContain("MISSING_FRONTEND_RUN");
  });

  it("missing backend context run id → mismatch(MISSING_CONTEXT)", () => {
    expect(evaluateBinding({ ...base, contextRunId: null }).reasons).toContain("MISSING_CONTEXT");
  });

  it("a different backend run id (all present) → mismatch(RUN_MISMATCH)", () => {
    const b = evaluateBinding({ ...base, contextRunId: "wt-OTHER" });
    expect(b.status).toBe("mismatch");
    expect(b.reasons).toContain("RUN_MISMATCH");
  });

  it("URL run id differs from frontend/backend → mismatch(RUN_MISMATCH)", () => {
    expect(evaluateBinding({ ...base, urlRunId: "wt-STALE" }).reasons).toContain("RUN_MISMATCH");
  });

  it("origin differs (127.0.0.1 vs localhost) → mismatch(ORIGIN_MISMATCH)", () => {
    expect(
      evaluateBinding({ ...base, currentOrigin: "http://127.0.0.1:5173" }).reasons,
    ).toContain("ORIGIN_MISMATCH");
  });

  it("does not assert RUN_MISMATCH when a run id is merely missing (no false extra reason)", () => {
    const b = evaluateBinding({ ...base, urlRunId: null });
    expect(b.reasons).toContain("MISSING_URL_RUN");
    expect(b.reasons).not.toContain("RUN_MISMATCH");
  });
});

describe("readUrlRunId", () => {
  it("extracts walkthroughRun", () => {
    expect(readUrlRunId("?walkthroughRun=wt-abc&x=1")).toBe("wt-abc");
  });
  it("null when absent or empty", () => {
    expect(readUrlRunId("?x=1")).toBeNull();
    expect(readUrlRunId("")).toBeNull();
    expect(readUrlRunId("?walkthroughRun=")).toBeNull();
  });
});

describe("mode + frontend run id from env", () => {
  it("isWalkthroughMode reflects VITE_WALKTHROUGH_MODE", () => {
    vi.stubEnv("VITE_WALKTHROUGH_MODE", "true");
    expect(isWalkthroughMode()).toBe(true);
    vi.stubEnv("VITE_WALKTHROUGH_MODE", "false");
    expect(isWalkthroughMode()).toBe(false);
  });
  it("frontendRunId reads VITE_WALKTHROUGH_RUN_ID, else null", () => {
    vi.stubEnv("VITE_WALKTHROUGH_RUN_ID", "wt-xyz");
    expect(frontendRunId()).toBe("wt-xyz");
    vi.stubEnv("VITE_WALKTHROUGH_RUN_ID", "");
    expect(frontendRunId()).toBeNull();
  });
});
