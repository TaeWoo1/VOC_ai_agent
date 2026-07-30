/**
 * The review-reply vertical slice as a LangGraph state graph.
 *
 *   goal → search reviews needing reply → prioritize → review/product context
 *        + rule-based draft (saved) → HUMAN CHECKPOINT (interrupt)
 *        → record approved version + prepare guided reply session
 *
 * LangGraph owns the orchestration; every side-effecting step goes through a Tool onto the
 * existing Spring review-reply endpoints, which remain the system of record. The graph
 * re-implements no review-reply rule.
 *
 * Two deliberate departures from the inquiry graph, both driven by the task's boundaries:
 *  1. The draft is SAVED before the checkpoint (in `prepareDraft`), so the checkpoint can
 *     carry a real server version + fingerprint and restart-resume binds to the exact same
 *     version. The draft body comes from the backend's own rule-based suggestion (no LLM).
 *  2. No review content ever enters a persisted channel — the redacted body and the
 *     suggestion body are used only transiently inside `prepareDraft`.
 *
 * On reject, `record` writes nothing (no approval, no guided-session mint). `interrupt`/
 * `Command` require a checkpointer; the graph is compiled with one in {@link ../reviewRuntime}.
 */
import { END, START, StateGraph, interrupt } from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ReviewAgentStateAnnotation } from "../state/ReviewAgentState";
import type { ReviewAgentState } from "../state/ReviewAgentState";
import { REVIEW_TOOL } from "../tools/reviewTools";
import type { ToolRegistry } from "../tools/ToolRegistry";
import { prioritizeReviews, selectTopReview } from "../prioritize/prioritizeReviews";
import {
  REVIEW_CHECKPOINT_KIND,
  parseReviewDecision,
  type ReviewCheckpointRequest,
} from "../checkpoint/ReviewCheckpointContract";
import type { ReviewReplyDraftView, ReviewReplyPrepView, ReviewReplyWorkResponse } from "../spring/types";
import { performReviewRecord } from "./performReviewRecord";
import { log } from "../log";

export { reviewApprovalCommandId } from "./performReviewRecord";

export interface ReviewGraphDeps {
  readonly registry: ToolRegistry;
}

function threadId(config: LangGraphRunnableConfig): string {
  const id = config.configurable?.thread_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("missing thread_id in run config");
  }
  return id;
}

function requireAccountId(state: ReviewAgentState): string {
  const accountId = state.goal?.accountId;
  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new Error("review runs require goal.accountId (the review-reply endpoints are account-scoped)");
  }
  return accountId;
}

