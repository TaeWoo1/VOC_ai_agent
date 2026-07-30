/**
 * Wire types for the Agent Runtime HTTP service — the NEW separate-origin orchestration service
 * (Node) the frontend calls, distinct from the Spring backend. These mirror the service's
 * `AgentRunView` contract (agent-runtime/src/http/contract.ts) and are the ONLY new contract this
 * surface owns; it does not redefine any existing Spring domain DTO.
 *
 * Privacy note: none of these views carries raw customer 원문. The inquiry checkpoint carries only
 * the templated reply draft (safe to show/edit); the review checkpoint carries no body/reply text;
 * the issue brief is quote-free. Raw customer text is read on the existing authorized detail
 * screens (문의 응답 / 리뷰 운영 / 상품 이슈), never here.
 */

export type AgentRunDomain = "INQUIRY" | "REVIEW" | "ISSUE";
export type AgentRunStatus = "AWAITING_APPROVAL" | "DONE";

export interface DraftProvenance {
  providerKind: string;
  name: string;
  version: string;
}

export interface InquiryCheckpointView {
  kind: "INQUIRY_REPLY_APPROVAL";
  domain: "INQUIRY";
  workItemId: string;
  inquiryId: string;
  phase: string;
  priorityBucket: string;
  category: string;
  provenance?: DraftProvenance;
  /** The rule-based template reply — present in the live start/resume response, absent on GET. */
  replyDraft?: string;
}

export interface ReviewCheckpointView {
  kind: "REVIEW_REPLY_APPROVAL";
  domain: "REVIEW";
  actionRef: string;
  draftVersion: number;
  draftFingerprint: string;
  phase: string;
  priorityBucket: string;
  category: string;
  rating: number | null;
  reviewDate: string | null;
  productName: string | null;
  channelReviewIdFingerprint: string | null;
}

export type CheckpointView = InquiryCheckpointView | ReviewCheckpointView;

export interface InquiryOutcome {
  recorded: boolean;
  decision: "APPROVED" | "REJECTED" | "NONE";
  workItemId: string | null;
  phase: string | null;
  executionStatus: string | null;
  category: string | null;
  approvedFingerprint: string | null;
  externalSendAttempted: boolean;
  note?: string;
}

export interface ReviewOutcome {
  recorded: boolean;
  decision: "APPROVED" | "REJECTED" | "NONE";
  actionRef: string | null;
  draftVersion: number | null;
  approvedFingerprint: string | null;
  approvalState: string | null;
  guidedSessionPrepared: boolean;
  submissionRef: string | null;
  externalSendAttempted: boolean;
  note?: string;
}

export interface IssueChangeInfo {
  kinds: string[];
  labelsKo: string[];
  highSurge: boolean;
  surgeWindowCount: number;
  surgeBaselineWeekly: number;
}

export interface IssueProductEvidence {
  productId: string;
  productName: string | null;
  evidenceCount: number;
}

export interface IssueRatingDistribution {
  rating1: number;
  rating2: number;
  rating3: number;
  rating4: number;
  rating5: number;
  unrated: number;
}

export interface IssueBriefEntry {
  issueId: string;
  rank: number;
  priorityBucket: string;
  title: string;
  aspect: string;
  problem: string;
  severity: string;
  lifecycleState: string;
  lifecycleLabelKo: string;
  evidenceCount: number;
  firstEvidenceOn: string | null;
  lastEvidenceOn: string | null;
  dominantProductId: string | null;
  dominantProductName: string | null;
  trend: IssueChangeInfo;
  evidenceSummary: {
    totalEvidence: number;
    byProduct: IssueProductEvidence[];
    unattributedEvidence: number;
    ratingDistribution: IssueRatingDistribution;
  };
  lifecycleHistoryDepth: number;
}

export interface IssueOperationsBrief {
  referenceDate: string | null;
  totalActiveIssues: number;
  selectedCount: number;
  entries: IssueBriefEntry[];
  note?: string;
}

export interface AgentRunView {
  threadId: string;
  domain: AgentRunDomain;
  status: AgentRunStatus;
  trail: string[];
  checkpoint?: CheckpointView;
  outcome?: InquiryOutcome | ReviewOutcome | null;
  brief?: IssueOperationsBrief;
}

export interface CapabilitiesView {
  service: string;
  version: string;
  env: string;
  intents: Array<{
    intent: string;
    domain: AgentRunDomain;
    hasCheckpoint: boolean;
    requiresAccountScope: boolean;
    examples: string[];
  }>;
  runStore: { kind: string; durable: boolean; multiInstanceSafe: boolean };
  externalSend: "disabled";
}

export interface StartRunRequest {
  threadId?: string;
  goalText?: string;
  intent?: string;
  accountId?: string;
  referenceDate?: string;
  size?: number;
}

export interface ResumeRunRequest {
  approved: boolean;
  approvedBy?: string;
  editedComments?: string;
}
