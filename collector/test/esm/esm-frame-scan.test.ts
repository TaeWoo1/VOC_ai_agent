import { describe, expect, it } from "vitest";
import type { ExportCandidateVisibilitySummary } from "../../src/esm/esm-export-visibility";
import {
  FRAME_AWARE_EXPORT_SCAN_KEYS,
  FRAME_SCOPE_PROBE_KEYS,
  frameHostAllowed,
  type FrameScanResult,
  summarizeFrameAwareExportScan,
} from "../../src/esm/esm-frame-scan";
import type { EsmUrlCategory } from "../../src/esm/esm-review-probe";

const sum = (
  o: Partial<ExportCandidateVisibilitySummary> = {},
): ExportCandidateVisibilitySummary => ({ total: 0, visible: 0, enabled: 0, actionable: 0, ...o });

function frame(
  frameUrlCategory: EsmUrlCategory,
  readResult: FrameScanResult,
  summary: ExportCandidateVisibilitySummary | null,
  allowlisted = false,
) {
  return { frameUrlCategory, readResult, allowlisted, summary };
}

const COUNT_BUCKETS = ["none", "one", "few", "some", "many"];
const SCOPE_CATS = ["top-document", "same-origin-frame", "allowlisted-frame", "none"];
const READ_RESULTS = ["read", "skipped-cross-origin", "blocked"];

describe("frameHostAllowed — ESM-family cross-origin allowlist (fail-closed)", () => {
  const allow = ["esmplus.com", "gmarket.co.kr"];

  it("empty allowlist → always false (fail-closed default)", () => {
    expect(frameHostAllowed("https://sa2.esmplus.com/x", [])).toBe(false);
  });

  it("exact host match", () => {
    expect(frameHostAllowed("https://esmplus.com/Home", allow)).toBe(true);
  });

  it("dotted subdomain match (sa2.esmplus.com ⊂ esmplus.com)", () => {
    expect(frameHostAllowed("https://sa2.esmplus.com/Home/v2/manage-feedback", allow)).toBe(true);
    expect(frameHostAllowed("https://www.gmarket.co.kr/panel", allow)).toBe(true);
  });

  it("look-alike host is NOT a subdomain match", () => {
    expect(frameHostAllowed("https://evil-esmplus.com/x", allow)).toBe(false);
    expect(frameHostAllowed("https://esmplus.com.evil.test/x", allow)).toBe(false);
  });

  it("non-http(s) and malformed URLs are rejected", () => {
    expect(frameHostAllowed("about:blank", allow)).toBe(false);
    expect(frameHostAllowed("data:text/html,hi", allow)).toBe(false);
    expect(frameHostAllowed("not a url", allow)).toBe(false);
  });

  it("matching is case-insensitive", () => {
    expect(frameHostAllowed("https://SA2.EsmPlus.COM/x", allow)).toBe(true);
  });
});

describe("summarizeFrameAwareExportScan — scope aggregation", () => {
  it("ACTIONABLE control inside a same-origin frame → aggregate true, scope = same-origin-frame", () => {
    const r = summarizeFrameAwareExportScan({
      topDocument: sum({ total: 3, visible: 0, enabled: 3, actionable: 0 }), // the live ambiguity
      frames: [frame("seller-center", "read", sum({ total: 2, visible: 1, enabled: 1, actionable: 1 }))],
    });
    expect(r.hasActionableExportCandidate).toBe(true);
    expect(r.actionableScope).toBe("same-origin-frame");
    expect(r.topDocument).toEqual({ total: "few", visible: "none", enabled: "few", actionable: "none" });
    expect(r.frames[0]?.candidates).toEqual({ total: "few", visible: "one", enabled: "one", actionable: "one" });
  });

  it("HIDDEN in top but VISIBLE in frame: top not actionable, frame is → scope = same-origin-frame", () => {
    const r = summarizeFrameAwareExportScan({
      topDocument: sum({ total: 1, visible: 0, enabled: 1, actionable: 0 }),
      frames: [frame("seller-center", "read", sum({ total: 1, visible: 1, enabled: 1, actionable: 1 }))],
    });
    expect(r.hasActionableExportCandidate).toBe(true);
    expect(r.actionableScope).toBe("same-origin-frame");
  });

  it("top-document actionable WINS the scope label over a frame", () => {
    const r = summarizeFrameAwareExportScan({
      topDocument: sum({ total: 2, visible: 2, enabled: 2, actionable: 2 }),
      frames: [frame("seller-center", "read", sum({ total: 1, visible: 1, enabled: 1, actionable: 1 }))],
    });
    expect(r.hasActionableExportCandidate).toBe(true);
    expect(r.actionableScope).toBe("top-document");
  });

  it("no actionable anywhere → aggregate false, scope = none", () => {
    const r = summarizeFrameAwareExportScan({
      topDocument: sum({ total: 3, visible: 0, enabled: 3, actionable: 0 }),
      frames: [frame("seller-center", "read", sum({ total: 1, visible: 0, enabled: 1, actionable: 0 }))],
    });
    expect(r.hasActionableExportCandidate).toBe(false);
    expect(r.actionableScope).toBe("none");
  });
});

