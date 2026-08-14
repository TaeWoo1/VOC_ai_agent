/**
 * **The acquisition session.** What these hold is not "did it collect the reviews" — it is **when is it
 * allowed to say it collected all of them**.
 *
 * v1 walks to the end of the pager, on a backfill and on a re-sync alike. The rule an earlier draft had —
 * stop at the first page that brings nothing new — is only sound on a newest-first list, and this screen's
 * sort order has never been proven live. On any other ordering that rule stops early while reporting full
 * coverage, which is the worst failure available here: silent, and shaped exactly like success.
 *
 * So `complete` is true in one case only: the PAGER said this was the last page. Not when the reviews looked
 * familiar, not when the operator said they were done — that is recorded, separately, as a report.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_ACQUISITION_PAGES,
  ReviewAcquisitionSession,
} from "../../src/action-window/coupang-review/review-acquisition";
import {
  canonicalizeReviewRows,
  localBoundaryKey,
  pagerPosition,
  pagerReading,
  UNREAD_PAGER,
  type CoupangReviewPagerReading,
  type CoupangReviewPageReading,
  type CoupangReviewRowReading,
} from "../../src/action-window/coupang-review/review-rows";

function row(body: string, date = "2026.08.11", rating = "5", product = "111222333"): CoupangReviewRowReading {
  return {
    rowIndex: 0,
    dateText: date,
    ratingText: rating,
    ratingAria: null,
    bodyText: body,
    bodyTruncated: false,
    bodyExpandable: false,
    productText: product,
    productNameText: "무선 이어폰",
    mediaCount: 0,
  };
}

/** A resolved five-page pager sitting on page `current`. The shape the live census actually found. */
function pagerAt(current: number, last = 5): CoupangReviewPagerReading {
  return pagerReading({
    found: true,
    resolved: true,
    pageNumbers: Array.from({ length: last }, (_, i) => i + 1),
    currentPage: current,
    hasNext: current < last,
    nextEnabled: current < last,
  });
}

function readable(
  rows: readonly CoupangReviewRowReading[],
  pager: CoupangReviewPagerReading = pagerAt(1),
): CoupangReviewPageReading {
  return {
    reason: "OK",
    tablesScanned: 1,
    headerWidth: 7,
    excludedColumns: 1,
    unmappedColumns: 1,
    duplicateRoles: 0,
    rolesResolved: ["date", "rating", "product", "productName", "body"],
    widthMismatchRows: 0,
    rows,
    pager,
  };
}

const UNREADABLE: CoupangReviewPageReading = {
  ...readable([]),
  reason: "ROW_WIDTH_MISMATCH",
  widthMismatchRows: 1,
};

const PAGE_1 = readable([row("아주 만족합니다"), row("배송이 빨라요")], pagerAt(1, 2));
const PAGE_2 = readable([row("포장이 아쉬웠어요"), row("크기가 작습니다")], pagerAt(2, 2));

function keysOf(reading: CoupangReviewPageReading): string[] {
  return canonicalizeReviewRows(reading).reviews.map(localBoundaryKey);
}

describe("a walk completes only when the pager says it reached the end", () => {
  it("completes on the last page of the pager", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(PAGE_1);

    expect(session.offerPage(PAGE_2).stopReason).toBe("FINAL_PAGE_REACHED");
    expect(session.result()).toMatchObject({
      complete: true,
      stopReason: "FINAL_PAGE_REACHED",
      pagesAccepted: 2,
      lastPageNumber: 2,
    });
    expect(session.result().reviews).toHaveLength(4);
  });

  it("completes on a screen with no pager and nothing to press — a one-page list is a whole list", () => {
    const single: CoupangReviewPagerReading = pagerReading({
      found: false,
      resolved: false,
      pageNumbers: [],
      currentPage: null,
      hasNext: false,
      nextEnabled: false,
    });
    const session = new ReviewAcquisitionSession();

    session.offerPage(readable([row("하나뿐인 후기")], single));

    expect(session.result()).toMatchObject({ complete: true, stopReason: "FINAL_PAGE_REACHED" });
  });

  it("keeps walking on a page that brought nothing new — familiarity is not the end of the list", () => {
    // The rule that was removed. On a list not sorted newest-first, everything on page 1 being known says
    // nothing whatever about pages 2..5, and stopping here would report full coverage of a list barely read.
    const session = new ReviewAcquisitionSession({ knownKeys: keysOf(PAGE_1) });

    const outcome = session.offerPage(PAGE_1);

    expect(outcome.newReviews).toBe(0);
    expect(outcome.alreadyKnown).toBe(2);
    expect(outcome.stopReason).toBe("IN_PROGRESS");
    expect(session.open).toBe(true);
    expect(session.result().complete).toBe(false);
  });

  it("makes a re-sync walk the same pages a backfill does", () => {
    const backfill = new ReviewAcquisitionSession();
    backfill.offerPage(PAGE_1);
    backfill.offerPage(PAGE_2);

    const resync = new ReviewAcquisitionSession({ knownKeys: [...keysOf(PAGE_1), ...keysOf(PAGE_2)] });
    resync.offerPage(PAGE_1);
    resync.offerPage(PAGE_2);

    expect(resync.result()).toMatchObject({
      complete: true,
      stopReason: "FINAL_PAGE_REACHED",
      pagesAccepted: backfill.result().pagesAccepted,
    });
    // Same pages walked; nothing new collected. That is the idempotence, and it costs the same page turns.
    expect(resync.result().reviews).toHaveLength(0);
  });

  it("does not treat the highest PRINTED number as the end while the next control is still live", () => {
    // A windowed pager: 1…10 shown, 50 pages behind it, and 다음 still pressable on 10.
    const windowed: CoupangReviewPagerReading = pagerReading({
      found: true,
      resolved: true,
      pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      currentPage: 10,
      hasNext: true,
      nextEnabled: true,
    });
    const session = new ReviewAcquisitionSession();

    const outcome = session.offerPage(readable([row("열번째 페이지")], windowed));

    expect(outcome.stopReason).toBe("IN_PROGRESS");
    expect(session.result().complete).toBe(false);
  });
});

