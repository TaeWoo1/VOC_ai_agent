/**
 * **Finding the ONE inquiry on the WING 고객문의 screen, without reading what a buyer wrote.**
 *
 * Pure: types, a sanitizer, and the rules that decide whether a target may be acted on at all.
 *
 * ## The constraint that shapes everything here
 *
 * The rows on that screen carry buyer-authored text. It must never reach a log, a fixture, an assistant's
 * context, or any returned field — so the obvious way to find a row (match its content against the body we
 * stored) is not available to us in the obvious form.
 *
 * What IS available is a number we already hold. `onlineInquiries` gives SellerOps the channel's own
 * `inquiryId`, and the seller's own `sellerProductId`; both are identifiers from our own database, not buyer
 * data. So the match runs the other way round: we hand the page a digit string we are looking for, and the
 * page hands back **how many elements carry it**. Nothing crosses but integers, enums, and tag names.
 *
 * ## Why this version measures topology instead of counting rows
 *
 * The first two versions asked the page "how many rows are there, and do any of them carry the id?" — where
 * *row* meant `table tr`, `ul li`, or `[role=row]`. Against the real WING screen that returned 54 rows, zero
 * id matches, and — decisively — **zero occurrences of both `답변완료` and `미답변`**, on a screen the operator
 * could see two answered inquiries on. A row set that contains neither status word is not the inquiry list.
 * The measurement had found the page's navigation and furniture and counted it confidently.
 *
 * The mistake was structural, not a tuning error: **the row tag was assumed before it was measured.** So this
 * version assumes nothing about it. The anchor is the identifier — a digit string we already hold — and it is
 * searched for across the whole document in a small allowlist of STRUCTURAL attributes (`href`, `id`, `data-*`).
 * Wherever it lands, the topology around it is then measured: what tag carries it, how far up the first
 * repeating sibling unit sits, how many siblings that unit has, whether it offers a way into a detail view.
 * The row shape comes back as a *finding*. That is the only order in which it can be trusted.
 *
 * ## What the page may and may not send back
 *
 * Attribute VALUES never cross — only which KIND of attribute matched. Class names never cross — only how many
 * tokens, and how many siblings share the identical shape (compared inside the page). Text never crosses: the
 * only text comparison is `indexOf` against fixed PLATFORM strings WE supply, on leaf elements, reduced to a
 * boolean before it can be returned. Buyer text never leaves the page.
 */

/** The STRUCTURAL attributes an identifier may be looked for in. Nothing else is read, in any element. */
export const INQUIRY_ATTRIBUTE_KINDS = [
  /** The element's `href`. */
  "HREF",
  /** The element's `id`. */
  "ID",
  /** Any `data-*` attribute. */
  "DATA",
] as const;
export type InquiryAttributeKind = (typeof INQUIRY_ATTRIBUTE_KINDS)[number];

/**
 * One thing we are looking for, expressed as a digit string we already hold.
 *
 * `id` is our own name for it and is the only string that comes back verbatim. `digits` is matched as a whole
 * digit run — `1584` must not match inside `158421449`, because a prefix match would silently target a
 * different inquiry, and "silently targets a different inquiry" is the failure this whole module exists to
 * make impossible.
 */
export interface InquiryDigitExpectation {
  readonly id: string;
  readonly digits: string;
}

/**
 * One fixed PLATFORM label to count — `답변완료`, `미답변` and the like.
 *
 * These are Coupang's own UI strings, supplied by us and compared as fixed literals, exactly as the issuance
 * calibration compares `발급` or `확인`. Several spellings of the same state are supplied at once because the
 * exact wording on that screen has never been measured, and guessing one and re-running live for the next is
 * precisely the loop this calibration exists to avoid.
 */
export interface InquiryLabelExpectation {
  readonly id: string;
  readonly exactText: string;
}

/** Why a census refused. Every one of these is a fail-closed outcome — never a partial reading. */
export const INQUIRY_CENSUS_REFUSALS = [
  /** The scan hit its element budget; a truncated page cannot be counted honestly. */
  "SCAN_TRUNCATED",
  /** The document held no elements to scan at all. */
  "NO_ELEMENTS",
  /** The script returned something that is not a census. */
  "UNREADABLE",
] as const;
export type InquiryCensusRefusal = (typeof INQUIRY_CENSUS_REFUSALS)[number];

/**
 * **One level of repetition above the anchor.** A `<td>` repeats across a row and a `<tr>` repeats down a
 * table, and both are true at once — so the chain reports every level it finds rather than picking one.
 *
 * `siblingsSharingClassShape` separates a genuine repeating list from a coincidence of two `<div>`s. The class
 * strings themselves are compared inside the page; only the count comes back.
 */
