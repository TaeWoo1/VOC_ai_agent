/**
 * **The acquisition reader, executed** — the real generated script against a fake WING 상품평 table.
 *
 * This is the first Coupang review script that is allowed to return text, so the tests that matter are not the
 * happy path. They are:
 *
 * - **the buyer's name is in the fixture and in no output.** The author column is deliberately present, and
 *   deliberately located (`excludedColumns` counts it), so "we never read it" is a proven property rather than
 *   an unexercised one;
 * - **a moved or renamed column fails closed.** The reader addresses by Coupang's own header words, and the
 *   test for that is a table missing one of them returning nothing at all rather than a full set of rows read
 *   off the wrong columns;
 * - **a rating-only review is dropped, not merged.** The screen has no per-review identifier, so two textless
 *   5-star reviews of the same product on the same day are indistinguishable — and storing them would look
 *   exactly like dedupe working.
 */
import { describe, expect, it } from "vitest";
import { buildReviewRowReadScript } from "../../src/action-window/coupang-review/review-row-inpage";
import {
  canonicalizeReviewRows,
  localBoundaryKey,
  pagerPosition,
  parseProductIds,
  parseReviewDate,
  parseReviewRating,
  sanitizeReviewPageReading,
  type CoupangReviewPageReading,
} from "../../src/action-window/coupang-review/review-rows";
import { el, run, type El } from "./fake-dom";

/** Distinctive on purpose: a leak of any of these into any output would be unmistakable in an assertion. */
const BUYER_A = "김서연";
const BUYER_B = "박준호";
const BODY_A = "배송도 빠르고 포장도 꼼꼼해서 아주 만족합니다";
const BODY_B = "생각보다 크기가 작아서 조금 아쉬웠어요";
const PRODUCT_CELL = "15411270785 (81234567890)";

const HEADERS = ["번호", "노출상품ID (옵션ID)", "상품명", "구매자", "평점", "상품평", "등록일"];

interface RowSpec {
  no: string;
  product: string;
  productName: string;
  buyer: string;
  rating: string;
  body: string;
  date: string;
  bodyImages?: number;
  ratingAria?: string;
}

function cell(text: string, kids: El[] = []): El {
  return el({ tag: "td", text }).add(...kids);
}

function rowOf(spec: RowSpec): El {
  const media = new Array(spec.bodyImages ?? 0).fill(0).map(() => el({ tag: "img", attrs: { src: "x" } }));
  const rating = spec.ratingAria === undefined
    ? cell(spec.rating)
    : cell(spec.rating, [el({ tag: "span", attrs: { "aria-label": spec.ratingAria } })]);
  return el({ tag: "tr" }).add(
    cell(spec.no),
    cell(spec.product),
    cell(spec.productName, [el({ tag: "img", attrs: { src: "thumb.jpg" } })]),
    cell(spec.buyer),
    rating,
    cell(spec.body, media),
    cell(spec.date),
  );
}

function tableOf(headers: readonly string[], rows: readonly RowSpec[]): El {
  const head = el({ tag: "thead" }).add(
    el({ tag: "tr" }).add(...headers.map((h) => el({ tag: "th", text: h }))),
  );
  // One TBODY per review, which is what the live census found the real screen to be.
  const bodies = rows.map((r) => el({ tag: "tbody" }).add(rowOf(r)));
  return el({ tag: "table" }).add(head, ...bodies);
}

const ROW_A: RowSpec = {
  no: "1",
  product: PRODUCT_CELL,
  productName: "무선 이어폰",
  buyer: BUYER_A,
  rating: "5",
  body: BODY_A,
  date: "2026.08.11",
  bodyImages: 2,
};
const ROW_B: RowSpec = {
  no: "2",
  product: "15411270785",
  productName: "무선 이어폰",
  buyer: BUYER_B,
  rating: "3",
  body: BODY_B,
  date: "2026.08.10",
};

function readPage(root: El): CoupangReviewPageReading {
  return sanitizeReviewPageReading(run<unknown>(buildReviewRowReadScript(), root));
}

