/**
 * The runnable façade over the inquiry graph.
 *
 * Two resume paths, one behavior:
 *  - **same process:** LangGraph's in-memory checkpointer resumes the paused run;
 *  - **after a restart:** the in-memory checkpointer is empty, so the runtime reconstructs
 *    from the durable {@link RunStore} — re-fetching detail from the backend and
 *    regenerating the draft deterministically — then runs the SAME {@link performRecord}
 *    step. Idempotency (deterministic commandId + head-draft reuse + a DONE snapshot guard)
 *    makes both double-resume and restart-resume safe.
 *
 * Fail-closed startup: {@link assertExecutionDisabled} verifies with the backend that the
 * external reply-send path is disabled before any run proceeds.
 */
import { Command } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { buildInquiryGraph } from "./graph/inquiryGraph";
import { performRecord } from "./graph/performRecord";
import { buildInquiryToolRegistry } from "./tools/ToolRegistry";
import type { ToolRegistry } from "./tools/ToolRegistry";
import { TOOL } from "./tools/inquiryTools";
import { createCheckpointer, threadConfig, parseDecision } from "./checkpoint/CheckpointContract";
import type { CheckpointRequest, CheckpointDecision } from "./checkpoint/CheckpointContract";
import { InMemoryRunStore } from "./checkpoint/RunStore";
import type { RunStore, RunSnapshot } from "./checkpoint/RunStore";
import { parseGoal } from "./goal/parseGoal";
import type { GoalRequest } from "./goal/parseGoal";
import { RuleBasedDraftProvider } from "./provider/DraftModelSeam";
import type { DraftModelProvider } from "./provider/DraftModelSeam";
import type { SpringClient } from "./spring/SpringClient";
import type { InquiryDetail } from "./spring/types";
import type { RunOutcome } from "./state/AgentState";
import { log } from "./log";

export interface RuntimeDeps {
  readonly client: SpringClient;
  readonly draftProvider?: DraftModelProvider;
  /** Defaults to an in-memory checkpointer; the in-memory saver resumes within a process. */
  readonly checkpointer?: BaseCheckpointSaver;
  /** Defaults to an in-memory run store; inject a durable one (FileRunStore) for restart-resume. */
  readonly runStore?: RunStore;
}

export type RunResult =
  | { readonly status: "AWAITING_APPROVAL"; readonly checkpoint: CheckpointRequest; readonly trail: string[] }
  | { readonly status: "DONE"; readonly outcome: RunOutcome | null; readonly trail: string[] };

export class ExecutionEnabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionEnabledError";
  }
}

interface InterruptEnvelope {
  readonly value: unknown;
}

export class InquiryAgentRuntime {
  private readonly graph: ReturnType<ReturnType<typeof buildInquiryGraph>["compile"]>;
  private readonly registry: ToolRegistry;
  private readonly drafter: DraftModelProvider;
  private readonly client: SpringClient;
  readonly runStore: RunStore;
  /** Threads this PROCESS has parked at a checkpoint (empty after a restart). */
  private readonly liveThreads = new Set<string>();

  constructor(deps: RuntimeDeps) {
    this.client = deps.client;
    this.registry = buildInquiryToolRegistry(deps.client);
    this.drafter = deps.draftProvider ?? new RuleBasedDraftProvider();
    const graph = buildInquiryGraph({ registry: this.registry, draftProvider: this.drafter });
    this.graph = graph.compile({ checkpointer: deps.checkpointer ?? createCheckpointer() });
    this.runStore = deps.runStore ?? new InMemoryRunStore();
  }

  /**
   * Fail closed: confirm with the backend that the external reply-send path is disabled.
   * Throws {@link ExecutionEnabledError} if execution is enabled or any reply adapter is
   * registered. Call before driving runs against a real backend.
   */
  async assertExecutionDisabled(): Promise<void> {
    const cap = await this.client.getPublishCapability();
    if (cap.executionEnabled || cap.replyAdapterChannelCodes.length > 0) {
      throw new ExecutionEnabledError(
        `refusing to run: backend reply-send is ENABLED (executionEnabled=${cap.executionEnabled}, ` +
          `adapters=${cap.replyAdapterChannelCodes.length}). This slice must never be able to send.`,
      );
    }
    log("execution_disabled_verified", { adapters: cap.replyAdapterChannelCodes.length });
  }