describe("summarizeFrameAwareExportScan — cross-origin / blocked frames skipped safely", () => {
  it("a cross-origin frame is skipped: candidates null, counted as skipped, never actionable", () => {
    const r = summarizeFrameAwareExportScan({
      topDocument: sum({ total: 1, visible: 0, enabled: 1, actionable: 0 }),
      frames: [
        frame("other", "skipped-cross-origin", null),
        frame("seller-center", "read", sum({ total: 1, visible: 1, enabled: 1, actionable: 1 })),
      ],
    });
    expect(r.frames[0]?.candidates).toBeNull();
    expect(r.skippedFrameCount).toBe("one");
    // The actionable scope still comes from the readable same-origin frame.
    expect(r.actionableScope).toBe("same-origin-frame");
  });

  it("a blocked (inaccessible) same-origin frame is skipped safely", () => {
    const r = summarizeFrameAwareExportScan({
      topDocument: sum(),
      frames: [frame("seller-center", "blocked", null)],
    });
    expect(r.frames[0]?.candidates).toBeNull();
    expect(r.frames[0]?.readResult).toBe("blocked");
    expect(r.skippedFrameCount).toBe("one");
    expect(r.hasActionableExportCandidate).toBe(false);
  });

  it("an ALLOWLISTED cross-origin frame with an actionable control → scope = allowlisted-frame", () => {
    const r = summarizeFrameAwareExportScan({
      topDocument: sum({ total: 3, visible: 0, enabled: 3, actionable: 0 }), // the run-3 top doc
      frames: [
        // The run-3 iframe, now READ via the allowlist, with an actionable export control.
        frame("seller-center", "read", sum({ total: 1, visible: 1, enabled: 1, actionable: 1 }), true),
      ],
    });
    expect(r.hasActionableExportCandidate).toBe(true);
    expect(r.actionableScope).toBe("allowlisted-frame");
    expect(r.allowlistedFrameCount).toBe("one");
    expect(r.frames[0]?.allowlisted).toBe(true);
  });

  it("allowlistedFrameCount counts allowlisted frames; same-origin reads are not allowlisted", () => {
    const r = summarizeFrameAwareExportScan({
      topDocument: sum(),
      frames: [
        frame("seller-center", "read", sum(), false), // same-origin
        frame("seller-center", "read", sum(), true), // allowlisted cross-origin
        frame("other", "skipped-cross-origin", null, false),
      ],
    });
    expect(r.allowlistedFrameCount).toBe("one");
    expect(r.skippedFrameCount).toBe("one");
  });

  it("buckets total frame count (top + children) and dedupes/sorts frame categories", () => {
    const r = summarizeFrameAwareExportScan({
      topDocument: sum(),
      frames: [
        frame("seller-center", "read", sum()),
        frame("login", "skipped-cross-origin", null),
        frame("seller-center", "read", sum()),
      ],
    });
    expect(r.frameCount).toBe("few"); // 3 children + top = 4
    expect(r.frameUrlCategories).toEqual(["login", "seller-center"]);
    expect(r.skippedFrameCount).toBe("one");
  });
});

describe("summarizeFrameAwareExportScan — sanitized shape (no leaks)", () => {
  const r = summarizeFrameAwareExportScan({
    topDocument: sum({ total: 3, visible: 0, enabled: 3, actionable: 0 }),
    frames: [
      frame("seller-center", "read", sum({ total: 1, visible: 1, enabled: 1, actionable: 1 })),
      frame("other", "skipped-cross-origin", null),
    ],
  });

  it("emits ONLY the allowed top-level / per-frame keys", () => {
    expect(Object.keys(r).sort()).toEqual([...FRAME_AWARE_EXPORT_SCAN_KEYS].sort());
    for (const f of r.frames) {
      expect(Object.keys(f).sort()).toEqual([...FRAME_SCOPE_PROBE_KEYS].sort());
    }
  });

  it("every leaf is a bucket / category / boolean — never text", () => {
    const serialized = JSON.stringify(r);
    expect(/[가-힣]/.test(serialized)).toBe(false); // no Korean DOM text
    expect(COUNT_BUCKETS).toContain(r.frameCount);
    expect(COUNT_BUCKETS).toContain(r.skippedFrameCount);
    expect(COUNT_BUCKETS).toContain(r.allowlistedFrameCount);
    expect(SCOPE_CATS).toContain(r.actionableScope);
    for (const f of r.frames) {
      expect(READ_RESULTS).toContain(f.readResult);
      expect(typeof f.allowlisted).toBe("boolean");
      if (f.candidates) {
        for (const v of Object.values(f.candidates)) expect(COUNT_BUCKETS).toContain(v);
      }
    }
  });

  it("is deterministic for the same input", () => {
    const input = {
      topDocument: sum({ total: 2, actionable: 1, visible: 1, enabled: 1 }),
      frames: [frame("seller-center" as const, "read" as const, sum({ total: 1 }))],
    };
    expect(summarizeFrameAwareExportScan(input)).toEqual(summarizeFrameAwareExportScan(input));
  });
});
