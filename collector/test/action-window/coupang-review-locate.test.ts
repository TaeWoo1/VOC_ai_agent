/**
 * **Locate.** The property under test is not "it finds the review" — it is **what it does when it is not sure**.
 *
 * A wrong ring is worse than no ring: the seller reads a highlighted row as SellerOps telling them which review
 * they are looking at. So zero matches and two matches are both refusals, a target missing any field refuses
 * before it looks at the page at all, and the buyer's name — which is on the screen and would make matching
 * easier — is never part of the comparison.
 */
import { describe, expect, it } from "vitest";
import {
  buildReviewRowAnnotateScript,
  REVIEW_TARGET_ATTRIBUTE,
  REVIEW_TARGET_TEARDOWN,
} from "../../src/action-window/coupang-review/review-row-inpage";
import { locateReviewOnPage, type ReviewLocateTarget } from "../../src/action-window/coupang-review/review-locate";
import { reviewBodyFingerprint } from "../../src/action-window/reply-submission/review-body-fingerprint";
import {
  canonicalizeReviewRows,
  type CoupangReviewPageReading,
  type CoupangReviewRowReading,
} from "../../src/action-window/coupang-review/review-rows";
import { el, run, type El } from "./fake-dom";

const BODY_A = "배송도 빠르고 포장도 꼼꼼해서 아주 만족합니다";
const BODY_B = "생각보다 크기가 작아서 조금 아쉬웠어요";

function row(over: Partial<CoupangReviewRowReading> = {}): CoupangReviewRowReading {
  return {
    rowIndex: 0,
    dateText: "2026.08.11",
    ratingText: "5",
    ratingAria: null,
    bodyText: BODY_A,
    bodyTruncated: false,
    bodyExpandable: false,
    productText: "15411270785 (81234567890)",
    productNameText: "무선 이어폰",
    mediaCount: 0,
    ...over,
  };
}

