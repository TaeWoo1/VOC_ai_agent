// Pure helpers for the attention-signal drill-down. Kept out of the components so
// the param derivation, list-key stability, and reply-status labeling can be
// unit-tested as plain functions, independent of any rendering.

import type { AttentionSignal, OperatorVocItem, TriageDisposition } from "./types";

/** Query params for the drill-down behind one signal over a window. */
export interface DrilldownParams {
  type: string;
  from: string;
  to: string;
}

// The items endpoint keys off the signal TYPE (the AttentionSignalType), not its
// sourceType — LOW_RATING_REVIEW and NEW_REVIEW are both REVIEW yet drill to
// different rows, so the precise filter must travel as `type`.
export function drilldownParams(
  signal: AttentionSignal,
  range: { from: string; to: string },
): DrilldownParams {
  return { type: signal.type, from: range.from, to: range.to };
}

// Stable list key: a VOC item carries no id (metadata only), so the key is built
// from its position within the page plus invariant metadata. Page is included so
// keys stay unique across pages within one mounted list.
export function vocItemKey(item: OperatorVocItem, page: number, index: number): string {
  return `${item.signalType}-${page}-${index}`;
}

export interface ReplyStatusLabel {
  text: string;
  cls: string;
}

const REPLY_STATUS_LABEL: Record<string, ReplyStatusLabel> = {
  PENDING: { text: "미답변", cls: "bg-warn/10 text-warn" },
  IN_PROGRESS: { text: "처리 중", cls: "bg-brand/10 text-brand-700" },
  ANSWERED: { text: "답변 완료", cls: "bg-good/10 text-good" },
  UNKNOWN: { text: "상태 미상", cls: "bg-canvas text-muted" },
};

/**
 * Label + chip style for a reply status; null and unknown values both fall back to UNKNOWN.
 *
 * An ingested review now carries the CHANNEL's own statement where the export makes one — NAVER's
 * `답글여부` arrives as PENDING or ANSWERED. `UNKNOWN` covers a source that says nothing (an export
 * without the column, a blank cell, a row imported before the state was preserved) and is never
 * guessed into an answer; null and unrecognised values land on the same 상태 미상 chip, which is the
 * honest rendering for all three: the status is not known.
 *
 * This describes the channel, not SellerOps: a reply SellerOps guided is reported separately as
 * 답변함으로 기록 + 확인 안 함, because a public reply has no read-back oracle.
 */
export function replyStatusLabel(status: string | null): ReplyStatusLabel {
  return (status == null ? undefined : REPLY_STATUS_LABEL[status]) ?? REPLY_STATUS_LABEL.UNKNOWN;
}

/** Neutral placeholder when no sanitized preview is available (empty or suppressed). */
export const PREVIEW_PLACEHOLDER = "미리보기 없음";

export interface PreviewText {
  text: string;
  isPlaceholder: boolean;
}

// The backend already sanitizes; this only decides preview-vs-placeholder. Null OR
// an empty/whitespace string → the neutral placeholder (the absence can be empty
// content or a safety suppression, so the wording does not overclaim "protected").
export function previewText(safePreview: string | null): PreviewText {
  if (safePreview != null && safePreview.trim() !== "") {
    return { text: safePreview, isPlaceholder: false };
  }
  return { text: PREVIEW_PLACEHOLDER, isPlaceholder: true };
}

/**
 * Frontend-owned fallback when a VOC row carries no resolvable product name.
 *
 * Says the NAME is unknown — not that the product is missing. The backend's null
 * means "no name is available", never "this row has no product": a Cafe24 community
 * article has a real product its store simply cannot name. Wording that implied the
 * product itself was absent (e.g. "상품 미지정") would misreport that as an empty
 * row and quietly contradict the DTO's contract. Copy is owned here, never sent by
 * the server.
 */
export const PRODUCT_PLACEHOLDER = "상품명 미상";

export interface ProductLabel {
  text: string;
  isPlaceholder: boolean;
}

// Display name → label, mirroring previewText. `productName` is a name and never an
// identifier (the backend exposes no productId/sku/productNo/productRef here and
// withholds any name equal to its own SKU), so it is rendered as-is: not truncated,
// not redacted, not linked. Null OR an empty/whitespace string → the placeholder,
// since a blank name is no more nameable than a missing one.
export function productLabel(productName: string | null): ProductLabel {
  if (productName != null && productName.trim() !== "") {
    return { text: productName.trim(), isPlaceholder: false };
  }
  return { text: PRODUCT_PLACEHOLDER, isPlaceholder: true };
}

// --- Classification facet (stored rule-based analysis category) ---

/** The reserved server-side sentinel for "no analysis row exists". Never a stored category. */
export const UNCLASSIFIED = "unclassified";

/** FE-owned label for the unclassified bucket. */
export const UNCLASSIFIED_LABEL = "분류 전";

