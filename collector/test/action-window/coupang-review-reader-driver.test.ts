/**
 * **The reader driver** — one read, many targets, and one ring at most.
 *
 * The property that carries the weight is why `locateAny` reads the page ONCE. A per-target read would compare
 * each target against a different reading of a page that can re-render between them, so a run could ring row 3
 * of a page it never matched. The test for that is a page object that counts its own reads.
 *
 * The other property is the log line: this is the one driver in the Coupang review path that HAS the review
 * bodies in hand, which is exactly why its log has to be counts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CoupangWingReviewReaderDriver } from "../../src/action-window/coupang-review/coupang-wing-review-reader-driver";
import { REVIEW_TARGET_ATTRIBUTE } from "../../src/action-window/coupang-review/review-row-inpage";
import { reviewBodyFingerprint } from "../../src/action-window/reply-submission/review-body-fingerprint";
import type { ReviewLocateTarget } from "../../src/action-window/coupang-review/review-locate";
import { clearLogSink, getLogSink } from "../../src/log";

const BODY_A = "배송도 빠르고 포장도 꼼꼼해서 아주 만족합니다";
const BODY_B = "생각보다 크기가 작아서 조금 아쉬웠어요";
const BUYER = "김서연";

/** One row exactly as the in-page reader returns it. */
function row(rowIndex: number, bodyText: string): Record<string, unknown> {
  return {
    rowIndex,
    dateText: "2026.08.11",
    ratingText: "5",
    ratingAria: null,
    bodyText,
    bodyTruncated: false,
    bodyExpandable: false,
    productText: "15411270785 (81234567890)",
    productNameText: "무선 이어폰",
    mediaCount: 0,
  };
}

function reading(bodies: readonly string[]): Record<string, unknown> {
  return {
    reason: "OK",
    tablesScanned: 1,
    headerWidth: 7,
    excludedColumns: 1,
    unmappedColumns: 1,
    duplicateRoles: 0,
    rolesResolved: ["date", "rating", "product", "productName", "body"],
    widthMismatchRows: 0,
    rows: bodies.map((b, i) => row(i, b)),
    pager: { found: false, resolved: false, pageNumbers: [], currentPage: null, hasNext: false, nextEnabled: false },
  };
}

function target(body: string): ReviewLocateTarget {
  return {
    productId: "15411270785",
    vendorItemId: "81234567890",
    writtenOn: "2026-08-11",
    rating: 5,
    bodyFingerprint: reviewBodyFingerprint(body),
  };
}

/** A page that counts reads and annotate calls, and can be told what the annotate returns. */
function fakePage(result: unknown, opts: { annotateReturns?: number } = {}) {
  const state = { reads: 0, annotates: 0, lastAnnotatedIndex: -1 };
  const page = {
    async waitForLoadState() {
      /* settles instantly */
    },
    async evaluate<T>(script: string): Promise<T> {
      if (script.includes(REVIEW_TARGET_ATTRIBUTE) && script.includes("setAttribute")) {
        state.annotates += 1;
        const m = /rows\[(\d+)\]/.exec(script);
        state.lastAnnotatedIndex = m ? Number(m[1]) : -1;
        return (opts.annotateReturns ?? 1) as unknown as T;
      }
      state.reads += 1;
      return result as T;
    },
  };
  return { page, state };
}

beforeEach(() => {
  clearLogSink();
});

