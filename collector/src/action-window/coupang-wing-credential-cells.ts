/**
 * **Where the credential VALUES sit, relative to the labels that name them.** Pure: types, a sanitizer, and the
 * one rule that decides whether a read may happen at all.
 *
 * ## Why this module exists
 *
 * `WING_CREDENTIAL_REGION_EVIDENCE` measured the label structure on the operator's own issued screen —
 * `Access Key` / `Secret Key` / `업체코드` are three `<th>` in ONE header row — and it recorded, in its own
 * `notEstablished` list, that **`WHERE_THE_CREDENTIAL_VALUES_SIT_RELATIVE_TO_THE_VENDOR_BLOCK` is not known**.
 * The prose beside that table says the values "live in the body row beneath". That is a reasonable reading of a
 * header row; it is not a measurement, and this workstream has twice had to withdraw a rule built on a reasonable
 * reading (`entryRowCount` for a chip; `submitAffordancePresent` for a `<button type=button>`).
 *
 * A locator written from the prose would be the same mistake with a worse blast radius: the thing it resolves to
 * is a secret. So the association is RESOLVED by this module, MEASURED value-free before anything reads it, and
 * the read then uses the identical resolution — not a second implementation that agrees on a good day.
 *
 * ## The two shapes, and why both are tried
 *
 * A key/value table can be column-headed (labels across the top, values in the row beneath) or row-headed (label
 * left, value beside it). The measurement says the labels are in one row together, which is the column-headed
 * shape — but "which shape" is exactly the question, so both are resolved and the census REPORTS which one
 * answered. A disjunction that fails closed on ambiguity claims nothing; a single guessed shape claims the guess.
 *
 * ## What crosses the boundary, and the one exception
 *
 * The census returns an association enum, tag names, and integers — the same alphabet as every other structural
 * reading here. The exception is {@link CredentialCellReading.cellNonEmpty}: one boolean per cell, derived from
 * `textContent.trim().length > 0`.
 *
 * It is a reading of a credential cell, it is the only one taken before the operator's confirmation, and it is
 * required rather than convenient: a locator that resolves to an EMPTY cell has not found the value, and a
 * calibration that cannot tell those apart would certify a locator that reads nothing. It is one bit, it is
 * gated behind its own opt-in flag, and it is what {@link credentialCellsResolved} refuses on. No length, no
 * character class, no prefix, and no value — those exist only after the barrier, in the handoff evidence.
 */

/** How a fixed label was tied to the cell holding its value. A fixed enum — it names no element. */
export const CREDENTIAL_CELL_ASSOCIATIONS = [
  /** Column-headed: the label is a `<th>` in a header row; the value is the cell at the SAME column index below. */
  "TH_COLUMN_TD",
  /** Row-headed: the value cell is the label's next sibling in its own row. */
  "TH_NEXT_TD",
  /** Nothing structural tied the label to a cell. Reported, never guessed past. */
  "NONE",
] as const;
export type CredentialCellAssociation = (typeof CREDENTIAL_CELL_ASSOCIATIONS)[number];

/** One label to resolve. `id` is the caller's own name for it and is the only string that comes back verbatim. */
export interface CredentialCellRequest {
  readonly id: string;
  readonly candidateQuery: string;
  readonly exactText: string;
}

/**
 * **The three fields, and the backend key each one becomes.**
 *
 * The ids ARE the backend's own credential keys (`CredentialTemplates` `COUPANG` → `access_key`, `secret_key`,
 * `vendor_id`), so there is no translation step between what was read and what is stored — a mapping layer is
 * somewhere a field can be swapped, and swapping `access_key` with `secret_key` would store a credential that
 * fails verification with no visible cause.
 *
 * `candidateQuery` / `exactText` restate `WING_HIGHLIGHT_LABELS.credentials` rather than importing it, because
 * this module is a zero-import leaf and that one pulls the Playwright driver. An anti-drift test pins the two
 * together — the same arrangement as the backend's `CredentialTemplatesTest` over its connectors.
 */
export const COUPANG_CREDENTIAL_FIELDS: readonly CredentialCellRequest[] = Object.freeze([
  Object.freeze({ id: "vendor_id", candidateQuery: "label,span,div,dt,th,strong", exactText: "업체코드" }),
  Object.freeze({ id: "access_key", candidateQuery: "label,span,div,dt,th,strong", exactText: "Access Key" }),
  Object.freeze({ id: "secret_key", candidateQuery: "label,span,div,dt,th,strong", exactText: "Secret Key" }),
]);

