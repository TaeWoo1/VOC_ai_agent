import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decideLiveProbe,
  probeLiveExportTargetReadiness,
  LIVE_EXPORT_TARGET_PROBE_KEYS,
  type LiveExportTargetProbeDeps,
  type RawLiveProbeSignals,
} from "../../src/naver/live-export-target-probe";
import type { PwPage } from "../../src/profile";

const PAGE = {} as unknown as PwPage;
const noSleep = (): Promise<void> => Promise.resolve();

/** A fully-specified signal bundle; helpers below override only the fields a test cares about. */
const signals = (over: Partial<RawLiveProbeSignals>): RawLiveProbeSignals => ({
  visibleRowCount: 0,
  visibleEmptyState: false,
  visibleGridLikeSurface: false,
  frameTotal: 1,
  framesChecked: 1,
  ...over,
});

/** A reader that yields the given sequence of signals, the last step repeating thereafter. */
function scripted(steps: RawLiveProbeSignals[]): Pick<LiveExportTargetProbeDeps, "readSignalsFn"> {
  let i = 0;
  return {
    readSignalsFn: () => {
      const step = steps[Math.min(i, steps.length - 1)] as RawLiveProbeSignals;
      i += 1;
      return Promise.resolve(step);
    },
  };
}

const deps = (over: Partial<LiveExportTargetProbeDeps>): LiveExportTargetProbeDeps => ({
  timeoutMs: 50,
  intervalMs: 10,
  readSignalsFn: () => Promise.resolve(signals({})),
  sleepFn: noSleep,
  ...over,
});

describe("decideLiveProbe — visible rows win, hidden empty is never a confident empty", () => {
  it("any visible row → LIVE_ROWS_PRESENT (even if an empty flag is also set)", () => {
    expect(decideLiveProbe(signals({ visibleRowCount: 3, visibleEmptyState: true }))).toBe("LIVE_ROWS_PRESENT");
  });
  it("zero rows + a genuinely-visible empty placeholder → LIVE_EMPTY_VISIBLE", () => {
    expect(decideLiveProbe(signals({ visibleRowCount: 0, visibleEmptyState: true }))).toBe("LIVE_EMPTY_VISIBLE");
  });
  it("zero rows + NO visible empty (placeholder hidden) → LIVE_TARGET_UNKNOWN (conservative)", () => {
    expect(decideLiveProbe(signals({ visibleRowCount: 0, visibleEmptyState: false, visibleGridLikeSurface: true }))).toBe(
      "LIVE_TARGET_UNKNOWN",
    );
  });
});

describe("probeLiveExportTargetReadiness — short-circuits on visible rows", () => {
  it("HTML-EMPTY context but live rows present → LIVE_ROWS_PRESENT, bucketed", async () => {
    const res = await probeLiveExportTargetReadiness(PAGE, deps(scripted([signals({ visibleRowCount: 3 })])));
    expect(res.decision).toBe("LIVE_ROWS_PRESENT");
    expect(res.visibleRowCountBucket).toBe("few");
    expect(res.checks).toBe(1);
    expect(res.elapsedMs).toBe(0);
  });

  it("rows present in a CHILD frame (summed) → LIVE_ROWS_PRESENT with frame buckets", async () => {
    const res = await probeLiveExportTargetReadiness(
      PAGE,
      deps(scripted([signals({ visibleRowCount: 2, frameTotal: 3, framesChecked: 3, visibleGridLikeSurface: true })])),
    );
    expect(res.decision).toBe("LIVE_ROWS_PRESENT");
    expect(res.frameCountBucket).toBe("few"); // 3 frames
    expect(res.checkedFramesBucket).toBe("few"); // 3 checked
    expect(res.visibleGridLikeSurface).toBe(true);
  });

  it("rows render LATE (empty for a few checks, then a row) → still LIVE_ROWS_PRESENT", async () => {
    const res = await probeLiveExportTargetReadiness(
      PAGE,
      deps({
        ...scripted([signals({}), signals({}), signals({}), signals({ visibleRowCount: 1 })]),
        timeoutMs: 100,
        intervalMs: 10,
      }),
    );
    expect(res.decision).toBe("LIVE_ROWS_PRESENT");
    expect(res.checks).toBe(4);
  });
});

