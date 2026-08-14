/**
 * **Discovering what a WING 상품평 screen IS, without reading a single review.**
 *
 * Pure: types, a sanitizer, and the two classifications this discovery exists to produce.
 *
 * ## Why this probe is shaped differently from the 고객문의 one
 *
 * That probe had an anchor. SellerOps already held the inquiry's own id, so the match could run inwards — we
 * hand the page a digit string, the page hands back a count. **Here there is nothing to hand in.** Coupang
 * publishes no review API (`developers.coupang.com` lists 11 API categories and no review endpoint among them),
 * so SellerOps holds no review id, no review date, and no rating. The screen is the first contact.
 *
 * So the anchors are the only strings we can legitimately supply: **Coupang's own fixed UI words**. `평점`,
 * `작성일`, `답글` — ours to state, compared in-page, reduced to counts. Wherever they land, the repeating
 * structure around them is measured, and the unit they AGREE on is the review row. The row tag is a finding,
 * never an assumption — the lesson three 고객문의 sittings paid for.
 *
 * ## The question this run exists to answer first
 *
 * **Does a seller reply control exist at all?** Everything downstream forks on it: with one, Coupang review
 * operations can reach a guided human-in-the-loop reply; without one, the channel is acquisition-and-analysis
 * only and no amount of engineering changes that. It is answered independently of the row structure, so a
 * screen whose layout we fail to resolve still yields the answer — and it distinguishes an INTERACTIVE `답글`
 * from a printed one, because `답글여부` as a column header is a word, not a capability. Counting them together
 * would report a reply feature on a screen that has none, which is the most expensive wrong answer available
 * here.
 *
 * ## What may not cross, and what that leaves
 *
 * Review bodies, buyer names, product names, photos and videos are all on this screen, and **none of them is
 * read into any returned field.** Attribute values, class names, and `src` never travel. Page text is read in
 * exactly one function (the shared primitives' `textOf`) and compared there against fixed platform words and
 * SHAPE patterns we supply, reduced to a count before it can be returned. Dates come back as *which pattern
 * matched and how many* — never a date. Ratings come back as *how many cells carry a rating-shaped token* —
 * never a rating.
 *
 * **Page text never leaves the page** is the honest claim. "Nothing is read" would be false, and a disclosure
 * that overstates its boundary is the kind that quietly stops being true.
 */

/** The STRUCTURAL attributes an identifier may be looked for in. Nothing else is read, in any element. */
export const REVIEW_ATTRIBUTE_KINDS = ["HREF", "ID", "DATA"] as const;
export type ReviewAttributeKind = (typeof REVIEW_ATTRIBUTE_KINDS)[number];

/** One fixed PLATFORM literal to look for — Coupang's own UI word, supplied by us, never read off the page. */
export interface ReviewLabelExpectation {
  readonly id: string;
  readonly exactText: string;
}

/**
 * One identifier SellerOps already holds, as a digit string.
 *
 * For this screen that means a `sellerProductId` / `productId` from our own catalog — never a review id, which
 * we have no way to hold. Matched as a WHOLE digit run: a prefix match would attribute a review to the wrong
 * product, and that reads identically to success in any log.
 */
export interface ReviewDigitExpectation {
  readonly id: string;
  readonly digits: string;
}

/**
 * One text SHAPE to test for — a date format, a rating token.
 *
 * `pattern` is an ES5 regex source string **we** supply and the page never contributes to. It exists so the
 * probe can report "this column holds dates in `YYYY.MM.DD`" without any date crossing the boundary: what
 * comes back is which shape id matched and how many leaves matched it.
 */
export interface ReviewTextShape {
  readonly id: string;
  readonly pattern: string;
}

/** Why a census refused. Every one is fail-closed — never a partial reading. */
export const REVIEW_CENSUS_REFUSALS = [
  /** The scan hit its element budget; a truncated page cannot be counted honestly. */
  "SCAN_TRUNCATED",
  /** The document held no elements to scan at all. */
  "NO_ELEMENTS",
  /** The script returned something that is not a census. */
  "UNREADABLE",
] as const;
export type ReviewCensusRefusal = (typeof REVIEW_CENSUS_REFUSALS)[number];

