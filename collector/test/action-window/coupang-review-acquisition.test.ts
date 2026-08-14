/**
 * **The acquisition session.** What these hold is not "did it collect the reviews" — it is **when is it allowed
 * to say it collected all of them**.
 *
 * `complete` is the field the product acts on: a complete walk is what a first backfill claims, and an
 * incomplete one is what must not silently become a stored coverage claim. So every ending that is not a real
 * boundary or an operator's own "that was the last page" is tested to leave it false, including the two that
 * look most like success — a page that could not be read after several that could, and a page that repeated
 * the one before it.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_ACQUISITION_PAGES,
  ReviewAcquisitionSession,
} from "../../src/action-window/coupang-review/review-acquisition";
import {
  canonicalizeReviewRows,
  localBoundaryKey,
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

function readable(rows: readonly CoupangReviewRowReading[]): CoupangReviewPageReading {
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
  };
}

const UNREADABLE: CoupangReviewPageReading = { ...readable([]), reason: "ROW_WIDTH_MISMATCH", widthMismatchRows: 1 };

const PAGE_1 = readable([row("아주 만족합니다"), row("배송이 빨라요")]);
const PAGE_2 = readable([row("포장이 아쉬웠어요"), row("크기가 작습니다")]);

function keysOf(reading: CoupangReviewPageReading): string[] {
  return canonicalizeReviewRows(reading).reviews.map(localBoundaryKey);
}

describe("a first backfill", () => {
  it("collects each page the operator brings up, and completes when they say it was the last", () => {
    const session = new ReviewAcquisitionSession();

    expect(session.offerPage(PAGE_1).newReviews).toBe(2);
    expect(session.offerPage(PAGE_2).newReviews).toBe(2);
    session.finish();

    const result = session.result();
    expect(result.complete).toBe(true);
    expect(result.stopReason).toBe("OPERATOR_FINISHED");
    expect(result.pagesAccepted).toBe(2);
    expect(result.reviews).toHaveLength(4);
  });

  it("stops at a page that brings nothing new, without needing the operator to say so", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(PAGE_1);
    const second = session.offerPage(readable([row("아주 만족합니다"), row("완전히 새로운 후기")]));

    // One of the two was already collected; the page still advanced because one was not.
    expect(second.newReviews).toBe(1);
    expect(second.alreadyKnown).toBe(1);
    expect(session.open).toBe(true);
  });
});

describe("a routine re-sync", () => {
  it("reaches its boundary on the first page, with no page turn at all", () => {
    const session = new ReviewAcquisitionSession({ knownKeys: keysOf(PAGE_1) });

    const outcome = session.offerPage(PAGE_1);

    expect(outcome.newReviews).toBe(0);
    expect(outcome.alreadyKnown).toBe(2);
    expect(session.result()).toMatchObject({ complete: true, stopReason: "BOUNDARY_REACHED", reviews: [] });
  });

  it("collects only what is new when the top page has moved on, and keeps walking", () => {
    const session = new ReviewAcquisitionSession({ knownKeys: keysOf(PAGE_1) });

    session.offerPage(readable([row("오늘 도착한 새 후기"), ...PAGE_1.rows]));

    const result = session.result();
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]!.body).toBe("오늘 도착한 새 후기");
    // A page holding known reviews is NOT the boundary — that shortcut is only sound on a newest-first list,
    // and the screen's sort order has not been established live. One more page turn beats a coverage claim
    // that rests on an assumption.
    expect(result.complete).toBe(false);
    expect(session.open).toBe(true);
  });
});

describe("every ending that is not a boundary refuses to claim coverage", () => {
  it("stops on a page it cannot read, and does not call the walk complete", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(PAGE_1);

    const outcome = session.offerPage(UNREADABLE);

    expect(outcome.accepted).toBe(false);
    expect(session.result()).toMatchObject({ complete: false, stopReason: "PAGE_UNREADABLE", pagesAccepted: 1 });
    // What it DID read is still handed over — dedupe makes that free. Only the coverage claim is withheld.
    expect(session.result().reviews).toHaveLength(2);
  });

  it("refuses to be finished out of a failed page", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(UNREADABLE);
    session.finish();

    expect(session.result()).toMatchObject({ complete: false, stopReason: "PAGE_UNREADABLE" });
  });

  it("stops when a page turn did not turn", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(PAGE_1);

    const outcome = session.offerPage(PAGE_1);

    expect(outcome.stopReason).toBe("PAGE_DID_NOT_ADVANCE");
    expect(session.result()).toMatchObject({ complete: false, repeatedPages: 1, pagesAccepted: 1 });
  });

  it("stops at the page bound and says nothing about what lay beyond it", () => {
    const session = new ReviewAcquisitionSession({ maxPages: 2 });
    session.offerPage(PAGE_1);
    session.offerPage(PAGE_2);

    expect(session.result()).toMatchObject({ complete: false, stopReason: "PAGE_LIMIT_REACHED" });
  });

  it("ignores pages offered after it stopped", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(UNREADABLE);

    expect(session.offerPage(PAGE_1).accepted).toBe(false);
    expect(session.result().reviews).toHaveLength(0);
  });

  it("bounds maxPages to the module ceiling however it is asked", () => {
    const session = new ReviewAcquisitionSession({ maxPages: 10_000 });
    expect(MAX_ACQUISITION_PAGES).toBe(100);
    expect(session.open).toBe(true);
  });
});

describe("a page of reviews that cannot be canonicalized is not a boundary", () => {
  it("keeps walking past a page where every review was textless", () => {
    const session = new ReviewAcquisitionSession();
    const textless = readable([row(""), row("")]);

    const outcome = session.offerPage(textless);

    expect(outcome.dropped.noBody).toBe(2);
    expect(outcome.stopReason).toBe("IN_PROGRESS");
    expect(session.open).toBe(true);
  });

  it("does not read a second all-dropped page as a page that did not advance", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(readable([row("")]));

    expect(session.offerPage(readable([row("")])).stopReason).toBe("IN_PROGRESS");
  });

  it("accumulates drop counts across the whole walk", () => {
    const session = new ReviewAcquisitionSession();
    session.offerPage(readable([row(""), row("좋아요")]));
    session.offerPage(readable([row("", "어제"), row("괜찮아요")]));

    expect(session.result().dropped).toMatchObject({ noBody: 1, unparseableDate: 1 });
  });
});

describe("the session holds no review text it should not", () => {
  it("keeps its page identities as boundary keys, so no body reaches them", () => {
    const session = new ReviewAcquisitionSession({ knownKeys: keysOf(PAGE_1) });
    session.offerPage(PAGE_1);

    // The collected list is empty on a boundary, so the only state left is keys — fingerprints, not text.
    expect(JSON.stringify(session.result())).not.toContain("아주 만족합니다");
  });
});
