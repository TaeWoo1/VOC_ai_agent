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
}

export interface CredentialCellCensus {
  readonly readings: readonly CredentialCellReading[];
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
    };
    if (!row || labelVisibleCount !== 1) return base;
    const assocRaw = row["association"];
    const association: CredentialCellAssociation =
      typeof assocRaw === "string" && ASSOCIATIONS.has(assocRaw) ? (assocRaw as CredentialCellAssociation) : "NONE";
    const labelTag = tag(row["labelTag"]);
    const candidateCellCount = count(row["candidateCellCount"]);
    const cellTag = association === "NONE" ? undefined : tag(row["cellTag"]);
    const cellInputCount = count(row["cellInputCount"]);
    const nonEmptyRaw = row["cellNonEmpty"];
    return {
      ...base,
      ...(labelTag ? { labelTag } : {}),
      association,
      ...(candidateCellCount !== undefined ? { candidateCellCount } : {}),
      ...(cellTag ? { cellTag } : {}),
      ...(cellInputCount !== undefined ? { cellInputCount } : {}),
      ...(row["cellDuplicate"] === true ? { cellDuplicate: true } : {}),
      ...(typeof nonEmptyRaw === "boolean" ? { cellNonEmpty: nonEmptyRaw } : {}),
    };
  });
  return { readings };
}
