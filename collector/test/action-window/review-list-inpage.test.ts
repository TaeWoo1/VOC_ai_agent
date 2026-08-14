/**
 * **The 상품평 acquisition-feasibility discovery, executed.** These run the REAL generated script — the same
 * string the driver evaluates in the page — against a fake DOM.
 *
 * Three properties carry the most weight here.
 *
 * **The identifier answer is the product of the run, and it has three states.** A number every review carries
 * but whose value is the same on all of them is a category code, not a dedupe key — collecting on it would fold
 * the whole screen into one row, and the fold would look exactly like de-duplication working. And refusing to
 * say "no identifier" from a reading that never found the rows is what keeps this probe from producing the
 * confident zero three 고객문의 sittings were spent on.
 *
 * **Nothing a customer wrote can leave the page.** A fixture full of distinctive review text, buyer names and
 * media sources yields a census containing none of it.
 *
 * **The row tag is never assumed.** The fixture is a `div` grid with no table, no list and no row role, and
 * the field words appear only in the HEADER — which is where a probe that stopped at the first agreeing level
 * would resolve the unit to a header cell and then ask whether it contained a photo.
 *
 * There is no reply-control test, and that is deliberate. The operator confirmed WING gives sellers no way to
 * answer a 상품평, so the probe does not look for one — a measurement kept "for later" after being told not to
 * use it is a measurement that quietly gets used.
 */
import { describe, expect, it } from "vitest";
import { buildReviewListCensusScript } from "../../src/action-window/api-issuance-calibration/review-list-inpage";
import {
  WING_REVIEW_CLASS_TOKENS,
  WING_REVIEW_CONTROL_LABELS,
  WING_REVIEW_FIELD_LABELS,
  WING_REVIEW_TEXT_SHAPES,
} from "../../src/action-window/coupang-wing-review-driver";
import {
  classifyAcquisitionFeasibility,
  classifyOwnershipScope,
  sanitizeReviewListCensus,
  type ReviewDigitExpectation,
  type ReviewListCensus,
} from "../../src/action-window/coupang-wing-review-list";
import { el, run, type El } from "./fake-dom";

/* ───────────────────────────── the fixtures ───────────────────────────── */

/** Review text and buyer names, deliberately distinctive so a leak would be unmistakable in an assertion. */
const REVIEW_BODY_A = "배송도 빠르고 포장도 꼼꼼해서 아주 만족합니다";
const REVIEW_BODY_B = "생각보다 크기가 작아서 조금 아쉬웠어요";
const REVIEW_BODY_C = "무난합니다";
const BUYER_A = "김서연";
const BUYER_B = "박준호";
const BUYER_C = "이도윤";
const REVIEW_DATE = "2026.08.11";
const PRODUCT = "15411270785";
const IMAGE_SRC = "https://image.coupangcdn.com/reviews/secret-path.jpg";

const PRODUCT_IDS: ReviewDigitExpectation[] = [{ id: "productId", digits: PRODUCT }];

function script(digits: ReviewDigitExpectation[] = []): string {
  return buildReviewListCensusScript(
    WING_REVIEW_FIELD_LABELS,
    WING_REVIEW_CONTROL_LABELS,
    WING_REVIEW_TEXT_SHAPES,
    digits,
    WING_REVIEW_CLASS_TOKENS,
  );
}

function census(root: El, digits: ReviewDigitExpectation[] = []): ReviewListCensus {
  return sanitizeReviewListCensus(
    run(script(digits), root),
    WING_REVIEW_FIELD_LABELS,
    WING_REVIEW_CONTROL_LABELS,
    WING_REVIEW_TEXT_SHAPES,
  );
}

