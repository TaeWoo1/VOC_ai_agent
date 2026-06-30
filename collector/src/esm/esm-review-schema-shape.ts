import { createHash } from "node:crypto";

/**
 * Pure, SANITIZED schema-SHAPE summariser for an ESM+ REVIEW workbook (Gate 4).
 *
 * Gate 4 is **schema discovery only** — it inspects a captured xlsx's *structure*
 * (sheet/row/column/header shape) to PLAN a future normaliser, and never ingests,
 * normalises, or confirms a field mapping. This module owns every sanitisation and
 * categorisation decision; the dependency-free file reader (`esm-review-xlsx-reader.ts`)
 * does the I/O and hands this module a plain `WorkbookShape`.
 *
 * STRICT NO-LEAK: the only thing that ever leaves this module is sanitized metadata —
 * booleans, coarse buckets, exact structural counts (sheet/column/header counts are
 * shape, not content), fixed category labels, and salted non-reversible header **hashes**.
 * Raw header strings arrive ONLY as input (so the categoriser can hash + classify them)
 * and are NEVER copied into the output. Row/cell values are never read at all. So
 * `JSON.stringify` of any result here is leak-free by construction.
 *
 * NON-GOALS (by design): no row parsing, no column-schema CONFIRMATION, no dedup-key
 * confirmation, no upload, no ingest, no `CONFIRMED` capability.
 */

/** Pure: read `--xlsx <path>` (or `=path`) from argv. Null when absent (CLI then refuses). */
export function parseXlsxPathArg(args: readonly string[]): string | null {
  const FLAG = "--xlsx";
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === FLAG) return args[i + 1] ?? null;
    if (a.startsWith(`${FLAG}=`)) return a.slice(FLAG.length + 1);
  }
  return null;
}

/** Coarse row-count bucket — never the exact row count (rows may be PII-bearing). */
export type RowCountBucket = "zero" | "one" | "few" | "tens" | "hundreds" | "thousands_plus";

/** Pure: coarse row-count bucket. */
export function rowCountBucket(n: number): RowCountBucket {
  if (!Number.isFinite(n) || n <= 0) return "zero";
  if (n === 1) return "one";
  if (n <= 9) return "few";
  if (n <= 99) return "tens";
  if (n <= 999) return "hundreds";
  return "thousands_plus";
}

/**
 * Sanitized candidate category for a header column. These are **candidates** only — a
 * provisional classification of what a column *might* be, never a confirmed mapping.
 * `orderOrBuyerRiskCandidate` flags a PII-/identity-like header (buyer/order/contact);
 * such headers are categorised as a RISK and their raw text is never emitted.
 */
export type HeaderCategory =
  | "reviewIdCandidate"
  | "reviewDateCandidate"
  | "ratingCandidate"
  | "productCandidate"
  | "reviewTextCandidate"
  | "replyStatusCandidate"
  | "orderOrBuyerRiskCandidate"
  | "unknown";

/** All categories, in a stable order — drives `categoryPresence`. */
export const HEADER_CATEGORIES: readonly HeaderCategory[] = [
  "reviewIdCandidate",
  "reviewDateCandidate",
  "ratingCandidate",
  "productCandidate",
  "reviewTextCandidate",
  "replyStatusCandidate",
  "orderOrBuyerRiskCandidate",
  "unknown",
];

/**
 * Risk-first, priority-ordered classification rules. The FIRST match wins, so a header
 * that looks identity-/PII-like (buyer, order, contact, author name) is classified as a
 * risk even when it also contains a benign token (e.g. "상품주문번호" → risk, not product).
 */
const RULES: ReadonlyArray<{ category: Exclude<HeaderCategory, "unknown">; re: RegExp }> = [
  // Strong PII/identity tokens win first: a buyer/order/contact/author column is a risk even
  // when it also carries a benign word (e.g. "상품주문번호" → risk, not product).
  {
    category: "orderOrBuyerRiskCandidate",
    re: /주문|order|구매자|buyer|회원|member|수취인|받는|작성자|글쓴이|닉네임|nick|이름|성명|전화|연락처|phone|mobile|휴대폰|이메일|e-?mail|메일|주소|address|우편|\bzip\b|결제|카드|계좌|생년|주민|아이디/i,
  },
  { category: "reviewIdCandidate", re: /(리뷰|후기|평가|review).*(번호|no\.?|id)|글번호|^\s*번호\s*$/i },
  { category: "ratingCandidate", re: /평점|별점|점수|만족도|rating|score|star|★|평가점/i },
  { category: "reviewDateCandidate", re: /작성일|등록일|작성.*일자|날짜|일시|일자|date|regdate|작성시간|시간/i },
  { category: "productCandidate", re: /상품|제품|품목|product|item|goods|모델|model/i },
  { category: "reviewTextCandidate", re: /내용|후기|본문|리뷰|평가|코멘트|comment|content|\btext\b|body|review|메시지|message/i },
  { category: "replyStatusCandidate", re: /답변|댓글|reply|answer|상태|status|처리|노출|공개|여부|진행/i },
  // Weak, UNqualified identity tokens fall to risk only after the qualified categories had a
  // chance (so "Review ID" / "Product Name" classify correctly, but a bare "ID"/"Name" → risk).
  { category: "orderOrBuyerRiskCandidate", re: /(^|[^a-z])id([^a-z]|$)|\bname\b/i },
];