function page(headers: readonly string[], rows: readonly RowSpec[]): CoupangReviewPageReading {
  return readPage(el({ tag: "body" }).add(tableOf(headers, rows)));
}

describe("the WING 상품평 reader resolves columns by Coupang's own header words", () => {
  it("reads every role it needs, and reports the buyer column it will not read", () => {
    const reading = page(HEADERS, [ROW_A, ROW_B]);

    expect(reading.reason).toBe("OK");
    expect(reading.rows).toHaveLength(2);
    expect([...reading.rolesResolved].sort()).toEqual(["body", "date", "product", "productName", "rating"]);
    expect(reading.excludedColumns).toBe(1);
    expect(reading.unmappedColumns).toBe(1); // 번호
    expect(reading.headerWidth).toBe(7);
    expect(reading.widthMismatchRows).toBe(0);

    const first = reading.rows[0]!;
    expect(first.bodyText).toBe(BODY_A);
    expect(first.dateText).toBe("2026.08.11");
    expect(first.ratingText).toBe("5");
    expect(first.productText).toBe(PRODUCT_CELL);
    expect(first.productNameText).toBe("무선 이어폰");
  });

  it("never carries a buyer name, in any field, on any row", () => {
    const reading = page(HEADERS, [ROW_A, ROW_B]);
    const serialized = JSON.stringify(reading);

    expect(serialized).not.toContain(BUYER_A);
    expect(serialized).not.toContain(BUYER_B);
  });

  it("counts media inside the review body only — not the product thumbnail every row carries", () => {
    const reading = page(HEADERS, [ROW_A, ROW_B]);

    expect(reading.rows[0]!.mediaCount).toBe(2);
    expect(reading.rows[1]!.mediaCount).toBe(0);
  });

  it("reports a body cell that offers to show more, because the stored text is then a prefix", () => {
    const reading = page(HEADERS, [{ ...ROW_A, body: `${BODY_A} 더보기` }]);

    expect(reading.rows[0]!.bodyExpandable).toBe(true);
  });

  it("reads the rating from an aria label when the cell prints a widget", () => {
    const reading = page(HEADERS, [{ ...ROW_A, rating: "", ratingAria: "5점 만점에 4점" }]);

    expect(parseReviewRating(reading.rows[0]!.ratingText, reading.rows[0]!.ratingAria)).toBe(4);
  });
});

describe("a screen that is not the one we calibrated against yields nothing", () => {
  it("fails closed when a required header is missing, rather than reading the neighbouring column", () => {
    const withoutRating = HEADERS.filter((h) => h !== "평점");
    const reading = readPage(
      el({ tag: "body" }).add(
        el({ tag: "table" }).add(
          el({ tag: "thead" }).add(el({ tag: "tr" }).add(...withoutRating.map((h) => el({ tag: "th", text: h })))),
          el({ tag: "tbody" }).add(
            el({ tag: "tr" }).add(...withoutRating.map(() => el({ tag: "td", text: "x" }))),
          ),
        ),
      ),
    );

    expect(reading.reason).toBe("HEADERS_UNRESOLVED");
    expect(reading.rows).toHaveLength(0);
    expect(canonicalizeReviewRows(reading).reviews).toHaveLength(0);
  });

  it("fails closed when two tables both claim to be the review list", () => {
    const root = el({ tag: "body" }).add(tableOf(HEADERS, [ROW_A]), tableOf(HEADERS, [ROW_B]));

    expect(readPage(root).reason).toBe("AMBIGUOUS_TABLE");
  });

  it("fails closed on a row whose width disagrees with the header", () => {
    const table = tableOf(HEADERS, [ROW_A]);
    table.add(el({ tag: "tbody" }).add(el({ tag: "tr" }).add(el({ tag: "td", text: "합계" }))));
    const reading = readPage(el({ tag: "body" }).add(table));

    expect(reading.reason).toBe("ROW_WIDTH_MISMATCH");
    expect(reading.widthMismatchRows).toBe(1);
    // The rows it DID read are discarded: half a review list is indistinguishable from a whole one.
    expect(canonicalizeReviewRows(reading).reviews).toHaveLength(0);
  });

  it("treats a page with no table at all as unreadable, not as a page with no reviews", () => {
    const reading = readPage(el({ tag: "body" }).add(el({ tag: "div", text: "조회 결과가 없습니다" })));

    expect(reading.reason).toBe("HEADERS_UNRESOLVED");
  });

  it("sanitizes a null or malformed evaluate result into UNREADABLE with no rows", () => {
    for (const raw of [null, undefined, 42, "rows", { reason: "TOTALLY_FINE", rows: [{ bodyText: BODY_A }] }]) {
      const reading = sanitizeReviewPageReading(raw);
      expect(reading.reason).toBe("UNREADABLE");
      expect(canonicalizeReviewRows(reading).reviews).toHaveLength(0);
    }
  });
});