export function buildReviewGraph(deps: ReviewGraphDeps) {
  const registry = deps.registry;

  async function search(state: ReviewAgentState): Promise<Partial<ReviewAgentState>> {
    const accountId = requireAccountId(state);
    // The reply-work worklist is already bounded (server clamps todoLimit ≤ 50) and not
    // window-scoped, so one read is the whole to-do; the runtime ranks it oldest-first.
    const res = await registry.invoke<ReviewReplyWorkResponse>(REVIEW_TOOL.SEARCH_NEEDING_REPLY, {
      accountId,
      todoLimit: state.goal?.size ?? 50,
    });
    log("review_search", { coverage: res.coverage, fetched: res.todo.length });
    return { reviews: res.todo, trail: ["searched"] };
  }

  function prioritize(state: ReviewAgentState): Partial<ReviewAgentState> {
    const ranked = prioritizeReviews(state.reviews);
    const top = selectTopReview(ranked);
    log("review_prioritize", { ranked: ranked.length, selected: top != null });
    if (!top) {
      return {
        ranked,
        selected: null,
        outcome: {
          recorded: false,
          decision: "NONE",
          actionRef: null,
          draftVersion: null,
          approvedFingerprint: null,
          approvalState: null,
          guidedSessionPrepared: false,
          submissionRef: null,
          submissionApprovedVersion: null,
          targetHint: null,
          externalSendAttempted: false,
          note: "no reviews awaiting reply in worklist",
        },
        trail: ["prioritized_empty"],
      };
    }
    return {
      ranked,
      selected: {
        actionRef: top.item.actionRef,
        rating: top.item.rating,
        priorityBucket: top.priorityBucket,
        rank: top.rank,
      },
      trail: ["prioritized"],
    };
  }

  /**
   * Fetch the review/product context AND persist the rule-based starter draft, returning
   * only sanitized metadata + the saved version/fingerprint. The redacted body and the
   * suggestion body are read here and NEVER returned into a channel — so they exist only in
   * this function's scope, never in the MemorySaver checkpoint.
   */
  async function prepareDraft(state: ReviewAgentState): Promise<Partial<ReviewAgentState>> {
    const accountId = requireAccountId(state);
    const actionRef = state.selected!.actionRef;
    const prep = await registry.invoke<ReviewReplyPrepView>(REVIEW_TOOL.GET_PREP, { accountId, actionRef });

    let draftVersion: number;
    let draftFingerprint: string;
    if (prep.draft) {
      // Reuse the existing head draft rather than overwrite operator work — idempotent, and
      // the reason a re-run of a fresh graph never appends a duplicate version.
      draftVersion = prep.draft.version;
      draftFingerprint = prep.draft.contentFingerprint;
      log("review_draft_reused", { version: draftVersion, category: prep.suggestion.category });
    } else {
      // Adopt the backend's own rule-based suggestion body as the starter draft. The body
      // (content) is passed straight to the save tool and never retained.
      const saved = await registry.invoke<ReviewReplyDraftView>(REVIEW_TOOL.SAVE_DRAFT, {
        accountId,
        actionRef,
        body: prep.suggestion.body,
        baseVersion: 0,
      });
      draftVersion = saved.version;
      draftFingerprint = saved.contentFingerprint;
      log("review_draft_saved", {
        version: draftVersion,
        category: prep.suggestion.category,
        providerKind: prep.suggestion.providerKind,
        providerVersion: prep.suggestion.providerVersion,
      });
    }

    return {
      draftVersion,
      draftFingerprint,
      draftCategory: prep.suggestion.category,
      reviewMeta: {
        rating: prep.rating,
        reviewDate: prep.reviewDate,
        productName: prep.productName,
        channelReviewIdFingerprint: prep.channelReviewIdFingerprint,
        channelReplyState: prep.channelReplyState,
      },
      trail: ["draft_prepared"],
    };
  }

  /**
   * The human checkpoint. `interrupt` pauses the graph and surfaces a body-free reference to
   * the saved draft (version + fingerprint) plus coarse locating aids; the run resumes only
   * when a human returns a {@link ReviewCheckpointDecision}.
   */
  function humanCheckpoint(state: ReviewAgentState): Partial<ReviewAgentState> {
    const meta = state.reviewMeta;
    const request: ReviewCheckpointRequest = {
      kind: REVIEW_CHECKPOINT_KIND,
      actionRef: state.selected!.actionRef,
      draftVersion: state.draftVersion!,
      draftFingerprint: state.draftFingerprint!,
      phase: "DRAFT_SAVED",
      priorityBucket: state.selected!.priorityBucket,
      category: state.draftCategory ?? "general",
      rating: meta?.rating ?? null,
      reviewDate: meta?.reviewDate ?? null,
      productName: meta?.productName ?? null,
      channelReviewIdFingerprint: meta?.channelReviewIdFingerprint ?? null,
    };
    const decision = parseReviewDecision(interrupt(request));
    log("review_checkpoint_resumed", { approved: decision.approved });
    return { decision, trail: ["checkpoint_resumed"] };
  }

  async function record(
    state: ReviewAgentState,
    config: LangGraphRunnableConfig,
  ): Promise<Partial<ReviewAgentState>> {
    const decision = state.decision!;
    const outcome = await performReviewRecord(registry, {
      threadId: threadId(config),
      accountId: requireAccountId(state),
      actionRef: state.selected!.actionRef,
      approved: decision.approved,
      draftVersion: state.draftVersion!,
      draftFingerprint: state.draftFingerprint!,
    });
    return { outcome, trail: [decision.approved ? "recorded_approved" : "recorded_rejected"] };
  }

  // `prioritize` also handles the empty worklist (sets a NONE outcome), so search always
  // flows into it; only after prioritization do we branch on whether a row was selected.
  const afterPrioritize = (state: ReviewAgentState) => (state.selected ? "prepareDraft" : END);

  return new StateGraph(ReviewAgentStateAnnotation)
    .addNode("search", search)
    .addNode("prioritize", prioritize)
    .addNode("prepareDraft", prepareDraft)
    .addNode("humanCheckpoint", humanCheckpoint)
    .addNode("record", record)
    .addEdge(START, "search")
    .addEdge("search", "prioritize")
    .addConditionalEdges("prioritize", afterPrioritize, { prepareDraft: "prepareDraft", [END]: END })
    .addEdge("prepareDraft", "humanCheckpoint")
    .addEdge("humanCheckpoint", "record")
    .addEdge("record", END);
}