interface RowOptions {
  /**
   * The review's own id, in a detail link.
   *  - `unique` — a different 9-digit id per row. A dedupe key.
   *  - `shared` — the SAME id on every row. Present on each review and useless as a key, which is the case
   *    a presence-only reading would score identically to `unique`.
   *  - `none`   — no link at all.
   */
  id?: "unique" | "shared" | "none";
  /** Whether this row carries a link to a product id SellerOps already holds. */
  productLink?: boolean;
}

const SHARED_ID = "981234567";

function reviewRow(index: number, body: string, buyer: string, opts: RowOptions = {}): El {
  const cells: El[] = [
    // The rating, rendered the way a real one is: a class-tokened strip that also exposes an accessible value.
    el({ tag: "span", attrs: { class: "star-rating on", "aria-valuenow": "5" } }),
    el({ tag: "span", text: REVIEW_DATE }),
    el({ tag: "span", text: body }),
    el({ tag: "span", text: buyer }),
    el({ tag: "img", attrs: { src: IMAGE_SRC } }),
  ];
  if (opts.id === "unique") {
    cells.push(el({ tag: "a", attrs: { href: `/reviews/98123456${index}` }, text: "상세" }));
  } else if (opts.id === "shared") {
    cells.push(el({ tag: "a", attrs: { href: `/reviews/${SHARED_ID}` }, text: "상세" }));
  }
  if (opts.productLink) {
    cells.push(el({ tag: "a", attrs: { href: `/vendor-items/${PRODUCT}` }, text: "상품 보기" }));
  }
  return el({ tag: "div", attrs: { class: "rv-row" } }).add(...cells);
}

/** A WING-shaped 상품평 grid: a header row of field words, then review rows that repeat its shape. */
function reviewGrid(opts: RowOptions = { id: "unique" }): El {
  const header = el({ tag: "div", attrs: { class: "rv-row rv-hdr" } }).add(
    el({ tag: "span", text: "평점" }),
    el({ tag: "span", text: "작성일" }),
    el({ tag: "span", text: "상품평" }),
    el({ tag: "span", text: "구매자" }),
    el({ tag: "span", text: "상품명" }),
  );
  // Only the FIRST row links a product id we hold — so the catalog-scope reading has to count units, not rows.
  const rest: RowOptions = { ...opts, productLink: false };
  const grid = el({ tag: "div", attrs: { class: "rv-grid" } }).add(
    header,
    reviewRow(1, REVIEW_BODY_A, BUYER_A, opts),
    reviewRow(2, REVIEW_BODY_B, BUYER_B, rest),
    reviewRow(3, REVIEW_BODY_C, BUYER_C, rest),
  );
  return el({ tag: "body" }).add(el({ tag: "nav" }).add(el({ tag: "a", attrs: { href: "/wing" }, text: "홈" })), grid);
}

/** The paging and range furniture, as a seller centre renders it. */
function withControls(root: El): El {
  return root.add(
    el({ tag: "div", attrs: { class: "filters" } }).add(
      el({ tag: "input", attrs: { type: "date" } }),
      el({ tag: "input", attrs: { type: "date" } }),
      el({ tag: "select" }),
      // A pressable range, and a printed caption of the same family. The split has to keep them apart.
      el({ tag: "button" }).add(el({ tag: "span", text: "3개월" })),
      el({ tag: "span", text: "조회기간" }),
    ),
    el({ tag: "div", attrs: { class: "pager" } }).add(
      el({ tag: "span", text: "1" }),
      el({ tag: "span", text: "2" }),
      el({ tag: "span", text: "7" }),
    ),
  );
}

/* ───────────────────────────── the identifier question ───────────────────────────── */

