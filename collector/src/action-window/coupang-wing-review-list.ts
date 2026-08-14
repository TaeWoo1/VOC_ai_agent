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
 * ## The question this run exists to answer
 *
 * **Can a review be acquired and de-duplicated at all?** The reply question is closed: the operator confirmed
 * WING offers sellers no way to answer a 상품평, so Coupang review operations are acquisition-and-analysis
 * only and no measurement here can change that. This probe therefore does not look for a reply control, does
 * not count one, and cannot report one — a measurement kept "for later" after being told not to use it is a
 * measurement that quietly gets used.
 *
 * What acquisition needs before anything is designed is a **stable identifier**. Not a plausible one: one that
 * is present on each review and DIFFERENT for each. So identifier candidates are reported as a pair of counts
 * per digit length — how many units carry a run of that length, and how many DISTINCT values those runs have.
 * Equal counts mean a dedupe key; `unitsCarrying` far above `distinctValues` means a category code that would
 * collapse every review into one row.
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

/** Why the catalog-column probe refused. */
export const REVIEW_COLUMN_REFUSALS = ["HEADER_NOT_FOUND", "HEADER_AMBIGUOUS", "NO_CELLS"] as const;
export type ReviewColumnRefusal = (typeof REVIEW_COLUMN_REFUSALS)[number];

/**
 * **The `노출상품ID (옵션ID)` column — the seller's catalog identity, printed rather than marked up.**
 *
 * The operator read this column off the real screen; no field-word scan had found it. Coupang's own
 * definitions make those two numbers `productId` and `vendorItemId`, which means catalog identity is available
 * per row **without SellerOps supplying anything** — and available in exactly the place three 고객문의 sittings
 * of attribute scanning were never going to look.
 *
 * It is also the better anchor for the row itself: one cell per review, by construction.
 *
 * Column scope is a SAFETY property, not a convenience. Other columns hold digit runs too, and matching a
 * catalog id against one of those would attribute a review to the wrong product.
 */
export interface ReviewColumnProbe {
  readonly reason: "OK" | ReviewColumnRefusal;
  /** Which header spelling matched, as the id WE supplied. Never the page's text. */
  readonly headerId: string | null;
  readonly cellsInColumn: number;
  readonly cellsWithDigits: number;
  /** Cells printing TWO runs — the `노출상품ID (옵션ID)` shape, product and option together. */
  readonly cellsWithTwoRuns: number;
  /** Distinct FIRST runs (productId). Fewer than the cell count means several reviews share a product. */
  readonly distinctFirstRunValues: number;
  /** Distinct SECOND runs (vendorItemId). Counts only — the values stay in the page. */
  readonly distinctSecondRunValues: number;
  /** Cells carrying a digit SellerOps already holds. The catalog match, as a count. */
  readonly cellsMatchingOurDigits: number;
}

/** How the review unit was resolved. Reported so a reading cannot be mistaken for the stronger one. */
export const REVIEW_UNIT_SOURCES = ["COLUMN", "LABEL_AGREEMENT"] as const;
export type ReviewUnitSource = (typeof REVIEW_UNIT_SOURCES)[number];

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
 * **A sort / period / paging control, split by whether it is pressable.**
 *
 * `interactiveCount` and `staticCount` are separate because a printed `최근 1개월` is a caption describing what
 * the screen is already showing, and a pressable one is a range the acquisition could ASK for. Only the second
 * makes incremental collection possible, and collapsing them would report a filter on a screen that has none.
 */
export interface ReviewControlAffordance {
  readonly id: string;
  /** Hits on a button / link / `[role=button]` / submit input — a control a seller could press. */
  readonly interactiveCount: number;
  /** Hits on a leaf that is not interactive — a caption, a legend, a column header. Never a control. */
  readonly staticCount: number;
  /** How many of the interactive hits sit inside the resolved review unit rather than in page furniture. */
  readonly insideUnitCount: number;
}