describe("locateAny reads the page once", () => {
  it("matches every target against ONE reading, however many targets there are", async () => {
    const { page, state } = fakePage(reading([BODY_B, BODY_B, BODY_A]));
    const driver = new CoupangWingReviewReaderDriver(page as never);

    const outcome = await driver.locateAny([target("전혀 다른 후기"), target("또 다른 후기"), target(BODY_A)]);

    expect(outcome).toMatchObject({ verdict: "LOCATED", matchedRowIndex: 2, highlighted: true });
    // Three targets, one read. A read per target would compare each against a page that may have re-rendered.
    expect(state.reads).toBe(1);
    expect(state.annotates).toBe(1);
    expect(state.lastAnnotatedIndex).toBe(2);
  });

  it("rings the first target that matches uniquely and stops", async () => {
    const { page, state } = fakePage(reading([BODY_A, BODY_B]));
    const driver = new CoupangWingReviewReaderDriver(page as never);

    const outcome = await driver.locateAny([target(BODY_A), target(BODY_B)]);

    expect(outcome.matchedRowIndex).toBe(0);
    expect(state.annotates).toBe(1);
  });

  it("skips an ambiguous target and keeps trying the next one", async () => {
    // Two rows carry BODY_A — that target is a refusal. BODY_B is unique and is the one rung.
    const { page } = fakePage(reading([BODY_A, BODY_A, BODY_B]));
    const driver = new CoupangWingReviewReaderDriver(page as never);

    const outcome = await driver.locateAny([target(BODY_A), target(BODY_B)]);

    expect(outcome).toMatchObject({ verdict: "LOCATED", matchedRowIndex: 2 });
  });

  it("rings nothing when no target is on the page", async () => {
    const { page, state } = fakePage(reading([BODY_B]));
    const driver = new CoupangWingReviewReaderDriver(page as never);

    const outcome = await driver.locateAny([target(BODY_A)]);

    expect(outcome).toMatchObject({ verdict: "NOT_ON_PAGE", matchedRowIndex: null, highlighted: false });
    expect(state.annotates).toBe(0);
  });

  it("reports NOT_ON_PAGE when the row it matched is gone by the time it rings", async () => {
    const { page } = fakePage(reading([BODY_A]), { annotateReturns: 0 });
    const driver = new CoupangWingReviewReaderDriver(page as never);

    const outcome = await driver.locateAny([target(BODY_A)]);

    // The page changed between the read and the ring. That is a miss, not a silent success.
    expect(outcome).toMatchObject({ verdict: "NOT_ON_PAGE", matchedRowIndex: null, highlighted: false });
  });

  it("rings nothing on a page it could not read", async () => {
    const { page, state } = fakePage({ ...reading([BODY_A]), reason: "HEADERS_UNRESOLVED" });
    const driver = new CoupangWingReviewReaderDriver(page as never);

    expect((await driver.locateAny([target(BODY_A)])).verdict).toBe("PAGE_UNREADABLE");
    expect(state.annotates).toBe(0);
  });

  it("rings nothing when given no targets at all", async () => {
    const { page, state } = fakePage(reading([BODY_A]));
    const driver = new CoupangWingReviewReaderDriver(page as never);

    expect((await driver.locateAny([])).highlighted).toBe(false);
    expect(state.annotates).toBe(0);
  });
});

describe("a read that fails is a named reason, never an empty page", () => {
  it("turns an evaluate that throws into UNREADABLE rather than a page with no reviews on it", async () => {
    const page = {
      async waitForLoadState() {
        /* settles */
      },
      async evaluate<T>(): Promise<T> {
        throw new Error("Execution context was destroyed");
      },
    };
    const driver = new CoupangWingReviewReaderDriver(page as never);

    expect((await driver.readCurrentPage()).reason).toBe("UNREADABLE");
  });
});

describe("the log line, with the review bodies in hand", () => {
  it("records the read as counts and enums only", async () => {
    const { page } = fakePage(reading([BODY_A, BODY_B]));
    const driver = new CoupangWingReviewReaderDriver(page as never);

    await driver.readCurrentPage();

    const serialized = JSON.stringify(getLogSink());
    expect(serialized).toContain("aw_coupang_review_read");
    expect(serialized).not.toContain(BODY_A);
    expect(serialized).not.toContain("무선 이어폰");
    expect(serialized).not.toContain("15411270785");
  });

  it("records a locate as a verdict and counts", async () => {
    const { page } = fakePage(reading([BODY_A]));
    const driver = new CoupangWingReviewReaderDriver(page as never);

    await driver.locateAny([target(BODY_A)]);

    const serialized = JSON.stringify(getLogSink());
    expect(serialized).toContain("aw_coupang_review_locate");
    expect(serialized).not.toContain(BODY_A);
  });

  it("carries no buyer name even when the page returned one", async () => {
    // A hostile reading: the page hands back an author field the reader type does not have.
    const withAuthor = reading([BODY_A]);
    (withAuthor.rows as Record<string, unknown>[])[0]!.author = BUYER;
    const { page } = fakePage(withAuthor);
    const driver = new CoupangWingReviewReaderDriver(page as never);

    const result = await driver.readCurrentPage();

    expect(JSON.stringify(result)).not.toContain(BUYER);
    expect(JSON.stringify(getLogSink())).not.toContain(BUYER);
  });
});