/**
 * One level of repetition. A cell repeats across a row and a row repeats down a list, and both are true at
 * once — so every level is reported and none is declared "the row" from inside the measurement.
 */
export interface ReviewRepeatLevel {
  readonly depth: number;
  readonly tagName: string;
  /** Same-tag siblings, including this element. */
  readonly siblingCount: number;
  /** How many of those siblings carry an identical class shape. Compared in-page; only the count travels. */
  readonly siblingsSharingClassShape: number;
  /** How many class tokens this element carries. A shape, not a name. */
  readonly classTokenCount: number;
  readonly attributeKinds: readonly ReviewAttributeKind[];
  readonly hasDetailAffordance: boolean;
  /** LENGTHS of the digit runs this unit carries in allowlisted attributes. Lengths, never values. */
  readonly digitRunLengths: readonly number[];
}

/**
 * **The reply reading — the finding this whole run is for.**
 *
 * `interactiveCount` and `staticCount` are separate because collapsing them is the difference between "sellers
 * can answer reviews on Coupang" and "the word 답글 appears on the screen". A `답글여부` column header is a
 * printed word; a `답글 등록` button is a product capability. Only the first of those is safe to be wrong about.
 */
export interface ReviewReplyAffordance {
  readonly id: string;
  /** Hits on a button / link / `[role=button]` / submit input — a control a seller could press. */
  readonly interactiveCount: number;
  /** Hits on a leaf that is not interactive — a header, a state word, a legend. Never a capability. */
  readonly staticCount: number;
  /** How many of the interactive hits sit inside the resolved review unit rather than in page furniture. */
  readonly insideUnitCount: number;
}

/** Per-label outcome, and the repeat level its hits agree on. */
export interface ReviewLabelCount {
  readonly id: string;
  readonly elementCount: number;
  /** The repeat the hits AGREE on, as the most common (tag, sibling count) across their whole chains. */
  readonly sharedRepeatLevel: ReviewRepeatLevel | null;
  readonly hitsSharingRepeatShape: number;
}

/** Per-shape outcome: how many leaves matched, and how many of them sit inside the resolved unit. */
export interface ReviewTextShapeCount {
  readonly id: string;
  readonly leafCount: number;
  readonly unitCount: number;
}

/**
 * **The review unit — the row or card, measured rather than assumed.**
 *
 * Resolved as the repeat level the most distinct field labels agree on. A screen where `평점`, `작성일` and
 * `답글` all sit inside the same repeating `LI` has told us what a review is; a screen where they agree on
 * nothing has told us the labels found page furniture, and that is a refusal rather than a row.
 */
export interface ReviewUnitReading {
  readonly resolved: boolean;
  readonly level: ReviewRepeatLevel | null;
  /** How many distinct field labels' hits share this level. One label agreeing with itself is not a row. */
  readonly labelsAgreeing: number;
  /** How many units were measured. Markup, not reviews — a header row is a sibling too. */
  readonly unitCount: number;
  readonly unitsWithDetailAffordance: number;
  /** Units containing at least one `<img>`. Counts only — no `src`, no alt text, no dimensions. */
  readonly unitsWithImage: number;
  /** Units containing at least one `<video>`. */
  readonly unitsWithVideo: number;
  /** Units containing an element that carries an `aria-valuenow` ATTRIBUTE — presence, never its value. */
  readonly unitsWithRatingAria: number;
  /** Units containing an element whose class shape contains a fixed token we supplied (`star`, `rating`, …). */
  readonly unitsWithStarLikeClass: number;
  /** Units carrying an identifier SellerOps already holds — the only evidence of catalog scope available. */
  readonly unitsMatchingOurDigits: number;
  /**
   * Digit-run LENGTHS inside units, in allowlisted ATTRIBUTES — the stable-review-id question, asked of markup.
   *
   * Lengths, never values. The 고객문의 calibration is why this is measured rather than assumed either way:
   * that screen's attribute digit lengths were `[1,2,3,4,10,14]` while the id we needed was 9 — the length was
   * simply absent, and no amount of selector work was ever going to find it.
   */
  readonly unitAttributeDigitLengths: readonly number[];
  /** The same question asked of PRINTED text, because on 고객문의 that is where the identifier turned out to be. */
  readonly unitPrintedDigitLengths: readonly number[];
  /** Units containing an interactive reply control. */
  readonly unitsWithReplyControl: number;
  /** Units containing a `textarea` or `contenteditable` — a place a reply could be typed. */
  readonly unitsWithReplyInput: number;
}