export interface InquiryRepeatLevel {
  /** Levels above the matched element. 0 means the matched element itself already repeats. */
  readonly depth: number;
  readonly tagName: string;
  /** Same-tag siblings, including this element. */
  readonly siblingCount: number;
  /** How many of those siblings carry an identical class shape. */
  readonly siblingsSharingClassShape: number;
  /** How many class tokens this element carries. A shape, not a name. */
  readonly classTokenCount: number;
  /** Which structural attribute kinds this element itself carries. */
  readonly attributeKinds: readonly InquiryAttributeKind[];
  /** Whether this element offers a link or button — a way into a detail view at all. */
  readonly hasDetailAffordance: boolean;
  /**
   * **The LENGTHS of the digit runs this unit carries** in allowlisted attributes, deduplicated and sorted.
   *
   * Lengths, never values. This is what separates "the screen carries no machine id" from "the screen carries
   * an id of a different kind than ours" — two findings that look identical as a match count of zero, and that
   * lead to completely different next steps. A length distribution identifies nothing and no one.
   */
  readonly digitRunLengths: readonly number[];
}

/**
 * **The structure around a resolved anchor**, measured rather than assumed.
 *
 * Reported ONLY when exactly one element carried the identifier. With two matches this would describe two
 * different places at once, and with none there is nothing to describe — in both cases the honest output is
 * the count and no topology.
 *
 * `repeatLevels` runs innermost-first and is the measured answer to "what is a row on this screen". Nothing
 * here decides which level is THE row: the level whose `siblingCount` matches the number of inquiries the
 * seller can see is a finding to be read off, and reading it off is a decision for the unit that builds a
 * locator — with this measurement in front of it, not in place of it.
 */
export interface InquiryAnchorTopology {
  /** Tag of the element that carried the identifier. */
  readonly matchedTagName: string;
  /** Which kinds of structural attribute carried it. Kinds, never names, never values. */
  readonly attributeKinds: readonly InquiryAttributeKind[];
  /** How many ancestor levels were walked before the budget ran out. */
  readonly ancestorDepthScanned: number;
  /** Repeating ancestors, innermost first. Empty means nothing around the anchor repeats at all. */
  readonly repeatLevels: readonly InquiryRepeatLevel[];
}

/** Per-expectation outcome: our own id, how many elements carried it, and the topology when exactly one did. */
export interface InquiryAnchorMatch {
  readonly id: string;
  /** Innermost matches across the whole document, in allowlisted attributes only. */
  readonly matchCount: number;
  /** Present only when `matchCount === 1`. */
  readonly topology: InquiryAnchorTopology | null;
}

/**
 * Per-label outcome: our own id, how many leaf elements carried that exact platform literal, and the structure
 * around them.
 *
 * **A fixed platform word is a legitimate anchor in its own right**, and measuring the topology around it is
 * how a screen that does not carry our identifier can still be understood. If two leaves say `완료` and each
 * sits inside one of two identically shaped siblings, the row structure has been found — using only a string we
 * supplied. Nothing about the buyer's question is involved, and no text comes back.
 */
export interface InquiryLabelCount {
  readonly id: string;
  readonly elementCount: number;
  /** The structure around the FIRST hit. Null when nothing matched. */
  readonly topology: InquiryAnchorTopology | null;
  /**
   * The repeat level the hits AGREE on — the row candidate, when there is one.
   *
   * Chosen as the most common (tag, sibling count) across every hit's whole chain, not from the first hit
   * alone: two hits can sit in the same repeating row while one of them is a wrapper deeper, and comparing
   * only innermost levels scores that as disagreement.
   */
  readonly sharedRepeatLevel: InquiryRepeatLevel | null;
  /** How many hits' chains contain that level — the difference between rows and page furniture. */
  readonly hitsSharingRepeatShape: number;
}

/**
 * The whole structural reading of one 고객문의 screen. Integers, enums, tag names, and the ids we supplied —
 * nothing else. No text, no selector, no href, no class name, no attribute VALUE.
 */
export interface InquiryListCensus {
  readonly reason: "OK" | InquiryCensusRefusal;
  /** Every element considered, including inside open shadow roots. */
  readonly elementsScanned: number;
  /**
   * How many open shadow roots the scan descended into.
   *
   * A component-rendered list is invisible to `document.querySelectorAll('*')` — the same blind spot as
   * scanning only the top frame, one layer in. This number is how a future reading of "nothing found" can be
   * told apart from "nothing found, and there were 40 shadow roots we now do look inside".
   */
  readonly shadowRootsFound: number;
  /** Elements carrying at least one digit run in an allowlisted attribute — whether machine ids exist here. */
  readonly elementsWithAnchorAttributes: number;
  /** Every distinct digit-run LENGTH the screen carries in allowlisted attributes, sorted. Lengths, not values. */
  readonly anchorDigitRunLengths: readonly number[];
  readonly anchors: readonly InquiryAnchorMatch[];
  readonly labelCounts: readonly InquiryLabelCount[];
}

