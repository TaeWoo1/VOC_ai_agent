/**
 * Pure, SANITIZED composite dedup-KEY builder for an ESM+ REVIEW workbook (Gate 5, Slice 5A).
 *
 * Gate 4b + Slice 4B established (on real populated rows) that ESM+ REVIEW carries NO single
 * stable review-id column, so dedup must use a COMPOSITE key over product + date + rating +
 * reviewText. A single export cannot prove such a key is stable/unique across exports — that
 * cross-export test (Slice 5B) needs, for every sampled row, a comparable *composite* key. The
 * per-column `valueHashes` of `esm-review-row-shape.ts` cannot supply it: they are a per-COLUMN
 * bag that drops empty cells, so they are not row-aligned and never combine across columns.
 *
 * This module fills that gap. From a `WorkbookRowSample` (raw rows are INPUT-ONLY) it selects
 * one representative column per identity category, normalises the components, and emits — per
 * row — three salted, one-way COMPOSITE key hashes (L1 strong / L2 fallback / L3 weak) plus a
 * full-content context hash used only to detect cross-export false-merges. Two captures that
 * share the same non-empty salt hash the same review to the same key, so the offline overlap
 * comparator (`esm-review-overlap.ts`) can test same-review→same-key and collision risk.
 *
 * STRICT NO-LEAK (Policy A): the ONLY thing that leaves this module is sanitized metadata —
 * salted 16-hex hashes, coarse buckets, fixed category labels, booleans, and the fixed channel
 * literal. Raw header/cell strings arrive ONLY as input (to be normalised/hashed) and are NEVER
 * emitted. A composite key is a hash OF normalised content, strictly less reversible than the
 * per-cell hashes Gate 5 already emits (one hash per row ≤ the per-cell bag).
 *
 * EXCLUDED FROM IDENTITY, by construction: `replyStatusCandidate` (mutable — a seller may answer
 * between exports), `orderOrBuyerRiskCandidate` (PII), `reviewIdCandidate` (no stable id — the
 * very reason a composite is needed), and `unknown`. Only the four identity categories below
 * ever contribute to a key. This module CONFIRMS nothing: `dedupKeyConfirmed`/
 * `schemaMappingConfirmed` stay false; dedup stays NEEDS_VERIFICATION.
 */

import { createHash } from "node:crypto";
import {
  categorizeHeader,
  headerHash,
  rowCountBucket,
  type HeaderCategory,
  type RowCountBucket,
} from "./esm-review-schema-shape";
import type { WorkbookRowSample } from "./esm-review-xlsx-reader";

/** The identity categories that contribute to a composite key, in slot order. */
export const IDENTITY_CATEGORIES = [
  "reviewDateCandidate",
  "productCandidate",
  "ratingCandidate",
  "reviewTextCandidate",
] as const satisfies readonly HeaderCategory[];

/** The channel literal is a fixed, non-identifying constant — safe to emit and namespace keys by. */
export type ChannelLiteral = "esmplus";

/** Per-row composite candidate keys. A level is null when its required components are absent. */
export interface RowCompositeKeys {
  /** channel + store + H(date) + H(product) + rating + H(reviewText). Null if any is missing. */
  l1: string | null;
  /** channel + store + H(date) + H(product) + rating. Null if any is missing. */
  l2: string | null;
  /** channel + store + H(date) + H(product). Null if date or product is missing (weak/collision-prone). */
  l3: string | null;
  /** Full-content fingerprint (all present identity components). Detects cross-export false-merges. */
  context: string;
}

/** Which header (by salted hash) fills each identity slot; null when that category is absent. */
export interface SlotProvenance {
  reviewDate: string | null;
  product: string | null;
  rating: string | null;
  reviewText: string | null;
}

/** Coarse per-level coverage across the sampled rows (bucketed, never exact). */
export interface CompositeCoverage {
  l1: RowCountBucket;
  l2: RowCountBucket;
  l3: RowCountBucket;
}