describe("canonicalization decides what a cell means, once, offline", () => {
  it("turns a reading into stored reviews with ids, date, rating and a body fingerprint", () => {
    const { reviews, dropped } = canonicalizeReviewRows(page(HEADERS, [ROW_A, ROW_B]));

    expect(dropped).toEqual({ unparseableDate: 0, unreadableRating: 0, noProductId: 0, noBody: 0 });
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      writtenOn: "2026-08-11",
      rating: 5,
      body: BODY_A,
      productId: "15411270785",
      vendorItemId: "81234567890",
      productName: "무선 이어폰",
      mediaCount: 2,
    });
    expect(reviews[0]!.bodyFingerprint).toMatch(/^[0-9a-f]{64}$/);
    // The second row's cell prints no option id — that stays null rather than borrowing the first row's.
    expect(reviews[1]!.vendorItemId).toBeNull();
  });

  it("drops a rating-only review instead of merging it with the next one", () => {
    const textless = { ...ROW_A, body: "" };
    const { reviews, dropped } = canonicalizeReviewRows(page(HEADERS, [textless, { ...textless, no: "2" }]));

    expect(reviews).toHaveLength(0);
    expect(dropped.noBody).toBe(2);
  });

  it("drops a row whose date, rating or product id it cannot read, and counts which", () => {
    const { reviews, dropped } = canonicalizeReviewRows(
      page(HEADERS, [
        { ...ROW_A, date: "어제" },
        { ...ROW_A, rating: "", ratingAria: undefined },
        { ...ROW_A, product: "-" },
        ROW_B,
      ]),
    );

    expect(dropped).toEqual({ unparseableDate: 1, unreadableRating: 1, noProductId: 1, noBody: 0 });
    expect(reviews).toHaveLength(1);
  });

  it("keeps two reviews that differ only in what the buyer wrote", () => {
    const twin = { ...ROW_B, no: "3", body: "완전히 다른 내용입니다", date: ROW_B.date, rating: ROW_B.rating };
    const { reviews } = canonicalizeReviewRows(page(HEADERS, [ROW_B, twin]));

    expect(reviews).toHaveLength(2);
    expect(localBoundaryKey(reviews[0]!)).not.toBe(localBoundaryKey(reviews[1]!));
  });

  it("gives one review the same boundary key every time it is read", () => {
    const first = canonicalizeReviewRows(page(HEADERS, [ROW_A])).reviews[0]!;
    const second = canonicalizeReviewRows(page(HEADERS, [ROW_A])).reviews[0]!;

    expect(localBoundaryKey(first)).toBe(localBoundaryKey(second));
  });

  it("carries no buyer name into a stored review", () => {
    const serialized = JSON.stringify(canonicalizeReviewRows(page(HEADERS, [ROW_A, ROW_B])));

    expect(serialized).not.toContain(BUYER_A);
    expect(serialized).not.toContain(BUYER_B);
  });
});