/**
 * One frame's reading. WING embeds sub-applications, and a document-wide scan of the TOP document is still a
 * scan of the wrong document when the list lives in a child frame — the same class of mistake as assuming the
 * row tag, one level up. The frame is identified by INDEX only; a frame URL would carry the seller's own
 * account path and has no business in a sanitized record.
 */
export interface InquiryFrameCensus {
  readonly frameIndex: number;
  readonly census: InquiryListCensus;
}

/** Why a target resolution refused. */
export const INQUIRY_TARGET_REFUSALS = [
  /** The census itself refused; there is nothing to resolve against. */
  "CENSUS_REFUSED",
  /** No element carried the identifier. The inquiry is not on this screen — or the screen carries no ids. */
  "TARGET_NOT_FOUND",
  /** More than one element carried it. Picking one would be a guess about which is the seller's inquiry. */
  "TARGET_AMBIGUOUS",
  /** Exactly one matched, but nothing around it repeats — there is no row-shaped thing to point at. */
  "TARGET_TOPOLOGY_UNKNOWN",
] as const;
export type InquiryTargetRefusal = (typeof INQUIRY_TARGET_REFUSALS)[number];

export type InquiryTargetResolution =
  | { readonly ok: true; readonly expectationId: string; readonly topology: InquiryAnchorTopology }
  | { readonly ok: false; readonly reason: InquiryTargetRefusal };

/**
 * **The one rule that decides whether a target may be acted on.** Exactly one element, with a measured
 * repeating unit around it, or nothing happens.
 *
 * Deliberately total and deliberately narrow: it consults one expectation, not a best-of. A caller that
 * wants to try `inquiryId` and fall back to `sellerProductId` must ask twice and own that decision, because
 * a product id matches every inquiry on that product — falling back to it silently would turn "the one
 * inquiry" into "some inquiry about the right product", which reads identically in a log and is wrong.
 */
export function resolveInquiryTarget(
  census: InquiryListCensus | null | undefined,
  expectationId: string,
): InquiryTargetResolution {
  if (!census || census.reason !== "OK") {
    return { ok: false, reason: "CENSUS_REFUSED" };
  }
  const match = census.anchors.find((m) => m.id === expectationId);
  if (!match || match.matchCount === 0) {
    return { ok: false, reason: "TARGET_NOT_FOUND" };
  }
  if (match.matchCount > 1) {
    return { ok: false, reason: "TARGET_AMBIGUOUS" };
  }
  if (!match.topology || match.topology.repeatLevels.length === 0) {
    return { ok: false, reason: "TARGET_TOPOLOGY_UNKNOWN" };
  }
  return { ok: true, expectationId, topology: match.topology };
}

const REFUSALS: readonly string[] = INQUIRY_CENSUS_REFUSALS;
const ATTRIBUTE_KINDS: readonly string[] = INQUIRY_ATTRIBUTE_KINDS;

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

/** Attribute KINDS from the fixed allowlist, deduplicated and ordered as declared. */
function attributeKinds(value: unknown): readonly InquiryAttributeKind[] {
  const raw = Array.isArray(value) ? value : [];
  return INQUIRY_ATTRIBUTE_KINDS.filter((k) => raw.some((v) => v === k && ATTRIBUTE_KINDS.includes(k)));
}

/** How many repeat levels may be reported. Enough to tell a cell from a row from a section; not a page dump. */
const MAX_REPEAT_LEVELS = 4;
/** How many distinct digit-run lengths may be reported. A distribution, not an inventory. */
const MAX_DIGIT_LENGTHS = 12;

