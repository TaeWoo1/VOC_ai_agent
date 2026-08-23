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

export type AgentRunDomain = "OPERATOR" | "INQUIRY" | "INQUIRY_DRAFT" | "REVIEW" | "ISSUE";
export type AgentRunStatus = "AWAITING_APPROVAL" | "DONE" | "FAILED";

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

/**
 * The draft-preparation result (domain INQUIRY_DRAFT, always DONE). The run reads one inquiry and
 * generates a rule-based answer DRAFT, then stops at a terminal human checkpoint — nothing is
 * proposed, saved, or sent. `replyDraft` is the templated reply text the operator reviews/edits
 * locally; it carries NO customer body and is present only in the live start response. The scalar
 * fields let the UI name the target channel, show the inquiry status, flag a 비밀글, and show when
 * the draft was made — without exposing the inquiry content. `prepared` is false when the OPEN queue
 * was empty.
 */
export interface InquiryDraftPreparationView {
  kind: "INQUIRY_DRAFT_PREPARATION";
  domain: "INQUIRY_DRAFT";
  prepared: boolean;
  workItemId: string | null;
  inquiryId: string | null;
  phase: string | null;
  priorityBucket: string | null;
  category: string | null;
  provenance: DraftProvenance | null;
  channelId: string | null;
  channelCode: string | null;
  channelNameKo: string | null;
  inquiryStatus: string | null;
  informStatus: string | null;
  isSecret: boolean | null;
  generatedAt: string | null;
  replyDraft?: string;
  note?: string;
}

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
  /** Present for the operator domain (no checkpoint): findings, their evidence, and what was spent. */
  answer?: OperatorAnswer;
  /** Present for the inquiry-draft domain (no checkpoint): the sanitized draft-preparation result. */
  draftPreparation?: InquiryDraftPreparationView;
  /**
   * Present only when `status` is FAILED — an Agent-chat run whose plan could not be made.
   *
   * This is a real product state, not an error page: since Operator Graph v2 there is no deterministic
   * planner to fall back to, so a run without a plan ends here and the screen says why. Rendering it as
   * an empty success would tell the seller "확인했고 아무것도 없었다", which is false.
   */
  failureCode?: string;
  failureReason?: string;
}

