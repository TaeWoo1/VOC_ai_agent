/**
 * <b>The apply (조회) control is identified by what it says and where it stands — not by a substring of its
 * markup.</b> — NAVER Guided Acquisition Runtime Closure v2, blocker 4.
 *
 * The 2026-09-02 live sitting reported `applyWordingPresent: true` with `applyCandidateCount: 45` on a real
 * NAVER review-search surface. `inferRequiresApply` needs exactly one, so it answered `false`, the
 * `APPLY_RANGE` stage was never planned, and the seller went from the date fields to the export locate having
 * never been asked to press 조회. The compensating control the code relied on — "a surface that did need
 * applying is caught by the scope read-back" — could not fire either: the read-back reads the date INPUTS,
 * which hold the typed value whether or not the range has been applied, and it returned `MATCH`.
 *
 * Two rules replace the substring test, and both are stated so that the in-page selector can compute the
 * identical answer from the live DOM:
 *   1. wording is read off the LABEL (element text + `value`), never off attributes;
 *   2. the control must FOLLOW the first date input in document order.
 */
import { describe, expect, it } from "vitest";
import {
  applyCandidates,
  importLocateDiagnostic,
  inferRequiresApply,
  locateApplyDecision,
} from "../../src/naver/import-locate";

const DATES = `
  <input type="text" class="date-picker" value="2026-09-02">
  <input type="text" class="date-picker" value="2026-09-02">
`;

describe("apply control identification", () => {
  it("does not treat a class/id/href containing 'search' as an apply control", () => {
    // The observed shape: ordinary chrome whose ATTRIBUTES contain the word, and no real 조회 button.
    const html = `
      <a href="/search/reviews" class="searchLink">리뷰 관리</a>
      <button class="btn-search-toggle" id="searchPanel">닫기</button>
      <input type="button" class="searchReset" value="초기화">
      ${DATES}
    `;
    expect(applyCandidates(html)).toHaveLength(0);
    expect(importLocateDiagnostic(html).applyCandidateCount).toBe(0);
    expect(inferRequiresApply(html)).toBe(false);
  });

  it("finds the one control whose visible label says 조회, after the date fields", () => {
    const html = `
      <a href="/search/reviews" class="searchLink">리뷰 관리</a>
      ${DATES}
      <button type="button" class="btn_primary">조회</button>
    `;
    expect(applyCandidates(html)).toHaveLength(1);
    expect(locateApplyDecision(html)).toEqual({ count: 1, index: 0 });
    expect(inferRequiresApply(html)).toBe(true);
  });

  it("reads an input control's label from its value attribute", () => {
    const html = `${DATES}<input type="submit" class="c1" value="검색">`;
    expect(locateApplyDecision(html)).toEqual({ count: 1, index: 0 });
  });

  /**
   * The positional half. A site-wide 검색 box lives in the page header, above the filter it has nothing to do
   * with; the filter's own button is below its fields. Without this rule the header box and the real 조회
   * button are two candidates and the run fails closed on a surface it could have read.
   */
  it("ignores an apply-worded control that stands BEFORE the date fields", () => {
    const html = `
      <button type="button" class="gnb">검색</button>
      ${DATES}
      <button type="button" class="btn_primary">조회</button>
    `;
    expect(applyCandidates(html)).toHaveLength(1);
    expect(locateApplyDecision(html)).toEqual({ count: 1, index: 0 });
  });

  it("fails closed on two real apply controls after the dates", () => {
    const html = `${DATES}<button>조회</button><button>적용</button>`;
    expect(locateApplyDecision(html).count).toBe(2);
    expect(inferRequiresApply(html)).toBe(false);
  });

  it("finds no apply control on a surface with no date fields", () => {
    expect(applyCandidates(`<button>조회</button>`)).toHaveLength(0);
  });

  it("excludes a disabled or hidden apply control", () => {
    expect(locateApplyDecision(`${DATES}<button disabled>조회</button>`).count).toBe(0);
    expect(locateApplyDecision(`${DATES}<input type="submit" value="조회" style="display:none">`).count).toBe(0);
  });

  /**
   * `input[type=text]` carrying 조회 in a placeholder is a search BOX, not a search button. The in-page
   * selector only considers `input[type=button]` and `input[type=submit]`, so the pure side must too or the
   * counts diverge and every locate ends in `aw_import_locate_tag_divergence`.
   */
  it("counts only the input types the in-page selector considers", () => {
    const html = `${DATES}<input type="text" value="조회"><button>조회</button>`;
    expect(applyCandidates(html)).toHaveLength(1);
  });
});