/**
 * **An identifier candidate — the reading acquisition cannot be designed without.**
 *
 * A dedupe key has to be present on each review and DIFFERENT for each. Those are two properties and a single
 * count cannot express both, so both travel: how many units carry a digit run of this length, and how many
 * DISTINCT values those runs have.
 *
 *  - `unitsCarrying === distinctValues` — every carrier's run is unique. A dedupe key candidate.
 *  - `unitsCarrying` far above `distinctValues` — a category code, a page size, a rating. Collecting on it
 *    would collapse every review on the screen into one row, and the collapse would look like successful
 *    de-duplication.
 *
 * **Lengths and counts only.** The values are compared inside the page and never returned; a distinct-value
 * count identifies nothing and no one.
 */
export interface ReviewIdCandidate {
  /** Where the run was found. Attribute runs survive a re-render; printed ones are what the seller can see. */
  readonly source: "ATTRIBUTE" | "PRINTED";
  readonly digitLength: number;
  readonly unitsCarrying: number;
  readonly distinctValues: number;
  /** Derived, and the whole point: every unit that carries one carries a different one. */
  readonly uniquePerUnit: boolean;
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
 * `상품평` all sit inside the same repeating `LI` has told us what a review is; a screen where they agree on
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
  /**
   * Units carrying their own `<a href>` — a per-review DETAIL URL, which is both an identifier and the only
   * route to anything the list does not show. Counted; the address itself never travels.
   */
  readonly unitsWithDetailLink: number;
  /** Identifier candidates, per source and length. The dedupe-key question, answered with two counts. */
  readonly idCandidates: readonly ReviewIdCandidate[];
  /**
   * How many text-printing leaves each unit holds, in unit order.
   *
   * A structural count, in the same family as `unitCount` — it says nothing about anyone. It is here because
   * a row that carries fewer cells than its neighbours is a **different kind of row**, and that is the first
   * hypothesis for why an identifier covers some rows and not others. A uniform list rules the hypothesis out;
   * a split list names the cause without a second sitting.
   */
  readonly leafCounts: readonly number[];
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
  /**
   * The largest page number the pager prints.
   *
   * Not a value about anyone — it is how far back the screen admits to going, and therefore the difference
   * between a channel that can be backfilled and one that can only be watched forward. `0` when no pager was
   * found, which is a finding rather than "one page".
   */
  readonly highestPagerNumber: number;
}

/**
 * **One digit-run length, seen at one cell position across the rows.**
 *
 * The first reading proved that "a 10-digit run exists somewhere in the row, unique where present, on 7 of 10
 * rows" is not enough to build on. It names no column, so nothing can extract it; and it cannot say WHY three
 * rows lack it. Both gaps close by asking the same question *per cell position* instead of per row.
 */
export interface ReviewCellRun {
  readonly digitLength: number;
  readonly unitsCarrying: number;
  readonly distinctValues: number;
  /** Every unit carrying a run of this length at this position carries a different one. */
  readonly uniquePerUnit: boolean;
}

/**
 * **One cell position, across every review row.**
 *
 * Cells are indexed by their order among the row's own text-printing leaves — a position, not a selector and
 * not a column name. A key at a known position is *extractable*; a key known only to be "somewhere in the row"
 * is not, which is why this exists.
 *
 * `unitsWithCell` below the unit count is itself a finding: rows that do not reach this position are a
 * different row shape, and that is the most likely explanation for a partial identifier.
 */
export interface ReviewCellReading {
  readonly cellIndex: number;
  readonly unitsWithCell: number;
  readonly runs: readonly ReviewCellRun[];
  /** How many units carry a leaf matching each supplied shape at this position — a date column, a rating column. */
  readonly shapeHits: readonly ReviewCellShapeHit[];
}

export interface ReviewCellShapeHit {
  readonly shapeId: string;
  readonly unitCount: number;
}

