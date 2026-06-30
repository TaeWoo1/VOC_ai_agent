/**
 * Pure, SANITIZED minimal ROW-SHAPE analyser for an ESM+ REVIEW workbook (Gate 5).
 *
 * Gate 4 read header shape only. Gate 5 reads the first N **data** rows (via the
 * dependency-free reader's `readWorkbookRowSample`) and reduces every cell to sanitized
 * signals — **presence / value-class / salted hash / per-column distinctness** — so the
 * composite dedup-key candidates (dedup design L1/L2/L3) can be evaluated from real row
 * behaviour. It owns every sanitisation decision; the reader does the I/O and hands this
 * module a `WorkbookRowSample` whose raw header/row arrays are INPUT-ONLY.
 *
 * STRICT NO-LEAK (Policy A of `docs/esmplus-review-data-policy.md`): the only thing that
 * leaves this module is sanitized metadata — booleans, coarse buckets, fixed enum labels,
 * structural counts, and salted non-reversible hashes. Raw header/cell strings arrive ONLY
 * as input (to be hashed/categorised/classified) and are NEVER copied into the output;
 * PII-like columns (`orderOrBuyerRiskCandidate`) emit presence + value-class only, never a
 * value hash. So `JSON.stringify` of any result here is leak-free by construction.
 *
 * Honest markers differ from the schema-shape module: rows ARE minimally inspected here
 * (`minimalRowsInspected: true`), but `rawCellLeak`, `schemaMappingConfirmed`, and
 * `dedupKeyConfirmed` stay false — Gate 5 evaluates dedup feasibility, it never CONFIRMS a
 * key. REVIEW stays NEEDS_DISCOVERY; dedup stays NEEDS_VERIFICATION.
 */

import {
  HEADER_CATEGORIES,
  categorizeHeader,
  headerHash,
  rowCountBucket,
  type HeaderCategory,
  type RowCountBucket,
} from "./esm-review-schema-shape";
import type { WorkbookRowSample } from "./esm-review-xlsx-reader";

/** Coarse, value-blind class for a single cell. Only the label ever leaves the module. */
export type CellValueClass =
  | "empty"
  | "numeric-small"
  | "numeric-long"
  | "date-like"
  | "id-like"
  | "text-short"
  | "text-long";

/** How populated a column's cells are across the sampled rows. */
export type PopulatedBucket = "none" | "some" | "all";

/** Distinctness of a column's populated cells across the sampled rows. */
export type Distinctness = "all-same" | "some-distinct" | "all-distinct" | "n/a";

const TEXT_SHORT_MAX = 20; // codepoints; above ⇒ text-long
const NUMERIC_LONG_MIN = 7; // all-digit runs this long ⇒ id-/order-like, not a small code
const DATE_RE = /^\d{4}[-./]\d{1,2}[-./]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/;

/** Pure: classify a raw cell value into a coarse, value-blind class. null/blank ⇒ "empty". */
export function classifyCellValue(raw: string | null): CellValueClass {
  if (raw === null) return "empty";
  const s = raw.trim();
  if (s.length === 0) return "empty";
  if (DATE_RE.test(s)) return "date-like";
  if (/^\d+$/.test(s)) return s.length >= NUMERIC_LONG_MIN ? "numeric-long" : "numeric-small";
  // compact alphanumeric token (has a letter AND a digit, no whitespace) ⇒ id-like
  if (!/\s/.test(s) && /[A-Za-z]/.test(s) && /\d/.test(s) && /^[A-Za-z0-9_.\-]+$/.test(s)) return "id-like";
  return [...s].length <= TEXT_SHORT_MAX ? "text-short" : "text-long";
}

/** Sanitized per-column row-shape signal. `valueHashes` is omitted for PII-like columns. */
export interface SanitizedColumnRowShape {
  headerHash: string;
  category: HeaderCategory;
  populated: PopulatedBucket;
  /** Dominant value class across populated cells, or "mixed" / "empty". */
  valueClass: CellValueClass | "mixed";
  distinctness: Distinctness;
  /** Low-cardinality short/numeric column (e.g. rating, reply-status). */
  enumLike: boolean;
  /** Per-populated-cell salted hashes (equality reasoning). OMITTED for PII-like columns. */
  valueHashes?: string[];
}

