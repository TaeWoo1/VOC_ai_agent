/**
 * **The 상품평 structure discovery, executed.** These run the REAL generated script — the same string the
 * driver evaluates in the page — against a fake DOM.
 *
 * Three properties carry the most weight here.
 *
 * **The reply answer is the product of the run, and it has three states.** A `답글` on a button is a
 * capability; `답글여부` printed in a header is a word. Collapsing them would report a reply feature on a
 * screen that has none — and refusing to say "no reply control" from a reading that never found the rows is
 * what keeps this probe from producing the confident zero three 고객문의 sittings were spent on.
 *
 * **Nothing a customer wrote can leave the page.** A fixture full of distinctive review text, buyer names and
 * media sources yields a census containing none of it.
 *
 * **The row tag is never assumed.** The fixture is a `div` grid with no table, no list and no row role, and
 * the field words appear only in the HEADER — which is where a probe that stopped at the first agreeing level
 * would resolve the unit to a header cell and then ask whether it contained a photo.
 */
import { describe, expect, it } from "vitest";
import { buildReviewListCensusScript } from "../../src/action-window/api-issuance-calibration/review-list-inpage";
import {
  WING_REVIEW_CLASS_TOKENS,
  WING_REVIEW_FIELD_LABELS,
  WING_REVIEW_REPLY_LABELS,
  WING_REVIEW_TEXT_SHAPES,
} from "../../src/action-window/coupang-wing-review-driver";
import {
  classifyOwnershipScope,
  classifyReplyCapability,
  sanitizeReviewListCensus,
  type ReviewDigitExpectation,
  type ReviewListCensus,
} from "../../src/action-window/coupang-wing-review-list";
import { el, run, type El } from "./fake-dom";

/* ───────────────────────────── the fixtures ───────────────────────────── */

/** Review text and buyer names, deliberately distinctive so a leak would be unmistakable in an assertion. */
const REVIEW_BODY_A = "배송도 빠르고 포장도 꼼꼼해서 아주 만족합니다";
const REVIEW_BODY_B = "생각보다 크기가 작아서 조금 아쉬웠어요";
const BUYER_A = "김서연";
const BUYER_B = "박준호";
const REVIEW_DATE = "2026.08.11";
const PRODUCT = "15411270785";
const IMAGE_SRC = "https://image.coupangcdn.com/reviews/secret-path.jpg";

const PRODUCT_IDS: ReviewDigitExpectation[] = [{ id: "productId", digits: PRODUCT }];

function script(digits: ReviewDigitExpectation[] = []): string {
  return buildReviewListCensusScript(
    WING_REVIEW_FIELD_LABELS,
    WING_REVIEW_REPLY_LABELS,
    WING_REVIEW_TEXT_SHAPES,
    digits,
    WING_REVIEW_CLASS_TOKENS,
  );
}

function census(root: El, digits: ReviewDigitExpectation[] = []): ReviewListCensus {
  return sanitizeReviewListCensus(
    run(script(digits), root),
    WING_REVIEW_FIELD_LABELS,
    WING_REVIEW_REPLY_LABELS,
    WING_REVIEW_TEXT_SHAPES,
  );
}

interface RowOptions {
  /** How the reply control is rendered. `none` leaves the row with no control at all. */
  reply?: "button" | "role" | "none";
  /** Whether this row carries a link to a product id SellerOps already holds. */
  productLink?: boolean;
}

function reviewRow(body: string, buyer: string, opts: RowOptions = {}): El {
  const cells: El[] = [
    // The rating, rendered the way a real one is: a class-tokened strip that also exposes an accessible value.
    el({ tag: "span", attrs: { class: "star-rating on", "aria-valuenow": "5" } }),
    el({ tag: "span", text: REVIEW_DATE }),
    el({ tag: "span", text: body }),
    el({ tag: "span", text: buyer }),
    el({ tag: "img", attrs: { src: IMAGE_SRC } }),
  ];
  if (opts.productLink) {
    cells.push(el({ tag: "a", attrs: { href: `/vendor-items/${PRODUCT}` }, text: "상품 보기" }));
  }
  if (opts.reply === "button") {
    cells.push(el({ tag: "button" }).add(el({ tag: "span", text: "답글" })));
  } else if (opts.reply === "role") {
    // The case that matters most: a modern seller centre renders its controls as divs.
    cells.push(el({ tag: "div", attrs: { role: "button", class: "btn" } }).add(el({ tag: "span", text: "답글" })));
  }
  return el({ tag: "div", attrs: { class: "rv-row" } }).add(...cells);
}

