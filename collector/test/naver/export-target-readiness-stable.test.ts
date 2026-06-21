import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ExportTargetReadiness } from "../../src/naver/export-target-readiness";
import {
  waitForExportTargetReadinessStable,
  type ExportTargetReadinessStableDeps,
} from "../../src/naver/export-target-readiness-stable";
import type { PwPage } from "../../src/profile";

const PAGE = {} as unknown as PwPage;
const noSleep = (): Promise<void> => Promise.resolve();

const READY: ExportTargetReadiness = { decision: "READY", rowCountBucket: "few", reason: "positive_rows" };
const EMPTY: ExportTargetReadiness = { decision: "HALT", state: "EXPORT_TARGET_EMPTY", reason: "empty_state" };
const UNKNOWN: ExportTargetReadiness = { decision: "HALT", state: "EXPORT_TARGET_UNKNOWN", reason: "ambiguous" };
const DRR: ExportTargetReadiness = { decision: "HALT", state: "EXPORT_DATE_RANGE_REQUIRED", reason: "date_range_missing" };

/** A readiness reader that yields the given sequence, the last step repeating thereafter. */
function scripted(steps: ExportTargetReadiness[]): Pick<ExportTargetReadinessStableDeps, "readHtmlFn" | "evaluateReadinessFn"> {
  let i = 0;
  return {
    readHtmlFn: () => Promise.resolve("<html/>"),
    evaluateReadinessFn: () => {
      const step = steps[Math.min(i, steps.length - 1)] as ExportTargetReadiness;
      i += 1; // one readiness per cycle (evaluateReadinessFn is the last call each loop)
      return step;
    },
  };
}

const deps = (over: Partial<ExportTargetReadinessStableDeps>): ExportTargetReadinessStableDeps => ({
  timeoutMs: 50,
  intervalMs: 10,
  readHtmlFn: () => Promise.resolve("<html/>"),
  evaluateReadinessFn: () => UNKNOWN,
  sleepFn: noSleep,
  ...over,
});

describe("waitForExportTargetReadinessStable — READY short-circuits immediately", () => {
  it("returns READY on the first check when the result is already rendered", async () => {
    const res = await waitForExportTargetReadinessStable(PAGE, deps(scripted([READY])));
    expect(res.decision).toBe("READY");
    expect(res.checks).toBe(1);
    expect(res.readiness).toEqual(READY);
  });

  it("waits through a transient empty, then proceeds when rows render (EMPTY → READY)", async () => {
    const res = await waitForExportTargetReadinessStable(PAGE, deps(scripted([EMPTY, READY])));
    expect(res.decision).toBe("READY");
    expect(res.checks).toBe(2); // the single empty never halted
  });

  it("waits through an unknown shell, then proceeds when it resolves (UNKNOWN → READY)", async () => {
    const res = await waitForExportTargetReadinessStable(PAGE, deps(scripted([UNKNOWN, READY])));
    expect(res.decision).toBe("READY");
    expect(res.checks).toBe(2);
  });
});