export interface CapabilitiesView {
  service: string;
  version: string;
  env: string;
  /** Whether free-text Agent chat can run. `unknown` until a run answers — the capability is per-org. */
  freeTextPlanning?: "enabled" | "unavailable" | "unknown";
  intents: Array<{
    intent: string;
    domain: AgentRunDomain;
    hasCheckpoint: boolean;
    requiresAccountScope: boolean;
    /** Illustrations, not a supported list — an LLM planner interprets whatever is typed. */
    sampleGoals: string[];
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


/* ─────────────────────── Operator Graph v1 (2026-08-21) ─────────────────────── */

/**
 * Whether a signal source could safely answer for the scope — mirrors the backend's
 * `AttentionCoverage`, the same vocabulary `/reviews` already uses to decline to answer.
 *
 * Any value other than `COVERED` means an empty result is a BLIND SPOT, not a clean bill of health.
 * A surface that renders the two the same way re-creates the false calm the attention slice fixed.
 */
export type AttentionCoverage =
  | "COVERED"
  | "UNCERTAIN_MULTI_ACCOUNT"
  | "UNCERTAIN_UNSUPPORTED_CHANNEL"
  | "UNCERTAIN_PRODUCT_UNLINKED";

export interface SignalCoverage {
  signal: string;
  coverage: AttentionCoverage;
  linked: number;
  unlinked: number;
  provenance: string;
}

/** Where a finding came from. Ids, closed-vocabulary labels, counts and dates — never customer text. */
export interface EvidenceRef {
  evidenceId: string;
  kind: string;
  sourceTool: string;
  sourceCall: string;
  locator: {
    issueId?: string;
    workItemId?: string;
    inquiryId?: string;
    reviewActionRef?: string;
    productId?: string;
    productName?: string;
    accountId?: string;
    channelCode?: string;
    count?: number;
    label?: string;
    severity?: string;
  };
  /** When SellerOps read it. Freshness — never a claim that the rows are from that date. */
  asOf: string | null;
  /** When the underlying rows happened, when the source can say. Null = unknown, never "now". */
  events: { from: string | null; to: string | null } | null;
  coverage: AttentionCoverage;
  provenance: string;
}

export interface JudgeVerdict {
  hasEvidence: boolean;
  supportingEvidenceIds: string[];
  unsafeAssertion: boolean;
  unsafeReason: string | null;
  needsMore: boolean;
  needsMoreTool: string | null;
  needsMoreReason: string | null;
  /** Which judge spoke. The UI reads this instead of hardcoding a label — the `draftKindLabel` rule. */
  judgeKind: "LLM" | "RULE_BASED";
  judgeVersion: string;
}

/**
 * `SUPPORTED` may be stated. `NEEDS_REVIEW` is shown as something to check. `UNSUPPORTED` never
 * reaches this type — the runtime drops those before composing, so a rendered finding is always one
 * of the first two.
 */
export type FindingConfidence = "SUPPORTED" | "NEEDS_REVIEW" | "UNSUPPORTED";

export interface Finding {
  findingId: string;
  specialist: string;
  statement: string;
  evidenceIds: string[];
  confidence: FindingConfidence;
  verdict: JudgeVerdict | null;
  surfaceLink: string | null;
  claimsCoverageLimit?: boolean;
  /** Which information need this sentence answers, when the plan declared one. */
  needId?: string;
}

/** One thing the planner decided it had to find out, and what became of it. */
export interface AnsweredNeed {
  id: string;
  question: string;
  status: "PENDING" | "SATISFIED" | "UNSATISFIABLE";
  required: boolean;
  evidenceIds: string[];
  reason?: string;
}

/**
 * Whether SellerOps HOLDS a product fact — the availability axis.
 *
 * Rendered beside `SignalCoverage`, never merged with it: that one says whether a signal can be
 * attributed to a product, this one says whether a fact is held at all. `UNAVAILABLE` must never be
 * rendered as "문제 없음" or as "그런 값이 없는 상품" — it means "우리가 갖고 있지 않다".
 */
export type KnowledgeCoverage = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "STALE";

export interface KnowledgeCoverageRow {
  facet: string;
  coverage: KnowledgeCoverage;
  known: number;
  newestObservedAt: string | null;
  provenance: string;
}

export interface NextAction {
  label: string;
  /** Always READ or PREPARE. There is no WRITE tool in v1, so there is no WRITE action to offer. */
  actionClass: "READ" | "PREPARE" | "WRITE";
  surfaceLink: string;
}

export interface BudgetReport {
  iterations: number;
  toolCalls: number;
  llmCalls: number;
  elapsedMs: number;
  exhausted: boolean;
  stopReason: "COMPLETE" | "BUDGET_EXHAUSTED" | "NO_PLAN" | "CLARIFICATION_NEEDED" | "REPLAN_UNAVAILABLE";
}

export interface OperatorAnswer {
  goalEcho: string;
  /**
   * Which planner interpreted the goal. One value since Operator Graph v2 — there is one planner and
   * it reaches a model. Kept as a field because it is PROVENANCE: a surface reads it rather than
   * assuming, the same rule `draftKindLabel` follows.
   */
  plannerKind: "LLM";
  /** Which model produced the plan. Shown so an answer can be traced to a specific planner version. */
  plannerVersion: string;
  /** The investigation the planner designed — rendered so a seller can check WHAT was looked at. */
  needs: AnsweredNeed[];
  specialists: string[];
  findings: Finding[];
  evidence: EvidenceRef[];
  coverage: SignalCoverage[];
  /** Per-facet availability for any product this run read. */
  knowledgeCoverage: KnowledgeCoverageRow[];
  nextActions: NextAction[];
  /** Present when the planner asked a question back instead of answering. */
  clarification: string | null;
  budget: BudgetReport;
  /** What was NOT seen. Rendered whenever present — a truncated answer must never look complete. */
  note?: string;
}