/**
 * **A `<select>`, profiled for whether it could ask for a range.**
 *
 * The first reading found 4 selects and 0 date inputs, which says a period filter exists but not what it can
 * reach. An option count and how many options carry a period word we supplied is the difference between
 * "there is a dropdown" and "the acquisition can request 6 months".
 */
export interface ReviewSelectReading {
  readonly optionCount: number;
  /** Options whose whole text equals one of the period words WE supplied. Ours to state, counted in-page. */
  readonly optionsMatchingControlLabels: number;
  readonly insideUnit: boolean;
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
  readonly controlAffordances: readonly ReviewControlAffordance[];
  /** Which route resolved the review unit — the column (strong) or field-word agreement (weaker). */
  readonly unitSource: ReviewUnitSource;
  readonly columnProbe: ReviewColumnProbe;
  readonly labelCounts: readonly ReviewLabelCount[];
  readonly textShapes: readonly ReviewTextShapeCount[];
  readonly unit: ReviewUnitReading;
  readonly pagination: ReviewPaginationReading;
  /** Per cell POSITION across the rows — where an extractable key lives, and why some rows lack one. */
  readonly cells: readonly ReviewCellReading[];
  /** Every `<select>` on the screen, profiled for range reach. */
  readonly selects: readonly ReviewSelectReading[];
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
 * **Whether a review could be acquired and de-duplicated at all.**
 *
 * `UNDETERMINED` is not a hedge, it is the honest third state. "No identifier" may only be claimed from a
 * reading that actually found the review list — on a screen whose unit never resolved, finding no candidate is
 * equally consistent with "the probe never reached the rows", and that is exactly the confident zero three
 * 고객문의 sittings produced.
 *
 * The bar for `IDENTIFIER_FOUND` is uniqueness, not presence. A length that every unit carries but that has
 * one distinct value is a category code; collecting on it would fold every review into a single row, and the
 * fold would look exactly like de-duplication working.
 */
export const REVIEW_ACQUISITION_VERDICTS = [
  "IDENTIFIER_FOUND",
  /**
   * Unique where present, but **not present on every review**.
   *
   * A third state, because the bar this module states — "present on each review and DIFFERENT for each" — is
   * two properties, and the first version only enforced the second. The first real reading found a 10-digit
   * number that was unique on every unit carrying it and carried by 7 of 10 units, and reported
   * `IDENTIFIER_FOUND`. An acquisition built on that would silently drop three reviews in ten.
   */
  "IDENTIFIER_PARTIAL",
  "NO_IDENTIFIER",
  "UNDETERMINED",
] as const;
export type ReviewAcquisitionVerdict = (typeof REVIEW_ACQUISITION_VERDICTS)[number];

export interface ReviewAcquisitionClassification {
  readonly verdict: ReviewAcquisitionVerdict;
  /** The candidates that are unique per carrying unit — the ones a dedupe key could be built on. */
  readonly dedupeKeyCandidates: readonly ReviewIdCandidate[];
  /** Whether any unit exposes its own detail link, which is an identifier and a route in one. */
  readonly detailLinkPresent: boolean;
  /**
   * Whether the resolved "unit" is really a CONTAINER holding many reviews rather than one.
   *
   * The independent check on the unit resolution, and it exists because the first live reading needed one: the
   * probe resolved a four-member `DIV` set that held **ten dates**, reported every identifier length as
   * carried by exactly one member, and produced a confident `NO_IDENTIFIER`. A review row holds one review's
   * worth of evidence; a container holds everyone's.
   */
  readonly containerSuspected: boolean;
  /**
   * The best candidate's coverage — carriers over units, 0..1. Reported rather than folded into the verdict,
   * because "unique on 7 of 10" and "unique on 10 of 10" are different engineering problems.
   */
  readonly bestCoverage: number;
}

/** At least two carriers, because "one unit carries one distinct value" is true of everything. */
const MIN_CARRIERS_FOR_A_KEY = 2;

/**
 * How many of one shape a unit may hold before it stops looking like one review. Two, not one: a row can
 * legitimately print 작성일 and 수정일, or a rating and a helpful-vote count.
 */
const MAX_SHAPE_HITS_PER_UNIT = 2;

export function classifyAcquisitionFeasibility(
  census: ReviewListCensus | null | undefined,
): ReviewAcquisitionClassification {
  if (!census || census.reason !== "OK" || !census.unit.resolved) {
    return {
      verdict: "UNDETERMINED",
      dedupeKeyCandidates: [],
      detailLinkPresent: false,
      containerSuspected: false,
      bestCoverage: 0,
    };
  }
  // The unit resolved — but did it resolve to a REVIEW? A set of four that holds ten dates has not.
  const busiest = census.textShapes.reduce((max, s) => Math.max(max, s.unitCount), 0);
  if (census.unit.unitCount > 0 && busiest > census.unit.unitCount * MAX_SHAPE_HITS_PER_UNIT) {
    return {
      verdict: "UNDETERMINED",
      dedupeKeyCandidates: [],
      detailLinkPresent: census.unit.unitsWithDetailLink > 0,
      containerSuspected: true,
      bestCoverage: 0,
    };
  }
  const detailLinkPresent = census.unit.unitsWithDetailLink > 0;
  const dedupeKeyCandidates = census.unit.idCandidates.filter(
    (c) => c.uniquePerUnit && c.unitsCarrying >= MIN_CARRIERS_FOR_A_KEY,
  );
  const bestCoverage = dedupeKeyCandidates.reduce(
    (max, c) => Math.max(max, census.unit.unitCount > 0 ? c.unitsCarrying / census.unit.unitCount : 0),
    0,
  );
  // FULL coverage, or it is partial. A key on 7 of 10 reviews drops three in ten, quietly.
  const verdict =
    dedupeKeyCandidates.length === 0
      ? "NO_IDENTIFIER"
      : bestCoverage >= 1
        ? "IDENTIFIER_FOUND"
        : "IDENTIFIER_PARTIAL";
  return { verdict, dedupeKeyCandidates, detailLinkPresent, containerSuspected: false, bestCoverage };
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
  // The column is the stronger evidence and is checked first: a match inside the ONE column whose header names
  // 노출상품ID is a match against a catalog id, where a match anywhere in a row could be an order number.
  if (census.columnProbe.reason === "OK" && census.columnProbe.cellsMatchingOurDigits > 0) {
    return "OUR_CATALOG_CONFIRMED";
  }
  return census.unit.unitsMatchingOurDigits > 0 ? "OUR_CATALOG_CONFIRMED" : "NOT_ESTABLISHED";
}

/**
 * **The canonical key — and the locate anchor, which turn out to be the same reading.**
 *
 * Acquisition needs a value that is present on every review, different for every review, and *extractable from
 * a known position*. `[쿠팡에서 보기]` needs a value that identifies one review on a re-rendered screen. Those
 * are the same three properties, so they are decided once rather than by two rules that could disagree — and a
 * key we could store but not re-find would be worse than none, because it would look like it worked.
 *
 * `PARTIAL_COVERAGE` is kept distinct from `NO_UNIQUE_POSITION` deliberately. The first reading found a run
 * that was unique on all 7 of the 10 rows carrying it; treated as a key, an acquisition would have silently
 * dropped three reviews in ten, and every count downstream would have agreed with itself.
 */
export const REVIEW_KEY_VERDICTS = [
  "KEY_FOUND",
  /** Unique at a known position, but not on every row. Not a key — see `unitsMissing`. */
  "PARTIAL_COVERAGE",
  /** Positions were read, and none held a per-row-unique run. */
  "NO_UNIQUE_POSITION",
  /** The row never resolved, so "no key" would be indistinguishable from "never reached the rows". */
  "UNDETERMINED",
] as const;
export type ReviewKeyVerdict = (typeof REVIEW_KEY_VERDICTS)[number];

export interface ReviewKeyChoice {
  readonly verdict: ReviewKeyVerdict;
  /** The position the key is read from. `null` unless a candidate was found. */
  readonly cellIndex: number | null;
  readonly digitLength: number | null;
  /** Rows the key covers, out of the rows measured. `1` is the only value that makes it a key. */
  readonly coverage: number;
  /** Rows with no such run — the ones an acquisition built on this key would silently drop. */
  readonly unitsMissing: number;
}

const NO_KEY: ReviewKeyChoice = Object.freeze({
  verdict: "UNDETERMINED" as const,
  cellIndex: null,
  digitLength: null,
  coverage: 0,
  unitsMissing: 0,
});

export function chooseDedupeKey(census: ReviewListCensus | null | undefined): ReviewKeyChoice {
  if (!census || census.reason !== "OK" || !census.unit.resolved) return NO_KEY;
  const units = census.unit.unitCount;
  if (units < 2 || census.cells.length === 0) return NO_KEY;

  let best: ReviewKeyChoice | null = null;
  for (const cell of census.cells) {
    for (const run of cell.runs) {
      if (!run.uniquePerUnit) continue;
      const candidate: ReviewKeyChoice = {
        verdict: run.unitsCarrying >= units ? "KEY_FOUND" : "PARTIAL_COVERAGE",
        cellIndex: cell.cellIndex,
        digitLength: run.digitLength,
        coverage: run.unitsCarrying / units,
        unitsMissing: Math.max(0, units - run.unitsCarrying),
      };
      // Coverage decides; a longer run breaks a tie, because a longer identifier collides less often once the
      // screen holds more rows than this page showed.
      if (
        best === null ||
        candidate.coverage > best.coverage ||
        (candidate.coverage === best.coverage && (candidate.digitLength ?? 0) > (best.digitLength ?? 0))
      ) {
        best = candidate;
      }
    }
  }
  return best ?? { ...NO_KEY, verdict: "NO_UNIQUE_POSITION" };
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
  unitsWithDetailLink: 0,
  idCandidates: [],
  leafCounts: [],
});