describe("the operator's word ends the walk without completing it", () => {
  it("records the operator's finish separately from a pager-confirmed completion", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(PAGE_1);
    session.finish();

    const result = session.result();
    expect(result.stopReason).toBe("OPERATOR_FINISHED");
    expect(result.operatorFinished).toBe(true);
    // A person's recollection of a screen is a report, not a reading.
    expect(result.complete).toBe(false);
    // What was collected is still handed over.
    expect(result.reviews).toHaveLength(2);
  });

  it("refuses to be finished out of a failed page", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(UNREADABLE);
    session.finish();

    expect(session.result()).toMatchObject({
      complete: false,
      operatorFinished: false,
      stopReason: "PAGE_UNREADABLE",
    });
  });
});

describe("a pager it cannot read stops the walk rather than continuing blind", () => {
  it("stops when a pager is present and its current page cannot be identified", () => {
    const unresolved: CoupangReviewPagerReading = pagerReading({
      found: true,
      resolved: false,
      pageNumbers: [1, 2, 3],
      currentPage: null,
      hasNext: true,
      nextEnabled: true,
    });
    const session = new ReviewAcquisitionSession();

    const outcome = session.offerPage(readable([row("어느 페이지인지 모름")], unresolved));

    expect(outcome.accepted).toBe(false);
    expect(session.result()).toMatchObject({
      complete: false,
      stopReason: "PAGER_UNRESOLVED",
      pagesAccepted: 0,
    });
  });

  it("still reports the rows the READER saw, so a pager failure cannot read as a table failure", () => {
    // The first live sitting printed `rows=0` over a page whose ten rows had been read perfectly. The one
    // line the operator sees said the table had failed when only the pager had.
    const unresolved = pagerReading({ found: true, resolved: false, pageNumbers: [1, 2, 3], hasNext: true, nextEnabled: true });
    const session = new ReviewAcquisitionSession();

    const outcome = session.offerPage(readable([row("a"), row("b"), row("c")], unresolved));

    expect(outcome.stopReason).toBe("PAGER_UNRESOLVED");
    expect(outcome.rowsRead).toBe(3);
  });

  it("stops when there is a next control but no numbers to count it against", () => {
    const nextOnly: CoupangReviewPagerReading = pagerReading({
      found: false,
      resolved: false,
      pageNumbers: [],
      currentPage: null,
      hasNext: true,
      nextEnabled: true,
    });

    expect(new ReviewAcquisitionSession().offerPage(readable([row("x")], nextOnly)).stopReason).toBe(
      "PAGER_UNRESOLVED",
    );
  });

  it("treats a pager that was never read as unknown, not as a one-page list", () => {
    expect(pagerPosition(UNREAD_PAGER)).toBe("UNKNOWN");
    expect(new ReviewAcquisitionSession().offerPage(readable([row("x")], UNREAD_PAGER)).stopReason).toBe(
      "PAGER_UNRESOLVED",
    );
  });
});