/** Sanitized dedup-feasibility verdict — evaluation only, never a confirmation. */
export interface DedupFeasibility {
  l1Feasible: boolean;
  l2Feasible: boolean;
  l3Only: boolean;
  idColumnSuspected: boolean;
  notes: string[];
}

/** The ONLY shape Gate 5 emits — fully sanitized. */
export interface SanitizedRowShape {
  workbookReadable: boolean;
  /** How many data rows were actually sampled (bucketed, never exact). */
  sampledRowBucket: RowCountBucket;
  /** Total rows in the sheet (bucketed, never exact). */
  totalRowBucket: RowCountBucket;
  columnCount: number;
  columns: SanitizedColumnRowShape[];
  dedup: DedupFeasibility;
  risks: string[];
  /** Honest markers. Rows ARE read here, but nothing is leaked or confirmed. */
  rawCellLeak: false;
  minimalRowsInspected: boolean;
  uploaded: false;
  schemaMappingConfirmed: false;
  dedupKeyConfirmed: false;
}

const PII_CATEGORY: HeaderCategory = "orderOrBuyerRiskCandidate";

function populatedBucket(populated: number, sampled: number): PopulatedBucket {
  if (populated <= 0) return "none";
  if (populated >= sampled) return "all";
  return "some";
}

function distinctnessOf(hashes: readonly string[]): Distinctness {
  if (hashes.length <= 1) return "n/a"; // can't judge distinctness from 0–1 populated cells
  const distinct = new Set(hashes).size;
  if (distinct === 1) return "all-same";
  if (distinct === hashes.length) return "all-distinct";
  return "some-distinct";
}

function dominantClass(classes: readonly CellValueClass[]): CellValueClass | "mixed" | "empty" {
  const nonEmpty = classes.filter((c) => c !== "empty");
  if (nonEmpty.length === 0) return "empty";
  const first = nonEmpty[0]!;
  return nonEmpty.every((c) => c === first) ? first : "mixed";
}

/** Does at least one column of this category carry discriminating, populated values? */
function categoryDiscriminates(columns: readonly SanitizedColumnRowShape[], category: HeaderCategory): boolean {
  return columns.some(
    (c) =>
      c.category === category &&
      c.populated !== "none" &&
      (c.distinctness === "all-distinct" || c.distinctness === "some-distinct"),
  );
}

function categoryPopulated(columns: readonly SanitizedColumnRowShape[], category: HeaderCategory): boolean {
  return columns.some((c) => c.category === category && c.populated !== "none");
}

function evaluateDedup(columns: readonly SanitizedColumnRowShape[], sampled: number): DedupFeasibility {
  const notes: string[] = [];

  const datePop = categoryPopulated(columns, "reviewDateCandidate");
  const productPop = categoryPopulated(columns, "productCandidate");
  const ratingPop = categoryPopulated(columns, "ratingCandidate");
  const textPop = categoryPopulated(columns, "reviewTextCandidate");

  const textDiscriminates = categoryDiscriminates(columns, "reviewTextCandidate");
  const dateOrProductDiscriminates =
    categoryDiscriminates(columns, "reviewDateCandidate") || categoryDiscriminates(columns, "productCandidate");

  const l1Feasible = datePop && productPop && ratingPop && textPop && textDiscriminates;
  const l2Feasible = datePop && productPop && ratingPop && dateOrProductDiscriminates;
  const l3Only = !l1Feasible && !l2Feasible && datePop && productPop;

  // An unknown/id-like column that is fully populated and all-distinct is a suspected natural key.
  const idColumnSuspected = columns.some(
    (c) =>
      (c.category === "unknown" || c.category === "reviewIdCandidate") &&
      c.populated === "all" &&
      c.distinctness === "all-distinct" &&
      (c.valueClass === "id-like" || c.valueClass === "numeric-long"),
  );

  if (sampled <= 1) notes.push("single-sample-row-distinctness-unreliable");
  if (textPop && !textDiscriminates) notes.push("reviewText-not-discriminating");
  if (!textPop) notes.push("reviewText-empty");
  if (categoryPopulated(columns, "ratingCandidate") && !categoryDiscriminates(columns, "ratingCandidate")) {
    notes.push("rating-low-entropy");
  }
  if (idColumnSuspected) notes.push("id-like-column-all-distinct-suspected-natural-key");
  if (l3Only) notes.push("only-weak-key-reachable-collision-risk");

  return { l1Feasible, l2Feasible, l3Only, idColumnSuspected, notes };
}