/**
 * The paging and range controls, as counts of structure. This answers how much history a single acquisition
 * could reach — the difference between a channel we can backfill and one we can only watch going forward.
 */
export interface ReviewPaginationReading {
  /** `input[type=date]` elements. A tag-plus-type presence test; no value is read. */
  readonly dateInputCount: number;
  /** `select` elements — the usual carrier of a 최근 1개월 / 3개월 range. */
  readonly selectCount: number;
  /** Leaves whose whole text is a 1–3 digit page number and which share a repeat. A pager, measured. */
  readonly numericPagerCount: number;
}

/**
 * The whole structural reading of one 상품평 screen. Integers, enums, tag names, and the ids we supplied.
 * No text, no selector, no href, no class name, no attribute VALUE, no `src`.
 */
export interface ReviewListCensus {
  readonly reason: "OK" | ReviewCensusRefusal;
  readonly elementsScanned: number;
  readonly shadowRootsFound: number;
  readonly elementsWithAnchorAttributes: number;
  readonly anchorDigitRunLengths: readonly number[];
  readonly replyAffordances: readonly ReviewReplyAffordance[];
  readonly labelCounts: readonly ReviewLabelCount[];
  readonly textShapes: readonly ReviewTextShapeCount[];
  readonly unit: ReviewUnitReading;
  readonly pagination: ReviewPaginationReading;
}

/**
 * One frame's reading. WING embeds sub-applications, and a document-wide scan of the TOP document is still a
 * scan of the wrong document when the list lives in a child frame. Identified by INDEX only — a frame URL
 * carries the seller's own account path.
 */
export interface ReviewFrameCensus {
  readonly frameIndex: number;
  readonly census: ReviewListCensus;
}

/* ─────────────────────────────── the two classifications ─────────────────────────────── */

/**
 * Whether a seller reply control exists on this screen.
 *
 * `UNDETERMINED` is not a hedge, it is the honest third state. "No reply control" may only be claimed from a
 * reading that actually found the review list — on a screen whose unit never resolved, zero interactive `답글`
 * hits is equally consistent with "the probe never reached the rows", and that is exactly the confident zero
 * three 고객문의 sittings produced.
 */
export const REVIEW_REPLY_VERDICTS = ["REPLY_CONTROL_PRESENT", "NO_REPLY_CONTROL", "UNDETERMINED"] as const;
export type ReviewReplyVerdict = (typeof REVIEW_REPLY_VERDICTS)[number];

export interface ReviewReplyClassification {
  readonly verdict: ReviewReplyVerdict;
  /** Which label ids carried an interactive hit. Ours, never the page's words. */
  readonly interactiveLabelIds: readonly string[];
  /** Whether any label appeared ONLY as printed text — a 답글여부 header, not a capability. */
  readonly printedOnly: boolean;
}

/**
 * **The fork this unit exists to decide.** One interactive hit is enough to say a control is present; saying
 * it is absent requires a reading that resolved the review unit first.
 */