describe("every other ending refuses to claim coverage", () => {
  it("stops on a page it cannot read, and still hands over what it had", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(PAGE_1);

    const outcome = session.offerPage(UNREADABLE);

    expect(outcome.accepted).toBe(false);
    expect(session.result()).toMatchObject({ complete: false, stopReason: "PAGE_UNREADABLE", pagesAccepted: 1 });
    expect(session.result().reviews).toHaveLength(2);
  });

  it("stops when the page number did not move forward", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(readable([row("첫 페이지")], pagerAt(2, 5)));

    // The operator pressed 이전: different rows, lower page. The row-set signature cannot catch this.
    const outcome = session.offerPage(readable([row("완전히 다른 후기")], pagerAt(1, 5)));

    expect(outcome.stopReason).toBe("PAGE_DID_NOT_ADVANCE");
    expect(session.result()).toMatchObject({ complete: false, repeatedPages: 1, pagesAccepted: 1 });
  });

  it("stops when the same page is offered twice", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(readable([row("첫 페이지")], pagerAt(1, 5)));

    expect(session.offerPage(readable([row("첫 페이지")], pagerAt(1, 5))).stopReason).toBe(
      "PAGE_DID_NOT_ADVANCE",
    );
  });

  it("stops when a page re-rendered identically under a number that did move", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(readable([row("같은 내용")], pagerAt(1, 5)));

    // The number advanced but the rows did not — a turn the screen reported and did not perform.
    expect(session.offerPage(readable([row("같은 내용")], pagerAt(2, 5))).stopReason).toBe(
      "PAGE_DID_NOT_ADVANCE",
    );
  });

  it("stops at the page bound and says nothing about what lay beyond it", () => {
    const session = new ReviewAcquisitionSession({ maxPages: 2 });
    session.offerPage(readable([row("1")], pagerAt(1, 5)));
    session.offerPage(readable([row("2")], pagerAt(2, 5)));

    expect(session.result()).toMatchObject({ complete: false, stopReason: "PAGE_LIMIT_REACHED" });
  });

  it("ignores pages offered after it stopped", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(UNREADABLE);

    expect(session.offerPage(PAGE_1).accepted).toBe(false);
    expect(session.result().reviews).toHaveLength(0);
  });

  it("bounds maxPages to the module ceiling however it is asked", () => {
    expect(MAX_ACQUISITION_PAGES).toBe(100);
    expect(new ReviewAcquisitionSession({ maxPages: 10_000 }).open).toBe(true);
  });
});

describe("a page of reviews that cannot be canonicalized is still a page", () => {
  it("keeps walking past a page where every review was textless", () => {
    const session = new ReviewAcquisitionSession();

    const outcome = session.offerPage(readable([row(""), row("")], pagerAt(1, 5)));

    expect(outcome.dropped.noBody).toBe(2);
    expect(outcome.stopReason).toBe("IN_PROGRESS");
    expect(session.open).toBe(true);
  });

  it("does not read a second all-dropped page as a page that did not advance", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(readable([row("")], pagerAt(1, 5)));

    expect(session.offerPage(readable([row("")], pagerAt(2, 5))).stopReason).toBe("IN_PROGRESS");
  });

  it("accumulates drop counts across the whole walk", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(readable([row(""), row("좋아요")], pagerAt(1, 5)));
    session.offerPage(readable([row("", "어제"), row("괜찮아요")], pagerAt(2, 5)));

    expect(session.result().dropped).toMatchObject({ noBody: 1, unparseableDate: 1 });
  });
});

describe("the session holds no review text it should not", () => {
  it("keeps its page identities as boundary keys, so no body reaches them", () => {
    const session = new ReviewAcquisitionSession({ knownKeys: keysOf(PAGE_1) });
    session.offerPage(PAGE_1);

    expect(JSON.stringify(session.result())).not.toContain("아주 만족합니다");
  });
});

describe("pagerPosition on its own", () => {
  it("calls a resolved pager on its last number with a dead next control the final page", () => {
    expect(pagerPosition(pagerAt(5, 5))).toBe("FINAL_PAGE");
  });

  it("calls any earlier page more pages", () => {
    expect(pagerPosition(pagerAt(3, 5))).toBe("MORE_PAGES");
  });

  it("refuses a current page the pager did not also offer", () => {
    const inconsistent: CoupangReviewPagerReading = pagerReading({
      found: true,
      resolved: true,
      pageNumbers: [1, 2, 3],
      currentPage: 9,
      hasNext: false,
      nextEnabled: false,
    });

    // "page 9 of 1,2,3" is a contradiction, not a position — and read as past-the-end it would COMPLETE a
    // walk. The reading is refused instead.
    expect(pagerPosition(inconsistent)).toBe("UNKNOWN");
  });
});
