// Pure helpers for the attention-signal drill-down. Kept out of the components so
// the param derivation, list-key stability, and reply-status labeling can be
// unit-tested as plain functions, independent of any rendering.

import type { AttentionSignal, OperatorVocItem } from "./types";

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

/** Label + chip style for a reply status; unknown values fall back to UNKNOWN. */
export function replyStatusLabel(status: string): ReplyStatusLabel {
  return REPLY_STATUS_LABEL[status] ?? REPLY_STATUS_LABEL.UNKNOWN;
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