/**
 * **Has a real sitting MEASURED where the values sit? No.**
 *
 * `false`, and it stays `false` until a `COUPANG_WING_CREDENTIAL_CELL_CALIBRATION` run has answered on the
 * operator's own issued screen. The approval gate refuses to prepare a `CREDENTIAL_READ` manifest while this is
 * `false`, so the handoff cannot run on a shape nobody has inspected — which is the precise risk the calibration
 * phase exists to remove, and which the contract's own §11 ordering promised without anything enforcing it until
 * review pointed that out.
 *
 * The precedent is `WING_ISSUE_SELECTOR_CALIBRATED`, including its history: it shipped `false`, closed the path
 * that depended on it, and was flipped only from a reading. Flip this the same way — from a run, with the run's
 * identity recorded beside it — and never to make a live attempt succeed.
 */
export const WING_CREDENTIAL_CELLS_CALIBRATED = false;

/** The ids of {@link COUPANG_CREDENTIAL_FIELDS}, in the same order. */
export const COUPANG_CREDENTIAL_FIELD_IDS: readonly string[] = Object.freeze(
  COUPANG_CREDENTIAL_FIELDS.map((f) => f.id),
);

/** One label's value-cell reading. Every field is a tag name, an integer, a fixed enum, or one boolean. */
export interface CredentialCellReading {
  readonly id: string;
  /** Painting matches for the fixed LABEL. Everything below is present only when this is exactly 1. */
  readonly labelVisibleCount: number;
  /** Matches rejected for not painting — tells "nothing visible matched" from "nothing matched". */
  readonly labelHiddenCount: number;
  /** MEASURED tag of the unique label. An observation, never an expectation. */
  readonly labelTag?: string;
  /** Which shape answered. `NONE` when neither did. */
  readonly association?: CredentialCellAssociation;
  /**
   * How many cells the winning association resolved to. **1 is the only usable answer** — a table with two body
   * rows resolves two candidates for the same column, and there is no structural reason to prefer either.
   * Reported rather than silently truncated, so an ambiguous layout is visible as a measurement.
   */
  readonly candidateCellCount?: number;
  /** MEASURED tag of the unique cell. */
  readonly cellTag?: string;
  /**
   * How many `input` / `textarea` descendants the cell holds — because a copyable key is as likely to be rendered
   * in a readonly input as in text, and the two need different extraction. 0 means "read the text", 1 means "read
   * that field's value", and anything above 1 means the cell holds more than one thing and no rule here says
   * which. Measured rather than assumed, so the extraction is chosen by a reading.
   */
  readonly cellInputCount?: number;
  /** Whether the unique cell holds non-empty trimmed text. Present only when the census asked. See the header. */
  readonly cellNonEmpty?: boolean;
  /** True when this cell is the SAME element another request resolved to. Two labels, one value, is not a read. */
  readonly cellDuplicate?: boolean;
  /**
   * Which `<table>` the cell sits in, as an ordinal among the document's tables. An integer, never an identity —
   * and the only thing that answers "did all three labels land in the same region". `-1` when the cell is in no
   * table (a row-headed resolution outside one).
   */
  readonly tableOrdinal?: number;
  /** True when the label scan exceeded its cap, so the uniqueness count is not trustworthy. */
  readonly scanTruncated?: boolean;
  /**
   * The label's own column index within its header row. Present whenever the label resolved uniquely inside a
   * row — including when the column then resolved to MORE than one cell, because that is exactly the case where
   * the index is the thing a reader needs.
   */
  readonly labelColumnIndex?: number;
  /**
   * One entry per candidate cell the column resolved to, in document order. Structure only: which row it is,
   * which section that row is in, and how many cells that row has.
   *
   * It exists because `candidateCellCount: 2` is a refusal that says nothing about WHY. The 2026-08-13
   * calibration returned exactly that for 업체코드 while `Access Key` and `Secret Key` each resolved to one —
   * which is a fact about the second row's WIDTH, and no count alone can say so. Measuring it is the alternative
   * to inferring it, and inferring it is what this workstream has twice had to withdraw.
   */
  readonly candidateCells?: readonly CredentialCandidateCell[];
}

