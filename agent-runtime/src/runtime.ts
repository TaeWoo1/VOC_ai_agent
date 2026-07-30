/**
 * The runnable façade over the inquiry graph.
 *
 * `start` parses the goal and runs the graph until it either finishes or pauses at the
 * human checkpoint; `resume` feeds a human decision back in. Both return a discriminated
 * {@link RunResult} so a caller (a controller, a CLI, a test) never has to read raw
 * LangGraph internals. The graph is compiled here with a checkpointer, which `interrupt`
 * requires.
 */
import { Command } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { buildInquiryGraph } from "./graph/inquiryGraph";
import { buildInquiryToolRegistry } from "./tools/ToolRegistry";
import { createCheckpointer, threadConfig } from "./checkpoint/CheckpointContract";
import type { CheckpointDecision, CheckpointRequest } from "./checkpoint/CheckpointContract";
import { parseGoal } from "./goal/parseGoal";
import type { GoalRequest } from "./goal/parseGoal";
import type { DraftModelProvider } from "./provider/DraftModelSeam";
import type { SpringClient } from "./spring/SpringClient";
import type { RunOutcome } from "./state/AgentState";

export interface RuntimeDeps {
  readonly client: SpringClient;
  readonly draftProvider?: DraftModelProvider;
  /** Defaults to an in-memory checkpointer; inject a durable one for cross-process resume. */
  readonly checkpointer?: BaseCheckpointSaver;
}

export type RunResult =
  | { readonly status: "AWAITING_APPROVAL"; readonly checkpoint: CheckpointRequest; readonly trail: string[] }
  | { readonly status: "DONE"; readonly outcome: RunOutcome | null; readonly trail: string[] };

interface InterruptEnvelope {
  readonly value: unknown;
}

export class InquiryAgentRuntime {
  private readonly graph: ReturnType<ReturnType<typeof buildInquiryGraph>["compile"]>;

  constructor(deps: RuntimeDeps) {
    const registry = buildInquiryToolRegistry(deps.client);
    const graph = buildInquiryGraph({ registry, draftProvider: deps.draftProvider });
    this.graph = graph.compile({ checkpointer: deps.checkpointer ?? createCheckpointer() });
  }

  /** Begin a run for a fresh thread. Returns AWAITING_APPROVAL if it reaches the checkpoint. */
  async start(threadId: string, request: GoalRequest): Promise<RunResult> {
    const goal = parseGoal(request);
    const final = await this.graph.invoke({ goal }, threadConfig(threadId));
    return this.toResult(final);
  }

  /** Resume a paused run with a human decision. Idempotent for a given (thread, decision). */
  async resume(threadId: string, decision: CheckpointDecision): Promise<RunResult> {
    const final = await this.graph.invoke(new Command({ resume: decision }), threadConfig(threadId));
    return this.toResult(final);
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