describe("the pager census, executed", () => {
  /** `<div class=paging><a>1</a><span class=active>2</span><a>3</a><a>다음</a></div>` and variants. */
  function pager(opts: {
    numbers: readonly number[];
    current: number | null;
    currentMarker?: "aria" | "class" | "not-a-link";
    next?: "enabled" | "disabled" | "none";
  }): El {
    const box = el({ tag: "div", attrs: { class: "paging" } });
    for (const n of opts.numbers) {
      const isCurrent = n === opts.current;
      if (isCurrent && opts.currentMarker === "aria") {
        box.add(el({ tag: "a", text: String(n), attrs: { href: "#", "aria-current": "page" } }));
      } else if (isCurrent && opts.currentMarker === "class") {
        box.add(el({ tag: "a", text: String(n), attrs: { href: "#", class: "page active" } }));
      } else if (isCurrent) {
        box.add(el({ tag: "span", text: String(n) }));
      } else {
        box.add(el({ tag: "a", text: String(n), attrs: { href: "#" } }));
      }
    }
    if (opts.next === "enabled") box.add(el({ tag: "a", text: "다음", attrs: { href: "#" } }));
    if (opts.next === "disabled") box.add(el({ tag: "a", text: "다음", attrs: { class: "disabled" } }));
    return box;
  }

  function readWith(pagerEl: El | null): CoupangReviewPageReading {
    const root = el({ tag: "body" }).add(tableOf(HEADERS, [ROW_A]));
    if (pagerEl) root.add(pagerEl);
    return readPage(root);
  }

  it("reads the page numbers and which one is being shown, from a non-link current page", () => {
    const reading = readWith(pager({ numbers: [1, 2, 3, 4, 5], current: 2, next: "enabled" }));

    expect(reading.pager).toMatchObject({
      found: true,
      resolved: true,
      pageNumbers: [1, 2, 3, 4, 5],
      currentPage: 2,
      hasNext: true,
      nextEnabled: true,
    });
  });

  it("prefers aria-current over every other signal", () => {
    const reading = readWith(
      pager({ numbers: [1, 2, 3], current: 3, currentMarker: "aria", next: "enabled" }),
    );

    expect(reading.pager.currentPage).toBe(3);
  });

  it("falls back to an active/current/selected class", () => {
    const reading = readWith(pager({ numbers: [1, 2, 3], current: 2, currentMarker: "class", next: "enabled" }));

    expect(reading.pager.currentPage).toBe(2);
  });

  it("reports a disabled next control as not pressable", () => {
    const reading = readWith(pager({ numbers: [1, 2, 3], current: 3, next: "disabled" }));

    expect(reading.pager).toMatchObject({ hasNext: true, nextEnabled: false });
    expect(pagerPosition(reading.pager)).toBe("FINAL_PAGE");
  });

  it("reports a screen with no pager and nothing to press as a one-page list", () => {
    const reading = readWith(null);

    expect(reading.pager).toMatchObject({ found: false, hasNext: false });
    expect(pagerPosition(reading.pager)).toBe("FINAL_PAGE");
  });

  it("refuses to resolve a pager whose current page cannot be told apart", () => {
    // Every number is a link and none is marked — nothing says which page is showing.
    const box = el({ tag: "div" }).add(
      el({ tag: "a", text: "1", attrs: { href: "#" } }),
      el({ tag: "a", text: "2", attrs: { href: "#" } }),
      el({ tag: "a", text: "3", attrs: { href: "#" } }),
    );
    const reading = readWith(box);

    expect(reading.pager).toMatchObject({ found: true, resolved: false, currentPage: null });
    expect(pagerPosition(reading.pager)).toBe("UNKNOWN");
  });

  it("does not mistake a single number on the page for a pager", () => {
    const reading = readWith(el({ tag: "div" }).add(el({ tag: "span", text: "7" })));

    expect(reading.pager.found).toBe(false);
  });

  it("says WHY it did not resolve, in counts — the first live sitting could only say that it had not", () => {
    // A cluster of page numbers where none is marked as current: three signals, none firing uniquely.
    const box = el({ tag: "div" }).add(
      el({ tag: "a", text: "1", attrs: { href: "#" } }),
      el({ tag: "a", text: "2", attrs: { href: "#" } }),
      el({ tag: "a", text: "3", attrs: { href: "#" } }),
    );
    const reading = readWith(box);

    expect(reading.pager.resolved).toBe(false);
    // "one cluster, three numbers, and no signal marked any of them" — three different fixes, and without
    // these counts all three arrive as the same silence.
    expect(reading.pager.clustersFound).toBe(1);
    expect(reading.pager.clusterSize).toBe(3);
    expect(reading.pager.ariaCurrentMarks).toBe(0);
    expect(reading.pager.classMarks).toBe(0);
    expect(reading.pager.nonLinkMarks).toBe(0);
  });

  it("counts a signal that fired on TWO cells, which is a different problem from one that never fired", () => {
    const box = el({ tag: "div" }).add(
      el({ tag: "span", text: "1" }),
      el({ tag: "span", text: "2" }),
      el({ tag: "a", text: "3", attrs: { href: "#" } }),
    );
    const reading = readWith(box);

    expect(reading.pager.resolved).toBe(false);
    expect(reading.pager.nonLinkMarks).toBe(2);
  });

  it("counts the review rows it discarded as pager candidates, rather than discarding them silently", () => {
    // Every review row prints 1 in 번호 and 5 in 평점 — two numeric children, and not a pager.
    const reading = readWith(null);

    expect(reading.pager.clustersOfCells).toBeGreaterThan(0);
    expect(reading.pager.clustersFound).toBe(0);
  });

  it("no longer excludes a pager just because it sits inside a table", () => {
    // The first rule excluded anything under a <table>, which would also have discarded a pager rendered in
    // the list's own tfoot — a real layout whose exclusion is invisible.
    const table = tableOf(HEADERS, [ROW_A]);
    table.add(
      el({ tag: "tfoot" }).add(
        el({ tag: "tr" }).add(
          el({ tag: "td" }).add(
            pager({ numbers: [1, 2, 3], current: 2, next: "enabled" }),
          ),
        ),
      ),
    );
    const reading = readPage(el({ tag: "body" }).add(table));

    expect(reading.pager).toMatchObject({ found: true, resolved: true, currentPage: 2 });
  });

  it("reads aria-selected as well as aria-current", () => {
    const box = el({ tag: "div" }).add(
      el({ tag: "a", text: "1", attrs: { href: "#" } }),
      el({ tag: "a", text: "2", attrs: { href: "#", "aria-selected": "true" } }),
      el({ tag: "a", text: "3", attrs: { href: "#" } }),
    );

    expect(readWith(box).pager.currentPage).toBe(2);
  });

  /**
   * **The real WING pager, as three live readings measured it.** Each page is a class-less `<span>` wrapping
   * an `<a>`, and the current-page marker is on the INNER element. Three sittings reported `SPAN-a--` and
   * `marks=0/0/0` because every signal looked only at the outer cell.
   */
  function wrappedPager(current: number, marker: "class" | "aria"): El {
    const box = el({ tag: "div" });
    for (const n of [1, 2, 3]) {
      const attrs: Record<string, string> =
        n === current
          ? marker === "class"
            ? { href: "#", class: "on" }
            : { href: "#", "aria-current": "page" }
          : { href: "#" };
      box.add(el({ tag: "span" }).add(el({ tag: "a", text: String(n), attrs })));
    }
    return box;
  }

  it("finds the current page when the marker is on the link INSIDE the cell", () => {
    const reading = readWith(wrappedPager(2, "class"));

    expect(reading.pager).toMatchObject({ found: true, resolved: true, currentPage: 2, pageNumbers: [1, 2, 3] });
    expect(pagerPosition(reading.pager)).toBe("MORE_PAGES");
  });

  it("reads an inner aria-current the same way", () => {
    expect(readWith(wrappedPager(3, "aria")).pager.currentPage).toBe(3);
  });

  it("calls the last numbered page final when the pager offers no next control at all", () => {
    // The live screen's pager is numbers only — three pages, no 다음. On page 3 that IS the end.
    const reading = readWith(wrappedPager(3, "class"));

    expect(reading.pager.hasNext).toBe(false);
    expect(pagerPosition(reading.pager)).toBe("FINAL_PAGE");
  });

  it("does not mark every cell just because the class contains the letters of a marker", () => {
    // `pagination-link` contains "on"; a substring rule marks all three and identifies none.
    const box = el({ tag: "div" });
    for (const n of [1, 2, 3]) {
      box.add(
        el({ tag: "span" }).add(
          el({ tag: "a", text: String(n), attrs: { href: "#", class: n === 2 ? "pagination-link on" : "pagination-link" } }),
        ),
      );
    }

    expect(readWith(box).pager.currentPage).toBe(2);
  });

  /**
   * **The real WING pager, copied from the screen.** Five readings failed against it, and every one failed
   * for a reason this fixture now holds: the current-page marker is the token `active` inside
   * `data-wuic-attrs` (not a class, not aria), the prev/next controls are empty `<a>`s whose glyph is drawn
   * in CSS and whose identity is `data-wuic-partial`, and `disabled` is a token in the same attribute.
   *
   *   <span data-wuic-partial="prev" data-wuic-attrs="disabled"><a href="#"></a></span>
   *   <span data-wuic-attrs="page:1 active"><a href="#">1</a></span>
   *   <span data-wuic-attrs="page:2"><a href="#">2</a></span>
   *   <span data-wuic-partial="next" data-wuic-attrs=""><a href="#"></a></span>
   */
  function wuicPager(current: number, last: number): El {
    const box = el({ tag: "div" });
    box.add(
      el({ tag: "span", attrs: { "data-wuic-partial": "prev", "data-wuic-attrs": current === 1 ? "disabled" : "" } })
        .add(el({ tag: "a", attrs: { href: "#" } })),
    );
    for (let n = 1; n <= last; n += 1) {
      box.add(
        el({ tag: "span", attrs: { "data-wuic-attrs": n === current ? `page:${n} active` : `page:${n}` } })
          .add(el({ tag: "a", text: String(n), attrs: { href: "#" } })),
      );
    }
    box.add(
      el({ tag: "span", attrs: { "data-wuic-partial": "next", "data-wuic-attrs": current === last ? "disabled" : "" } })
        .add(el({ tag: "a", attrs: { href: "#" } })),
    );
    return box;
  }

  it("resolves the real WING pager: the marker is a token in data-wuic-attrs, not a class", () => {
    const reading = readWith(wuicPager(1, 3));

    expect(reading.pager).toMatchObject({
      found: true,
      resolved: true,
      currentPage: 1,
      pageNumbers: [1, 2, 3],
      hasNext: true,
      nextEnabled: true,
    });
    expect(pagerPosition(reading.pager)).toBe("MORE_PAGES");
  });

  it("finds the next control by its role attribute, though its link has no text at all", () => {
    // The glyph is CSS. Every rule that looked for the word 다음 or a > character found nothing on a screen
    // that plainly shows < 1 2 3 >.
    const reading = readWith(wuicPager(2, 3));

    expect(reading.pager.hasNext).toBe(true);
    expect(reading.pager.currentPage).toBe(2);
    expect(pagerPosition(reading.pager)).toBe("MORE_PAGES");
  });

  it("calls the last page final, because next carries the disabled token there", () => {
    const reading = readWith(wuicPager(3, 3));

    expect(reading.pager).toMatchObject({ currentPage: 3, hasNext: true, nextEnabled: false });
    expect(pagerPosition(reading.pager)).toBe("FINAL_PAGE");
  });

  it("does not read page:1 as the marker — only the active token is one", () => {
    // Every cell carries a `page:N` token; a looser rule would mark all of them and identify none.
    const reading = readWith(wuicPager(2, 3));

    expect(reading.pager.classMarks).toBe(1);
  });

  it("reports the region's skeleton as tags and attribute NAMES, and no value among them", () => {
    const box = el({ tag: "div", attrs: { class: "paging" } }).add(
      el({ tag: "span" }).add(el({ tag: "a", text: "1", attrs: { href: "/reviews?page=1", "data-page": "1" } })),
      el({ tag: "span" }).add(el({ tag: "a", text: "2", attrs: { href: "/reviews?page=2", "data-page": "2" } })),
    );
    const reading = readWith(box);
    const skeleton = reading.pager.regionSkeleton.join(" ");

    // Names, not values: the attribute that distinguishes a current page from a link to one is a NAME.
    expect(skeleton).toContain("data-page");
    expect(skeleton).toContain("href");
    expect(skeleton).not.toContain("/reviews?page=");
    expect(skeleton).not.toContain("paging");
  });

  it("reports the shape of each numeric child, so a refusal can be designed against", () => {
    const reading = readWith(pager({ numbers: [1, 2, 3], current: 2, next: "enabled" }));

    // TAG + class-present + is-link + aria-present + disabled, one token per numeric child.
    expect(reading.pager.childShapes).toHaveLength(3);
    expect(reading.pager.childShapes[0]).toMatch(/^A/);
    expect(reading.pager.childShapes[1]).toContain("SPAN");
  });

  it("reports the short control words beside the numbers, and no number among them", () => {
    const reading = readWith(pager({ numbers: [1, 2, 3], current: 2, next: "enabled" }));

    const labels = reading.pager.regionLabels.map((l) => l.split("|")[0]);
    expect(labels).toContain("다음");
    // Pure numbers are the page numbers themselves and are excluded — the labels are the vocabulary.
    expect(labels.every((l) => !/^[0-9]+$/.test(l!))).toBe(true);
  });

  it("keeps a long string out of the labels, so the region cannot carry review text", () => {
    const box = pager({ numbers: [1, 2], current: 1, next: "enabled" });
    box.add(el({ tag: "span", text: "배송도 빠르고 포장도 꼼꼼해서 아주 만족합니다" }));
    const reading = readWith(box);

    expect(reading.pager.regionLabels.join(",")).not.toContain("배송도");
  });

  it("is read even when the table could not be", () => {
    const withoutRating = HEADERS.filter((h) => h !== "평점");
    const root = el({ tag: "body" }).add(
      el({ tag: "table" }).add(
        el({ tag: "thead" }).add(el({ tag: "tr" }).add(...withoutRating.map((h) => el({ tag: "th", text: h })))),
      ),
      pager({ numbers: [1, 2], current: 1, next: "enabled" }),
    );
    const reading = readPage(root);

    // A resolved pager over an unreadable table is a different diagnosis from "this is not the list screen".
    expect(reading.reason).toBe("HEADERS_UNRESOLVED");
    expect(reading.pager.resolved).toBe(true);
  });
});