const REFUSED_COLUMN: ReviewColumnProbe = Object.freeze({
  reason: "HEADER_NOT_FOUND" as const,
  headerId: null,
  cellsInColumn: 0,
  cellsWithDigits: 0,
  cellsWithTwoRuns: 0,
  distinctFirstRunValues: 0,
  distinctSecondRunValues: 0,
  cellsMatchingOurDigits: 0,
});

const COLUMN_REFUSALS: readonly string[] = REVIEW_COLUMN_REFUSALS;

/**
 * The column probe, fail-closed. The header id is echoed only when it names a spelling the CALLER supplied —
 * the one place a page-controlled string could otherwise have travelled.
 */
function sanitizeColumnProbe(raw: unknown, headers: readonly ReviewLabelExpectation[]): ReviewColumnProbe {
  if (!raw || typeof raw !== "object") return REFUSED_COLUMN;
  const p = raw as Record<string, unknown>;
  const headerId =
    typeof p.headerId === "string" && headers.some((h) => h.id === p.headerId) ? p.headerId : null;
  const reason = typeof p.reason === "string" ? p.reason : null;
  if (reason !== "OK") {
    return {
      ...REFUSED_COLUMN,
      reason: reason && COLUMN_REFUSALS.includes(reason) ? (reason as ReviewColumnRefusal) : "HEADER_NOT_FOUND",
      headerId,
    };
  }
  const cellsInColumn = count(p.cellsInColumn);
  if (cellsInColumn === null || cellsInColumn === 0) return { ...REFUSED_COLUMN, reason: "NO_CELLS", headerId };
  const bounded = (v: unknown): number => Math.min(count(v) ?? 0, cellsInColumn);
  return {
    reason: "OK",
    headerId,
    cellsInColumn,
    cellsWithDigits: bounded(p.cellsWithDigits),
    cellsWithTwoRuns: bounded(p.cellsWithTwoRuns),
    distinctFirstRunValues: bounded(p.distinctFirstRunValues),
    distinctSecondRunValues: bounded(p.distinctSecondRunValues),
    cellsMatchingOurDigits: bounded(p.cellsMatchingOurDigits),
  };
}

