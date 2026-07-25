// Pure view helpers for the persistent Review Issue surface. No React, no I/O.
//
// THE FRONTEND OWNS EVERY WORD. The server sends enum names plus the four判 labels and the raw
// numbers; the sentences are written here. That is the same split the Action Window contract uses
// (dotted copy keys + sanitized primitives from the runtime, all prose in the FE) and it exists so a
// wording change never needs a server release.
//
// TWO RULES THIS FILE ENFORCES IN COPY:
//   1. No cause. "이 상품에 집중되고 있습니다 — …를 먼저 확인해 보세요" is allowed;
//      "…가 원인입니다" is not. The extractor's accuracy is unmeasured (the review-eval label seed is
//      empty), so a causal claim would have nothing behind it.
//   2. 해결됨 is never described as disappearance. It is an observation of silence, not proof of
//      absence — see contracts/review-issue/v1/THRESHOLDS.md §4.
import type {
  IssueChangeKind,
  IssueChangeView,
  IssueEvidenceView,
  IssueLifecycleState,
  IssueSeverity,
  ReviewIssueView,
} from "./types";

/** Display order for the four judgements plus improvement. Mirrors the server enum's order. */
export const CHANGE_ORDER: readonly IssueChangeKind[] = [
  "NEW",
  "SURGING",
  "PERSISTENT",
  "CONCENTRATED",
  "IMPROVED",
] as const;

export type ChangeTone = "bad" | "warn" | "neutral" | "good";

/**
 * Tone per judgement. IMPROVED is the only "good" one, and it is deliberately styled as good rather
 * than neutral: an operations surface that renders every signal as a warning teaches people that
 * nothing on it is worth reading.
 */
export const CHANGE_TONE: Record<IssueChangeKind, ChangeTone> = {
  NEW: "bad",
  SURGING: "bad",
  PERSISTENT: "warn",
  CONCENTRATED: "warn",
  IMPROVED: "good",
};

export const SEVERITY_LABEL_KO: Record<IssueSeverity, string> = {
  HIGH: "심각",
  NORMAL: "보통",
  LOW: "경미",
};

export const SEVERITY_TONE: Record<IssueSeverity, ChangeTone> = {
  HIGH: "bad",
  NORMAL: "warn",
  LOW: "neutral",
};

/** One-line explanation per judgement. Describes the observation, never a cause. */
export const CHANGE_EXPLANATION_KO: Record<IssueChangeKind, string> = {
  NEW: "이전에 없던 내용이 반복되기 시작했어요.",
  SURGING: "기존 내용이 평소보다 빠르게 늘고 있어요.",
  PERSISTENT: "급증하지는 않지만 계속 확인되고 있어요.",
  CONCENTRATED: "특정 상품에 집중돼 있어요.",
  IMPROVED: "관련 리뷰가 눈에 띄게 줄었어요.",
};

/**
 * The badge row for an issue, in display order.
 *
 * Reads `kinds` and pairs it with the server's own `labelsKo` by index. If the server ever sent
 * mismatched lengths the label falls back to the local map rather than rendering `undefined` — a
 * blank badge is the one outcome that tells the operator nothing at all.
 */
export function changeBadges(
  change: IssueChangeView,
): { kind: IssueChangeKind; labelKo: string; tone: ChangeTone }[] {
  return change.kinds.map((kind, index) => ({
    kind,
    labelKo: change.labelsKo[index] ?? LOCAL_CHANGE_LABEL_KO[kind],
    tone: CHANGE_TONE[kind],
  }));
}

/** Fallback labels. The server is the source; these exist so a badge is never blank. */
const LOCAL_CHANGE_LABEL_KO: Record<IssueChangeKind, string> = {
  NEW: "새로 나타남",
  SURGING: "증가 중",
  PERSISTENT: "계속 발생",
  CONCENTRATED: "특정 상품 집중",
  IMPROVED: "개선됨",
};

/**
 * The quantified surge line, or null when no surge fired.
 *
 * Rounds the weekly baseline to one decimal for reading, and never rounds it to 0: a baseline shown
 * as "주 0건" next to a surge would read as a contradiction, when the real statement is "less than
 * one a week".
 */
export function surgeLine(change: IssueChangeView): string | null {
  if (!change.kinds.includes("SURGING")) {
    return null;
  }
  const weekly = change.surgeBaselineWeekly;
  const baseline = weekly > 0 && weekly < 0.1 ? "주 1건 미만" : `주 ${weekly.toFixed(1)}건`;
  return `최근 7일 ${change.surgeWindowCount}건 · 이전 8주 평균 ${baseline}`;
}