export function classifyReplyCapability(census: ReviewListCensus | null | undefined): ReviewReplyClassification {
  if (!census || census.reason !== "OK") {
    return { verdict: "UNDETERMINED", interactiveLabelIds: [], printedOnly: false };
  }
  const interactiveLabelIds = census.replyAffordances.filter((a) => a.interactiveCount > 0).map((a) => a.id);
  const printedOnly =
    interactiveLabelIds.length === 0 && census.replyAffordances.some((a) => a.staticCount > 0);
  if (interactiveLabelIds.length > 0) {
    return { verdict: "REPLY_CONTROL_PRESENT", interactiveLabelIds, printedOnly: false };
  }
  // No control found. That is only a FINDING if the probe demonstrably reached the reviews.
  if (!census.unit.resolved) {
    return { verdict: "UNDETERMINED", interactiveLabelIds: [], printedOnly };
  }
  return { verdict: "NO_REPLY_CONTROL", interactiveLabelIds: [], printedOnly };
}

/**
 * Whether this screen is scoped to the seller's own catalog.
 *
 * Deliberately asymmetric. Finding a product id we hold proves our catalog is on the screen; finding none
 * proves nothing at all — the id may simply not be printed or marked up, exactly as the 접수번호 was not. So
 * there is no `OTHER_SELLERS_ITEMS` verdict: the probe cannot earn it, and a verdict a measurement cannot earn
 * has no business existing.
 *
 * This matters more on Coupang than it would elsewhere. Coupang shares 상품평 across every seller of the same
 * item, so "reviews on my product page" and "reviews of my sales" are not the same set, and no screen reading
 * can separate them.
 */
export const REVIEW_SCOPE_VERDICTS = ["OUR_CATALOG_CONFIRMED", "NOT_ESTABLISHED"] as const;
export type ReviewScopeVerdict = (typeof REVIEW_SCOPE_VERDICTS)[number];

export function classifyOwnershipScope(census: ReviewListCensus | null | undefined): ReviewScopeVerdict {
  if (!census || census.reason !== "OK") return "NOT_ESTABLISHED";
  return census.unit.unitsMatchingOurDigits > 0 ? "OUR_CATALOG_CONFIRMED" : "NOT_ESTABLISHED";
}

/* ─────────────────────────────────── the sanitizer ─────────────────────────────────── */

const REFUSALS: readonly string[] = REVIEW_CENSUS_REFUSALS;
const ATTRIBUTE_KINDS: readonly string[] = REVIEW_ATTRIBUTE_KINDS;

/** A safe non-negative integer, or null. Anything else is a reading we will not trust. */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000
    ? value
    : null;
}

/**
 * A tag name we are willing to echo. Uppercase, short, dashes allowed for custom elements — conservative
 * enough that an attribute value cannot masquerade as one.
 */
function tagName(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z][A-Z0-9-]{0,23}$/.test(value) ? value : null;
}

function attributeKinds(value: unknown): readonly ReviewAttributeKind[] {
  const raw = Array.isArray(value) ? value : [];
  return REVIEW_ATTRIBUTE_KINDS.filter((k) => raw.some((v) => v === k && ATTRIBUTE_KINDS.includes(k)));
}

/** How many distinct digit-run lengths may be reported. A distribution, not an inventory. */
const MAX_DIGIT_LENGTHS = 12;

function digitRunLengths(value: unknown): readonly number[] {
  const raw = Array.isArray(value) ? value : [];
  const lengths = raw.filter(
    (n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 64,
  );
  return [...new Set(lengths)].sort((a, b) => a - b).slice(0, MAX_DIGIT_LENGTHS);
}

/** One level, or null when any field is missing or incoherent. A bad level drops; it never degrades a good one. */
function sanitizeRepeatLevel(raw: unknown): ReviewRepeatLevel | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  const depth = count(l.depth);
  const tag = tagName(l.tagName);
  const siblingCount = count(l.siblingCount);
  const siblingsSharingClassShape = count(l.siblingsSharingClassShape);
  const classTokenCount = count(l.classTokenCount);
  if (
    depth === null ||
    tag === null ||
    siblingCount === null ||
    siblingsSharingClassShape === null ||
    classTokenCount === null
  ) {
    return null;
  }
  // A repeating level has at least two siblings, and no more can share its shape than exist.
  if (siblingCount < 2 || siblingsSharingClassShape > siblingCount) return null;
  return {
    depth,
    tagName: tag,
    siblingCount,
    siblingsSharingClassShape,
    classTokenCount,
    attributeKinds: attributeKinds(l.attributeKinds),
    hasDetailAffordance: l.hasDetailAffordance === true,
    digitRunLengths: digitRunLengths(l.digitRunLengths),
  };
}