describe("the question the run exists to answer", () => {
  it("**a per-review id that DIFFERS per review is a dedupe key**", () => {
    const c = census(reviewGrid({ id: "unique" }));

    const verdict = classifyAcquisitionFeasibility(c);
    expect(verdict.verdict).toBe("IDENTIFIER_FOUND");
    const key = verdict.dedupeKeyCandidates.find((k) => k.source === "ATTRIBUTE" && k.digitLength === 9)!;
    expect(key.unitsCarrying).toBe(3);
    expect(key.distinctValues).toBe(3);
    expect(key.uniquePerUnit).toBe(true);
  });

  it("**an id every review carries but that never differs is NOT a key**", () => {
    // The failure a presence-only reading cannot see: three units, three runs, one value. Collecting on it
    // would fold the whole screen into one row — and the fold would look exactly like de-duplication working.
    const c = census(reviewGrid({ id: "shared" }));

    const candidate = c.unit.idCandidates.find((k) => k.source === "ATTRIBUTE" && k.digitLength === 9)!;
    expect(candidate.unitsCarrying).toBe(3);
    expect(candidate.distinctValues).toBe(1);
    expect(candidate.uniquePerUnit).toBe(false);
    expect(classifyAcquisitionFeasibility(c).verdict).toBe("NO_IDENTIFIER");
  });

  it("reports the per-review DETAIL LINK, which is an identifier and a route in one", () => {
    expect(census(reviewGrid({ id: "unique" })).unit.unitsWithDetailLink).toBe(3);
    expect(classifyAcquisitionFeasibility(census(reviewGrid({ id: "unique" }))).detailLinkPresent).toBe(true);
    expect(census(reviewGrid({ id: "none" })).unit.unitsWithDetailLink).toBe(0);
  });

  it("**a screen whose rows never resolved is UNDETERMINED, never 'no identifier'**", () => {
    // Navigation only: no field words, so nothing agrees on a repeating unit. Finding no candidate here is
    // exactly what a screen WITH ids also produces when the probe never reached the reviews — the confident
    // zero that cost three 고객문의 sittings. It may not be rounded down into a finding.
    const nav = el({ tag: "body" }).add(
      el({ tag: "ul" }).add(
        el({ tag: "li" }).add(el({ tag: "a", attrs: { href: "/a/12345678" }, text: "주문" })),
        el({ tag: "li" }).add(el({ tag: "a", attrs: { href: "/b/87654321" }, text: "정산" })),
      ),
    );
    const c = census(nav);

    expect(c.unit.resolved).toBe(false);
    expect(classifyAcquisitionFeasibility(c).verdict).toBe("UNDETERMINED");
    expect(classifyAcquisitionFeasibility(c).dedupeKeyCandidates).toEqual([]);
  });

  it("**the probe cannot report a reply control** — the words are not in the run at all", () => {
    // The operator established WING has no seller reply feature, so this is not measured. Keeping the
    // measurement "for later" is how it gets used later.
    const body = script();
    for (const replyWord of ["답글", "댓글", "답변하기", "답글 등록"]) {
      expect(body, `probe must not ask about ${replyWord}`).not.toContain(replyWord);
    }
    expect(JSON.stringify(census(reviewGrid()))).not.toContain("reply");
  });
});

/* ───────────────────────────── the unit, measured not assumed ───────────────────────────── */

describe("the review unit is found, not assumed", () => {
  it("resolves a DIV grid with no table, no list, and no row role", () => {
    const c = census(reviewGrid());

    expect(c.unit.resolved).toBe(true);
    expect(c.unit.level?.tagName).toBe("DIV");
    // 4, not 3: the header is a sibling of the same shape. Sibling count measures MARKUP, not reviews — the
    // same caveat the 고객문의 census carries, and the reason the count travels rather than a claim.
    expect(c.unit.unitCount).toBe(4);
    expect(c.unit.labelsAgreeing).toBeGreaterThanOrEqual(2);
  });

  it("**ties resolve by what a unit CONTAINS** — the field words are in the header, and a cell is not a review", () => {
    const c = census(reviewGrid());

    // Every field word votes for the header's span repeat AND for the row repeat. Taking the first would have
    // resolved the unit to a SPAN and then asked whether that span contained a photo.
    expect(c.unit.level?.tagName).not.toBe("SPAN");
    expect(c.unit.unitsWithImage).toBe(3);
  });

  it("measures media as COUNTS — the image source never travels", () => {
    const c = census(reviewGrid());

    expect(c.unit.unitsWithImage).toBe(3);
    expect(c.unit.unitsWithVideo).toBe(0);
    expect(JSON.stringify(c)).not.toContain("coupangcdn");
    expect(JSON.stringify(c)).not.toContain(".jpg");
  });

  it("detects a rating widget by BOTH routes, because neither alone is reliable", () => {
    const c = census(reviewGrid());

    expect(c.unit.unitsWithRatingAria).toBe(3);
    expect(c.unit.unitsWithStarLikeClass).toBe(3);
    // The class string itself stays in the page; only the per-unit boolean was counted.
    expect(JSON.stringify(c)).not.toContain("star-rating");
  });
});