/**
 * What the operator can do next, given the lifecycle state. Returns null where the only legitimate
 * move belongs to SellerOps.
 *
 * There is no 해결 처리 action at any state, on purpose: 해결됨 is reached by observing quiet weeks
 * after recorded remediation, so offering a button would let an assertion stand in for evidence.
 */
export function nextActionKo(state: IssueLifecycleState): string | null {
  switch (state) {
    case "NEEDS_REVIEW":
      return "조치 시작";
    case "ACTING":
      return "조치 완료로 기록";
    case "OBSERVING":
    case "VERIFYING":
    case "RESOLVED":
      return null;
  }
}

/** What SellerOps is doing while the operator has nothing to do. */
export function waitingNoteKo(state: IssueLifecycleState): string | null {
  switch (state) {
    case "OBSERVING":
      return "아직 확인을 권할 만큼 근거가 모이지 않았어요.";
    case "VERIFYING":
      return "조치 이후 리뷰 변화를 지켜보고 있어요.";
    case "RESOLVED":
      return "최근 4주간 관련 리뷰가 확인되지 않아 현재 해결된 상태로 표시했어요.";
    case "NEEDS_REVIEW":
    case "ACTING":
      return null;
  }
}

/**
 * The product line, or null when nothing is attributable.
 *
 * Null must render as absent rather than as "기타" or "미지정": those read as a product the customer
 * named, when the truth is that SellerOps could not attribute the evidence.
 */
export function productLineKo(issue: ReviewIssueView): string | null {
  if (!issue.dominantProductName) {
    return null;
  }
  return issue.change.kinds.includes("CONCENTRATED")
    ? `${issue.dominantProductName}에 집중`
    : `주로 ${issue.dominantProductName}`;
}

/**
 * The suggestion under a concentrated issue. Points at what to check and stops there.
 *
 * Naming a cause here would be the single easiest way for this product to mislead a seller into
 * changing a supplier over an unmeasured keyword match.
 */
export function investigationHintKo(issue: ReviewIssueView): string | null {
  if (!issue.change.kinds.includes("CONCENTRATED") || !issue.dominantProductName) {
    return null;
  }
  return `${issue.dominantProductName}의 최근 출고분, 보관 상태, 자재를 먼저 확인해 보세요.`;
}

/** Counts for the surface header. Excludes dismissed issues, which the API already omits. */
export interface IssueSummary {
  total: number;
  needsReview: number;
  changed: number;
  improved: number;
}

export function issuesSummary(issues: ReviewIssueView[]): IssueSummary {
  return {
    total: issues.length,
    needsReview: issues.filter((i) => i.lifecycleState === "NEEDS_REVIEW").length,
    // "Changed" counts issues with any judgement EXCEPT improvement — the header is a call to look,
    // and good news is not one.
    changed: issues.filter((i) => i.change.kinds.some((k) => k !== "IMPROVED")).length,
    improved: issues.filter((i) => i.change.kinds.includes("IMPROVED")).length,
  };
}

/** Issues an operator should look at now: anything with a non-improvement judgement. */
export function changedIssues(issues: ReviewIssueView[]): ReviewIssueView[] {
  return issues.filter((i) => i.change.kinds.some((k) => k !== "IMPROVED"));
}

/** Issues that improved. Shown separately so the surface reports outcomes, not only alarms. */
export function improvedIssues(issues: ReviewIssueView[]): ReviewIssueView[] {
  return issues.filter((i) => i.change.kinds.includes("IMPROVED"));
}

/** Everything else — real issues with nothing new to say about them right now. */
export function steadyIssues(issues: ReviewIssueView[]): ReviewIssueView[] {
  return issues.filter((i) => i.change.kinds.length === 0);
}

/**
 * Evidence quotes worth rendering. Drops suppressed ones instead of rendering an empty quote, which
 * would put words the customer never said (none) inside quotation marks.
 */
export function renderableQuotes(evidence: IssueEvidenceView[], limit = 3): string[] {
  const quotes: string[] = [];
  for (const row of evidence) {
    if (row.quote && row.quote.trim().length > 0) {
      quotes.push(row.quote);
    }
    if (quotes.length >= limit) {
      break;
    }
  }
  return quotes;
}

/**
 * How many evidence rows had no renderable quote. Surfaced rather than hidden: if most of an issue's
 * evidence is unquotable the operator should know the list they are reading is partial.
 */
export function suppressedQuoteCount(evidence: IssueEvidenceView[]): number {
  return evidence.filter((row) => !row.quote || row.quote.trim().length === 0).length;
}

/** Honest provenance line. Never says AI, because it is not. */
export function provenanceKo(issue: ReviewIssueView): string {
  return issue.extractorKind === "RULE_BASED"
    ? "규칙 기반 분석으로 모은 이슈 후보입니다. 최종 진단이 아닙니다."
    : "이슈 후보입니다. 최종 진단이 아닙니다.";
}