/** One candidate value cell, as structure. No text, no attribute, no identity. */
export interface CredentialCandidateCell {
  /** The candidate's row position among the table's rows, in document order. */
  readonly rowOrdinal: number;
  /** The tag of the row's parent — `THEAD` / `TBODY` / `TABLE`. */
  readonly sectionTag: string;
  /** How many `th`/`td` cells that row holds. A narrower row cannot be the credential row. */
  readonly rowCellCount: number;
  /** The candidate's own tag. */
  readonly cellTag: string;
}

export interface CredentialCellCensus {
  readonly readings: readonly CredentialCellReading[];
}

/**
 * **One ancestor level of the credential VALUE cell, scored by what it encloses.** The measurement D1 needs and
 * which has never been taken.
 *
 * `WING_CREDENTIAL_REGION_EVIDENCE` scored the ancestors of the LABEL and found no level holding the keys
 * without the seller's 연동 정보 block — and it recorded, in its own `notEstablished` list, that whether a
 * `tbody` level would exclude that block was unknown, because the anchor was in the `thead`. This scores from
 * the VALUE side instead, which is the side the ring has to enclose.
 *
 * Counts of matched fixed labels and of resolved cells. Never their text, never a value, never a selector.
 */
export interface CredentialRegionScopeRow {
  /** 1 = the value cell's parent. The cell itself is never a row: one value is not the region. */
  readonly depth: number;
  readonly tag: string;
  /** How many of the three credential LABELS paint inside this level. */
  readonly credentialLabelCount: number;
  /** How many of the resolved credential VALUE CELLS are inside it. */
  readonly credentialCellCount: number;
  /** How many of 업체명 / IP주소 / URL paint inside it. The first non-zero level is one level too far. */
  readonly vendorLabelCount: number;
}

export interface CredentialRegionScope {
  /** Whether a value cell resolved at all. Nothing below is read if not. */
  readonly anchorResolved: boolean;
  /** How many of the three value cells resolved uniquely — the basis the counts below are relative to. */
  readonly resolvedCellCount: number;
  readonly rows: readonly CredentialRegionScopeRow[];
}

/**
 * **The SHALLOWEST level that holds every credential label and value and none of the vendor block — or `null`.**
 *
 * `null` is a real answer and must not be rounded up to "the closest one that nearly works". The product-owner
 * rule for D1 is explicit: if no clean region is measured, the ring stays a blocker rather than being pointed
 * at an anchor somebody chose.
 */
export function chooseCredentialRegion(
  scope: CredentialRegionScope,
  labelCount: number,
): CredentialRegionScopeRow | null {
  if (!scope.anchorResolved || scope.resolvedCellCount === 0) return null;
  for (const row of [...scope.rows].sort((a, b) => a.depth - b.depth)) {
    if (row.credentialLabelCount === labelCount && row.credentialCellCount === scope.resolvedCellCount && row.vendorLabelCount === 0) {
      return row;
    }
  }
  return null;
}

/**
 * Why a credential read may not proceed. `OK` is the only member that permits one, and every other member is a
 * STOP — there is no "probably fine" here, because the recovery path (the seller types the keys themselves) has
 * always existed and costs a form, while a wrong resolution costs a credential.
 */
export const CREDENTIAL_CELL_REFUSALS = [
  "OK",
  /** A requested label was missing from the census entirely. */
  "MISSING_READING",
  /** The label did not resolve to exactly one painting element. */
  "LABEL_NOT_UNIQUE",
  /** Neither shape tied the label to a cell. */
  "NO_ASSOCIATION",
  /** The association resolved to zero cells, or to more than one. */
  "CELL_NOT_UNIQUE",
  /** The cell holds more than one field, so no rule here says which one is the value. */
  "CELL_SHAPE_AMBIGUOUS",
  /** The cell resolved, and is empty. A locator that reads nothing is not a locator. */
  "CELL_EMPTY",
  /** Two labels resolved to cells the page reported as the same one. */
  "CELL_COLLISION",
  /**
   * The three labels did not resolve by the SAME shape. Found by review, with an executed repro: a trailing cell
   * in the header row makes the LAST label's next sibling a `td`, so it resolves row-headed while the other two
   * resolve column-headed — and reads the cell beside it, which on a real page is a copy button's label. Every
   * per-field check passed; the whole was wrong. The values differ, so the distinctness check passes too, and a
   * button label would have been stored as the Secret Key on an account that then refuses to be overwritten.
   */
  "ASSOCIATION_MIXED",
  /** The labels resolved inside DIFFERENT tables. Three keys are one region or they are not these three keys. */
  "TABLE_MIXED",
  /** The candidate scan hit its cap, so "matched once" could not be distinguished from "matched once so far". */
  "SCAN_TRUNCATED",
] as const;
export type CredentialCellRefusal = (typeof CREDENTIAL_CELL_REFUSALS)[number];

