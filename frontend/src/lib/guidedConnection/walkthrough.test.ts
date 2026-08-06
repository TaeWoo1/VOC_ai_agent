// Walkthrough environment-binding logic (pure). The 3-way run match + origin check is the machine proof
// that the operator's tab is bound to the bootstrapped run; every failure mode must fail closed.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  evaluateBinding,
  expectedWalkthroughUrl,
  frontendRunId,
  isWalkthroughMode,
  readUrlRunId,
  withWalkthroughRun,
} from "./walkthrough";

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

describe("expectedWalkthroughUrl — the one tested reopen-URL constructor", () => {
  it("builds <origin>/connect/naver?walkthroughRun=<runId> (default channel path)", () => {
    expect(expectedWalkthroughUrl(ORIGIN, "wt-abc123")).toBe(
      "http://localhost:5173/connect/naver?walkthroughRun=wt-abc123",
    );
  });

  it("channelizes the connect path — a Coupang caller re-opens /connect/coupang", () => {
    expect(expectedWalkthroughUrl(ORIGIN, "wt-abc123", "/connect/coupang")).toBe(
      "http://localhost:5173/connect/coupang?walkthroughRun=wt-abc123",
    );
  });

  it("the channelized query param still round-trips through readUrlRunId", () => {
    const url = expectedWalkthroughUrl(ORIGIN, "wt-cp-1", "/connect/coupang");
    expect(readUrlRunId(url.slice(url.indexOf("?")))).toBe("wt-cp-1");
  });

  it("the produced query param round-trips through readUrlRunId (symmetric encode/decode)", () => {
    const url = expectedWalkthroughUrl(ORIGIN, "wt-abc123");
    const search = url.slice(url.indexOf("?"));
    expect(readUrlRunId(search)).toBe("wt-abc123");
  });

  it("carries the EXACT run id — a different run id is not silently produced", () => {
    const url = expectedWalkthroughUrl(ORIGIN, "wt-REALRUN");
    expect(new URL(url).searchParams.get("walkthroughRun")).toBe("wt-REALRUN");
  });
});

describe("withWalkthroughRun — preserve the run id across an internal navigation", () => {
  it("appends walkthroughRun to a bare internal path", () => {
    expect(withWalkthroughRun("/settings/review-import", "wt-1")).toBe(
      "/settings/review-import?walkthroughRun=wt-1",
    );
  });

  it("uses & when the path already has a query", () => {
    expect(withWalkthroughRun("/x?a=1", "wt-1")).toBe("/x?a=1&walkthroughRun=wt-1");
  });

  it("null/empty run id (not in a bound walkthrough) → path unchanged", () => {
    expect(withWalkthroughRun("/settings/review-import", null)).toBe("/settings/review-import");
    expect(withWalkthroughRun("/settings/review-import", "")).toBe("/settings/review-import");
  });

  it("idempotent — never doubles an already-present walkthroughRun", () => {
    const once = withWalkthroughRun("/connect/naver", "wt-1");
    expect(withWalkthroughRun(once, "wt-1")).toBe(once);
    expect(withWalkthroughRun("/connect/naver?walkthroughRun=wt-1", "wt-2")).toBe(
      "/connect/naver?walkthroughRun=wt-1",
    );
  });

  it("the preserved param reads back as the same run id via readUrlRunId", () => {
    const path = withWalkthroughRun("/settings/review-import", "wt-keep");
    expect(readUrlRunId(path.slice(path.indexOf("?")))).toBe("wt-keep");
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