/** A unit reading that measured nothing. Never "resolved with zeroes", which would read as an empty list. */
const REFUSED_UNIT: ReviewUnitReading = Object.freeze({
  resolved: false,
  level: null,
  labelsAgreeing: 0,
  unitCount: 0,
  unitsWithDetailAffordance: 0,
  unitsWithImage: 0,
  unitsWithVideo: 0,
  unitsWithRatingAria: 0,
  unitsWithStarLikeClass: 0,
  unitsMatchingOurDigits: 0,
  unitAttributeDigitLengths: [],
  unitPrintedDigitLengths: [],
  unitsWithReplyControl: 0,
  unitsWithReplyInput: 0,
});

const REFUSED_PAGINATION: ReviewPaginationReading = Object.freeze({
  dateInputCount: 0,
  selectCount: 0,
  numericPagerCount: 0,
});

/**
 * The unit reading, fail-closed. A unit is only `resolved` when a coherent level came back AND at least two
 * distinct labels agree on it — one label agreeing with itself is a repeated word, not a row.
 */
function sanitizeUnit(raw: unknown): ReviewUnitReading {
  if (!raw || typeof raw !== "object") return REFUSED_UNIT;
  const u = raw as Record<string, unknown>;
  const level = sanitizeRepeatLevel(u.level);
  const labelsAgreeing = count(u.labelsAgreeing);
  const unitCount = count(u.unitCount);
  if (level === null || labelsAgreeing === null || unitCount === null) return REFUSED_UNIT;

  const per = (v: unknown): number => Math.min(count(v) ?? 0, unitCount);
  return {
    // THE RULE. Two independent field labels landing in the same repeating shape is what makes it a review row.
    resolved: labelsAgreeing >= 2 && unitCount >= 1,
    level,
    labelsAgreeing,
    unitCount,
    unitsWithDetailAffordance: per(u.unitsWithDetailAffordance),
    unitsWithImage: per(u.unitsWithImage),
    unitsWithVideo: per(u.unitsWithVideo),
    unitsWithRatingAria: per(u.unitsWithRatingAria),
    unitsWithStarLikeClass: per(u.unitsWithStarLikeClass),
    unitsMatchingOurDigits: per(u.unitsMatchingOurDigits),
    unitAttributeDigitLengths: digitRunLengths(u.unitAttributeDigitLengths),
    unitPrintedDigitLengths: digitRunLengths(u.unitPrintedDigitLengths),
    unitsWithReplyControl: per(u.unitsWithReplyControl),
    unitsWithReplyInput: per(u.unitsWithReplyInput),
  };
}

function sanitizePagination(raw: unknown): ReviewPaginationReading {
  if (!raw || typeof raw !== "object") return REFUSED_PAGINATION;
  const p = raw as Record<string, unknown>;
  return {
    dateInputCount: count(p.dateInputCount) ?? 0,
    selectCount: count(p.selectCount) ?? 0,
    numericPagerCount: count(p.numericPagerCount) ?? 0,
  };
}

/**
 * **Total, fail-closed sanitizer** for whatever the page returned. Every field is re-derived and re-typed here;
 * nothing is passed through because it looked plausible.
 *
 * The ids echoed back are matched against the expectations the CALLER supplied, so the page cannot introduce a
 * string of its own into the result — the one place a page-controlled value could otherwise have travelled.
 */
