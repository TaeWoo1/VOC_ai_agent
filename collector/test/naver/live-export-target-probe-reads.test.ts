import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readLiveProbeSignals } from "../../src/naver/live-export-target-probe-reads";
import type { PwPage } from "../../src/profile";

/**
 * Build a fake Playwright-ish page whose frames return CANNED scan results from `evaluate`. The
 * in-browser DOM logic itself runs only in a real browser (validated by the source guard + the
 * gated live diagnostic run); these tests exercise the frame ITERATION + AGGREGATION in
 * `readLiveProbeSignals`, the only part that is pure enough to unit-test — mirroring the project's
 * "live DOM logic is not unit-tested, structure/aggregation is" convention.
 */
type FrameSpec = { rows: number; emptyVisible: boolean; gridVisible: boolean } | "throws";

function fakePage(frameSpecs: FrameSpec[]): PwPage {
  const frames = frameSpecs.map((spec) => ({
    evaluate: (): Promise<unknown> =>
      spec === "throws" ? Promise.reject(new Error("frame detached")) : Promise.resolve(spec),
  }));
  const mainFrame = frames[0];
  return {
    frames: () => frames,
    mainFrame: () => mainFrame,
  } as unknown as PwPage;
}

describe("readLiveProbeSignals — aggregates read-only scans across frames", () => {
  it("sums visible rows and OR-folds visible empty/grid across main + child frames", async () => {
    const res = await readLiveProbeSignals(
      fakePage([
        { rows: 2, emptyVisible: false, gridVisible: true }, // main
        { rows: 1, emptyVisible: true, gridVisible: false }, // child
      ]),
    );
    expect(res.visibleRowCount).toBe(3);
    expect(res.visibleEmptyState).toBe(true); // from the child
    expect(res.visibleGridLikeSurface).toBe(true); // from the main
    expect(res.frameTotal).toBe(2);
    expect(res.framesChecked).toBe(2);
  });

  it("rows visible in a CHILD frame are found (main frame empty)", async () => {
    const res = await readLiveProbeSignals(
      fakePage([
        { rows: 0, emptyVisible: false, gridVisible: false }, // main
        { rows: 4, emptyVisible: false, gridVisible: true }, // child iframe hosts the grid
      ]),
    );
    expect(res.visibleRowCount).toBe(4);
    expect(res.framesChecked).toBe(2);
  });

  it("a frame whose evaluate throws is skipped — the run still completes", async () => {
    const res = await readLiveProbeSignals(
      fakePage([
        { rows: 1, emptyVisible: false, gridVisible: true }, // main reads
        "throws", // detached/cross-origin child → skipped
      ]),
    );
    expect(res.visibleRowCount).toBe(1);
    expect(res.frameTotal).toBe(2); // both frames present
    expect(res.framesChecked).toBe(1); // only one read successfully
  });

  it("returns ONLY scalar counts/booleans (no raw nodes/text/selectors)", async () => {
    const res = await readLiveProbeSignals(fakePage([{ rows: 7, emptyVisible: false, gridVisible: true }]));
    expect(Object.keys(res).sort()).toEqual(
      ["frameTotal", "framesChecked", "visibleEmptyState", "visibleGridLikeSurface", "visibleRowCount"].sort(),
    );
    for (const v of Object.values(res)) {
      expect(["number", "boolean"]).toContain(typeof v);
    }
    expect(/[<>]/.test(JSON.stringify(res))).toBe(false);
  });
});

describe("live-export-target-probe-reads.ts — source guard: read-only DOM, no action", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "src", "naver", "live-export-target-probe-reads.ts");
  const code = readFileSync(SRC, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("READS frames/evaluate but NEVER clicks, navigates, downloads, uploads, or writes status", () => {
    // Read-only DOM access IS allowed for this live adapter.
    expect(/\.evaluate\s*\(/.test(code)).toBe(true);
    expect(/\.frames\s*\(/.test(code)).toBe(true);
    // Action verbs and any export/download/upload/status path are forbidden.
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent|tap)\s*\(/.test(code)).toBe(false);
    expect(/\.goto\s*\(/.test(code)).toBe(false);
    expect(/runExport|saveAs|waitForEvent|uploadReviewFile|writeStatus/.test(code)).toBe(false);
  });

  it("imports playwright ONLY as types (no runtime browser import), and no fs/http", () => {
    const importLines = code.split("\n").filter((l) => /^\s*import\b/.test(l));
    for (const line of importLines) {
      if (/playwright/.test(line)) expect(/^\s*import\s+type\b/.test(line)).toBe(true);
      expect(/node:fs|node:http/.test(line)).toBe(false);
    }
  });
});
