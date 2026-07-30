/**
 * The runnable façade over the review-reply graph — a sibling of {@link InquiryAgentRuntime}
 * with the same two-path resume behavior:
 *  - **same process:** LangGraph's in-memory checkpointer resumes the paused run;
 *  - **after a restart:** the in-memory checkpointer is empty, so the runtime reconstructs
 *    from the durable {@link ReviewRunStore} — and, because the draft was already persisted
 *    in the backend BEFORE the checkpoint, it simply approves that exact version and
 *    prepares the guided session. Nothing is re-fetched or regenerated, so resume always
 *    binds the SAME draft version.
 *
 * Idempotency: a deterministic approval commandId makes the approval a replay; the
 * guided-session mint (not idempotent at the backend) is protected by the DONE-snapshot
 * guard — a finished run replays its stored outcome and never re-mints.
 *
 * Fail-closed startup: {@link assertExecutionDisabled} verifies with the backend that no
 * reply adapter is registered before any run proceeds. The review-reply surface has no send
 * endpoint at all, so this is defence in depth over an already-structural guarantee.
 */
import { Command } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { buildReviewGraph } from "./graph/reviewGraph";
import { performReviewRecord } from "./graph/performReviewRecord";
import { buildReviewToolRegistry } from "./tools/ReviewToolRegistry";
import type { ToolRegistry } from "./tools/ToolRegistry";
import { createCheckpointer, threadConfig } from "./checkpoint/CheckpointContract";
import {
  parseReviewDecision,
  type ReviewCheckpointRequest,
  type ReviewCheckpointDecision,
} from "./checkpoint/ReviewCheckpointContract";
import { InMemoryReviewRunStore } from "./checkpoint/ReviewRunStore";
import type { ReviewRunStore, ReviewRunSnapshot } from "./checkpoint/ReviewRunStore";
import { parseGoal, routeIntent } from "./goal/parseGoal";
import type { GoalRequest } from "./goal/parseGoal";
import { ExecutionEnabledError } from "./runtime";
import type { ReviewSpringClient } from "./spring/ReviewSpringClient";
import type { ReviewRunOutcome } from "./state/ReviewAgentState";
import { log } from "./log";

export interface ReviewRuntimeDeps {
  readonly client: ReviewSpringClient;
  /** Defaults to an in-memory checkpointer; the in-memory saver resumes within a process. */
  readonly checkpointer?: BaseCheckpointSaver;
  /** Defaults to an in-memory store; inject a durable one (FileReviewRunStore) for restart-resume. */
  readonly runStore?: ReviewRunStore;
}

export type ReviewRunResult =
  | { readonly status: "AWAITING_APPROVAL"; readonly checkpoint: ReviewCheckpointRequest; readonly trail: string[] }
  | { readonly status: "DONE"; readonly outcome: ReviewRunOutcome | null; readonly trail: string[] };

interface InterruptEnvelope {
  readonly value: unknown;
}

export class ReviewAgentRuntime {
  private readonly graph: ReturnType<ReturnType<typeof buildReviewGraph>["compile"]>;
  private readonly registry: ToolRegistry;
  private readonly client: ReviewSpringClient;
  readonly runStore: ReviewRunStore;
  /** Threads this PROCESS has parked at a checkpoint (empty after a restart). */
  private readonly liveThreads = new Set<string>();
  /** Account scope per parked thread, so a same-process resume snapshot carries it. */
  private readonly threadAccount = new Map<string, string>();

  constructor(deps: ReviewRuntimeDeps) {
    this.client = deps.client;
    this.registry = buildReviewToolRegistry(deps.client);
    const graph = buildReviewGraph({ registry: this.registry });
    this.graph = graph.compile({ checkpointer: deps.checkpointer ?? createCheckpointer() });
    this.runStore = deps.runStore ?? new InMemoryReviewRunStore();
  }

  /** Whether this runtime is responsible for the thread (parked here or durably recorded). */
  async owns(threadId: string): Promise<boolean> {
    return this.liveThreads.has(threadId) || (await this.runStore.load(threadId)) != null;
  }

  /**
   * Fail closed: confirm with the backend that no reply adapter is registered. Throws
   * {@link ExecutionEnabledError} if execution is enabled or any adapter exists.
   */
  async assertExecutionDisabled(): Promise<void> {
    const cap = await this.client.getPublishCapability();
    if (cap.executionEnabled || cap.replyAdapterChannelCodes.length > 0) {
      throw new ExecutionEnabledError(
        `refusing to run: backend reply-send is ENABLED (executionEnabled=${cap.executionEnabled}, ` +
          `adapters=${cap.replyAdapterChannelCodes.length}). This subgraph must never be able to send.`,
      );
    }
    log("review_execution_disabled_verified", { adapters: cap.replyAdapterChannelCodes.length });
  }

