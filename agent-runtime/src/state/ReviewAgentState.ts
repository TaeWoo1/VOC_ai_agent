/**
 * The review subgraph's shared state (a LangGraph `Annotation.Root`).
 *
 * <b>No review content lives here.</b> Unlike the inquiry state (which held the inquiry
 * detail and the draft candidate text in memory), this state carries only sanitized
 * metadata plus the SAVED draft's version + fingerprint. The redacted review body and the
 * rule-based suggestion body are read only transiently inside the `prepareDraft` node to
 * produce a saved draft; they are never returned into a channel, so the MemorySaver
 * checkpoint never holds them. Every channel here is safe to persist.
 */
import { Annotation } from "@langchain/langgraph";
import type { AgentGoal } from "../goal/parseGoal";
import type { RankedReview } from "../prioritize/prioritizeReviews";
import type { ReviewCheckpointDecision } from "../checkpoint/ReviewCheckpointContract";
import type { ReviewWorkItem } from "../spring/types";

export interface SelectedReview {
  readonly actionRef: string;
  readonly rating: number | null;
  readonly priorityBucket: string;
  readonly rank: number;
}

/** Sanitized, non-content locating metadata for the selected review. */
export interface ReviewMeta {
  readonly rating: number | null;
  readonly reviewDate: string | null;
  readonly productName: string | null;
  readonly channelReviewIdFingerprint: string | null;
  readonly channelReplyState: string;
}

/** Coarse, one-way target hint echoed on the prepared guided session (no raw body/timestamp/id). */
export interface ReviewTargetHint {
  readonly rating: number;
  readonly recencyBucket: string;
  readonly bodyFingerprint: string;
}

export type ReviewRunDecision = "APPROVED" | "REJECTED" | "NONE";

/**
 * Terminal summary of a review-reply run. `externalSendAttempted` is structurally always
 * false: there is no send tool and no send endpoint. `submissionRef` is an opaque 16-hex
 * token (never reversible to a review id); `targetHint` carries only coarse fields and a
 * one-way hash — both safe to persist and log.
 */
export interface ReviewRunOutcome {
  readonly recorded: boolean;
  readonly decision: ReviewRunDecision;
  readonly actionRef: string | null;
  readonly draftVersion: number | null;
  readonly approvedFingerprint: string | null;
  readonly approvalState: string | null;
  readonly guidedSessionPrepared: boolean;
  readonly submissionRef: string | null;
  readonly submissionApprovedVersion: number | null;
  readonly targetHint: ReviewTargetHint | null;
  readonly externalSendAttempted: boolean;
  readonly note?: string;
}

export const ReviewAgentStateAnnotation = Annotation.Root({
  goal: Annotation<AgentGoal | null>({ reducer: (_p, n) => n, default: () => null }),
  reviews: Annotation<ReviewWorkItem[]>({ reducer: (_p, n) => n, default: () => [] }),
  ranked: Annotation<RankedReview[]>({ reducer: (_p, n) => n, default: () => [] }),
  selected: Annotation<SelectedReview | null>({ reducer: (_p, n) => n, default: () => null }),
  reviewMeta: Annotation<ReviewMeta | null>({ reducer: (_p, n) => n, default: () => null }),
  draftVersion: Annotation<number | null>({ reducer: (_p, n) => n, default: () => null }),
  draftFingerprint: Annotation<string | null>({ reducer: (_p, n) => n, default: () => null }),
  draftCategory: Annotation<string | null>({ reducer: (_p, n) => n, default: () => null }),
  decision: Annotation<ReviewCheckpointDecision | null>({ reducer: (_p, n) => n, default: () => null }),
  outcome: Annotation<ReviewRunOutcome | null>({ reducer: (_p, n) => n, default: () => null }),
  trail: Annotation<string[]>({ reducer: (p, n) => [...p, ...n], default: () => [] }),
});

export type ReviewAgentState = typeof ReviewAgentStateAnnotation.State;
