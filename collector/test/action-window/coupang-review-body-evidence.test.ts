/**
 * **The counter that can accuse the reader.**
 *
 * Every Coupang review the Aside lane has acquired came back textless, and nothing in the run's record could
 * say whether that was the store or the read. `bodyEvidenceOf` separates them with the one signal the page
 * itself gives: a body cell that offers to show more is a cell with something in it. So `textlessExpandable`
 * is the only number here that is ever an accusation — the others are description.
 *
 * The tests are about that boundary, not about arithmetic.
 */
import { describe, expect, it } from "vitest";
import {
  bodyEvidenceOf,
  canonicalizeReviewRows,
  type CoupangReviewPageReading,
  type CoupangReviewRowReading,
} from "../../src/action-window/coupang-review/review-rows";

/** A page whose structure is fine, so only the bodies are under test. */
const OK_PAGE: CoupangReviewPageReading = {
  reason: "OK",
  tablesScanned: 1,
  headerWidth: 7,
  excludedColumns: 1,
  unmappedColumns: 0,
  duplicateRoles: 0,
  rolesResolved: ["date", "rating", "product", "body", "media"],
  widthMismatchRows: 0,
  rows: [],
  pager: { found: true, resolved: true, currentPage: 1, pageNumbers: [1], hasNext: false, nextEnabled: false },
};

function row(over: Partial<CoupangReviewRowReading> = {}): CoupangReviewRowReading {
  return {
    rowIndex: 0,
    dateText: "2026-09-01",
    ratingText: "5",
    ratingAria: null,
    bodyText: "",
    bodyTruncated: false,
    bodyExpandable: false,
    productText: "15411270785 (81234567890)",
    productNameText: null,
    mediaCount: 0,
    ...over,
  };
}

describe("bodyEvidenceOf", () => {
  it("a buyer who rated and wrote nothing is textless and accuses nobody", () => {
    expect(bodyEvidenceOf([row(), row()])).toEqual({
      textless: 2,
      expandable: 0,
      truncated: 0,
      textlessExpandable: 0,
    });
  });

  it("an empty cell that offers to show more is a hidden body, and is counted as one", () => {
    const evidence = bodyEvidenceOf([row({ bodyExpandable: true }), row()]);
    expect(evidence.textless).toBe(2);
    expect(evidence.textlessExpandable).toBe(1);
  });

  it("a written review that offers more is expandable but not an accusation", () => {
    const evidence = bodyEvidenceOf([row({ bodyText: "배송이 빨라서 좋았습니다", bodyExpandable: true })]);
    expect(evidence).toEqual({ textless: 0, expandable: 1, truncated: 0, textlessExpandable: 0 });
  });

  it("whitespace is not a body", () => {
    expect(bodyEvidenceOf([row({ bodyText: "   \n  " })]).textless).toBe(1);
  });

  /**
   * The first live run of this counter reported `textless: 0` for a page on which the handoff then skipped
   * nine rows as textless duplicates. WING prints a sentence where a buyer wrote nothing, and a counter that
   * tests the raw cell disagrees with the canonicalizer that decides what is stored.
   */
  it("the channel's placeholder sentence is not a body, because storage does not treat it as one", () => {
    const reading = [row({ bodyText: "등록된 내용이 없습니다." }), row({ bodyText: "내용 없음" })];
    expect(bodyEvidenceOf(reading).textless).toBe(2);
    // The counter and the canonicalizer must say the same thing, which is the whole point of the fix.
    expect(canonicalizeReviewRows({ ...OK_PAGE, rows: reading }).textlessCount).toBe(2);
  });

  it("a cell holding only the expander control is not a body either", () => {
    expect(bodyEvidenceOf([row({ bodyText: "더보기" })]).textless).toBe(1);
  });

  it("the reader's own cut is reported apart from the cell's offer", () => {
    expect(bodyEvidenceOf([row({ bodyText: "긴-본문", bodyTruncated: true })]))
      .toEqual({ textless: 0, expandable: 0, truncated: 1, textlessExpandable: 0 });
  });

  it("an empty page says nothing about bodies", () => {
    expect(bodyEvidenceOf([])).toEqual({ textless: 0, expandable: 0, truncated: 0, textlessExpandable: 0 });
  });
});

/**
 * **The two lanes read with the same instrument.**
 *
 * The M3 report could not rule out a reader regression in the Aside lane, because nothing asserted that the
 * script Aside carries is the script the helper evaluates. It is — both call `buildReviewRowReadScript()` with
 * no arguments — and asserting the two STRINGS are equal is what makes "the lane cannot read bodies
 * differently" a property rather than a reading of two call sites. On 2026-08-23 this script read 4 bodies out
 * of 23 rows off this store's list through the helper; a September page that comes back all-textless is
 * therefore a claim about the rows, and `bodyEvidenceOf` is what can contradict it.
 */
import { buildReviewRowReadScript } from "../../src/action-window/coupang-review/review-row-inpage";
import { buildReviewRuntimePlan } from "../../src/aside/coupang-review-executor";
import { COUPANG_REVIEW_READ_WORKFLOW } from "../../src/aside/coupang-review-workflow";

describe("the reader the Aside lane carries", () => {
  it("is the same script the helper lane evaluates, character for character", () => {
    expect(buildReviewRuntimePlan(COUPANG_REVIEW_READ_WORKFLOW).readerScript).toBe(buildReviewRowReadScript());
  });
});
