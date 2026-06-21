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

describe("waitForExportTargetReadinessStable — only READY short-circuits", () => {
  it("returns READY on the first check when the result is already rendered", async () => {
    const res = await waitForExportTargetReadinessStable(PAGE, deps(scripted([READY])));
    expect(res.decision).toBe("READY");
    expect(res.checks).toBe(1);
    expect(res.elapsedMs).toBe(0);
    expect(res.readiness).toEqual(READY);
    expect(res.lastReadiness).toEqual(READY);
  });

  it("EMPTY observed twice quickly does NOT halt early — it polls the FULL window", async () => {
    // maxChecks = ceil(50/10) = 5; a repeated empty must survive all 5 checks (no 2-check early exit).
    const res = await waitForExportTargetReadinessStable(PAGE, deps({ ...scripted([EMPTY, EMPTY]), timeoutMs: 50, intervalMs: 10 }));
    expect(res.decision).toBe("HALT");
    expect(res.readiness).toEqual(EMPTY);
    expect(res.checks).toBe(5); // ran the full window, not 2
  });

  it("EMPTY persists through the full window → HALT EXPORT_TARGET_EMPTY with stableCount === checks", async () => {
    const res = await waitForExportTargetReadinessStable(PAGE, deps({ ...scripted([EMPTY]), timeoutMs: 30, intervalMs: 10 }));
    expect(res.decision).toBe("HALT");
    expect(res.readiness).toEqual(EMPTY);
    expect(res.checks).toBe(3);
    if (res.decision === "HALT") expect(res.stableCount).toBe(3);
    expect(res.elapsedMs).toBe(20); // (3 - 1) * 10
  });

  it("EMPTY for several checks then READY → proceeds (a late-rendering result wins)", async () => {
    const res = await waitForExportTargetReadinessStable(
      PAGE,
      deps({ ...scripted([EMPTY, EMPTY, EMPTY, READY]), timeoutMs: 100, intervalMs: 10 }),
    );
    expect(res.decision).toBe("READY");
    expect(res.checks).toBe(4);
  });
});

describe("waitForExportTargetReadinessStable — non-empty halts also wait out the window", () => {
  it("UNKNOWN persists → HALT EXPORT_TARGET_UNKNOWN after the bounded window", async () => {
    const res = await waitForExportTargetReadinessStable(PAGE, deps({ ...scripted([UNKNOWN]), timeoutMs: 30, intervalMs: 10 }));
    expect(res.decision).toBe("HALT");
    expect(res.readiness).toEqual(UNKNOWN);
    expect(res.checks).toBe(3);
  });

  it("DATE_RANGE_REQUIRED persists → HALT EXPORT_DATE_RANGE_REQUIRED after the bounded window", async () => {
    const res = await waitForExportTargetReadinessStable(PAGE, deps({ ...scripted([DRR]), timeoutMs: 30, intervalMs: 10 }));
    expect(res.decision).toBe("HALT");
    expect(res.readiness).toEqual(DRR);
    expect(res.checks).toBe(3);
  });

  it("halts on the LAST observed state when the page flaps (UNKNOWN, UNKNOWN, EMPTY)", async () => {
    const res = await waitForExportTargetReadinessStable(
      PAGE,
      deps({ ...scripted([UNKNOWN, UNKNOWN, EMPTY]), timeoutMs: 30, intervalMs: 10 }),
    );
    expect(res.decision).toBe("HALT");
    expect(res.readiness).toEqual(EMPTY);
    if (res.decision === "HALT") expect(res.stableCount).toBe(1); // only the final EMPTY
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
    const res = await waitForExportTargetReadinessStable(PAGE, deps({ readHtmlFn, evaluateReadinessFn: () => READY }));
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
