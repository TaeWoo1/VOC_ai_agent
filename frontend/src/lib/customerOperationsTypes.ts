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
  disposition: "AUTO_RESOLVED" | "MONITORING";
  decidedBy: "RULE" | "AGENT" | null;
  reasonNote: string;
  summary: string | null;
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
    rows: CustomerOperationsHandledRow[];
  };
  gaps: { total: number; rows: CustomerOperationsGapRow[] };
}