export function sanitizeReviewListCensus(
  raw: unknown,
  labelExpectations: readonly ReviewLabelExpectation[],
  replyExpectations: readonly ReviewLabelExpectation[],
  shapeExpectations: readonly ReviewTextShape[],
): ReviewListCensus {
  const refused = (reason: "OK" | ReviewCensusRefusal): ReviewListCensus => ({
    reason,
    elementsScanned: 0,
    shadowRootsFound: 0,
    elementsWithAnchorAttributes: 0,
    anchorDigitRunLengths: [],
    replyAffordances: [],
    labelCounts: [],
    textShapes: [],
    unit: REFUSED_UNIT,
    pagination: REFUSED_PAGINATION,
  });
  if (!raw || typeof raw !== "object") return refused("UNREADABLE");
  const r = raw as Record<string, unknown>;
  const reason = typeof r.reason === "string" ? r.reason : null;
  if (reason !== "OK") {
    return refused(reason && REFUSALS.includes(reason) ? (reason as ReviewCensusRefusal) : "UNREADABLE");
  }
  const elementsScanned = count(r.elementsScanned);
  const shadowRootsFound = count(r.shadowRootsFound);
  const elementsWithAnchorAttributes = count(r.elementsWithAnchorAttributes);
  if (elementsScanned === null || shadowRootsFound === null || elementsWithAnchorAttributes === null) {
    return refused("UNREADABLE");
  }
  // More elements carrying anchors than elements scanned is incoherent — refuse rather than reconcile it.
  if (elementsWithAnchorAttributes > elementsScanned) return refused("UNREADABLE");

  const find = (list: unknown, id: string): Record<string, unknown> | undefined =>
    (Array.isArray(list) ? list : []).find(
      (e) => e && typeof e === "object" && (e as Record<string, unknown>).id === id,
    ) as Record<string, unknown> | undefined;

  const replyAffordances: ReviewReplyAffordance[] = [];
  for (const expectation of replyExpectations) {
    const found = find(r.replyAffordances, expectation.id);
    const interactiveCount = count(found?.interactiveCount);
    const staticCount = count(found?.staticCount);
    // The reply reading is the point of the run. An unreadable one must not degrade to a quiet zero, which
    // would be indistinguishable from "Coupang has no reply feature".
    if (interactiveCount === null || staticCount === null) return refused("UNREADABLE");
    replyAffordances.push({
      id: expectation.id,
      interactiveCount,
      staticCount,
      insideUnitCount: Math.min(count(found?.insideUnitCount) ?? 0, interactiveCount),
    });
  }

  const labelCounts: ReviewLabelCount[] = [];
  for (const expectation of labelExpectations) {
    const found = find(r.labelCounts, expectation.id);
    const elementCount = count(found?.elementCount);
    if (elementCount === null) return refused("UNREADABLE");
    labelCounts.push({
      id: expectation.id,
      elementCount,
      sharedRepeatLevel: elementCount > 0 ? sanitizeRepeatLevel(found?.sharedRepeatLevel) : null,
      hitsSharingRepeatShape: Math.min(count(found?.hitsSharingRepeatShape) ?? 0, elementCount),
    });
  }

  const textShapes: ReviewTextShapeCount[] = [];
  for (const expectation of shapeExpectations) {
    const found = find(r.textShapes, expectation.id);
    const leafCount = count(found?.leafCount) ?? 0;
    textShapes.push({
      id: expectation.id,
      leafCount,
      unitCount: Math.min(count(found?.unitCount) ?? 0, leafCount),
    });
  }

  return {
    reason: "OK",
    elementsScanned,
    shadowRootsFound,
    elementsWithAnchorAttributes,
    anchorDigitRunLengths: digitRunLengths(r.anchorDigitRunLengths),
    replyAffordances,
    labelCounts,
    textShapes,
    unit: sanitizeUnit(r.unit),
    pagination: sanitizePagination(r.pagination),
  };
}