const REFUSED_PAGINATION: ReviewPaginationReading = Object.freeze({
  dateInputCount: 0,
  selectCount: 0,
  numericPagerCount: 0,
  highestPagerNumber: 0,
});

/** How many identifier candidates may be reported. A distribution, not an inventory. */
const MAX_ID_CANDIDATES = 16;

/**
 * Identifier candidates, fail-closed per entry. `uniquePerUnit` is DERIVED here rather than trusted from the
 * page — it is the field a reader will act on, and a page that could assert it could assert a dedupe key that
 * does not exist.
 */
function sanitizeIdCandidates(raw: unknown, unitCount: number): readonly ReviewIdCandidate[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: ReviewIdCandidate[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const c = row as Record<string, unknown>;
    const source = c.source === "ATTRIBUTE" || c.source === "PRINTED" ? c.source : null;
    const digitLength = count(c.digitLength);
    const unitsCarrying = count(c.unitsCarrying);
    const distinctValues = count(c.distinctValues);
    if (source === null || digitLength === null || unitsCarrying === null || distinctValues === null) continue;
    if (digitLength < 1 || digitLength > 64) continue;
    // No more units can carry a run than exist, and no more distinct values than carriers.
    if (unitsCarrying > unitCount || distinctValues > unitsCarrying) continue;
    out.push({
      source,
      digitLength,
      unitsCarrying,
      distinctValues,
      uniquePerUnit: unitsCarrying > 0 && distinctValues === unitsCarrying,
    });
    if (out.length >= MAX_ID_CANDIDATES) break;
  }
  return out;
}

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
    unitsWithDetailLink: per(u.unitsWithDetailLink),
    idCandidates: sanitizeIdCandidates(u.idCandidates, unitCount),
    // One entry per unit, bounded by the unit count. A longer list than there are units is incoherent.
    leafCounts: (Array.isArray(u.leafCounts) ? u.leafCounts : [])
      .slice(0, unitCount)
      .map((v) => count(v) ?? 0),
  };
}