/** A WING-shaped 상품평 grid: a header row of field words, then review rows that repeat its shape. */
function reviewGrid(opts: RowOptions = { reply: "button" }): El {
  const header = el({ tag: "div", attrs: { class: "rv-row rv-hdr" } }).add(
    el({ tag: "span", text: "평점" }),
    el({ tag: "span", text: "작성일" }),
    el({ tag: "span", text: "상품평" }),
    el({ tag: "span", text: "구매자" }),
    // Both a state column and (as a substring) the reply word — the exact overlap the split has to survive.
    el({ tag: "span", text: "답글여부" }),
  );
  // Only the FIRST row links a product id we hold — so the catalog-scope reading has to count units, not rows.
  const rest: RowOptions = { ...opts, productLink: false };
  const grid = el({ tag: "div", attrs: { class: "rv-grid" } }).add(
    header,
    reviewRow(REVIEW_BODY_A, BUYER_A, opts),
    reviewRow(REVIEW_BODY_B, BUYER_B, rest),
    reviewRow("무난합니다", "이도윤", rest),
  );
  return el({ tag: "body" }).add(el({ tag: "nav" }).add(el({ tag: "a", attrs: { href: "/wing" }, text: "홈" })), grid);
}

/** The paging and range furniture, as a seller centre renders it. */
function withPager(root: El): El {
  return root.add(
    el({ tag: "div", attrs: { class: "filters" } }).add(
      el({ tag: "input", attrs: { type: "date" } }),
      el({ tag: "input", attrs: { type: "date" } }),
      el({ tag: "select" }),
    ),
    el({ tag: "div", attrs: { class: "pager" } }).add(
      el({ tag: "span", text: "1" }),
      el({ tag: "span", text: "2" }),
      el({ tag: "span", text: "3" }),
    ),
  );
}

/* ───────────────────────────── the reply fork ───────────────────────────── */