describe("waitForExportTargetReadinessStable — halts only on a confirmed/persistent state", () => {
  it("EMPTY twice consecutively → HALT EXPORT_TARGET_EMPTY (early, once confirmed)", async () => {
    const res = await waitForExportTargetReadinessStable(PAGE, deps({ ...scripted([EMPTY, EMPTY]), timeoutMs: 200, intervalMs: 10 }));
    expect(res.decision).toBe("HALT");
    expect(res.readiness).toEqual(EMPTY);
    expect(res.checks).toBe(2);
    if (res.decision === "HALT") expect(res.stableCount).toBe(2);
  });

  it("DATE_RANGE_REQUIRED persists until timeout → HALT EXPORT_DATE_RANGE_REQUIRED", async () => {
    const res = await waitForExportTargetReadinessStable(PAGE, deps({ ...scripted([DRR]), timeoutMs: 30, intervalMs: 10 }));
    expect(res.decision).toBe("HALT");
    expect(res.readiness).toEqual(DRR);
    expect(res.checks).toBe(3); // ran the full window (no early short-circuit for non-empty)
  });

  it("UNKNOWN persists until timeout → HALT EXPORT_TARGET_UNKNOWN", async () => {
    const res = await waitForExportTargetReadinessStable(PAGE, deps({ ...scripted([UNKNOWN]), timeoutMs: 30, intervalMs: 10 }));
    expect(res.decision).toBe("HALT");
    expect(res.readiness).toEqual(UNKNOWN);
    expect(res.checks).toBe(3);
  });

  it("a single EMPTY at the very end (no second confirm) halts on the last state at timeout", async () => {
    // UNKNOWN, UNKNOWN, EMPTY across a 3-check window: EMPTY appears once, never confirmed,
    // so the window expires and we halt honestly on the last observed state (EMPTY).
    const res = await waitForExportTargetReadinessStable(
      PAGE,
      deps({ ...scripted([UNKNOWN, UNKNOWN, EMPTY]), timeoutMs: 30, intervalMs: 10 }),
    );
    expect(res.decision).toBe("HALT");
    expect(res.readiness).toEqual(EMPTY);
    expect(res.checks).toBe(3);
    if (res.decision === "HALT") expect(res.stableCount).toBe(1);
  });
});

describe("waitForExportTargetReadinessStable — transient errors keep polling", () => {
  it("a thrown read on the first cycle is ignored; the next READY resolves", async () => {
    let i = 0;
    const readHtmlFn = (): Promise<string> => {
      i += 1;
      if (i === 1) return Promise.reject(new Error("navigating"));
      return Promise.resolve("<html/>");
    };
    const res = await waitForExportTargetReadinessStable(
      PAGE,
      deps({ readHtmlFn, evaluateReadinessFn: () => READY }),
    );
    expect(res.decision).toBe("READY");
    expect(res.checks).toBe(2);
  });

  it("when EVERY read fails, halts conservatively as EXPORT_TARGET_UNKNOWN (never a blind click)", async () => {
    const res = await waitForExportTargetReadinessStable(
      PAGE,
      deps({ readHtmlFn: () => Promise.reject(new Error("dead")), timeoutMs: 30, intervalMs: 10 }),
    );
    expect(res.decision).toBe("HALT");
    expect(res.readiness).toEqual({ decision: "HALT", state: "EXPORT_TARGET_UNKNOWN", reason: "ambiguous" });
    if (res.decision === "HALT") expect(res.stableCount).toBe(0);
  });
});

describe("waitForExportTargetReadinessStable — sanitized output (no leak)", () => {
  it("the stable result carries only the sanitized readiness + counts — no raw page content", async () => {
    // Even when the reader hands the loop hostile HTML, the result echoes only the readiness enum.
    const res = await waitForExportTargetReadinessStable(
      PAGE,
      deps({ ...scripted([READY]), readHtmlFn: () => Promise.resolve("<div>행복마켓 Commerce ID 1234567 홍길동</div>") }),
    );
    const json = JSON.stringify(res);
    for (const s of ["행복마켓", "1234567", "홍길동"]) expect(json.includes(s)).toBe(false);
    expect(/[<>]/.test(json)).toBe(false);
  });
});

describe("export-target-readiness-stable.ts — source guard: read-only, no DOM action", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "src", "naver", "export-target-readiness-stable.ts");
  const code = readFileSync(SRC, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("never clicks, navigates, exports, downloads, uploads, or writes status", () => {
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent|tap)\s*\(/.test(code)).toBe(false);
    expect(/\.goto\s*\(/.test(code)).toBe(false);
    expect(/runExport|saveAs|waitForEvent|uploadReviewFile|writeStatus/.test(code)).toBe(false);
  });

  it("imports no fs/http/playwright (browser-free pure leaf)", () => {
    const importLines = code.split("\n").filter((l) => /^\s*import\b/.test(l));
    for (const line of importLines) {
      expect(/node:fs|node:http|playwright/.test(line)).toBe(false);
    }
  });
});