/** How many cell POSITIONS may be reported. A row wider than this is not a row we can key on anyway. */
const MAX_CELLS = 32;

/**
 * The per-position reading, fail-closed per entry.
 *
 * `uniquePerUnit` is DERIVED here, exactly as it is for the whole-row candidates and for the same reason: it
 * is the field an acquisition would be built on, and a page able to assert it could assert a dedupe key that
 * does not exist.
 */
function sanitizeCells(
  raw: unknown,
  unitCount: number,
  shapes: readonly ReviewTextShape[],
): readonly ReviewCellReading[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: ReviewCellReading[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const c = row as Record<string, unknown>;
    const cellIndex = count(c.cellIndex);
    const unitsWithCell = count(c.unitsWithCell);
    if (cellIndex === null || unitsWithCell === null) continue;
    if (cellIndex >= MAX_CELLS || unitsWithCell > unitCount) continue;

    const runs: ReviewCellRun[] = [];
    for (const r of Array.isArray(c.runs) ? c.runs : []) {
      if (!r || typeof r !== "object") continue;
      const run = r as Record<string, unknown>;
      const digitLength = count(run.digitLength);
      const unitsCarrying = count(run.unitsCarrying);
      const distinctValues = count(run.distinctValues);
      if (digitLength === null || unitsCarrying === null || distinctValues === null) continue;
      if (digitLength < 1 || digitLength > 64) continue;
      if (unitsCarrying > unitsWithCell || distinctValues > unitsCarrying) continue;
      runs.push({
        digitLength,
        unitsCarrying,
        distinctValues,
        uniquePerUnit: unitsCarrying > 0 && distinctValues === unitsCarrying,
      });
    }

    // Shape ids are echoed only when they name a shape the CALLER supplied.
    const shapeHits: ReviewCellShapeHit[] = [];
    for (const hit of Array.isArray(c.shapeHits) ? c.shapeHits : []) {
      if (!hit || typeof hit !== "object") continue;
      const h = hit as Record<string, unknown>;
      if (typeof h.shapeId !== "string" || !shapes.some((s) => s.id === h.shapeId)) continue;
      shapeHits.push({ shapeId: h.shapeId, unitCount: Math.min(count(h.unitCount) ?? 0, unitsWithCell) });
    }

    out.push({ cellIndex, unitsWithCell, runs, shapeHits });
    if (out.length >= MAX_CELLS) break;
  }
  return out;
}