/** The ONLY shape Slice 5A's key builder emits — fully sanitized. */
export interface SanitizedCompositeKeySet {
  workbookReadable: boolean;
  /** Fixed channel literal — namespaces keys per platform; safe to emit. */
  channel: ChannelLiteral;
  /** True when a non-empty store fingerprint namespaced the keys (value itself never emitted). */
  storeFingerprintApplied: boolean;
  sampledRowBucket: RowCountBucket;
  totalRowBucket: RowCountBucket;
  columnCount: number;
  /** The header (salted hash) chosen for each identity slot — lets the comparator detect drift. */
  slotProvenance: SlotProvenance;
  /** Categories present in the header but deliberately excluded from identity (e.g. replyStatus, PII). */
  excludedCategories: HeaderCategory[];
  /** Per-row composite keys (salted hashes only). */
  rows: RowCompositeKeys[];
  coverage: CompositeCoverage;
  risks: string[];
  /** Honest markers. Rows ARE read to build keys, but nothing is leaked or confirmed. */
  rawCellLeak: false;
  dedupKeyConfirmed: false;
  schemaMappingConfirmed: false;
}

export interface CompositeKeyOptions {
  channel?: ChannelLiteral;
  /** One-way store fingerprint (e.g. `boundStoreFingerprintHash`) — NOT a raw store id. */
  storeFingerprint?: string | undefined;
  /** Shared salt (`STORAGE_PROBE_SALT`). Two captures must use the SAME salt to be comparable. */
  salt?: string | undefined;
}

const DATE_CANON_RE = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?/;

/** Pure: canonicalise a review date so separator/zero-pad differences don't split the same day.
 *  `2026.6.3` / `2026-06-03` / `2026/06/03 09:05:00` → `2026-06-03` (+`T09:05` when a time is present).
 *  Unparseable input falls back to whitespace-collapsed lowercase (stable within one format). */
export function normalizeReviewDate(raw: string): string {
  const s = raw.trim();
  const m = DATE_CANON_RE.exec(s);
  if (!m) return s.replace(/\s+/g, " ").toLowerCase();
  const pad = (v: string): string => v.padStart(2, "0");
  let out = `${m[1]!}-${pad(m[2]!)}-${pad(m[3]!)}`;
  if (m[4] !== undefined && m[5] !== undefined) out += `T${pad(m[4])}:${m[5]}`;
  return out;
}