  /** Begin a run. Verifies fail-closed first, then runs until the checkpoint or completion. */
  async start(threadId: string, request: GoalRequest): Promise<RunResult> {
    await this.assertExecutionDisabled();
    const goal = parseGoal(request);
    const final = await this.graph.invoke({ goal }, threadConfig(threadId));
    const result = this.toResult(final);
    if (result.status === "AWAITING_APPROVAL") {
      this.liveThreads.add(threadId);
      await this.runStore.save(this.snapshotFromCheckpoint(threadId, result.checkpoint, result.trail));
    }
    return result;
  }

  /** Resume a paused run with a human decision — same-process fast path or durable reconstruction. */
  async resume(threadId: string, decision: CheckpointDecision): Promise<RunResult> {
    // Resume is the only path that mutates the backend (and the CLI runs it in a fresh
    // process that never called start()), so the fail-closed guard must fire here too.
    await this.assertExecutionDisabled();
    if (this.liveThreads.has(threadId)) {
      const final = await this.graph.invoke(new Command({ resume: decision }), threadConfig(threadId));
      this.liveThreads.delete(threadId);
      const result = this.toResult(final);
      await this.persistDone(threadId, result);
      return result;
    }
    return this.resumeFromDurable(threadId, decision);
  }

  /** Restart path: reconstruct from the sanitized snapshot (no content replicated). */
  private async resumeFromDurable(threadId: string, decision: CheckpointDecision): Promise<RunResult> {
    const snap = await this.runStore.load(threadId);
    if (!snap) throw new Error(`unknown thread: ${threadId}`);
    if (snap.status === "DONE") {
      // Idempotent: the run already finished (double-resume after restart) — replay the outcome.
      return { status: "DONE", outcome: snap.outcome ?? null, trail: snap.trail };
    }

    const parsed = parseDecision(decision);
    // Re-fetch detail from the backend (system of record — not replicated in the store)
    // and regenerate the draft deterministically. Raw content never came from the store.
    const detail = await this.registry.invoke<InquiryDetail>(TOOL.GET_DETAIL, { workItemId: snap.workItemId });
    const candidate = this.drafter.draft({
      title: detail.title,
      details: detail.details,
      status: detail.status,
      informStatus: detail.informStatus,
    });
    const title = parsed.editedTitle ?? candidate.title;
    const comments = parsed.editedComments ?? candidate.comments;

    const outcome = await performRecord(this.registry, {
      threadId,
      workItemId: snap.workItemId,
      approved: parsed.approved,
      title,
      comments,
      rejectPhase: detail.phase,
    });
    const trail = [...snap.trail, "resumed_after_restart", outcome.decision === "APPROVED" ? "recorded_approved" : "recorded_rejected"];
    await this.runStore.save({ ...snap, status: "DONE", outcome, trail });
    return { status: "DONE", outcome, trail };
  }

  private snapshotFromCheckpoint(threadId: string, cp: CheckpointRequest, trail: string[]): RunSnapshot {
    return {
      threadId,
      status: "AWAITING_APPROVAL",
      inquiryId: cp.inquiryId,
      workItemId: cp.workItemId,
      phase: cp.phase,
      priorityBucket: cp.priorityBucket,
      category: cp.category,
      trail,
    };
  }

  private async persistDone(threadId: string, result: RunResult): Promise<void> {
    const prior = await this.runStore.load(threadId);
    if (!prior) return; // empty-queue runs never parked; nothing durable to update
    await this.runStore.save({
      ...prior,
      status: "DONE",
      outcome: result.status === "DONE" ? result.outcome : prior.outcome,
      trail: result.trail,
    });
  }

  private toResult(final: unknown): RunResult {
    const state = final as Record<string, unknown>;
    const interrupts = state["__interrupt__"];
    if (Array.isArray(interrupts) && interrupts.length > 0) {
      const first = interrupts[0] as InterruptEnvelope;
      return {
        status: "AWAITING_APPROVAL",
        checkpoint: first.value as CheckpointRequest,
        trail: (state["trail"] as string[]) ?? [],
      };
    }
    return {
      status: "DONE",
      outcome: (state["outcome"] as RunOutcome | null) ?? null,
      trail: (state["trail"] as string[]) ?? [],
    };
  }
}