export interface CategoryChip {
  text: string;
  cls: string;
}

/**
 * The chip for a row's category, or `null` when there is nothing to say.
 *
 * <p>Deliberately unlike {@link productLabel}, which has a placeholder: a missing product NAME
 * still implies a product exists, so "상품명 미상" is a true statement. A missing category implies
 * nothing at all — the row was simply never analyzed (analysis runs on newly-inserted ids only and
 * swallows its own failures), so there is no honest sentence to render. Returning null means the
 * card shows no chip, rather than a placeholder an operator would read as a finding about their
 * review. It must also never fall back to 기타, which is a real verdict the analyzer reached.
 *
 * <p>The label is the server's value: the analyzer's categories are already Korean operator-facing
 * words, and re-mapping them here would create a second vocabulary to keep in sync. An unrecognised
 * value still renders — it is derived metadata, never customer text — because hiding it would make
 * a writer-side bug invisible on the surface most likely to reveal it.
 */
export function categoryChip(category: string | null): CategoryChip | null {
  if (category == null || category.trim() === "") {
    return null;
  }
  return { text: category.trim(), cls: "bg-brand/10 text-brand-700" };
}

/** Display label for one facet option; the sentinel gets FE-owned copy, a category speaks for itself. */
export function facetLabel(category: string): string {
  return category === UNCLASSIFIED ? UNCLASSIFIED_LABEL : category;
}

export interface FacetOption {
  /** Wire value: a stored category, or the UNCLASSIFIED sentinel. */
  value: string;
  label: string;
  count: number;
}

/**
 * Facet options for one drill-down page: the window's categories in the server's order, then the
 * unclassified bucket last.
 *
 * <p>Built from the page's counts, which the server computes UNFILTERED — so the options do not
 * collapse to the one already chosen. A zero-count bucket is omitted: the list is what is in this
 * window, not a catalogue of everything the analyzer could say. The unclassified bucket comes last
 * because it is a coverage state rather than a subject, and is included at all so those rows stay
 * reachable — they are exactly the rows a category filter can never surface.
 */
export function facetOptions(
  categoryCounts: readonly { category: string; count: number }[],
  unclassifiedCount: number,
  active: string | null = null,
): FacetOption[] {
  const options: FacetOption[] = categoryCounts
    .filter((c) => c.count > 0)
    .map((c) => ({ value: c.category, label: facetLabel(c.category), count: c.count }));
  if (unclassifiedCount > 0) {
    options.push({ value: UNCLASSIFIED, label: UNCLASSIFIED_LABEL, count: unclassifiedCount });
  }
  // An ACTIVE filter always appears, even at zero. The drill-down survives a window change, so a
  // category chosen over one window can outlive its rows in the next — and an empty list whose
  // cause is a filter with no visible control reads as "there are no such reviews" when the truth
  // is "you are still filtering". Showing it at 0 both explains the emptiness and gives the
  // operator the thing to click their way out of.
  if (active != null && !options.some((o) => o.value === active)) {
    options.push({ value: active, label: facetLabel(active), count: 0 });
  }
  return options;
}

/**
 * The triage choices, in the order an operator scans them: most demanding first.
 *
 * Copy is owned here and never sent by the server — the backend ships enum NAMES, which
 * are a contract, not a label. The order is the array's, not the enum's: it is a UI
 * decision, and pinning it here keeps a backend enum reorder from silently reshuffling
 * the buttons.
 */
export const TRIAGE_OPTIONS: ReadonlyArray<{ value: TriageDisposition; label: string }> = [
  { value: "RESPONSE_NEEDED", label: "대응 필요" },
  { value: "MONITOR", label: "지켜보기" },
  { value: "NO_ACTION", label: "조치 불필요" },
];

/** The wire values, derived from the options above so the two can never drift apart. */
const TRIAGE_VALUES: ReadonlySet<string> = new Set(TRIAGE_OPTIONS.map((o) => o.value));

/**
 * A server-supplied disposition, or null if it is not one this client knows.
 *
 * The response is typed as {@code TriageDecisionResponse}, but a TypeScript type is a claim
 * about the code, not about the bytes: a 200 carrying a typo'd, absent, or newly-added
 * disposition satisfies the compiler and lands in state as-is. That failure is silent in
 * the worst way — an unknown value renders as no decision, so the operator sees "판단 전"
 * after a SUCCESSFUL save and reasonably concludes their click did nothing.
 *
 * Validating here turns it into an honest, retryable failure. A value the client does not
 * recognise is treated as unusable rather than passed through, because rendering a decision
 * this UI cannot name is worse than admitting the save could not be confirmed.
 */
export function asTriageDisposition(value: unknown): TriageDisposition | null {
  return typeof value === "string" && TRIAGE_VALUES.has(value) ? (value as TriageDisposition) : null;
}