function reading(rows: readonly CoupangReviewRowReading[]): CoupangReviewPageReading {
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

const TARGET: ReviewLocateTarget = {
  productId: "15411270785",
  vendorItemId: "81234567890",
  writtenOn: "2026-08-11",
  rating: 5,
  bodyFingerprint: reviewBodyFingerprint(BODY_A),
};

describe("locate rings exactly one row", () => {
  it("finds the review among rows that differ in one field each", () => {
    const page = reading([
      row({ rowIndex: 0, bodyText: BODY_B }),
      row({ rowIndex: 1 }),
      row({ rowIndex: 2, ratingText: "3" }),
      row({ rowIndex: 3, dateText: "2026.08.10" }),
      row({ rowIndex: 4, productText: "99999999 (81234567890)" }),
    ]);

    expect(locateReviewOnPage(page, TARGET)).toMatchObject({
      verdict: "LOCATED",
      matchedRowIndex: 1,
      matches: 1,
    });
  });

  it("matches a row whose cell prints no option id, rather than refusing it", () => {
    const page = reading([row({ rowIndex: 0, productText: "15411270785" })]);

    expect(locateReviewOnPage(page, TARGET).verdict).toBe("LOCATED");
  });

  it("separates two options of the same product reviewed identically on the same day", () => {
    const page = reading([
      row({ rowIndex: 0, productText: "15411270785 (70000000000)" }),
      row({ rowIndex: 1, productText: "15411270785 (81234567890)" }),
    ]);

    expect(locateReviewOnPage(page, TARGET)).toMatchObject({ verdict: "LOCATED", matchedRowIndex: 1 });
  });
});

describe("locate refuses rather than guesses", () => {
  it("refuses when the review is not on this page", () => {
    const page = reading([row({ rowIndex: 0, bodyText: BODY_B })]);

    expect(locateReviewOnPage(page, TARGET)).toMatchObject({
      verdict: "NOT_ON_PAGE",
      matchedRowIndex: null,
      matches: 0,
    });
  });

  it("refuses when two rows are indistinguishable — the case this screen actually produces", () => {
    const page = reading([row({ rowIndex: 0 }), row({ rowIndex: 1 })]);

    expect(locateReviewOnPage(page, TARGET)).toMatchObject({
      verdict: "AMBIGUOUS",
      matchedRowIndex: null,
      matches: 2,
    });
  });

  it("refuses a page it could not read, without looking for a row in it", () => {
    const unreadable: CoupangReviewPageReading = { ...reading([row()]), reason: "HEADERS_UNRESOLVED" };

    expect(locateReviewOnPage(unreadable, TARGET).verdict).toBe("PAGE_UNREADABLE");
  });

  it("refuses a malformed target before it compares anything", () => {
    const cases: ReviewLocateTarget[] = [
      { ...TARGET, productId: "" },
      { ...TARGET, writtenOn: "2026/08/11" },
      { ...TARGET, rating: 0 },
      { ...TARGET, rating: 4.5 },
      { ...TARGET, bodyFingerprint: "" },
      { ...TARGET, bodyFingerprint: "not-a-fingerprint" },
    ];

    for (const target of cases) {
      expect(locateReviewOnPage(reading([row()]), target)).toMatchObject({
        verdict: "INVALID_TARGET",
        matchedRowIndex: null,
      });
    }
  });

  it("does not let an empty target match every row", () => {
    const empty = { productId: "", vendorItemId: null, writtenOn: "", rating: 0, bodyFingerprint: "" };

    expect(locateReviewOnPage(reading([row(), row({ rowIndex: 1 })]), empty).matches).toBe(0);
  });

  it("carries no review text or buyer field in its outcome", () => {
    const outcome = locateReviewOnPage(reading([row()]), TARGET);

    expect(Object.keys(outcome).sort()).toEqual(["matchedRowIndex", "matches", "rowsConsidered", "verdict"]);
  });
});

describe("the highlight is inert, and lands on the row locate chose", () => {
  const HEADERS = ["번호", "노출상품ID (옵션ID)", "상품명", "구매자", "평점", "상품평", "등록일"];

  function table(bodies: readonly string[]): El {
    const head = el({ tag: "thead" }).add(
      el({ tag: "tr" }).add(...HEADERS.map((h) => el({ tag: "th", text: h }))),
    );
    const rows = bodies.map((body) =>
      el({ tag: "tbody" }).add(
        el({ tag: "tr" }).add(
          el({ tag: "td", text: "1" }),
          el({ tag: "td", text: "15411270785 (81234567890)" }),
          el({ tag: "td", text: "무선 이어폰" }),
          el({ tag: "td", text: "김서연" }),
          el({ tag: "td", text: "5" }),
          el({ tag: "td", text: body }),
          el({ tag: "td", text: "2026.08.11" }),
        ),
      ),
    );
    return el({ tag: "table" }).add(head, ...rows);
  }

  it("marks the matched row and no other", () => {
    const root = el({ tag: "body" }).add(table([BODY_B, BODY_A, BODY_B]));

    expect(run<number>(buildReviewRowAnnotateScript(1), root)).toBe(1);

    const marked = root.descendants().filter((e) => e.hasAttribute(REVIEW_TARGET_ATTRIBUTE));
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain(BODY_A);
  });

  it("marks nothing when the row it was told to mark is gone", () => {
    const root = el({ tag: "body" }).add(table([BODY_A]));

    expect(run<number>(buildReviewRowAnnotateScript(7), root)).toBe(0);
    expect(root.descendants().some((e) => e.hasAttribute(REVIEW_TARGET_ATTRIBUTE))).toBe(false);
  });

  it("marks nothing on a page whose headers no longer resolve", () => {
    const withoutRating = HEADERS.filter((h) => h !== "평점");
    const root = el({ tag: "body" }).add(
      el({ tag: "table" }).add(
        el({ tag: "thead" }).add(el({ tag: "tr" }).add(...withoutRating.map((h) => el({ tag: "th", text: h })))),
        el({ tag: "tbody" }).add(el({ tag: "tr" }).add(...withoutRating.map(() => el({ tag: "td", text: "x" })))),
      ),
    );

    expect(run<number>(buildReviewRowAnnotateScript(0), root)).toBe(0);
  });

  it("refuses a negative or non-integer row index", () => {
    const root = el({ tag: "body" }).add(table([BODY_A]));

    expect(run<number>(buildReviewRowAnnotateScript(-1), root)).toBe(0);
    expect(run<number>(buildReviewRowAnnotateScript(0.5), root)).toBe(0);
  });

  it("takes the ring back off, and is safe on a page that never had one", () => {
    const root = el({ tag: "body" }).add(table([BODY_A]));
    run<number>(buildReviewRowAnnotateScript(0), root);

    expect(run<number>(REVIEW_TARGET_TEARDOWN, root)).toBe(1);
    expect(root.descendants().some((e) => e.hasAttribute(REVIEW_TARGET_ATTRIBUTE))).toBe(false);
    expect(run<number>(REVIEW_TARGET_TEARDOWN, root)).toBe(0);
  });

  it("never clicks, focuses, submits or navigates", () => {
    const source = buildReviewRowAnnotateScript(0) + REVIEW_TARGET_TEARDOWN;
    for (const forbidden of [".click(", ".focus(", ".submit(", "location.", "dispatchEvent", "requestSubmit"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("locates and highlights the same row the reading produced", () => {
    const root = el({ tag: "body" }).add(table([BODY_B, BODY_A]));
    // Round-trip: read → canonicalize → locate → annotate, with nothing hand-fed between the steps.
    const readingOfPage = reading([
      row({ rowIndex: 0, bodyText: BODY_B }),
      row({ rowIndex: 1, bodyText: BODY_A }),
    ]);
    const outcome = locateReviewOnPage(readingOfPage, TARGET);

    expect(canonicalizeReviewRows(readingOfPage).reviews).toHaveLength(2);
    expect(run<number>(buildReviewRowAnnotateScript(outcome.matchedRowIndex!), root)).toBe(1);
    expect(
      root.descendants().find((e) => e.hasAttribute(REVIEW_TARGET_ATTRIBUTE))!.textContent,
    ).toContain(BODY_A);
  });
});