/* ───────────────────────────── what may not cross ───────────────────────────── */

describe("nothing a customer wrote leaves the page", () => {
  it("no review body, buyer name, or date VALUE appears anywhere in the census", () => {
    const wire = JSON.stringify(census(reviewGrid({ id: "unique", productLink: true }), PRODUCT_IDS));

    for (const secret of [REVIEW_BODY_A, REVIEW_BODY_B, REVIEW_BODY_C, BUYER_A, BUYER_B, BUYER_C, REVIEW_DATE]) {
      expect(wire, `leaked ${secret}`).not.toContain(secret);
    }
    // And the identifier reading is counts about values, never the values.
    expect(wire).not.toContain("981234561");
  });

  it("reports the date as WHICH SHAPE matched and how many — never a date", () => {
    const c = census(reviewGrid());

    const dotted = c.textShapes.find((s) => s.id === "dateDotted")!;
    expect(dotted.leafCount).toBe(3);
    expect(dotted.unitCount).toBe(3);
    expect(c.textShapes.find((s) => s.id === "dateDashed")!.leafCount).toBe(0);
  });

  it("**a shape match outside the units is reported as such**, so a pager cannot pass for a rating", () => {
    const c = census(withControls(reviewGrid()));

    // '1' '2' in the pager match the rating-number shape. They are counted, and they are also reported as
    // sitting in NO unit — which is the difference between a rating column and page furniture.
    const rating = c.textShapes.find((s) => s.id === "ratingNumber")!;
    expect(rating.leafCount).toBeGreaterThan(0);
    expect(rating.unitCount).toBe(0);
    // And the unit is still the ROW set, not the body's "grid / filters / pager" — which every field word also
    // agrees on, and which a depth-only tie-break would have picked, making the pager one third of a review.
    expect(c.unit.unitCount).toBe(4);
  });

  it("the emitted script reads page text in exactly one place, and reaches no network", () => {
    const body = script();

    expect(body.split("textContent").length - 1).toBe(1);
    for (const forbidden of ["fetch(", "XMLHttpRequest", "sendBeacon", ".click(", ".submit(", "innerHTML"]) {
      expect(body, `script must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/* ───────────────────────────── scope, range, and incrementality ───────────────────────────── */

describe("the catalog-scope and collection-range readings", () => {
  it("finds a product id SellerOps already holds, and calls that OUR_CATALOG_CONFIRMED", () => {
    const c = census(reviewGrid({ id: "unique", productLink: true }), PRODUCT_IDS);

    expect(c.unit.unitsMatchingOurDigits).toBe(1);
    expect(classifyOwnershipScope(c)).toBe("OUR_CATALOG_CONFIRMED");
  });

  it("**finding none is NOT_ESTABLISHED, never a claim about other sellers**", () => {
    // The id may simply not be printed or marked up — exactly as the 접수번호 was not. Coupang shares 상품평
    // across every seller of the same item, so a verdict here would be a claim this probe cannot earn.
    const c = census(reviewGrid(), PRODUCT_IDS);

    expect(c.unit.unitsMatchingOurDigits).toBe(0);
    expect(classifyOwnershipScope(c)).toBe("NOT_ESTABLISHED");
  });

  it("**a pressable range is separated from a printed caption** — only one makes collection incremental", () => {
    const c = census(withControls(reviewGrid()));

    const period = c.controlAffordances.find((a) => a.id === "period3m")!;
    expect(period.interactiveCount).toBe(1);
    const printed = c.controlAffordances.find((a) => a.id === "periodWord")!;
    expect(printed.interactiveCount).toBe(0);
    expect(printed.staticCount).toBe(1);
  });

  it("reports how far back the pager admits to going", () => {
    const c = census(withControls(reviewGrid()));

    expect(c.pagination.dateInputCount).toBe(2);
    expect(c.pagination.selectCount).toBe(1);
    expect(c.pagination.numericPagerCount).toBe(3);
    // The highest printed page number — the difference between a channel that can be backfilled and one that
    // can only be watched forward.
    expect(c.pagination.highestPagerNumber).toBe(7);
  });

  it("reports id-candidate digit lengths from markup and from printed text, separately", () => {
    const c = census(reviewGrid({ id: "unique", productLink: true }), PRODUCT_IDS);

    expect(c.unit.unitAttributeDigitLengths).toContain(11);
    // Printed runs are the date's 4-2-2. Reported so the reading cannot be mistaken for a review id: the
    // 고객문의 screen is exactly where a printed number turned out to BE the identifier, and telling those
    // apart is a judgement for whoever reads the run, not one this probe should make silently.
    expect(c.unit.unitPrintedDigitLengths).toEqual([2, 4]);
    // The date is present on every unit and NOT unique — so it can never be mistaken for a dedupe key.
    const printedYear = c.unit.idCandidates.find((k) => k.source === "PRINTED" && k.digitLength === 4)!;
    expect(printedYear.uniquePerUnit).toBe(false);
  });
});

/* ───────────────────────────── the sanitizer ───────────────────────────── */

describe("the sanitizer refuses rather than degrades", () => {
  const LABELS = WING_REVIEW_FIELD_LABELS;
  const CONTROLS = WING_REVIEW_CONTROL_LABELS;
  const SHAPES = WING_REVIEW_TEXT_SHAPES;

  const base = {
    reason: "OK",
    elementsScanned: 10,
    shadowRootsFound: 0,
    elementsWithAnchorAttributes: 1,
    controlAffordances: CONTROLS.map((r) => ({ id: r.id, interactiveCount: 0, staticCount: 0 })),
    // Every declared label must come back. A missing one is a reading we cannot interpret, not a zero.
    labelCounts: LABELS.map((l) => ({ id: l.id, elementCount: 0 })),
    textShapes: [],
    pagination: {},
  };
  const level = {
    depth: 1,
    tagName: "DIV",
    siblingCount: 4,
    siblingsSharingClassShape: 4,
    classTokenCount: 1,
    attributeKinds: [],
    hasDetailAffordance: true,
    digitRunLengths: [],
  };

  it("a non-object, a wrong reason, or an incoherent count is UNREADABLE", () => {
    for (const bad of [null, undefined, 42, "OK", { reason: "WAT" }, {}]) {
      expect(sanitizeReviewListCensus(bad, LABELS, CONTROLS, SHAPES).reason).toBe("UNREADABLE");
    }
    expect(
      sanitizeReviewListCensus(
        { reason: "OK", elementsScanned: 5, shadowRootsFound: 0, elementsWithAnchorAttributes: 9 },
        LABELS,
        CONTROLS,
        SHAPES,
      ).reason,
    ).toBe("UNREADABLE");
  });

  it("a MISSING label reading is UNREADABLE — a declared question with no answer is not a zero", () => {
    const raw = { ...base, labelCounts: LABELS.slice(1).map((l) => ({ id: l.id, elementCount: 0 })), unit: {} };
    expect(sanitizeReviewListCensus(raw, LABELS, CONTROLS, SHAPES).reason).toBe("UNREADABLE");
  });

  it("a unit only counts as resolved when TWO labels agree — one word repeating is not a row", () => {
    const one = sanitizeReviewListCensus(
      { ...base, unit: { level, labelsAgreeing: 1, unitCount: 4 } },
      LABELS,
      CONTROLS,
      SHAPES,
    );
    expect(one.unit.resolved).toBe(false);
    expect(classifyAcquisitionFeasibility(one).verdict).toBe("UNDETERMINED");

    const two = sanitizeReviewListCensus(
      { ...base, unit: { level, labelsAgreeing: 2, unitCount: 4 } },
      LABELS,
      CONTROLS,
      SHAPES,
    );
    expect(two.unit.resolved).toBe(true);
    expect(classifyAcquisitionFeasibility(two).verdict).toBe("NO_IDENTIFIER");
  });

  it("**`uniquePerUnit` is DERIVED, never trusted from the page**", () => {
    // The field a reader acts on. A page that could assert it could assert a dedupe key that does not exist.
    const raw = {
      ...base,
      unit: {
        level,
        labelsAgreeing: 3,
        unitCount: 4,
        idCandidates: [
          { source: "ATTRIBUTE", digitLength: 9, unitsCarrying: 3, distinctValues: 1, uniquePerUnit: true },
        ],
      },
    };
    const c = sanitizeReviewListCensus(raw, LABELS, CONTROLS, SHAPES);
    expect(c.unit.idCandidates[0]!.uniquePerUnit).toBe(false);
    expect(classifyAcquisitionFeasibility(c).verdict).toBe("NO_IDENTIFIER");
  });

  it("an incoherent candidate is DROPPED, never repaired", () => {
    const raw = {
      ...base,
      unit: {
        level,
        labelsAgreeing: 3,
        unitCount: 4,
        idCandidates: [
          // More carriers than units, and more distinct values than carriers. Both are impossible.
          { source: "ATTRIBUTE", digitLength: 9, unitsCarrying: 90, distinctValues: 90 },
          { source: "PRINTED", digitLength: 4, unitsCarrying: 3, distinctValues: 9 },
          { source: "SOMEWHERE_ELSE", digitLength: 9, unitsCarrying: 3, distinctValues: 3 },
          { source: "ATTRIBUTE", digitLength: 11, unitsCarrying: 4, distinctValues: 4 },
        ],
      },
    };
    const c = sanitizeReviewListCensus(raw, LABELS, CONTROLS, SHAPES);
    expect(c.unit.idCandidates).toHaveLength(1);
    expect(c.unit.idCandidates[0]!.digitLength).toBe(11);
  });

  it("the PAGE cannot introduce an id of its own into the result", () => {
    const raw = {
      ...base,
      controlAffordances: [
        ...base.controlAffordances,
        { id: "attackerSuppliedId", interactiveCount: 99, staticCount: 0 },
      ],
      labelCounts: [...base.labelCounts, { id: "alsoNotOurs", elementCount: 7 }],
      textShapes: [{ id: "neitherIsThis", leafCount: 3 }],
      unit: {},
    };
    const wire = JSON.stringify(sanitizeReviewListCensus(raw, LABELS, CONTROLS, SHAPES));

    for (const injected of ["attackerSuppliedId", "alsoNotOurs", "neitherIsThis"]) {
      expect(wire).not.toContain(injected);
    }
  });

  it("a per-unit count can never exceed the number of units", () => {
    const raw = { ...base, unit: { level, labelsAgreeing: 3, unitCount: 4, unitsWithImage: 900 } };
    expect(sanitizeReviewListCensus(raw, LABELS, CONTROLS, SHAPES).unit.unitsWithImage).toBe(4);
  });
});
