// Pure helpers for the attention-signal drill-down. Kept out of the components so
// the param derivation, list-key stability, and reply-status labeling can be
// unit-tested without a DOM (the repo has no DOM test harness — see attention.ts).

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