describe("the question the run exists to answer", () => {
  it("**a 답글 BUTTON is a capability** — and the printed 답글여부 header does not become one", () => {
    const c = census(reviewGrid({ reply: "button" }));

    const tight = c.replyAffordances.find((a) => a.id === "replyTight")!;
    expect(tight.interactiveCount).toBe(3);
    // 답글여부 contains 답글. It is a column header, and it must land on the static side of the split.
    expect(tight.staticCount).toBe(1);
    expect(classifyReplyCapability(c).verdict).toBe("REPLY_CONTROL_PRESENT");
    expect(classifyReplyCapability(c).interactiveLabelIds).toContain("replyTight");
  });

  it("**a div[role=button] is a control too** — the case a tag-only probe would call furniture", () => {
    const c = census(reviewGrid({ reply: "role" }));

    expect(c.replyAffordances.find((a) => a.id === "replyTight")!.interactiveCount).toBe(3);
    expect(classifyReplyCapability(c).verdict).toBe("REPLY_CONTROL_PRESENT");
  });

  it("reply words present ONLY as printed text yield NO_REPLY_CONTROL, flagged as printed-only", () => {
    const c = census(reviewGrid({ reply: "none" }));

    expect(c.replyAffordances.every((a) => a.interactiveCount === 0)).toBe(true);
    expect(c.replyAffordances.find((a) => a.id === "replyTight")!.staticCount).toBe(1);
    const verdict = classifyReplyCapability(c);
    expect(verdict.verdict).toBe("NO_REPLY_CONTROL");
    expect(verdict.printedOnly).toBe(true);
  });

  it("**a screen whose rows never resolved is UNDETERMINED, never 'no reply control'**", () => {
    // Navigation only: no field words, so nothing agrees on a repeating unit. Zero reply hits here is exactly
    // what a screen WITH a reply feature also produces when the probe never reached the reviews — the confident
    // zero that cost three 고객문의 sittings. It may not be rounded down into a finding.
    const nav = el({ tag: "body" }).add(
      el({ tag: "ul" }).add(
        el({ tag: "li" }).add(el({ tag: "a", attrs: { href: "/a" }, text: "주문" })),
        el({ tag: "li" }).add(el({ tag: "a", attrs: { href: "/b" }, text: "정산" })),
      ),
    );
    const c = census(nav);

    expect(c.unit.resolved).toBe(false);
    expect(c.replyAffordances.every((a) => a.interactiveCount === 0)).toBe(true);
    expect(classifyReplyCapability(c).verdict).toBe("UNDETERMINED");
  });

  it("counts how many controls sit INSIDE a review unit — a nav button is not a review reply", () => {
    const root = reviewGrid({ reply: "button" });
    // A global 답변 control in the page furniture, of the kind a seller centre puts in its header.
    root.add(el({ tag: "button" }).add(el({ tag: "span", text: "답변" })));
    const c = census(root);

    const answer = c.replyAffordances.find((a) => a.id === "answer")!;
    expect(answer.interactiveCount).toBe(1);
    expect(answer.insideUnitCount).toBe(0);
    expect(c.replyAffordances.find((a) => a.id === "replyTight")!.insideUnitCount).toBe(3);
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

  it("**ties resolve outward** — the field words are in the header, and a header CELL is not a review", () => {
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

  it("a detail affordance is reported per unit, not assumed from the list", () => {
    const c = census(reviewGrid({ reply: "button" }));
    expect(c.unit.unitsWithDetailAffordance).toBe(3);
  });
});

/* ───────────────────────────── what may not cross ───────────────────────────── */

describe("nothing a customer wrote leaves the page", () => {
  it("no review body, buyer name, or date VALUE appears anywhere in the census", () => {
    const wire = JSON.stringify(census(reviewGrid(), PRODUCT_IDS));

    for (const secret of [REVIEW_BODY_A, REVIEW_BODY_B, BUYER_A, BUYER_B, "무난합니다", "이도윤", REVIEW_DATE]) {
      expect(wire, `leaked ${secret}`).not.toContain(secret);
    }
  });

  it("reports the date as WHICH SHAPE matched and how many — never a date", () => {
    const c = census(reviewGrid());

    const dotted = c.textShapes.find((s) => s.id === "dateDotted")!;
    expect(dotted.leafCount).toBe(3);
    expect(dotted.unitCount).toBe(3);
    expect(c.textShapes.find((s) => s.id === "dateDashed")!.leafCount).toBe(0);
  });

  it("**a shape match outside the units is reported as such**, so a pager cannot pass for a rating", () => {
    const c = census(withPager(reviewGrid()));

    // '1' '2' '3' in the pager match the rating-number shape. They are counted, and they are also reported as
    // sitting in NO unit — which is the difference between a rating column and page furniture.
    const rating = c.textShapes.find((s) => s.id === "ratingNumber")!;
    expect(rating.leafCount).toBe(3);
    expect(rating.unitCount).toBe(0);
    expect(c.pagination.numericPagerCount).toBe(3);
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

/* ───────────────────────────── the id and scope questions ───────────────────────────── */

describe("the identifier and catalog-scope readings", () => {
  it("finds a product id SellerOps already holds, and calls that OUR_CATALOG_CONFIRMED", () => {
    const c = census(reviewGrid({ reply: "button", productLink: true }), PRODUCT_IDS);

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

  it("reports id-candidate digit LENGTHS from markup and from printed text, separately", () => {
    const c = census(reviewGrid({ reply: "button", productLink: true }), PRODUCT_IDS);

    // The href carries an 11-digit product id — the markup route.
    expect(c.unit.unitAttributeDigitLengths).toContain(11);
    // Printed runs are the date's 4-2-2. Reported so the reading cannot be mistaken for a review id: the
    // 고객문의 screen is exactly where a printed number turned out to BE the identifier, and telling those
    // apart is a judgement for whoever reads the run, not one this probe should make silently.
    expect(c.unit.unitPrintedDigitLengths).toEqual([2, 4]);
  });

  it("measures the range and paging controls as structure", () => {
    const c = census(withPager(reviewGrid()));

    expect(c.pagination.dateInputCount).toBe(2);
    expect(c.pagination.selectCount).toBe(1);
  });
});

/* ───────────────────────────── the sanitizer ───────────────────────────── */

describe("the sanitizer refuses rather than degrades", () => {
  const LABELS = WING_REVIEW_FIELD_LABELS;
  const REPLIES = WING_REVIEW_REPLY_LABELS;
  const SHAPES = WING_REVIEW_TEXT_SHAPES;

  it("a non-object, a wrong reason, or an incoherent count is UNREADABLE", () => {
    for (const bad of [null, undefined, 42, "OK", { reason: "WAT" }, {}]) {
      expect(sanitizeReviewListCensus(bad, LABELS, REPLIES, SHAPES).reason).toBe("UNREADABLE");
    }
    expect(
      sanitizeReviewListCensus(
        { reason: "OK", elementsScanned: 5, shadowRootsFound: 0, elementsWithAnchorAttributes: 9 },
        LABELS,
        REPLIES,
        SHAPES,
      ).reason,
    ).toBe("UNREADABLE");
  });

  it("**a missing reply reading is UNREADABLE, not a quiet zero**", () => {
    // A zero here is indistinguishable from "Coupang has no reply feature", which is the one conclusion this
    // run must never reach by accident.
    const raw = {
      reason: "OK",
      elementsScanned: 10,
      shadowRootsFound: 0,
      elementsWithAnchorAttributes: 1,
      replyAffordances: [],
      labelCounts: [],
      textShapes: [],
      unit: {},
      pagination: {},
    };
    expect(sanitizeReviewListCensus(raw, LABELS, REPLIES, SHAPES).reason).toBe("UNREADABLE");
  });

  it("a MISSING label reading is UNREADABLE — a declared question with no answer is not a zero", () => {
    const raw = {
      reason: "OK",
      elementsScanned: 10,
      shadowRootsFound: 0,
      elementsWithAnchorAttributes: 1,
      replyAffordances: REPLIES.map((r) => ({ id: r.id, interactiveCount: 0, staticCount: 0 })),
      labelCounts: LABELS.slice(1).map((l) => ({ id: l.id, elementCount: 0 })),
      textShapes: [],
      unit: {},
      pagination: {},
    };
    expect(sanitizeReviewListCensus(raw, LABELS, REPLIES, SHAPES).reason).toBe("UNREADABLE");
  });

  it("a unit only counts as resolved when TWO labels agree — one word repeating is not a row", () => {
    const base = {
      reason: "OK",
      elementsScanned: 10,
      shadowRootsFound: 0,
      elementsWithAnchorAttributes: 1,
      replyAffordances: REPLIES.map((r) => ({ id: r.id, interactiveCount: 0, staticCount: 0 })),
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
    const one = sanitizeReviewListCensus(
      { ...base, unit: { level, labelsAgreeing: 1, unitCount: 4 } },
      LABELS,
      REPLIES,
      SHAPES,
    );
    expect(one.unit.resolved).toBe(false);
    expect(classifyReplyCapability(one).verdict).toBe("UNDETERMINED");

    const two = sanitizeReviewListCensus(
      { ...base, unit: { level, labelsAgreeing: 2, unitCount: 4 } },
      LABELS,
      REPLIES,
      SHAPES,
    );
    expect(two.unit.resolved).toBe(true);
    expect(classifyReplyCapability(two).verdict).toBe("NO_REPLY_CONTROL");
  });

  it("the PAGE cannot introduce an id of its own into the result", () => {
    const raw = {
      reason: "OK",
      elementsScanned: 10,
      shadowRootsFound: 0,
      elementsWithAnchorAttributes: 1,
      replyAffordances: [
        ...REPLIES.map((r) => ({ id: r.id, interactiveCount: 0, staticCount: 0 })),
        { id: "attackerSuppliedId", interactiveCount: 99, staticCount: 0 },
      ],
      labelCounts: [{ id: "alsoNotOurs", elementCount: 7 }],
      textShapes: [{ id: "neitherIsThis", leafCount: 3 }],
      unit: {},
      pagination: {},
    };
    const wire = JSON.stringify(sanitizeReviewListCensus(raw, LABELS, REPLIES, SHAPES));

    for (const injected of ["attackerSuppliedId", "alsoNotOurs", "neitherIsThis"]) {
      expect(wire).not.toContain(injected);
    }
  });

  it("a per-unit count can never exceed the number of units", () => {
    const raw = {
      reason: "OK",
      elementsScanned: 10,
      shadowRootsFound: 0,
      elementsWithAnchorAttributes: 1,
      replyAffordances: REPLIES.map((r) => ({ id: r.id, interactiveCount: 0, staticCount: 0 })),
      // Every declared label must come back. A missing one is a reading we cannot interpret, not a zero.
      labelCounts: LABELS.map((l) => ({ id: l.id, elementCount: 0 })),
      textShapes: [],
      unit: {
        level: {
          depth: 1,
          tagName: "LI",
          siblingCount: 3,
          siblingsSharingClassShape: 3,
          classTokenCount: 0,
          attributeKinds: [],
          hasDetailAffordance: false,
          digitRunLengths: [],
        },
        labelsAgreeing: 3,
        unitCount: 3,
        unitsWithImage: 900,
      },
      pagination: {},
    };
    expect(sanitizeReviewListCensus(raw, LABELS, REPLIES, SHAPES).unit.unitsWithImage).toBe(3);
  });
});
