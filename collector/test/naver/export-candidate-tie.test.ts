/**
 * <b>Two export matches where one contains the other are one control.</b>
 * — NAVER Guided Acquisition Runtime Closure v2, blocker 5.
 *
 * The 2026-09-02 live sitting ended `TARGET_AMBIGUOUS` with `count: 2` on a screen the classifier had already
 * read cleanly as `SYNC_DOWNLOAD` — the export control was present, the wording matched, and the run stopped
 * because it could not tell two matches apart. The record could not say WHAT the two were: the diagnostic
 * carried a bucketed count and nothing about the candidates.
 *
 * Two things follow, and neither of them is a guess about that page:
 *
 *  1. A container matches on its child's accessible name, so a wrapper and the control inside it are counted
 *     twice. The innermost wins — the rule `markContinuationTarget` has always applied to its own candidate
 *     set, now applied to this one too. It can only collapse a NESTED pair.
 *  2. Two disjoint controls stay two, and the run still fails closed. No first-match, no ordering preference,
 *     no "the one with an id". `exportCandidateShapes` is what a future rule would have to be derived FROM.
 */
import { describe, expect, it } from "vitest";
import { exportCandidateShapes, findExportCandidates } from "../../src/naver/review-export";
import { naverLocateDecision } from "../../src/action-window/naver-surface";

describe("export candidate ties", () => {
  it("counts a wrapper and the control inside it once", () => {
    const html = `<div role="button" class="wrap"><button type="button">엑셀 다운로드</button></div>`;
    expect(findExportCandidates(html)).toHaveLength(1);
    // And the run can proceed: one candidate is a located target, not an ambiguity.
    expect(naverLocateDecision(html).count).toBe(1);
  });

  it("keeps the INNERMOST of a nested pair", () => {
    // A `role="button"` container is scanned by its own pass, so this pair really is found twice; the
    // dedupe is what turns it into the one control it is.
    const html = `<span role="button" class="wrap"><button type="button">엑셀 다운로드</button></span>`;
    const found = findExportCandidates(html);
    expect(found).toHaveLength(1);
    expect(found[0]?.tag).toBe("button");
  });

  /**
   * A `<a>` wrapping a `<button>` was never a tie: the `(button|a)` scan consumes to the first matching close
   * tag, so the outer anchor is matched and the inner button is skipped. Pinned so the dedupe above is not
   * later "simplified" on the belief that it covers this shape too.
   */
  it("was never double-counting an anchor wrapping a button", () => {
    expect(findExportCandidates(`<a href="#"><button>엑셀 다운로드</button></a>`)).toHaveLength(1);
  });

  it("still fails closed on two disjoint export controls", () => {
    const html = `<button>엑셀 다운로드</button><div class="x"></div><button>리뷰 다운로드</button>`;
    expect(findExportCandidates(html)).toHaveLength(2);
    expect(naverLocateDecision(html).count).toBe(2);
  });

  it("describes a tie in sanitized structure — never page text", () => {
    const html = `<button id="a" data-export="review">엑셀 다운로드</button><a title="csv 다운로드">받기</a>`;
    const shapes = exportCandidateShapes(html);
    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toMatchObject({ order: 0, tag: "button", source: "TEXT", dataExportReview: true, hasId: true });
    expect(shapes[1]).toMatchObject({ order: 1, tag: "a", source: "TITLE", dataExportReview: false, hasId: false });
    // The keyword is OUR literal, reported as an index into our own closed list.
    expect(shapes[0]!.keywordIndex).toBeGreaterThanOrEqual(0);
    const serialized = JSON.stringify(shapes);
    for (const leak of ["엑셀 다운로드", "받기", '"a"', "review-export"]) {
      expect(serialized.includes(leak) && leak.length > 3).toBe(false);
    }
  });
});