describe("the cell parsers", () => {
  it("reads a date only when the cell actually prints one", () => {
    expect(parseReviewDate("2026.08.11")).toBe("2026-08-11");
    expect(parseReviewDate("2026-8-1")).toBe("2026-08-01");
    expect(parseReviewDate("2026/08/11 14:03")).toBe("2026-08-11");
    expect(parseReviewDate("오늘")).toBeNull();
    expect(parseReviewDate("2026.13.11")).toBeNull();
    expect(parseReviewDate(null)).toBeNull();
  });

  it("takes the score, not the scale, and floors a half star", () => {
    expect(parseReviewRating("5", null)).toBe(5);
    expect(parseReviewRating(null, "5점 만점에 4점")).toBe(4);
    expect(parseReviewRating("4.5", null)).toBe(4);
    expect(parseReviewRating("", null)).toBeNull();
    expect(parseReviewRating("0", null)).toBeNull();
  });

  it("splits the catalog cell by position, never by magnitude", () => {
    expect(parseProductIds("15411270785 (81234567890)")).toEqual({
      productId: "15411270785",
      vendorItemId: "81234567890",
    });
    expect(parseProductIds("15411270785")).toEqual({ productId: "15411270785", vendorItemId: null });
    expect(parseProductIds("(81234567890)")).toEqual({ productId: null, vendorItemId: "81234567890" });
    expect(parseProductIds("-")).toEqual({ productId: null, vendorItemId: null });
  });
});
