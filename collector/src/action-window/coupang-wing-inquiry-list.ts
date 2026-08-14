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
 * page hands back **how many rows carry it**. Nothing crosses but integers.
 *
 * That inversion is what makes this safe, and it also makes it honest — a count of 0 or 2 is a refusal that
 * needs no interpretation, where a text similarity score would have needed a threshold nobody could justify.
 *
 * ## What has NOT been measured
 *
 * Whether the WING list carries `inquiryId` at all — in an attribute, an href, a data-* value, or nowhere.
 * That is the question the calibration exists to answer, and this module is deliberately written so the
 * answer can be "nowhere": every expectation reports its own match count, and a zero is recorded rather than
 * worked around. No fallback to text matching exists here, and none should be added without its own decision.
 */

/** How the rows were arranged. A fixed enum — it names no element and no selector. */
export const INQUIRY_CONTAINER_KINDS = [
  /** Rows are `<tr>` inside one `<table>`. */
  "TABLE",
  /** Rows are `<li>` inside one list. */
  "LIST",
  /** Rows are elements carrying an explicit row role. */
  "GRID",
  /** No single container held the rows. Reported, never guessed past. */
  "NONE",
] as const;
export type InquiryContainerKind = (typeof INQUIRY_CONTAINER_KINDS)[number];

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
 * These are Coupang's own UI strings, supplied by us and matched whole, exactly as the issuance calibration
 * matches `발급` or `확인`. Counting rows that carry a known platform word is structural; it is categorically
 * different from reading the row's content, and no text is returned either way.
 */
export interface InquiryLabelExpectation {
  readonly id: string;
  readonly exactText: string;
}

/** Why a census refused. Every one of these is a fail-closed outcome — never a partial reading. */
export const INQUIRY_CENSUS_REFUSALS = [
  /** The scan hit its element budget; a truncated page cannot be counted honestly. */
  "SCAN_TRUNCATED",
  /** No row-shaped elements were found at all. */
  "NO_ROWS",
  /** Rows were found under more than one container kind — which list is THE list is not decidable. */
  "CONTAINER_AMBIGUOUS",
  /** The script returned something that is not a census. */
  "UNREADABLE",
] as const;
export type InquiryCensusRefusal = (typeof INQUIRY_CENSUS_REFUSALS)[number];

/** Per-expectation outcome: our own id, and how many rows carried that digit run. */
export interface InquiryDigitMatch {
  readonly id: string;
  readonly rowMatchCount: number;
  /** Where the digits were found, when exactly one row matched. Attribute NAMES are schema, not data. */
  readonly matchedAttributeNames: readonly string[];
}

/** Per-label outcome: our own id, and how many rows carried that exact platform word. */
export interface InquiryLabelCount {
  readonly id: string;
  readonly rowCount: number;
}

/**
 * The whole structural reading of one 고객문의 list. Integers, enums, booleans, and the ids we supplied —
 * nothing else. No row text, no selector, no href, no attribute VALUE.
 */
export interface InquiryListCensus {
  readonly reason: "OK" | InquiryCensusRefusal;
  readonly containerKind: InquiryContainerKind;
  readonly rowCount: number;
  /** Rows carrying at least one digit run anywhere in their attributes — the anchor's availability. */
  readonly rowsWithDigits: number;
  /** Rows carrying a link or button — whether a detail view is reachable from the row at all. */
  readonly rowsWithDetailAffordance: number;
  readonly digitMatches: readonly InquiryDigitMatch[];
  readonly labelCounts: readonly InquiryLabelCount[];
}

/** Why a target resolution refused. */
export const INQUIRY_TARGET_REFUSALS = [
  /** The census itself refused; there is nothing to resolve against. */
  "CENSUS_REFUSED",
  /** No row carried the identifier. The inquiry is not on this screen — or the screen does not carry ids. */
  "TARGET_NOT_FOUND",
  /** More than one row carried it. Picking one would be a guess about which is the seller's inquiry. */
  "TARGET_AMBIGUOUS",
] as const;
export type InquiryTargetRefusal = (typeof INQUIRY_TARGET_REFUSALS)[number];

export type InquiryTargetResolution =
  | { readonly ok: true; readonly expectationId: string }
  | { readonly ok: false; readonly reason: InquiryTargetRefusal };

/**
 * **The one rule that decides whether a target may be acted on.** Exactly one row, or nothing happens.
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
  const match = census.digitMatches.find((m) => m.id === expectationId);
  if (!match || match.rowMatchCount === 0) {
    return { ok: false, reason: "TARGET_NOT_FOUND" };
  }
  if (match.rowMatchCount > 1) {
    return { ok: false, reason: "TARGET_AMBIGUOUS" };
  }
  return { ok: true, expectationId };
}

const CONTAINER_KINDS: readonly string[] = INQUIRY_CONTAINER_KINDS;
const REFUSALS: readonly string[] = INQUIRY_CENSUS_REFUSALS;

/** A safe non-negative integer, or null. Anything else is a reading we will not trust. */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000
    ? value
    : null;
}

/** An attribute NAME we are willing to echo: conservative, so a value can never masquerade as a name. */
function attributeName(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_:-]{0,40}$/.test(value) ? value : null;
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
    containerKind: "NONE",
    rowCount: 0,
    rowsWithDigits: 0,
    rowsWithDetailAffordance: 0,
    digitMatches: [],
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
  const containerKind = typeof r.containerKind === "string" && CONTAINER_KINDS.includes(r.containerKind)
    ? (r.containerKind as InquiryContainerKind)
    : null;
  const rowCount = count(r.rowCount);
  const rowsWithDigits = count(r.rowsWithDigits);
  const rowsWithDetailAffordance = count(r.rowsWithDetailAffordance);
  if (containerKind === null || rowCount === null || rowsWithDigits === null
      || rowsWithDetailAffordance === null) {
    return refused("UNREADABLE");
  }
  // A container kind of NONE with rows counted is incoherent — refuse rather than reconcile it.
  if (containerKind === "NONE" && rowCount > 0) {
    return refused("UNREADABLE");
  }

  const rawMatches = Array.isArray(r.digitMatches) ? r.digitMatches : [];
  const digitMatches: InquiryDigitMatch[] = [];
  for (const expectation of digitExpectations) {
    const found = rawMatches.find(
      (m) => m && typeof m === "object" && (m as Record<string, unknown>).id === expectation.id,
    ) as Record<string, unknown> | undefined;
    const matchCount = count(found?.rowMatchCount);
    if (matchCount === null) {
      return refused("UNREADABLE");
    }
    const names = Array.isArray(found?.matchedAttributeNames) ? found!.matchedAttributeNames : [];
    digitMatches.push({
      id: expectation.id,
      rowMatchCount: matchCount,
      matchedAttributeNames: names
        .map(attributeName)
        .filter((n): n is string => n !== null)
        .slice(0, 8),
    });
  }

  const rawLabels = Array.isArray(r.labelCounts) ? r.labelCounts : [];
  const labelCounts: InquiryLabelCount[] = [];
  for (const expectation of labelExpectations) {
    const found = rawLabels.find(
      (l) => l && typeof l === "object" && (l as Record<string, unknown>).id === expectation.id,
    ) as Record<string, unknown> | undefined;
    const rows = count(found?.rowCount);
    if (rows === null) {
      return refused("UNREADABLE");
    }
    labelCounts.push({ id: expectation.id, rowCount: rows });
  }

  return {
    reason: "OK",
    containerKind,
    rowCount,
    rowsWithDigits,
    rowsWithDetailAffordance,
    digitMatches,
    labelCounts,
  };
}
