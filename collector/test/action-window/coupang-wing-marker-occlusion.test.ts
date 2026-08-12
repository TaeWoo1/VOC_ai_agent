/**
 * The hit test that stops step ⑦ completing behind WING's own dialog.
 *
 * Live on 2026-08-12: the seller pressed the vendor screen's 확인, WING opened a `발급 완료` dialog, and the
 * credential marker behind it painted — so the walk advanced, rang a row nobody could see, and told the seller to
 * copy keys that were covered. Every existing check was satisfied: the label matched, once, and it painted.
 *
 * These cases run the REAL generated script against a fake DOM, for the same reason the visibility filter's do:
 * the defect was a check that reported success without having been exercised.
 */
import { describe, expect, it } from "vitest";
import {
  buildFixedLabelOcclusionScript,
  occlusionVerdict,
  sanitizeOcclusionReading,
} from "../../src/action-window/api-issuance-calibration/occlusion-inpage";

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

class El {
  readonly tagName: string;
  readonly textContent: string;
  readonly childElementCount = 0;
  constructor(
    tag: string,
    text: string,
    readonly box: Box,
  ) {
    this.tagName = tag.toUpperCase();
    this.textContent = text;
  }
  getAttribute(): string | null {
    return null;
  }
  getClientRects(): unknown[] {
    return [{}];
  }
  getBoundingClientRect(): Box & { width: number; height: number } {
    return { ...this.box, width: this.box.right - this.box.left, height: this.box.bottom - this.box.top };
  }
  contains(other: unknown): boolean {
    return other === this;
  }
}

const VIEWPORT = { w: 1440, h: 780 };

/**
 * Run the script over a fake page. `stack` is painted back-to-front: the LAST element covering a point is what
 * `elementFromPoint` hands back, which is exactly how a modal wins.
 */
function run(marker: El, stack: readonly El[], viewport = VIEWPORT): unknown {
  const all = [marker, ...stack];
  const document = {
    querySelectorAll: (sel: string): El[] => {
      const wanted = sel.split(",").map((s) => s.trim().toUpperCase());
      return all.filter((e) => wanted.includes(e.tagName));
    },
    elementFromPoint: (x: number, y: number): El | null => {
      const hits = all.filter((e) => x >= e.box.left && x <= e.box.right && y >= e.box.top && y <= e.box.bottom);
      return hits.length > 0 ? hits[hits.length - 1]! : null;
    },
  };
  const window = {
    innerWidth: viewport.w,
    innerHeight: viewport.h,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
  };
  const script = buildFixedLabelOcclusionScript({ candidateQuery: "th,td,span,div", exactText: "Access Key" });
  return new Function("document", "window", `return (${script});`)(document, window);
}

function verdictOf(marker: El, stack: readonly El[], viewport = VIEWPORT) {
  return occlusionVerdict(sanitizeOcclusionReading(run(marker, stack, viewport)));
}

/** The credential header, where it sat on the live screen: mid-page, inside the viewport. */
const credentialHeader = (): El => new El("th", "Access Key", { left: 300, top: 300, right: 520, bottom: 340 });

describe("the marker behind WING's own dialog", () => {
  it("**reads COVERED when a modal is painted over it** — the live defect, in one assertion", () => {
    const dialog = new El("div", "발급 완료", { left: 0, top: 0, right: 1440, bottom: 780 });
    expect(verdictOf(credentialHeader(), [dialog])).toBe("COVERED");
  });

  it("reads CLEAR once the dialog is gone — the advance is delayed, never cancelled", () => {
    expect(verdictOf(credentialHeader(), [])).toBe("CLEAR");
  });

  it("a corner clipped by a sticky header is not a dialog — a minority of covered points still reads CLEAR", () => {
    // Covers the marker's top edge only: the centre and the two bottom corners remain the marker's own.
    const sticky = new El("div", "", { left: 0, top: 0, right: 1440, bottom: 305 });
    expect(verdictOf(credentialHeader(), [sticky])).toBe("CLEAR");
  });

  it("**a marker below the fold is CLEAR, not covered** — nothing is on top of it, it is just not scrolled to", () => {
    // Refusing to advance here would stall the ordinary case in order to catch the exceptional one.
    const belowFold = new El("th", "Access Key", { left: 300, top: 1200, right: 520, bottom: 1240 });
    expect(verdictOf(belowFold, [])).toBe("CLEAR");
  });

  it("reads NOT_VISIBLE when the label matches nothing that paints", () => {
    const other = new El("th", "Secret Key", { left: 300, top: 300, right: 520, bottom: 340 });
    expect(verdictOf(other, [])).toBe("NOT_VISIBLE");
  });
});

describe("what the reading is allowed to carry", () => {
  it("is integers and booleans — never the tag or text of whatever is on top", () => {
    const dialog = new El("div", "발급 완료 · 키가 생성되었습니다", { left: 0, top: 0, right: 1440, bottom: 780 });
    const raw = run(credentialHeader(), [dialog]);
    const dump = JSON.stringify(raw);
    expect(dump).not.toContain("발급 완료");
    expect(dump).not.toContain("DIV");
    expect(sanitizeOcclusionReading(raw)).toEqual({
      visibleCount: 1,
      hiddenCount: 0,
      inViewport: true,
      sampled: 5,
      covered: 5,
    });
  });

  it("a non-unique match carries no hit test — two markers identify nothing to test", () => {
    expect(sanitizeOcclusionReading({ visibleCount: 2, hiddenCount: 0, sampled: 5, covered: 5 })).toEqual({
      visibleCount: 2,
      hiddenCount: 0,
    });
  });

  it("drops a covered count that exceeds what was sampled rather than trusting it", () => {
    const r = sanitizeOcclusionReading({ visibleCount: 1, hiddenCount: 0, inViewport: true, sampled: 2, covered: 9 });
    expect(r?.covered).toBeUndefined();
    // …and with no covered count, nothing is proven covered, so the verdict is the permissive one. That is the
    // right side to fail to: a malformed reading must not be able to park the walk forever.
    expect(occlusionVerdict(r)).toBe("CLEAR");
  });
});

describe("the verdict fails closed where it matters", () => {
  it("an unreadable page is UNREADABLE, never quietly NOT_VISIBLE", () => {
    expect(occlusionVerdict(null)).toBe("UNREADABLE");
    expect(occlusionVerdict(sanitizeOcclusionReading({ nothing: true }))).toBe("UNREADABLE");
    expect(occlusionVerdict(sanitizeOcclusionReading("a string"))).toBe("UNREADABLE");
  });

  it("**neither UNREADABLE nor NOT_VISIBLE is CLEAR** — only a tested, uncovered marker advances the walk", () => {
    for (const v of ["UNREADABLE", "NOT_VISIBLE", "COVERED"] as const) {
      expect(v).not.toBe("CLEAR");
    }
    expect(occlusionVerdict({ visibleCount: 0, hiddenCount: 3 })).toBe("NOT_VISIBLE");
  });

  it("an exact half of the samples covered counts as covered", () => {
    // The threshold is stated as `covered * 2 >= sampled` rather than `>`, so an even split holds the walk.
    expect(occlusionVerdict({ visibleCount: 1, hiddenCount: 0, inViewport: true, sampled: 4, covered: 2 })).toBe(
      "COVERED",
    );
    expect(occlusionVerdict({ visibleCount: 1, hiddenCount: 0, inViewport: true, sampled: 5, covered: 2 })).toBe(
      "CLEAR",
    );
  });
});