/**
 * **Is this census a licence to read?** Total, fail-closed, and evaluated over the WHOLE requested set — one
 * unresolved label refuses the run, rather than a partial handoff that stores two of three secrets and leaves the
 * connection to fail later with no explanation.
 *
 * `requireNonEmpty` is on for the calibration and for the read's own pre-flight. It is separable only so a census
 * taken with the flag off can still be sanitized and inspected; it defaults to on because every caller that
 * DECIDES anything needs it.
 */
export function credentialCellsResolved(
  census: CredentialCellCensus,
  requestedIds: readonly string[],
  requireNonEmpty = true,
): { readonly ok: boolean; readonly reason: CredentialCellRefusal; readonly id?: string } {
  // WHOLE-SET checks first: a per-field sweep can pass three times over a resolution that is wrong as a set.
  const truncated = census.readings.find((r) => r.scanTruncated === true);
  if (truncated) return { ok: false, reason: "SCAN_TRUNCATED", id: truncated.id };
  const associations = new Set(
    census.readings.filter((r) => r.association && r.association !== "NONE").map((r) => r.association),
  );
  if (associations.size > 1) return { ok: false, reason: "ASSOCIATION_MIXED" };
  const tables = new Set(
    census.readings.filter((r) => typeof r.tableOrdinal === "number" && r.tableOrdinal >= 0).map((r) => r.tableOrdinal),
  );
  if (tables.size > 1) return { ok: false, reason: "TABLE_MIXED" };

  for (const id of requestedIds) {
    const reading = census.readings.find((r) => r.id === id);
    if (!reading) return { ok: false, reason: "MISSING_READING", id };
    if (reading.labelVisibleCount !== 1) return { ok: false, reason: "LABEL_NOT_UNIQUE", id };
    if (!reading.association || reading.association === "NONE") return { ok: false, reason: "NO_ASSOCIATION", id };
    if (reading.candidateCellCount !== 1) return { ok: false, reason: "CELL_NOT_UNIQUE", id };
    // An unmeasured input count is not a zero: a census that never answered cannot license an extraction rule.
    if (reading.cellInputCount === undefined || reading.cellInputCount > 1) {
      return { ok: false, reason: "CELL_SHAPE_AMBIGUOUS", id };
    }
    if (reading.cellDuplicate === true) return { ok: false, reason: "CELL_COLLISION", id };
    if (requireNonEmpty && reading.cellNonEmpty !== true) return { ok: false, reason: "CELL_EMPTY", id };
  }
  return { ok: true, reason: "OK" };
}

const ASSOCIATIONS: ReadonlySet<string> = new Set<string>(CREDENTIAL_CELL_ASSOCIATIONS);

/** How many candidate cells a reading may describe. A column with more than this is not a credential column. */
export const CREDENTIAL_CANDIDATE_CELL_LIMIT = 8;

function count(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : undefined;
}

/**
 * A tag name, and nothing that is not one. Uppercase ASCII letters and digits only — which `tagName` on an HTML
 * element always is, and which no text, id, class, or credential value can be smuggled through.
 */
function tag(raw: unknown): string | undefined {
  return typeof raw === "string" && /^[A-Z][A-Z0-9]{0,19}$/.test(raw) ? raw : undefined;
}

/** Fold the candidate list, dropping any row that is not four well-shaped structural facts. */
function candidateCells(raw: unknown): readonly CredentialCandidateCell[] {
  if (!Array.isArray(raw)) return [];
  const out: CredentialCandidateCell[] = [];
  for (const row of raw as unknown[]) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const rowOrdinal = count(r["rowOrdinal"]);
    const sectionTag = tag(r["sectionTag"]);
    const rowCellCount = count(r["rowCellCount"]);
    const cellTag = tag(r["cellTag"]);
    if (rowOrdinal === undefined || sectionTag === undefined || rowCellCount === undefined || cellTag === undefined) continue;
    out.push({ rowOrdinal, sectionTag, rowCellCount, cellTag });
  }
  return out.slice(0, CREDENTIAL_CANDIDATE_CELL_LIMIT);
}