/**
 * Pure: fold a `WorkbookRowSample` into the sanitized Gate-5 row-shape summary. Categorises +
 * hashes headers, classifies + hashes the sampled cells per column, derives populated /
 * distinctness / enum-like signals and a dedup-feasibility verdict. Emits no raw header/cell
 * text. PII-like columns never get a value hash.
 */
export function summarizeRowShape(sample: WorkbookRowSample, salt?: string): SanitizedRowShape {
  const sampled = sample.sampleRows.length;
  const columnCount = sample.columnCount;

  const columns: SanitizedColumnRowShape[] = [];
  for (let col = 0; col < columnCount; col += 1) {
    const rawHeader = (sample.headerCells[col] ?? "").trim();
    const category = rawHeader.length > 0 ? categorizeHeader(rawHeader) : "unknown";
    const isPii = category === PII_CATEGORY;

    const cellClasses: CellValueClass[] = [];
    const populatedHashes: string[] = []; // internal — drives distinctness even for PII
    for (const row of sample.sampleRows) {
      const raw = row[col] ?? null;
      const cls = classifyCellValue(raw);
      cellClasses.push(cls);
      if (cls !== "empty" && raw !== null) populatedHashes.push(headerHash(salt, raw));
    }

    const populatedCount = cellClasses.filter((c) => c !== "empty").length;
    const valueClass = dominantClass(cellClasses);
    const distinctness = distinctnessOf(populatedHashes);
    const enumLike =
      populatedCount > 0 &&
      (distinctness === "all-same" || distinctness === "some-distinct") &&
      (valueClass === "numeric-small" || valueClass === "text-short");

    const column: SanitizedColumnRowShape = {
      headerHash: headerHash(salt, rawHeader),
      category,
      populated: populatedBucket(populatedCount, sampled),
      valueClass: valueClass === "empty" ? "empty" : valueClass,
      distinctness,
      enumLike,
    };
    // Non-PII columns expose per-cell hashes; PII-like columns never do (Policy A).
    if (!isPii) column.valueHashes = populatedHashes;
    columns.push(column);
  }

  const risks: string[] = [];
  for (const r of sample.readerRisks ?? []) risks.push(r);
  if (!sample.workbookReadable) risks.push("unreadable-workbook");
  if (sample.workbookReadable && sampled === 0) risks.push("no-populated-data-rows");
  if (sampled === 1) risks.push("single-sample-row");
  if (columns.some((c) => c.category === PII_CATEGORY)) risks.push("pii-like-header-present");

  return {
    workbookReadable: sample.workbookReadable,
    sampledRowBucket: rowCountBucket(sampled),
    totalRowBucket: rowCountBucket(sample.rowCount),
    columnCount,
    columns,
    dedup: evaluateDedup(columns, sampled),
    risks: [...new Set(risks)],
    rawCellLeak: false,
    minimalRowsInspected: sampled > 0,
    uploaded: false,
    // Gate 5 NEVER confirms a mapping or a dedup key — those stay NEEDS_VERIFICATION.
    schemaMappingConfirmed: false,
    dedupKeyConfirmed: false,
  };
}

/** All categories, re-exported for callers building presence maps over the row-shape output. */
export { HEADER_CATEGORIES };