/** Distinct digit-run LENGTHS, sorted ascending. Anything that is not a plausible length is dropped. */
function digitRunLengths(value: unknown): readonly number[] {
  const raw = Array.isArray(value) ? value : [];
  const lengths = raw.filter(
    (n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 64,
  );
  return [...new Set(lengths)].sort((a, b) => a - b).slice(0, MAX_DIGIT_LENGTHS);
}

/** One level, or null when any field is missing or incoherent. A bad level drops; it never degrades a good one. */
function sanitizeRepeatLevel(raw: unknown): InquiryRepeatLevel | null {
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

/**
 * Total, fail-closed sanitizer for a topology. Returns null when the anchor itself is unreadable — an
 * unreadable topology must degrade to "no target", never to a partly-trusted one a locator gets built from.
 */
function sanitizeTopology(raw: unknown): InquiryAnchorTopology | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const matchedTagName = tagName(t.matchedTagName);
  const ancestorDepthScanned = count(t.ancestorDepthScanned);
  if (matchedTagName === null || ancestorDepthScanned === null) return null;
  const rawLevels = Array.isArray(t.repeatLevels) ? t.repeatLevels : [];
  const repeatLevels = rawLevels
    .map(sanitizeRepeatLevel)
    .filter((l): l is InquiryRepeatLevel => l !== null)
    .slice(0, MAX_REPEAT_LEVELS);
  return {
    matchedTagName,
    attributeKinds: attributeKinds(t.attributeKinds),
    ancestorDepthScanned,
    repeatLevels,
  };
}

/**
 * **Total, fail-closed sanitizer** for whatever the page returned. Every field is re-derived and re-typed
 * here; nothing is passed through because it looked plausible. An unrecognised shape is `UNREADABLE` with
 * zeroed counts, never a partially trusted census.
 *
 * The ids echoed back are matched against the expectations the CALLER supplied, so the page cannot introduce
 * a string of its own into the result — the one place a page-controlled value could otherwise have travelled.
 */
export function sanitizeInquiryListCensus(
  raw: unknown,
  digitExpectations: readonly InquiryDigitExpectation[],
  labelExpectations: readonly InquiryLabelExpectation[],
): InquiryListCensus {
  const refused = (reason: "OK" | InquiryCensusRefusal): InquiryListCensus => ({
    reason,
    elementsScanned: 0,
    shadowRootsFound: 0,
    elementsWithAnchorAttributes: 0,
    anchorDigitRunLengths: [],
    anchors: [],
    labelCounts: [],
  });
  if (!raw || typeof raw !== "object") {
    return refused("UNREADABLE");
  }
  const r = raw as Record<string, unknown>;
  const reason = typeof r.reason === "string" ? r.reason : null;
  if (reason !== "OK") {
    return refused(reason && REFUSALS.includes(reason) ? (reason as InquiryCensusRefusal) : "UNREADABLE");
  }
  const elementsScanned = count(r.elementsScanned);
  const elementsWithAnchorAttributes = count(r.elementsWithAnchorAttributes);
  const shadowRootsFound = count(r.shadowRootsFound);
  if (elementsScanned === null || elementsWithAnchorAttributes === null || shadowRootsFound === null) {
    return refused("UNREADABLE");
  }
  // More elements carrying anchors than elements scanned is incoherent — refuse rather than reconcile it.
  if (elementsWithAnchorAttributes > elementsScanned) {
    return refused("UNREADABLE");
  }

  const rawAnchors = Array.isArray(r.anchors) ? r.anchors : [];
  const anchors: InquiryAnchorMatch[] = [];
  for (const expectation of digitExpectations) {
    const found = rawAnchors.find(
      (m) => m && typeof m === "object" && (m as Record<string, unknown>).id === expectation.id,
    ) as Record<string, unknown> | undefined;
    const matchCount = count(found?.matchCount);
    if (matchCount === null) {
      return refused("UNREADABLE");
    }
    // Topology travels only for an unambiguous anchor. Anything else would describe the wrong element.
    const topology = matchCount === 1 ? sanitizeTopology(found?.topology) : null;
    anchors.push({ id: expectation.id, matchCount, topology });
  }

  const rawLabels = Array.isArray(r.labelCounts) ? r.labelCounts : [];
  const labelCounts: InquiryLabelCount[] = [];
  for (const expectation of labelExpectations) {
    const found = rawLabels.find(
      (l) => l && typeof l === "object" && (l as Record<string, unknown>).id === expectation.id,
    ) as Record<string, unknown> | undefined;
    const elementCount = count(found?.elementCount);
    const hitsSharingRepeatShape = count(found?.hitsSharingRepeatShape) ?? 0;
    if (elementCount === null) {
      return refused("UNREADABLE");
    }
    labelCounts.push({
      id: expectation.id,
      elementCount,
      topology: elementCount > 0 ? sanitizeTopology(found?.topology) : null,
      sharedRepeatLevel: elementCount > 0 ? sanitizeRepeatLevel(found?.sharedRepeatLevel) : null,
      // No more hits can share a shape than there were hits.
      hitsSharingRepeatShape: Math.min(hitsSharingRepeatShape, elementCount),
    });
  }

  return {
    reason: "OK",
    elementsScanned,
    shadowRootsFound,
    elementsWithAnchorAttributes,
    anchorDigitRunLengths: digitRunLengths(r.anchorDigitRunLengths),
    anchors,
    labelCounts,
  };
}
