/**
 * Wire types for 「고객 운영 관리」 (Responsibility Runtime v1). Mirrors `ResponsibilityView` and
 * `CustomerOperationsHomeView` on the backend.
 *
 * <b>Counts are nullable on purpose.</b> A source that could not be observed has `observedCount: null`, and nothing
 * in this product may render that as 0 — 「0건」 and 「확인하지 못함」 are different facts.
 */

export type ResponsibilityStatus = "ACTIVE" | "PAUSED" | "STOPPED";
export type SourceCompleteness = "COMPLETE" | "BOUNDED" | "PARTIAL" | "NONE";

export interface ResponsibilitySourceView {
  attempt: number;
  sellerAccountId: string;
  channelCode: string;
  dataType: string;
  method: string;
  recipeVersion: string | null;
  windowFrom: string;
  windowTo: string;
  cursorFrom: string | null;
  cursorTo: string | null;
  startedAt: string;
  observedAt: string | null;
  completeness: SourceCompleteness | null;
  observedCount: number | null;
  newCount: number | null;
  changedCount: number | null;
  failureReason: string | null;
  identityVerdict: string;
  syncJobId: string | null;
}

export interface ResponsibilityRunView {
  id: string;
  windowStart: string;
  windowEnd: string;
  trigger: string;
  status: string;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  failureReason: string | null;
  nextAttemptAt: string | null;
  sources: ResponsibilitySourceView[];
}

export interface ResponsibilityView {
  templateCode: string;
  displayName: string;
  /** This deployment runs the job for this organisation. */
  available: boolean;
  /** At least one required source is on a connected account. */
  eligible: boolean;
  /** Null when the organisation never took the job on. */
  status: ResponsibilityStatus | null;
  cadenceMinutes: number;
  timezone: string;
  /** `CHANNEL:DATA_TYPE`, e.g. `CAFE24:INQUIRY`. */
  sourcesInScope: string[];
  nextRunAt: string | null;
  activatedAt: string | null;
  pausedAt: string | null;
  stoppedAt: string | null;
  runs: ResponsibilityRunView[];
}

export interface CustomerOperationsSourceHealth {
  channelCode: string;
  channelNameKo: string | null;
  dataType: string;
  completeness: SourceCompleteness | null;
  observedCount: number | null;
  newCount: number | null;
  failureReason: string | null;
  observedAt: string | null;
  sellerActionRequired: boolean;
}

export interface CustomerOperationsDecisionRow {
  caseId: string;
  subjectKind: "INQUIRY" | "REVIEW";
  channelNameKo: string | null;
  title: string | null;
  rating: number | null;
  reasonNote: string;
  summary: string | null;
  recommendedActionType: string | null;
  recommendedAction: string | null;
  missingInformation: string[];
  draftPrepared: boolean;
  decidedBy: "RULE" | "AGENT" | null;
  openedAt: string;
  to: string;
}

export interface CustomerOperationsHandledRow {
  caseId: string;
  subjectKind: "INQUIRY" | "REVIEW";
  channelNameKo: string | null;
  title: string | null;
  rating: number | null;
  /** `NEEDS_DECISION` only on a `verifying` row: the seller decided, and the result is still being read back. */
  disposition: "AUTO_RESOLVED" | "MONITORING" | "NEEDS_DECISION";
  decidedBy: "RULE" | "AGENT" | null;
  reasonNote: string;
  summary: string | null;
  /**
   * The seller decided, and the record that owns the result has not settled it yet. Deliberately NOT a third
   * `disposition`: what Reviewnary judged and what the channel has done with it are two different facts, and
   * this row is only allowed to state the second one as «still being read back».
   */
  verifying: boolean;
  to: string;
}

export interface CustomerOperationsGapRow {
  caseId: string;
  channelCode: string | null;
  channelNameKo: string | null;
  reason: "SOURCE_AUTH_REQUIRED" | "SOURCE_NOT_CONNECTED" | string;
  dataTypes: string[];
  since: string;
  lastSeenAt: string;
  to: string;
}

export interface CustomerOperationsHome {
  available: boolean;
  eligible: boolean;
  status: ResponsibilityStatus | null;
  cadenceMinutes: number;
  lastCheckedAt: string | null;
  lastRunStatus: string | null;
  nextCheckAt: string | null;
  sources: CustomerOperationsSourceHealth[];
  decisions: { total: number; rows: CustomerOperationsDecisionRow[] };
  handled: {
    since: string | null;
    autoResolved: number;
    monitoring: number;
    draftsPrepared: number;
    /** Cases the seller decided whose result is still being read back from the record that owns it. */
    verifying: number;
    rows: CustomerOperationsHandledRow[];
    /** Every customer item Reviewnary opened a case for in the window — the denominator, not a sum. */
    checked?: number;
  };
  gaps: { total: number; rows: CustomerOperationsGapRow[] };
}

/**
 * One case as the case screen reads it (Knowledge & Intelligence Closure v1): what happened, what Reviewnary looked
 * at, which company knowledge it used, what it recommends, and — when knowledge is missing — exactly what to teach.
 */
export interface OperationsCaseDetail {
  caseId: string;
  open: boolean;
  subjectKind: "INQUIRY" | "REVIEW";
  channelNameKo: string | null;
  productName: string | null;
  /** Whether 「이 상품에만」 is a real choice: an inquiry with no named product can only teach company-wide. */
  productScopeAvailable: boolean;
  receivedOn: string | null;
  rating: number | null;
  title: string | null;
  body: string | null;
  reasonNote: string;
  disposition: string | null;
  decidedBy: string | null;
  summary: string | null;
  recommendedActionType: string | null;
  recommendedAction: string | null;
  missingInformation: string[];
  whyDecisionNeeded: string | null;
  investigated: { label: string; results: number }[];
  knowledgeUsed: {
    authority: string;
    provenance: string;
    title: string;
    excerpt: string;
    capturedOn: string | null;
    cited: boolean;
    scope: string;
    /** An answer or reply the seller gave before — precedent, never today's basis on its own. */
    pastAnswer: boolean;
    /** That past answer whole, so the seller can confirm it as today's basis. Null otherwise. */
    reusableText: string | null;
  }[];
  gap: { missingSubject: string | null; sentence: string; suggestedScope: string } | null;
  /** The review's photos, and whether Reviewnary actually looked at each one. */
  media?: {
    ordinal: number;
    kind: string;
    /** True only when a vision model looked at the photo. */
    inspected: boolean;
    statusKo: string;
    depicts: string | null;
    problemVisible: "YES" | "NO" | "UNCLEAR" | null;
    problemDescription: string | null;
    imagePath: string | null;
  }[];
  draft: {
    version: number;
    title: string | null;
    body: string;
    authorKind: string | null;
    answerBasis: string | null;
    evidence: { kind: string; scopeLabel: string; title: string | null; snippet: string | null }[];
  } | null;
  to: string;
}