function sanitizeSelects(raw: unknown): readonly ReviewSelectReading[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: ReviewSelectReading[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const s = row as Record<string, unknown>;
    const optionCount = count(s.optionCount);
    if (optionCount === null) continue;
    out.push({
      optionCount,
      optionsMatchingControlLabels: Math.min(count(s.optionsMatchingControlLabels) ?? 0, optionCount),
      insideUnit: s.insideUnit === true,
    });
    if (out.length >= MAX_CELLS) break;
  }
  return out;
}

function sanitizePagination(raw: unknown): ReviewPaginationReading {
  if (!raw || typeof raw !== "object") return REFUSED_PAGINATION;
  const p = raw as Record<string, unknown>;
  return {
    dateInputCount: count(p.dateInputCount) ?? 0,
    selectCount: count(p.selectCount) ?? 0,
    numericPagerCount: count(p.numericPagerCount) ?? 0,
    highestPagerNumber: count(p.highestPagerNumber) ?? 0,
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
  controlExpectations: readonly ReviewLabelExpectation[],
  shapeExpectations: readonly ReviewTextShape[],
  headerExpectations: readonly ReviewLabelExpectation[] = [],
): ReviewListCensus {
  const refused = (reason: "OK" | ReviewCensusRefusal): ReviewListCensus => ({
    reason,
    elementsScanned: 0,
    shadowRootsFound: 0,
    elementsWithAnchorAttributes: 0,
    anchorDigitRunLengths: [],
    controlAffordances: [],
    unitSource: "LABEL_AGREEMENT" as const,
    columnProbe: REFUSED_COLUMN,
    labelCounts: [],
    textShapes: [],
    unit: REFUSED_UNIT,
    pagination: REFUSED_PAGINATION,
    cells: [],
    selects: [],
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

  const controlAffordances: ReviewControlAffordance[] = [];
  for (const expectation of controlExpectations) {
    const found = find(r.controlAffordances, expectation.id);
    const interactiveCount = count(found?.interactiveCount);
    const staticCount = count(found?.staticCount);
    // An unreadable control reading must not degrade to a quiet zero, which would be indistinguishable from
    // "this screen offers no date range" — the reading incremental collection depends on.
    if (interactiveCount === null || staticCount === null) return refused("UNREADABLE");
    controlAffordances.push({
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
    controlAffordances,
    unitSource: r.unitSource === "COLUMN" ? "COLUMN" : "LABEL_AGREEMENT",
    columnProbe: sanitizeColumnProbe(r.columnProbe, headerExpectations),
    labelCounts,
    textShapes,
    unit: sanitizeUnit(r.unit),
    pagination: sanitizePagination(r.pagination),
    cells: sanitizeCells(r.cells, count(r.unit && (r.unit as Record<string, unknown>).unitCount) ?? 0, shapeExpectations),
    selects: sanitizeSelects(r.selects),
  };
}