  /** Begin a review run. Verifies fail-closed first, then runs until the checkpoint or completion. */
  async start(threadId: string, request: GoalRequest): Promise<ReviewRunResult> {
    await this.assertExecutionDisabled();
    const goal = parseGoal(request);
    if (routeIntent(goal.intent) !== "REVIEW") {
      throw new Error(`ReviewAgentRuntime cannot handle intent ${goal.intent}`);
    }
    const accountId = goal.accountId;
    if (typeof accountId !== "string" || accountId.length === 0) {
      throw new Error("review runs require accountId");
    }
    const final = await this.graph.invoke({ goal }, threadConfig(threadId));
    const result = this.toResult(final);
    if (result.status === "AWAITING_APPROVAL") {
      this.liveThreads.add(threadId);
      this.threadAccount.set(threadId, accountId);
      await this.runStore.save(this.snapshotFromCheckpoint(threadId, accountId, result.checkpoint, result.trail));
    }
    return result;
  }

  /** Resume a paused run with a human decision — same-process fast path or durable reconstruction. */
  async resume(threadId: string, decision: ReviewCheckpointDecision): Promise<ReviewRunResult> {
    // Resume is the only path that mutates the backend; the fail-closed guard fires here too.
    await this.assertExecutionDisabled();
    if (this.liveThreads.has(threadId)) {
      // Defence against a shared durable store with more than one live runtime: if another
      // process already finished this thread, the guided-session mint has happened, so replay
      // the stored outcome instead of re-entering the graph (the mint is not idempotent).
      const durable = await this.runStore.load(threadId);
      if (durable?.status === "DONE") {
        this.liveThreads.delete(threadId);
        return { status: "DONE", outcome: durable.outcome ?? null, trail: durable.trail };
      }
      const final = await this.graph.invoke(new Command({ resume: decision }), threadConfig(threadId));
      this.liveThreads.delete(threadId);
      const result = this.toResult(final);
      await this.persistDone(threadId, result);
      return result;
    }
    return this.resumeFromDurable(threadId, decision);
  }

  /** Restart path: reconstruct from the sanitized snapshot (no content replicated, no regeneration). */
  private async resumeFromDurable(threadId: string, decision: ReviewCheckpointDecision): Promise<ReviewRunResult> {
    const snap = await this.runStore.load(threadId);
    if (!snap) throw new Error(`unknown thread: ${threadId}`);
    if (snap.status === "DONE") {
      // Idempotent: the run already finished (double-resume) — replay the outcome. This is
      // what makes the non-idempotent guided-session mint mint-once: a finished run never
      // re-enters the record step.
      return { status: "DONE", outcome: snap.outcome ?? null, trail: snap.trail };
    }

    const parsed = parseReviewDecision(decision);
    // The draft is already persisted at snap.draftVersion; approval binds to that exact
    // version+fingerprint, so resume uses the SAME draft version by construction.
    const outcome = await performReviewRecord(this.registry, {
      threadId,
      accountId: snap.sellerAccountId,
      actionRef: snap.reviewRef,
      approved: parsed.approved,
      draftVersion: snap.draftVersion,
      draftFingerprint: snap.draftFingerprint,
    });
    const trail = [
      ...snap.trail,
      "resumed_after_restart",
      outcome.decision === "APPROVED" ? "recorded_approved" : "recorded_rejected",
    ];
    await this.runStore.save({
      ...snap,
      status: "DONE",
      phase: outcome.decision === "APPROVED" ? "GUIDED_SESSION_READY" : "REJECTED",
      outcome,
      trail,
    });
    return { status: "DONE", outcome, trail };
  }

  private snapshotFromCheckpoint(
    threadId: string,
    accountId: string,
    cp: ReviewCheckpointRequest,
    trail: string[],
  ): ReviewRunSnapshot {
    return {
      threadId,
      status: "AWAITING_APPROVAL",
      sellerAccountId: accountId,
      reviewRef: cp.actionRef,
      draftVersion: cp.draftVersion,
      draftFingerprint: cp.draftFingerprint,
      phase: cp.phase,
      priorityBucket: cp.priorityBucket,
      trail,
    };
  }

  private async persistDone(threadId: string, result: ReviewRunResult): Promise<void> {
    const prior = await this.runStore.load(threadId);
    if (!prior) return; // empty-worklist runs never parked; nothing durable to update
    const outcome = result.status === "DONE" ? result.outcome : prior.outcome;
    await this.runStore.save({
      ...prior,
      status: "DONE",
      phase: outcome?.decision === "APPROVED" ? "GUIDED_SESSION_READY" : "REJECTED",
      outcome,
      trail: result.trail,
    });
    this.threadAccount.delete(threadId);
  }

  private toResult(final: unknown): ReviewRunResult {
    const state = final as Record<string, unknown>;
    const interrupts = state["__interrupt__"];
    if (Array.isArray(interrupts) && interrupts.length > 0) {
      const first = interrupts[0] as InterruptEnvelope;
      return {
        status: "AWAITING_APPROVAL",
        checkpoint: first.value as ReviewCheckpointRequest,
        trail: (state["trail"] as string[]) ?? [],
      };
    }
    return {
      status: "DONE",
      outcome: (state["outcome"] as ReviewRunOutcome | null) ?? null,
      trail: (state["trail"] as string[]) ?? [],
    };
  }
}
