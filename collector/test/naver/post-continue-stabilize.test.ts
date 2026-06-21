import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ExportActionPlan } from "../../src/naver/export-classify";
import {
  isExportSurfaceReady,
  waitForPostContinueExportSurface,
  type PostContinueStabilizeDeps,
} from "../../src/naver/post-continue-stabilize";
import type { PwPage } from "../../src/profile";
import type { SessionVerdict } from "../../src/naver/session-verdict";

const PAGE = {} as unknown as PwPage;
const noSleep = (): Promise<void> => Promise.resolve();

const READY_PLAN: ExportActionPlan = {
  layout: "SYNC_DOWNLOAD",
  hasActionableExportCandidate: true,
  actionableExportCandidateCount: "one",
  triggerSelectorCount: "one",
  asyncMarkerPresent: false,
};
const UNRECOGNIZED_PLAN: ExportActionPlan = {
  layout: "LAYOUT_UNRECOGNIZED",
  hasActionableExportCandidate: false,
  actionableExportCandidateCount: "none",
  triggerSelectorCount: "none",
  asyncMarkerPresent: false,
};
const ASYNC_PLAN: ExportActionPlan = {
  layout: "ASYNC_JOB_DETECTED",
  hasActionableExportCandidate: true,
  actionableExportCandidateCount: "one",
  triggerSelectorCount: "one",
  asyncMarkerPresent: true,
};

interface Step {
  verdict: SessionVerdict;
  plan: ExportActionPlan;
}

/** A reader pair that yields the given (verdict, plan) sequence, last step repeating. */
function sequence(steps: Step[]): Pick<PostContinueStabilizeDeps, "settleFn" | "checkVerdictFn" | "readExportPlanFn"> {
  let i = 0;
  const at = (): Step => steps[Math.min(i, steps.length - 1)] as Step;
  return {
    settleFn: () => Promise.resolve(),
    checkVerdictFn: () => Promise.resolve(at().verdict),
    readExportPlanFn: () => {
      const plan = at().plan;
      i += 1; // advance once per cycle (readExportPlanFn is the last call each loop)
      return Promise.resolve(plan);
    },
  };
}

const deps = (over: Partial<PostContinueStabilizeDeps>): PostContinueStabilizeDeps => ({
  timeoutMs: 50,
  intervalMs: 10,
  settleFn: () => Promise.resolve(),
  checkVerdictFn: () => Promise.resolve<SessionVerdict>("UNKNOWN"),
  readExportPlanFn: () => Promise.resolve(UNRECOGNIZED_PLAN),
  sleepFn: noSleep,
  ...over,
});

describe("isExportSurfaceReady — LOGGED_IN + actionable SYNC only", () => {
  it("is true only for a logged-in actionable sync surface", () => {
    expect(isExportSurfaceReady("LOGGED_IN", READY_PLAN)).toBe(true);
    expect(isExportSurfaceReady("UNKNOWN", READY_PLAN)).toBe(false); // wrong verdict
    expect(isExportSurfaceReady("LOGGED_IN", UNRECOGNIZED_PLAN)).toBe(false); // not recognized
    expect(isExportSurfaceReady("LOGGED_IN", ASYNC_PLAN)).toBe(false); // async never counts
  });
});

describe("waitForPostContinueExportSurface — stops only on a truly ready surface", () => {
  it("returns READY immediately when the first read is logged-in actionable sync", async () => {
    const res = await waitForPostContinueExportSurface(PAGE, deps(sequence([{ verdict: "LOGGED_IN", plan: READY_PLAN }])));
    expect(res.kind).toBe("READY");
    expect(res.verdict).toBe("LOGGED_IN");
    expect(res.reachedExportSurface).toBe(true);
    expect(res.checks).toBe(1);
  });

  it("waits through the live failure shape (UNKNOWN / LAYOUT_UNRECOGNIZED), then resolves", async () => {
    const res = await waitForPostContinueExportSurface(
      PAGE,
      deps(
        sequence([
          { verdict: "UNKNOWN", plan: UNRECOGNIZED_PLAN },
          { verdict: "UNKNOWN", plan: UNRECOGNIZED_PLAN },
          { verdict: "LOGGED_IN", plan: READY_PLAN },
        ]),
      ),
    );
    expect(res.kind).toBe("READY");
    expect(res.checks).toBe(3);
  });

  it("keeps waiting when LOGGED_IN but the export layout is not yet recognized", async () => {
    const res = await waitForPostContinueExportSurface(
      PAGE,
      deps(
        sequence([
          { verdict: "LOGGED_IN", plan: UNRECOGNIZED_PLAN },
          { verdict: "LOGGED_IN", plan: READY_PLAN },
        ]),
      ),
    );
    expect(res.kind).toBe("READY");
    expect(res.checks).toBe(2);
  });

  it("never treats an async-job surface as ready (halts on timeout)", async () => {
    const res = await waitForPostContinueExportSurface(
      PAGE,
      deps({ ...sequence([{ verdict: "LOGGED_IN", plan: ASYNC_PLAN }]), timeoutMs: 30, intervalMs: 10 }),
    );
    expect(res.kind).toBe("TIMEOUT");
    expect(res.checks).toBe(3);
  });

  it("treats a transient read throw as 'keep waiting', then resolves", async () => {
    let i = 0;
    const checkVerdictFn = (): Promise<SessionVerdict> => {
      i += 1;
      if (i === 1) return Promise.reject(new Error("navigating"));
      return Promise.resolve("LOGGED_IN");
    };
    const res = await waitForPostContinueExportSurface(
      PAGE,
      deps({ checkVerdictFn, readExportPlanFn: () => Promise.resolve(READY_PLAN) }),
    );
    expect(res.kind).toBe("READY");
    expect(res.checks).toBe(2);
  });

  it("returns TIMEOUT (bounded) when the surface never stabilizes", async () => {
    const checkVerdictFn = vi.fn(() => Promise.resolve<SessionVerdict>("UNKNOWN"));
    const res = await waitForPostContinueExportSurface(
      PAGE,
      deps({ timeoutMs: 40, intervalMs: 10, checkVerdictFn }),
    );
    expect(res.kind).toBe("TIMEOUT");
    expect(res.verdict).toBe("UNKNOWN");
    expect(res.reachedExportSurface).toBe(false);
    expect(res.checks).toBe(4);
  });
});

describe("post-continue-stabilize.ts — source guard: read-only", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "src", "naver", "post-continue-stabilize.ts");
  const code = readFileSync(SRC, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("never clicks, navigates, exports, downloads, uploads, or writes status", () => {
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent|tap)\s*\(/.test(code)).toBe(false);
    expect(/\.goto\s*\(/.test(code)).toBe(false);
    expect(/runExport|saveAs|waitForEvent|uploadReviewFile|writeStatus/.test(code)).toBe(false);
  });
});