/** Pure: reduce a rating cell to its leading numeric token (so `5` / `5점` / `5.0` align). */
export function normalizeRating(raw: string): string {
  const n = /\d+(?:\.\d+)?/.exec(raw.trim());
  return n ? n[0] : raw.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Trim + collapse whitespace + lowercase (product / reviewText). Matches `headerHash`'s own normalise. */
function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

/** A present, non-blank cell value, or null. */
function cellValue(row: ReadonlyArray<string | null>, index: number | null): string | null {
  if (index === null) return null;
  const raw = row[index] ?? null;
  if (raw === null) return null;
  const s = raw.trim();
  return s.length === 0 ? null : raw;
}

/** Salted one-way 16-hex hash of an ORDERED component array (array form avoids separator ambiguity). */
function compositeHash(salt: string | undefined, parts: readonly string[]): string {
  return createHash("sha256")
    .update(`${salt ?? ""} ${JSON.stringify(parts)}`)
    .digest("hex")
    .slice(0, 16);
}

/** First column index whose header categorises to `category`, or null. Deterministic (lowest index). */
function firstColumnOf(headerCells: ReadonlyArray<string | null>, category: HeaderCategory): number | null {
  for (let col = 0; col < headerCells.length; col += 1) {
    const raw = (headerCells[col] ?? "").trim();
    if (raw.length > 0 && categorizeHeader(raw) === category) return col;
  }
  return null;
}

/**
 * Pure: fold a `WorkbookRowSample` into per-row sanitized composite candidate keys. Selects one
 * representative column per identity category, normalises + hashes the components with the shared
 * salt, and emits L1/L2/L3 + a context hash per row. Emits no raw header/cell text; identity uses
 * ONLY the four identity categories (replyStatus / PII / review-id / unknown are excluded).
 */
export function summarizeCompositeKeys(
  sample: WorkbookRowSample,
  options: CompositeKeyOptions = {},
): SanitizedCompositeKeySet {
  const channel: ChannelLiteral = options.channel ?? "esmplus";
  const storeFingerprint = (options.storeFingerprint ?? "").trim();
  const salt = options.salt;
  const headerCells = sample.headerCells;

  const dateCol = firstColumnOf(headerCells, "reviewDateCandidate");
  const productCol = firstColumnOf(headerCells, "productCandidate");
  const ratingCol = firstColumnOf(headerCells, "ratingCandidate");
  const textCol = firstColumnOf(headerCells, "reviewTextCandidate");

  const slotHash = (col: number | null): string | null =>
    col === null ? null : headerHash(salt, (headerCells[col] ?? "").trim());
  const slotProvenance: SlotProvenance = {
    reviewDate: slotHash(dateCol),
    product: slotHash(productCol),
    rating: slotHash(ratingCol),
    reviewText: slotHash(textCol),
  };

  const rows: RowCompositeKeys[] = [];
  for (const row of sample.sampleRows) {
    const dateRaw = cellValue(row, dateCol);
    const productRaw = cellValue(row, productCol);
    const ratingRaw = cellValue(row, ratingCol);
    const textRaw = cellValue(row, textCol);

    const date = dateRaw === null ? null : normalizeReviewDate(dateRaw);
    const product = productRaw === null ? null : normalizeText(productRaw);
    const rating = ratingRaw === null ? null : normalizeRating(ratingRaw);
    const text = textRaw === null ? null : normalizeText(textRaw);

    const prefix = [channel, storeFingerprint];
    const hasDateProduct = date !== null && product !== null;
    const l3 = hasDateProduct ? compositeHash(salt, [...prefix, date!, product!]) : null;
    const l2 = hasDateProduct && rating !== null ? compositeHash(salt, [...prefix, date!, product!, rating!]) : null;
    const l1 =
      hasDateProduct && rating !== null && text !== null
        ? compositeHash(salt, [...prefix, date!, product!, rating!, text!])
        : null;
    // Full-content fingerprint over every PRESENT identity component (distinct "ctx" prefix so it
    // can never equal an L-key). Same content ⇒ same context, so an L1 match implies a context
    // match; an L2/L3 key with DIFFERING contexts across exports reveals a false-merge.
    const context = compositeHash(salt, [
      "ctx",
      date ?? "",
      product ?? "",
      rating ?? "",
      text ?? "",
    ]);
    rows.push({ l1, l2, l3, context });
  }

  const presentCategories = new Set<HeaderCategory>();
  for (const cell of headerCells) {
    const raw = (cell ?? "").trim();
    if (raw.length > 0) presentCategories.add(categorizeHeader(raw));
  }
  const identity = new Set<HeaderCategory>(IDENTITY_CATEGORIES);
  const excludedCategories = [...presentCategories].filter((c) => !identity.has(c));

  const countLevel = (pick: (r: RowCompositeKeys) => string | null): number =>
    rows.reduce((n, r) => n + (pick(r) !== null ? 1 : 0), 0);

  const risks: string[] = [];
  for (const r of sample.readerRisks ?? []) risks.push(r);
  if (!sample.workbookReadable) risks.push("unreadable-workbook");
  if (sample.workbookReadable && rows.length === 0) risks.push("no-populated-data-rows");
  if (textCol === null) risks.push("reviewText-column-absent-l1-unreachable");
  if (dateCol === null || productCol === null) risks.push("weak-or-no-key-reachable");
  if (presentCategories.has("orderOrBuyerRiskCandidate")) risks.push("pii-like-header-present-excluded");
  if (presentCategories.has("replyStatusCandidate")) risks.push("reply-status-present-excluded");
  if (presentCategories.has("reviewIdCandidate")) risks.push("review-id-candidate-present-excluded");

  return {
    workbookReadable: sample.workbookReadable,
    channel,
    storeFingerprintApplied: storeFingerprint.length > 0,
    sampledRowBucket: rowCountBucket(rows.length),
    totalRowBucket: rowCountBucket(sample.rowCount),
    columnCount: sample.columnCount,
    slotProvenance,
    excludedCategories,
    rows,
    coverage: {
      l1: rowCountBucket(countLevel((r) => r.l1)),
      l2: rowCountBucket(countLevel((r) => r.l2)),
      l3: rowCountBucket(countLevel((r) => r.l3)),
    },
    risks: [...new Set(risks)],
    rawCellLeak: false,
    // Slice 5A/5B never confirm a key or a mapping — those stay NEEDS_VERIFICATION.
    dedupKeyConfirmed: false,
    schemaMappingConfirmed: false,
  };
}
