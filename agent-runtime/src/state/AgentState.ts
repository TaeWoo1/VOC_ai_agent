/**
 * The graph's shared state (a LangGraph `Annotation.Root`).
 *
 * Each channel is last-value except `trail`, which appends — a sanitized breadcrumb of
 * the steps taken, safe to log. Content-bearing channels (`detail`, `candidate`) hold
 * seller-owned text in memory for the graph to act on; they are never logged and never
 * leave the process except as the approved draft the backend persists.
 */
import { Annotation } from "@langchain/langgraph";
import type { AgentGoal } from "../goal/parseGoal";
import type { RankedInquiry } from "../prioritize/prioritizeInquiries";
import type { DraftCandidate } from "../provider/DraftModelSeam";
import type { CheckpointDecision } from "../checkpoint/CheckpointContract";
import type { InquiryDetail, InquiryQueueItem } from "../spring/types";

export interface SelectedInquiry {
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly priorityBucket: string;
  readonly rank: number;
}

export type RunDecision = "APPROVED" | "REJECTED" | "NONE";

/**
 * Terminal summary of a run. `externalSendAttempted` is structurally always false: the
 * runtime has no send tool, and the only outbound call — record-approval — is fail
 * closed at the backend. It is asserted in the tests as a standing invariant.
 */
export interface RunOutcome {
  readonly recorded: boolean;
  readonly decision: RunDecision;
  readonly workItemId: string | null;
  readonly phase: string | null;
  readonly executionStatus: string | null;
  readonly category: string | null;
  readonly approvedFingerprint: string | null;
  readonly externalSendAttempted: boolean;
  readonly note?: string;
}

export const AgentStateAnnotation = Annotation.Root({
  goal: Annotation<AgentGoal | null>({ reducer: (_p, n) => n, default: () => null }),
  inquiries: Annotation<InquiryQueueItem[]>({ reducer: (_p, n) => n, default: () => [] }),
  ranked: Annotation<RankedInquiry[]>({ reducer: (_p, n) => n, default: () => [] }),
  selected: Annotation<SelectedInquiry | null>({ reducer: (_p, n) => n, default: () => null }),
  detail: Annotation<InquiryDetail | null>({ reducer: (_p, n) => n, default: () => null }),
  candidate: Annotation<DraftCandidate | null>({ reducer: (_p, n) => n, default: () => null }),
  decision: Annotation<CheckpointDecision | null>({ reducer: (_p, n) => n, default: () => null }),
  outcome: Annotation<RunOutcome | null>({ reducer: (_p, n) => n, default: () => null }),
  trail: Annotation<string[]>({ reducer: (p, n) => [...p, ...n], default: () => [] }),
});

export type AgentState = typeof AgentStateAnnotation.State;
