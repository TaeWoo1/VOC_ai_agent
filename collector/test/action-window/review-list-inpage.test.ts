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
  WING_REVIEW_COLUMN_HEADERS,
  WING_REVIEW_CONTROL_LABELS,
  WING_REVIEW_FIELD_LABELS,
  WING_REVIEW_TEXT_SHAPES,
} from "../../src/action-window/coupang-wing-review-driver";
import {
  classifyAcquisitionFeasibility,
  chooseDedupeKey,
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
    WING_REVIEW_COLUMN_HEADERS,
  );
}

function census(root: El, digits: ReviewDigitExpectation[] = []): ReviewListCensus {
  return sanitizeReviewListCensus(
    run(script(digits), root),
    WING_REVIEW_FIELD_LABELS,
    WING_REVIEW_CONTROL_LABELS,
    WING_REVIEW_TEXT_SHAPES,
    WING_REVIEW_COLUMN_HEADERS,
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

/** Column geometry. The catalog column is resolved by its header's horizontal span, so boxes are load-bearing. */
const CATALOG_X = { left: 400, width: 120 };
function rowBox(top: number, left: number, width: number) {
  return { left, top, width, height: 20 };
}

function reviewRow(index: number, body: string, buyer: string, opts: RowOptions = {}): El {
  const top = 100 + index * 30;
  const cells: El[] = [
    // The rating, rendered the way a real one is: a class-tokened strip that also exposes an accessible value.
    el({ tag: "span", attrs: { class: "star-rating on", "aria-valuenow": "5" }, box: rowBox(top, 0, 80) }),
    el({ tag: "span", text: REVIEW_DATE, box: rowBox(top, 90, 100) }),
    el({ tag: "span", text: body, box: rowBox(top, 200, 100) }),
    el({ tag: "span", text: buyer, box: rowBox(top, 310, 80) }),
    // 노출상품ID (옵션ID): the seller's catalog identity, PRINTED. One product, a different option per row.
    el({
      tag: "span",
      // In `shared` mode the option id is constant too — a screen on which NOTHING differs per review.
      text: opts.id === "shared" ? `${PRODUCT} (87654321)` : `${PRODUCT} (8765432${index})`,
      box: rowBox(top, CATALOG_X.left, CATALOG_X.width),
    }),
    el({ tag: "img", attrs: { src: IMAGE_SRC }, box: rowBox(top, 530, 40) }),
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
    el({ tag: "span", text: "평점", box: rowBox(60, 0, 80) }),
    el({ tag: "span", text: "작성일", box: rowBox(60, 90, 100) }),
    el({ tag: "span", text: "상품평", box: rowBox(60, 200, 100) }),
    el({ tag: "span", text: "구매자", box: rowBox(60, 310, 80) }),
    // The header EXACTLY as WING renders it: the words are split across a <br>, so the element that prints
    // them is not a leaf by child count. That is what made the first column probe report HEADER_NOT_FOUND.
    el({ tag: "th", box: rowBox(60, CATALOG_X.left, CATALOG_X.width) }).add(
      // Own text plus a text-free <br> child — the words are the div's OWN text nodes, as WING renders them.
      el({
        tag: "div",
        attrs: { class: "text-wrapper" },
        text: "노출상품ID (옵션ID)",
        box: rowBox(60, CATALOG_X.left, CATALOG_X.width),
      }).add(el({ tag: "br" })),
    ),
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
    // 3 of 4 units carry it — the header row is the fourth. Unique where present, not on every unit.
    expect(verdict.verdict).toBe("IDENTIFIER_PARTIAL");
    const key = verdict.dedupeKeyCandidates.find((k) => k.source === "ATTRIBUTE" && k.digitLength === 9)!;
    expect(key.unitsCarrying).toBe(3);
    expect(key.distinctValues).toBe(3);
    expect(key.uniquePerUnit).toBe(true);
    expect(verdict.bestCoverage).toBeCloseTo(0.75);
  });

  it("**unique on SOME reviews is not a dedupe key** — the bar is present on each AND different for each", () => {
    // The first real reading found a 10-digit number unique on every unit carrying it and carried by 7 of 10.
    // Reported as IDENTIFIER_FOUND, an acquisition on it would have dropped three reviews in ten, silently.
    const raw = {
      reason: "OK",
      elementsScanned: 10,
      shadowRootsFound: 0,
      elementsWithAnchorAttributes: 1,
      controlAffordances: WING_REVIEW_CONTROL_LABELS.map((r) => ({ id: r.id, interactiveCount: 0, staticCount: 0 })),
      labelCounts: WING_REVIEW_FIELD_LABELS.map((l) => ({ id: l.id, elementCount: 0 })),
      textShapes: [],
      unit: {
        level: {
          depth: 1,
          tagName: "TBODY",
          siblingCount: 10,
          siblingsSharingClassShape: 10,
          classTokenCount: 0,
          attributeKinds: [],
          hasDetailAffordance: true,
          digitRunLengths: [],
        },
        labelsAgreeing: 20,
        unitCount: 10,
        idCandidates: [
          { source: "ATTRIBUTE", digitLength: 10, unitsCarrying: 7, distinctValues: 7 },
          { source: "ATTRIBUTE", digitLength: 11, unitsCarrying: 10, distinctValues: 9 },
        ],
      },
      pagination: {},
    };
    const c = sanitizeReviewListCensus(raw, WING_REVIEW_FIELD_LABELS, WING_REVIEW_CONTROL_LABELS, []);
    const verdict = classifyAcquisitionFeasibility(c);

    expect(verdict.verdict).toBe("IDENTIFIER_PARTIAL");
    expect(verdict.bestCoverage).toBeCloseTo(0.7);
    // The 11-digit run is on every unit and is NOT unique — a product id, not a review id.
    expect(verdict.dedupeKeyCandidates.map((k) => k.digitLength)).toEqual([10]);
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

    // Every row's catalog cell carries it — that is what the column is for.
    expect(c.unit.unitsMatchingOurDigits).toBe(3);
    expect(classifyOwnershipScope(c)).toBe("OUR_CATALOG_CONFIRMED");
  });

  it("**an id we do NOT hold is NOT_ESTABLISHED, never a claim about other sellers**", () => {
    // Coupang shares 상품평 across every seller of the same item, so "these are someone else's" is a verdict
    // this probe cannot earn — the absence of OUR id says nothing about whose reviews these are.
    const c = census(reviewGrid(), [{ id: "productId", digits: "99999999999" }]);

    expect(c.columnProbe.cellsMatchingOurDigits).toBe(0);
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
    // Printed runs are the date's 4-2-2 AND the catalog column's 11-digit product / 8-digit option. Reported
    // so the reading cannot be mistaken for a review id: the 고객문의 screen is exactly where a printed number
    // turned out to BE the identifier, and telling those apart is a judgement for whoever reads the run.
    expect(c.unit.unitPrintedDigitLengths).toEqual([2, 4, 8, 11]);
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

/* ───────────────────────────── the live reading that voided itself ───────────────────────────── */

describe("a container is not a review", () => {
  /**
   * **The failure the first live sitting produced, reproduced.**
   *
   * On the real WING 상품평 screen the probe resolved a four-member `DIV` set, reported it as the review unit,
   * and returned `NO_IDENTIFIER` — from a set that held **ten dates** and in which every identifier length was
   * carried by exactly one member. A review row holds one review's worth of evidence; that set held everyone's.
   *
   * The evidence heuristic alone cannot catch it: a wrapper whose every child contains a date scores 4/4, and
   * the row set — whose header row has no date — scores 3/4. The wrapper WINS on evidence. So the guard is a
   * separate, independent check on the outcome, not a better heuristic.
   */
  function wrapperOfCards(): El {
    const card = (n: number): El =>
      el({ tag: "div", attrs: { class: `card c${n}` } }).add(
        // Each wrapper child holds several reviews' worth of dates — which is what makes it a container.
        el({ tag: "span", text: REVIEW_DATE }),
        el({ tag: "span", text: REVIEW_DATE }),
        el({ tag: "span", text: REVIEW_DATE }),
        el({ tag: "span", text: "평점" }),
        el({ tag: "span", text: "작성일" }),
      );
    return el({ tag: "body" }).add(
      el({ tag: "div", attrs: { class: "wrap" } }).add(card(1), card(2), card(3), card(4)),
    );
  }

  it("**a unit holding many reviews' worth of dates is UNDETERMINED, not NO_IDENTIFIER**", () => {
    const c = census(wrapperOfCards());

    const verdict = classifyAcquisitionFeasibility(c);
    expect(verdict.containerSuspected).toBe(true);
    expect(verdict.verdict).toBe("UNDETERMINED");
    // And nothing about identifiers is asserted from it — every count describes the wrong element.
    expect(verdict.dedupeKeyCandidates).toEqual([]);
  });

  it("the guard allows a row that prints TWO dates — 작성일 and 수정일 are one review", () => {
    const raw = {
      reason: "OK",
      elementsScanned: 10,
      shadowRootsFound: 0,
      elementsWithAnchorAttributes: 1,
      controlAffordances: WING_REVIEW_CONTROL_LABELS.map((r) => ({
        id: r.id,
        interactiveCount: 0,
        staticCount: 0,
      })),
      labelCounts: WING_REVIEW_FIELD_LABELS.map((l) => ({ id: l.id, elementCount: 0 })),
      // 4 units, 8 date leaves inside them — exactly two each. A row, not a container.
      textShapes: [{ id: "dateDotted", leafCount: 8, unitCount: 8 }],
      unit: {
        level: {
          depth: 1,
          tagName: "TR",
          siblingCount: 4,
          siblingsSharingClassShape: 4,
          classTokenCount: 1,
          attributeKinds: [],
          hasDetailAffordance: true,
          digitRunLengths: [],
        },
        labelsAgreeing: 3,
        unitCount: 4,
        idCandidates: [
          { source: "ATTRIBUTE", digitLength: 9, unitsCarrying: 4, distinctValues: 4 },
        ],
      },
      pagination: {},
    };
    const c = sanitizeReviewListCensus(raw, WING_REVIEW_FIELD_LABELS, WING_REVIEW_CONTROL_LABELS, [
      { id: "dateDotted", pattern: "^x$" },
    ]);
    const verdict = classifyAcquisitionFeasibility(c);
    expect(verdict.containerSuspected).toBe(false);
    // 4 of 4 units carry it — full coverage is what earns IDENTIFIER_FOUND.
    expect(verdict.verdict).toBe("IDENTIFIER_FOUND");
    expect(verdict.bestCoverage).toBe(1);
  });

  it("**candidate sets are told apart by ELEMENT, not by tag-and-count**", () => {
    // The reporting half of the same defect: on the live screen two different DIV sets both had four siblings,
    // so one key covered both — one with all four sharing a class shape, one with none. Whichever the walk
    // reached first supplied the level that got reported, describing a set nobody had voted for.
    const c = census(reviewGrid());

    // The reported level must describe the set that was actually chosen: four DIV siblings, and the unit count
    // measured from that same set.
    expect(c.unit.level?.siblingCount).toBe(c.unit.unitCount);
  });
});

/* ───────────────────────────── the catalog column ───────────────────────────── */

describe("the 노출상품ID (옵션ID) column", () => {
  it("**resolves the review unit from the column, not from field-word agreement**", () => {
    // One cell per review by construction — a far stronger anchor than field words that all live in one header
    // cell. The run reports WHICH route resolved it, so the weaker reading can never be mistaken for this one.
    const c = census(reviewGrid());

    expect(c.unitSource).toBe("COLUMN");
    expect(c.unit.resolved).toBe(true);
    // Three cells, three rows — the header's own cell sits above the column and is excluded.
    expect(c.unit.unitCount).toBe(4);
  });

  it("reads product and option identity as COUNTS — neither number travels", () => {
    const c = census(reviewGrid());

    expect(c.columnProbe.reason).toBe("OK");
    expect(c.columnProbe.headerId).toBe("exposedWithOption");
    expect(c.columnProbe.cellsInColumn).toBe(3);
    expect(c.columnProbe.cellsWithTwoRuns).toBe(3);
    // One product across all three rows, a different option each — exactly what productId/vendorItemId means.
    expect(c.columnProbe.distinctFirstRunValues).toBe(1);
    expect(c.columnProbe.distinctSecondRunValues).toBe(3);
    // And neither id is anywhere in the result.
    expect(JSON.stringify(c)).not.toContain(PRODUCT);
    expect(JSON.stringify(c)).not.toContain("87654321");
  });

  it("**matches OUR catalog without being handed anything**, when we do hand it something", () => {
    const c = census(reviewGrid(), PRODUCT_IDS);

    expect(c.columnProbe.cellsMatchingOurDigits).toBe(3);
    expect(classifyOwnershipScope(c)).toBe("OUR_CATALOG_CONFIRMED");
  });

  it("**a header split across a <br> is still found** — the failure the second live sitting produced", () => {
    // WING renders it as <th><div class="text-wrapper">노출상품ID <br> (옵션ID)</div></th>. The <br> makes that
    // div a non-leaf by child count, so a leaf-only scan never tested the one element that prints the words —
    // and the run reported HEADER_NOT_FOUND for a column that was plainly on screen.
    const c = census(reviewGrid());

    expect(c.columnProbe.reason).toBe("OK");
    expect(c.columnProbe.headerId).toBe("exposedWithOption");
    // And the element that prints the words is a single hit, not an ambiguous pair with its <th>.
    expect(c.columnProbe.reason).not.toBe("HEADER_AMBIGUOUS");
  });

  it("a screen without that header falls back to field-word agreement, and says so", () => {
    const noColumn = el({ tag: "body" }).add(
      el({ tag: "div", attrs: { class: "g" } }).add(
        el({ tag: "div", attrs: { class: "r" } }).add(
          el({ tag: "span", text: "평점" }),
          el({ tag: "span", text: "작성일" }),
        ),
        el({ tag: "div", attrs: { class: "r" } }).add(el({ tag: "span", text: REVIEW_DATE })),
        el({ tag: "div", attrs: { class: "r" } }).add(el({ tag: "span", text: REVIEW_DATE })),
      ),
    );
    const c = census(noColumn);

    expect(c.columnProbe.reason).toBe("HEADER_NOT_FOUND");
    expect(c.unitSource).toBe("LABEL_AGREEMENT");
  });

  it("**a product id is NOT a review id** — it repeats across reviews, and the reading shows it", () => {
    // The trap this column creates: it is the most identifier-looking thing on the screen and it is per
    // PRODUCT, not per review. Collecting on it would fold every review of one product into a single row.
    const c = census(reviewGrid());

    const printed = c.unit.idCandidates.filter((k) => k.source === "PRINTED" && k.uniquePerUnit);
    // The option id differs per row; the product id does not. Both are printed, and only one is a key.
    expect(c.columnProbe.distinctFirstRunValues).toBeLessThan(c.columnProbe.cellsInColumn);
    expect(printed.length).toBeGreaterThan(0);
  });
});

/* ────────────────── the five questions one sitting has to close ────────────────── */

/**
 * **Ten rows shaped exactly like the live reading: a per-review number on only some of them.**
 *
 * `mode` is the whole point. Two screens produce the same "7 of 10 carry a 10-digit run" summary and mean
 * completely different things, and only a per-position reading can tell them apart:
 *
 *  - `MISSING_CELL` — three rows are a narrower row shape and never reach that position.
 *  - `EMPTY_CELL`   — every row has the cell; on three of them it prints a placeholder.
 *
 * The option id is deliberately shared across rows. It is per OPTION, not per review, so it must not be
 * mistaken for a key — and a screen where the only unique-per-row value is the review number is the one that
 * proves the chooser is picking on uniqueness rather than on looking like an id.
 */
function coverageGrid(carriers: number, mode: "MISSING_CELL" | "EMPTY_CELL"): El {
  const header = el({ tag: "div", attrs: { class: "rv-row rv-hdr" } }).add(
    el({ tag: "span", text: "평점", box: rowBox(60, 0, 80) }),
    el({ tag: "span", text: "작성일", box: rowBox(60, 90, 100) }),
    el({ tag: "th", box: rowBox(60, CATALOG_X.left, CATALOG_X.width) }).add(
      el({
        tag: "div",
        attrs: { class: "text-wrapper" },
        text: "노출상품ID (옵션ID)",
        box: rowBox(60, CATALOG_X.left, CATALOG_X.width),
      }).add(el({ tag: "br" })),
    ),
  );
  const rows: El[] = [];
  for (let i = 0; i < 10; i++) {
    const top = 100 + i * 30;
    const cells: El[] = [];
    if (i < carriers) {
      cells.push(el({ tag: "span", text: `90000000${String(10 + i)}`, box: rowBox(top, 0, 80) }));
    } else if (mode === "EMPTY_CELL") {
      cells.push(el({ tag: "span", text: "-", box: rowBox(top, 0, 80) }));
    }
    cells.push(el({ tag: "span", text: REVIEW_DATE, box: rowBox(top, 90, 100) }));
    // One product, three options across ten rows — an option id is not a review id.
    cells.push(
      el({
        tag: "span",
        text: `${PRODUCT} (8765432${i % 3})`,
        box: rowBox(top, CATALOG_X.left, CATALOG_X.width),
      }),
    );
    rows.push(el({ tag: "div", attrs: { class: "rv-row" } }).add(...cells));
  }
  // The header lives in its own container, as the live screen has it — a THEAD above ten TBODYs. Making it a
  // sibling of the rows would count it as an eleventh row and quietly depress every coverage figure below.
  return el({ tag: "body" }).add(
    el({ tag: "div", attrs: { class: "rv-grid" } }).add(
      el({ tag: "div", attrs: { class: "rv-head" } }).add(header),
      el({ tag: "div", attrs: { class: "rv-body" } }).add(...rows),
    ),
  );
}

describe("why an identifier covers only some rows, and what may be keyed on", () => {
  it("**a narrower row shape shows up in the leaf counts** — the cause, without a second sitting", () => {
    const c = census(coverageGrid(7, "MISSING_CELL"));

    expect(c.unit.unitCount).toBe(10);
    // Seven rows carry three cells, three carry two. The split IS the answer to "why 7 of 10".
    const wide = c.unit.leafCounts.filter((n) => n === 3).length;
    const narrow = c.unit.leafCounts.filter((n) => n === 2).length;
    expect(wide).toBe(7);
    expect(narrow).toBe(3);
  });

  it("**an empty cell is a different screen, and reads differently** — same summary, opposite cause", () => {
    const c = census(coverageGrid(7, "EMPTY_CELL"));

    // Every row reaches every position, so the leaf counts are uniform...
    expect(new Set(c.unit.leafCounts).size).toBe(1);
    // ...and the shortfall is in the RUNS at that position, not in whether the position exists.
    const first = c.cells.find((cell) => cell.cellIndex === 0);
    expect(first?.unitsWithCell).toBe(10);
    expect(first?.runs.find((r) => r.digitLength === 10)?.unitsCarrying).toBe(7);
  });

  it("**7 of 10 is PARTIAL_COVERAGE, and names the three rows it would drop**", () => {
    const key = chooseDedupeKey(census(coverageGrid(7, "EMPTY_CELL")));

    expect(key.verdict).toBe("PARTIAL_COVERAGE");
    expect(key.digitLength).toBe(10);
    expect(key.coverage).toBeCloseTo(0.7);
    // The number that matters: an acquisition built on this key loses three reviews in ten, silently.
    expect(key.unitsMissing).toBe(3);
  });

  it("full coverage at a known position is a KEY — and the position is what makes it extractable", () => {
    const key = chooseDedupeKey(census(coverageGrid(10, "EMPTY_CELL")));

    expect(key.verdict).toBe("KEY_FOUND");
    expect(key.coverage).toBe(1);
    expect(key.unitsMissing).toBe(0);
    // A key we could store but not re-find would be worse than none — the locate anchor is this same reading.
    expect(key.cellIndex).not.toBeNull();
    expect(key.digitLength).toBe(10);
  });

  it("**an option id is not chosen**, though it is printed, numeric, and looks like an identifier", () => {
    const c = census(coverageGrid(10, "EMPTY_CELL"));
    const key = chooseDedupeKey(c);

    // Three options across ten rows: present on every row, and useless as a key.
    const catalog = c.cells.find((cell) => cell.runs.some((r) => r.digitLength === 8));
    expect(catalog?.runs.find((r) => r.digitLength === 8)?.uniquePerUnit).toBe(false);
    expect(key.digitLength).toBe(10);
  });

  it("an unresolved row yields UNDETERMINED — never 'there is no key'", () => {
    // The confident zero this whole probe exists to avoid: a screen whose rows were never found produces
    // "no unique position" and "we never looked" identically, and only one of them is a finding.
    const bare = el({ tag: "body" }).add(el({ tag: "div" }).add(el({ tag: "span", text: "상품평" })));
    expect(chooseDedupeKey(census(bare)).verdict).toBe("UNDETERMINED");
  });

  it("no cell position, no key — a census that never measured positions cannot assert one", () => {
    expect(chooseDedupeKey(null).verdict).toBe("UNDETERMINED");
    expect(chooseDedupeKey(undefined).verdict).toBe("UNDETERMINED");
  });

  it("**no review text, buyer name, or identifier value survives the per-position reading**", () => {
    const serialized = JSON.stringify(census(coverageGrid(7, "EMPTY_CELL")));

    expect(serialized).not.toContain(PRODUCT);
    expect(serialized).not.toContain("9000000010");
    expect(serialized).not.toContain(REVIEW_DATE);
    expect(serialized).not.toContain("87654320");
  });
});

describe("how much history one acquisition could reach", () => {
  it("a dropdown is profiled for RANGE, not merely counted", () => {
    const root = withControls(coverageGrid(10, "EMPTY_CELL"));
    const c = census(root);

    // The bare `selectCount` says a filter exists; the profile says what it can be asked for.
    expect(c.pagination.selectCount).toBeGreaterThan(0);
    expect(c.selects.length).toBe(c.pagination.selectCount);
  });

  it("options carrying a period word WE supplied are counted, and the words never travel", () => {
    const withPeriods = el({ tag: "body" }).add(
      el({ tag: "select" }).add(
        el({ tag: "option", text: "1개월" }),
        el({ tag: "option", text: "3개월" }),
        el({ tag: "option", text: "직접입력" }),
        el({ tag: "option", text: "전체" }),
      ),
      coverageGrid(10, "EMPTY_CELL"),
    );
    const c = census(withPeriods);
    const select = c.selects[0];
    expect(select).toBeDefined();

    expect(select?.optionCount).toBe(4);
    // 1개월 / 3개월 / 직접입력 are ours; 전체 is not one we supplied, so it is not counted.
    expect(select?.optionsMatchingControlLabels).toBe(3);
    expect(select?.insideUnit).toBe(false);
  });
});

describe("the column the first live reading actually found", () => {
  /**
   * **The live shape, reproduced: one column, three digit lengths, and a collision hiding inside it.**
   *
   * Ten rows carried a number at the same position — two of 8 digits (the SAME value), one of 9, seven of 10
   * (all different). Bucketed by length, the largest bucket looked like a key on 7 of 10 rows, and the run
   * reported `PARTIAL_COVERAGE` with "3 rows missing". Both halves were wrong: no row was missing, and two
   * rows were indistinguishable.
   */
  function liveShapedGrid(): El {
    const header = el({ tag: "div", attrs: { class: "rv-row rv-hdr" } }).add(
      el({ tag: "span", text: "작성일", box: rowBox(60, 90, 100) }),
      el({ tag: "th", box: rowBox(60, CATALOG_X.left, CATALOG_X.width) }).add(
        el({
          tag: "div",
          attrs: { class: "text-wrapper" },
          text: "노출상품ID (옵션ID)",
          box: rowBox(60, CATALOG_X.left, CATALOG_X.width),
        }).add(el({ tag: "br" })),
      ),
    );
    // Two rows share one 8-digit value, one row has 9 digits, seven have distinct 10-digit values.
    const values = ["87654321", "87654321", "987654321", ...Array.from({ length: 7 }, (_, i) => `900000001${i}`)];
    const rows = values.map((v, i) => {
      const top = 100 + i * 30;
      return el({ tag: "div", attrs: { class: "rv-row" } }).add(
        el({ tag: "span", text: v, box: rowBox(top, 0, 80) }),
        el({ tag: "span", text: REVIEW_DATE, box: rowBox(top, 90, 100) }),
        el({
          tag: "span",
          text: `${PRODUCT} (8765432${i % 3})`,
          box: rowBox(top, CATALOG_X.left, CATALOG_X.width),
        }),
      );
    });
    return el({ tag: "body" }).add(
      el({ tag: "div", attrs: { class: "rv-grid" } }).add(
        el({ tag: "div", attrs: { class: "rv-head" } }).add(header),
        el({ tag: "div", attrs: { class: "rv-body" } }).add(...rows),
      ),
    );
  }

  it("**every row is populated — 'three rows missing' was an artefact of bucketing by length**", () => {
    const c = census(liveShapedGrid());
    const cell = c.cells.find((x) => x.cellIndex === 0);

    expect(c.unit.unitCount).toBe(10);
    // The per-length buckets still show 2 / 1 / 7 …
    expect(cell?.runs.find((r) => r.digitLength === 8)?.unitsCarrying).toBe(2);
    expect(cell?.runs.find((r) => r.digitLength === 10)?.unitsCarrying).toBe(7);
    // … and the column-level reading says what they add up to.
    expect(cell?.unitsWithAnyRun).toBe(10);
  });

  it("**and it is NOT a key — two rows carry the same value**, which the buckets could not show", () => {
    const c = census(liveShapedGrid());
    const cell = c.cells.find((x) => x.cellIndex === 0);

    // Ten rows, nine distinct values. The 10-digit bucket alone reported 7 carriers and 7 distinct, which is
    // what made a colliding column look like a partial key.
    expect(cell?.distinctValuesAcrossLengths).toBe(9);
    expect(chooseDedupeKey(c).verdict).not.toBe("KEY_FOUND");
    expect(chooseDedupeKey(c).verdict).not.toBe("PARTIAL_COVERAGE");
  });

  it("a composite key is still available here, and is reported as its own answer", () => {
    // The two colliding rows differ in their option ids, so their whole-row digit signatures differ. That is a
    // real answer and a worse key: wider, order-dependent, and not one value a locate can be handed.
    const c = census(liveShapedGrid());

    expect(c.distinctRowSignatures).toBe(10);
    expect(chooseDedupeKey(c).verdict).toBe("COMPOSITE_ONLY");
  });

  it("**two rows identical in every number means no key at all** — not 'we could not find one'", () => {
    const twins = el({ tag: "body" }).add(
      el({ tag: "div", attrs: { class: "rv-grid" } }).add(
        el({ tag: "div", attrs: { class: "rv-head" } }).add(
          el({ tag: "div", attrs: { class: "rv-row rv-hdr" } }).add(
            el({ tag: "span", text: "작성일", box: rowBox(60, 90, 100) }),
            el({ tag: "th", box: rowBox(60, CATALOG_X.left, CATALOG_X.width) }).add(
              el({
                tag: "div",
                attrs: { class: "text-wrapper" },
                text: "노출상품ID (옵션ID)",
                box: rowBox(60, CATALOG_X.left, CATALOG_X.width),
              }).add(el({ tag: "br" })),
            ),
          ),
        ),
        el({ tag: "div", attrs: { class: "rv-body" } }).add(
          ...[0, 1, 2].map((i) =>
            el({ tag: "div", attrs: { class: "rv-row" } }).add(
              el({ tag: "span", text: REVIEW_DATE, box: rowBox(100 + i * 30, 90, 100) }),
              el({
                tag: "span",
                text: `${PRODUCT} (87654321)`,
                box: rowBox(100 + i * 30, CATALOG_X.left, CATALOG_X.width),
              }),
            ),
          ),
        ),
      ),
    );
    const c = census(twins);

    expect(c.unit.unitCount).toBe(3);
    expect(c.distinctRowSignatures).toBe(1);
    expect(chooseDedupeKey(c).verdict).toBe("NO_UNIQUE_POSITION");
  });

  it("dropdown options are profiled by SHAPE once the guessed words all miss", () => {
    const withPeriods = el({ tag: "body" }).add(
      el({ tag: "select" }).add(
        el({ tag: "option", text: "1개월" }),
        el({ tag: "option", text: "6개월" }),
        el({ tag: "option", text: "7일" }),
        el({ tag: "option", text: "전체" }),
      ),
      liveShapedGrid(),
    );
    const select = census(withPeriods).selects[0];

    expect(select?.optionCount).toBe(4);
    expect(select?.optionsMatchingShapes.find((s) => s.shapeId === "periodMonths")?.unitCount).toBe(2);
    expect(select?.optionsMatchingShapes.find((s) => s.shapeId === "periodDays")?.unitCount).toBe(1);
    // 전체 matches no shape, and no option TEXT appears anywhere in the result.
    expect(JSON.stringify(select)).not.toContain("전체");
  });
});