describe("probeLiveExportTargetReadiness — window expires with no visible row", () => {
  it("a genuinely-visible empty placeholder persists → LIVE_EMPTY_VISIBLE after the full window", async () => {
    const res = await probeLiveExportTargetReadiness(
      PAGE,
      deps({ ...scripted([signals({ visibleEmptyState: true, visibleGridLikeSurface: true })]), timeoutMs: 30, intervalMs: 10 }),
    );
    expect(res.decision).toBe("LIVE_EMPTY_VISIBLE");
    expect(res.checks).toBe(3);
    expect(res.elapsedMs).toBe(20); // (3 - 1) * 10
    expect(res.visibleEmptyState).toBe(true);
  });

  it("zero rows, NO visible empty, only a visible grid → LIVE_TARGET_UNKNOWN (hydrating/ambiguous)", async () => {
    const res = await probeLiveExportTargetReadiness(
      PAGE,
      deps({ ...scripted([signals({ visibleGridLikeSurface: true })]), timeoutMs: 30, intervalMs: 10 }),
    );
    expect(res.decision).toBe("LIVE_TARGET_UNKNOWN");
    expect(res.visibleRowCountBucket).toBe("none");
  });
});

describe("probeLiveExportTargetReadiness — transient errors keep polling", () => {
  it("a thrown read on the first cycle is ignored; the next visible-rows read resolves", async () => {
    let i = 0;
    const readSignalsFn = (): Promise<RawLiveProbeSignals> => {
      i += 1;
      if (i === 1) return Promise.reject(new Error("frame detached"));
      return Promise.resolve(signals({ visibleRowCount: 1 }));
    };
    const res = await probeLiveExportTargetReadiness(PAGE, deps({ readSignalsFn }));
    expect(res.decision).toBe("LIVE_ROWS_PRESENT");
    expect(res.checks).toBe(2);
  });

  it("when EVERY read fails → LIVE_TARGET_UNKNOWN with all-none buckets (never a confident answer)", async () => {
    const res = await probeLiveExportTargetReadiness(
      PAGE,
      deps({ readSignalsFn: () => Promise.reject(new Error("dead")), timeoutMs: 30, intervalMs: 10 }),
    );
    expect(res.decision).toBe("LIVE_TARGET_UNKNOWN");
    expect(res.visibleRowCountBucket).toBe("none");
    expect(res.frameCountBucket).toBe("none");
    expect(res.checkedFramesBucket).toBe("none");
    expect(res.checks).toBe(3);
  });
});

describe("probeLiveExportTargetReadiness — sanitized output (no leak)", () => {
  it("emits only the allow-listed keys — enums/buckets/booleans/counts, no raw content", async () => {
    const res = await probeLiveExportTargetReadiness(
      PAGE,
      deps(scripted([signals({ visibleRowCount: 99, frameTotal: 2, framesChecked: 2 })])),
    );
    expect(Object.keys(res).sort()).toEqual([...LIVE_EXPORT_TARGET_PROBE_KEYS].sort());
    const json = JSON.stringify(res);
    expect(/[<>]/.test(json)).toBe(false);
    expect(/https?:\/\//.test(json)).toBe(false);
    // Buckets, never exact counts: a 99-row read must surface as "many", not the number 99.
    expect(json.includes("99")).toBe(false);
    expect(res.visibleRowCountBucket).toBe("many");
  });
});

describe("live-export-target-probe.ts — source guard: pure leaf, no DOM action", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "src", "naver", "live-export-target-probe.ts");
  const code = readFileSync(SRC, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("never clicks, navigates, exports, downloads, uploads, evaluates, or writes status", () => {
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent|tap)\s*\(/.test(code)).toBe(false);
    expect(/\.(goto|evaluate|frames|mainFrame)\s*\(/.test(code)).toBe(false);
    expect(/runExport|saveAs|waitForEvent|uploadReviewFile|writeStatus/.test(code)).toBe(false);
  });

  it("imports no fs/http/playwright (browser-free pure core)", () => {
    const importLines = code.split("\n").filter((l) => /^\s*import\b/.test(l));
    for (const line of importLines) {
      expect(/node:fs|node:http|playwright/.test(line)).toBe(false);
    }
  });
});