/** Fold a raw region-scope answer into the declared shape, dropping anything else. Fail-closed and total. */
export function sanitizeCredentialRegionScope(raw: unknown): CredentialRegionScope {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (obj["anchorResolved"] !== true) return { anchorResolved: false, resolvedCellCount: 0, rows: [] };
  const rows: CredentialRegionScopeRow[] = [];
  for (const r of Array.isArray(obj["rows"]) ? (obj["rows"] as unknown[]) : []) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const depth = count(row["depth"]);
    const t = tag(row["tag"]);
    const credentialLabelCount = count(row["credentialLabelCount"]);
    const credentialCellCount = count(row["credentialCellCount"]);
    const vendorLabelCount = count(row["vendorLabelCount"]);
    if (depth === undefined || depth < 1 || t === undefined) continue;
    if (credentialLabelCount === undefined || credentialCellCount === undefined || vendorLabelCount === undefined) continue;
    rows.push({ depth, tag: t, credentialLabelCount, credentialCellCount, vendorLabelCount });
  }
  return { anchorResolved: true, resolvedCellCount: count(obj["resolvedCellCount"]) ?? 0, rows };
}

/**
 * Fold whatever the page returned into the declared shape, dropping everything else.
 *
 * This sanitizer is the boundary, and it is the reason the in-page script's discipline is checkable from a unit
 * test rather than only by reading the script: a value smuggled into any field is not of a shape any field
 * accepts, so it lands nowhere. A reading that does not resolve uniquely is reduced to its counts, so a
 * half-answered page reads as unresolved rather than as partially trusted.
 */
export function sanitizeCredentialCellCensus(raw: unknown, requestedIds: readonly string[]): CredentialCellCensus {
  const rows = Array.isArray((raw as { readings?: unknown } | null)?.readings)
    ? ((raw as { readings: unknown[] }).readings as unknown[])
    : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (row && typeof row === "object") {
      const id = (row as { id?: unknown }).id;
      if (typeof id === "string") byId.set(id, row as Record<string, unknown>);
    }
  }
  const readings = requestedIds.map<CredentialCellReading>((id) => {
    const row = byId.get(id);
    const labelVisibleCount = count(row?.["labelVisibleCount"]) ?? 0;
    const base: CredentialCellReading = {
      id,
      labelVisibleCount,
      labelHiddenCount: count(row?.["labelHiddenCount"]) ?? 0,
      // Survives the early return below: a truncated scan is precisely WHY the label did not resolve, and
      // dropping it here would turn the honest refusal back into a bare "nothing matched".
      ...(row?.["scanTruncated"] === true ? { scanTruncated: true } : {}),
    };
    if (!row || labelVisibleCount !== 1) return base;
    const assocRaw = row["association"];
    const association: CredentialCellAssociation =
      typeof assocRaw === "string" && ASSOCIATIONS.has(assocRaw) ? (assocRaw as CredentialCellAssociation) : "NONE";
    const labelTag = tag(row["labelTag"]);
    const candidateCellCount = count(row["candidateCellCount"]);
    const cellTag = association === "NONE" ? undefined : tag(row["cellTag"]);
    const cellInputCount = count(row["cellInputCount"]);
    const columnIndex = count(row["labelColumnIndex"]);
    const candidates = candidateCells(row["candidateCells"]);
    const ordinalRaw = row["tableOrdinal"];
    const tableOrdinal =
      typeof ordinalRaw === "number" && Number.isInteger(ordinalRaw) && ordinalRaw >= -1 ? ordinalRaw : undefined;
    const nonEmptyRaw = row["cellNonEmpty"];
    return {
      ...base,
      ...(labelTag ? { labelTag } : {}),
      association,
      ...(candidateCellCount !== undefined ? { candidateCellCount } : {}),
      ...(cellTag ? { cellTag } : {}),
      ...(cellInputCount !== undefined ? { cellInputCount } : {}),
      ...(tableOrdinal !== undefined ? { tableOrdinal } : {}),
      ...(columnIndex !== undefined ? { labelColumnIndex: columnIndex } : {}),
      ...(candidates.length > 0 ? { candidateCells: candidates } : {}),
      ...(row["cellDuplicate"] === true ? { cellDuplicate: true } : {}),
      ...(typeof nonEmptyRaw === "boolean" ? { cellNonEmpty: nonEmptyRaw } : {}),
    };
  });
  return { readings };
}