/** Pure: classify a single raw header into a sanitized candidate category (risk-first). */
export function categorizeHeader(raw: string): HeaderCategory {
  const s = raw.trim();
  if (s.length === 0) return "unknown";
  for (const rule of RULES) {
    if (rule.re.test(s)) return rule.category;
  }
  return "unknown";
}

/** Pure: salted, one-way 16-hex header fingerprint. Two runs with the same header text
 *  produce the same token WITHOUT the raw text ever being recoverable or emitted. */
export function headerHash(salt: string | undefined, raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256")
    .update(`${salt ?? ""} ${normalized}`)
    .digest("hex")
    .slice(0, 16);
}

/** Sanitized per-header metadata — a hash + a candidate category, NEVER the raw header. */
export interface SanitizedHeader {
  hash: string;
  category: HeaderCategory;
}

/**
 * Plain structural facts the reader extracts. `headers` is RAW — it is consumed here only
 * to hash + categorise, and is never placed in the sanitized output.
 */
export interface WorkbookShape {
  workbookReadable: boolean;
  sheetCount: number;
  /** 0-based index of the inspected sheet, or null when no worksheet was read. */
  selectedSheetIndex: number | null;
  /** Exact row count (kept internal — only the bucket is emitted). */
  rowCount: number;
  columnCount: number;
  /** RAW header strings — INPUT ONLY. Never emitted. */
  headers: readonly string[];
  /** Structural risks the reader detected (e.g. "not-zip-container", "no-worksheet"). */
  readerRisks?: readonly string[];
}

/** The ONLY shape Gate 4 emits — fully sanitized. */
export interface SanitizedSchemaShape {
  workbookReadable: boolean;
  sheetCount: number;
  selectedSheetIndex: number | null;
  rowCountBucket: RowCountBucket;
  columnCount: number;
  headerCount: number;
  /** Sanitized header metadata: hash + candidate category only (never raw header text). */
  headerMeta: SanitizedHeader[];
  /** Which candidate categories are present (booleans only). */
  categoryPresence: Record<HeaderCategory, boolean>;
  /** Possible dedup-key candidate columns (review-id-like), as hash + category only. */
  candidateDedupFields: SanitizedHeader[];
  /** Fixed sanitized risk tokens — never raw content. */
  risks: string[];
  /** Invariants, always asserted explicitly so the honest posture is machine-checkable. */
  rawCellLeak: false;
  uploaded: false;
  rowsParsed: false;
  schemaMappingConfirmed: false;
  dedupKeyConfirmed: false;
}

/**
 * Pure: fold the raw `WorkbookShape` into the sanitized Gate-4 summary. Categorises +
 * hashes the headers, derives the row bucket, lists review-id-like dedup candidates,
 * and collects fixed risk tokens. Emits no raw header/cell text or filename.
 */
export function summarizeSchemaShape(shape: WorkbookShape, salt?: string): SanitizedSchemaShape {
  const headerMeta: SanitizedHeader[] = shape.headers
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .map((h) => ({ hash: headerHash(salt, h), category: categorizeHeader(h) }));

  const categoryPresence = Object.fromEntries(
    HEADER_CATEGORIES.map((c) => [c, headerMeta.some((h) => h.category === c)]),
  ) as Record<HeaderCategory, boolean>;

  const candidateDedupFields = headerMeta.filter((h) => h.category === "reviewIdCandidate");

  const risks: string[] = [];
  for (const r of shape.readerRisks ?? []) risks.push(r);
  if (!shape.workbookReadable) risks.push("unreadable-workbook");
  if (shape.workbookReadable && shape.rowCount <= 0) risks.push("empty-workbook");
  if (shape.workbookReadable && shape.rowCount > 0 && headerMeta.length === 0) risks.push("no-header-row");
  if (shape.sheetCount > 1) risks.push("multiple-sheets");
  if (categoryPresence.orderOrBuyerRiskCandidate) risks.push("pii-like-header-present");
  if (shape.workbookReadable && candidateDedupFields.length === 0) risks.push("no-dedup-key-candidate");

  return {
    workbookReadable: shape.workbookReadable,
    sheetCount: shape.sheetCount,
    selectedSheetIndex: shape.selectedSheetIndex,
    rowCountBucket: rowCountBucket(shape.rowCount),
    columnCount: shape.columnCount,
    headerCount: headerMeta.length,
    headerMeta,
    categoryPresence,
    candidateDedupFields,
    risks: [...new Set(risks)],
    rawCellLeak: false,
    uploaded: false,
    rowsParsed: false,
    // Gate 4 NEVER confirms a mapping or a dedup key — those stay NEEDS_VERIFICATION.
    schemaMappingConfirmed: false,
    dedupKeyConfirmed: false,
  };
}
