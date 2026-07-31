/**
 * The runnable façade over the inquiry draft-preparation graph — a sibling of {@link IssueAgentRuntime}:
 * this subgraph has no human-checkpoint interrupt, so a run goes straight from a request to a DONE
 * draft. There is no `resume`.
 *
 * What it does: reads the OPEN inquiry queue, picks the top-priority item, reads its seller-owned
 * detail, and generates a rule-based answer DRAFT — then STOPS. It never proposes, saves a draft to
 * the backend, records an approval, or sends anything. The "Human Checkpoint" is terminal: the run
 * finishes with the draft in the response and hands off to the human.
 *
 * Structural no-mutation: the graph is built on the READ-ONLY inquiry tool registry (search + detail),
 * so there is no mutating tool to reach and no interrupt to resume. The backend work item stays OPEN
 * and the inquiry status is untouched, because nothing on this path can write.
 *
 * Transient draft: the generated draft body (`replyDraft`) is returned in the live result and is NEVER
 * persisted — the run store keeps only the sanitized {@link InquiryDraftMeta}. Re-running the same
 * request reproduces the same draft deterministically (the drafter is pure), so replay is idempotent
 * with no cumulative effect; `generatedAt` records when this preparation ran.
 */
import { buildInquiryDraftGraph } from "./graph/inquiryDraftGraph";
import { buildInquiryReadToolRegistry } from "./tools/ToolRegistry";
import type { ToolRegistry } from "./tools/ToolRegistry";
import { threadConfig } from "./checkpoint/CheckpointContract";
import { InMemoryInquiryDraftRunStore } from "./checkpoint/InquiryDraftRunStore";
import type { InquiryDraftRunStore } from "./checkpoint/InquiryDraftRunStore";
import { parseGoal, routeIntent } from "./goal/parseGoal";
import type { GoalRequest } from "./goal/parseGoal";
import { RuleBasedDraftProvider } from "./provider/DraftModelSeam";
import type { DraftModelProvider } from "./provider/DraftModelSeam";
import type { SpringClient } from "./spring/SpringClient";
import type { AgentState } from "./state/AgentState";
import type { InquiryDraftMeta, InquiryDraftPreparation } from "./state/InquiryDraftState";
import { log } from "./log";

export interface InquiryDraftRuntimeDeps {
  readonly client: SpringClient;
  readonly draftProvider?: DraftModelProvider;
  /** Defaults to an in-memory store; a terminal run needs nothing durable. */
  readonly runStore?: InquiryDraftRunStore;
  /** Injectable clock for the generation timestamp (deterministic in tests). */
  readonly now?: () => string;
}

export interface InquiryDraftRunResult {
  readonly status: "DONE";
  readonly preparation: InquiryDraftPreparation;
  readonly trail: string[];
}

export class InquiryDraftAgentRuntime {
  private readonly graph: ReturnType<ReturnType<typeof buildInquiryDraftGraph>["compile"]>;
  private readonly registry: ToolRegistry;
  readonly runStore: InquiryDraftRunStore;
  private readonly now: () => string;

  constructor(deps: InquiryDraftRuntimeDeps) {
    // READ-ONLY registry: search + detail only — no propose/save/record tool exists on this path.
    this.registry = buildInquiryReadToolRegistry(deps.client);
    // No checkpointer: there is no interrupt on this path, so nothing to persist mid-run.
    this.graph = buildInquiryDraftGraph({
      registry: this.registry,
      draftProvider: deps.draftProvider ?? new RuleBasedDraftProvider(),
    }).compile();
    this.runStore = deps.runStore ?? new InMemoryInquiryDraftRunStore();
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /** Whether this runtime has a recorded preparation for the thread (a completed run). */
  async owns(threadId: string): Promise<boolean> {
    return (await this.runStore.load(threadId)) != null;
  }

  /**
   * Prepare a draft for the top-priority OPEN inquiry. Read-only: no interrupt, no backend mutation,
   * no send. Persists only the sanitized metadata (never the draft body) so a reloaded run cannot
   * re-surface the draft.
   */
  async run(threadId: string, request: GoalRequest): Promise<InquiryDraftRunResult> {
    const goal = parseGoal(request);
    if (routeIntent(goal.intent) !== "INQUIRY_DRAFT") {
      throw new Error(`InquiryDraftAgentRuntime cannot handle intent ${goal.intent}`);
    }

    const final = (await this.graph.invoke({ goal }, threadConfig(threadId))) as AgentState;
    const trail = final.trail ?? [];

    if (!final.selected || !final.detail || !final.candidate) {
      // Empty queue: nothing to draft. Nothing written, nothing sent.
      await this.runStore.save({ threadId, status: "DONE", prepared: false, meta: null, trail });
      log("inquiry_draft_run_done", { prepared: false });
      return {
        status: "DONE",
        preparation: { prepared: false, meta: null, replyDraft: null, note: "no unanswered inquiries to draft" },
        trail,
      };
    }

    const meta: InquiryDraftMeta = {
      workItemId: final.selected.workItemId,
      inquiryId: final.selected.inquiryId,
      phase: final.detail.phase,
      priorityBucket: final.selected.priorityBucket,
      category: final.candidate.category,
      provenance: final.candidate.provenance,
      channelId: final.detail.channelId,
      channelCode: final.detail.channelCode ?? null,
      channelNameKo: final.detail.channelNameKo ?? null,
      inquiryStatus: final.detail.status,
      informStatus: final.detail.informStatus,
      isSecret: final.detail.isSecret ?? null,
      generatedAt: this.now(),
    };

    // Snapshot is body-free: metadata only, never candidate.comments/title.
    await this.runStore.save({ threadId, status: "DONE", prepared: true, meta, trail });
    // Log coarse, non-content scalars only. (An "isSecret" key would be dropped by the log filter's
    // secret-key rule anyway, so the secret flag is intentionally not logged here.)
    log("inquiry_draft_run_done", {
      prepared: true,
      category: meta.category,
      channelCode: meta.channelCode,
    });

    return {
      status: "DONE",
      // Expose ONLY the templated reply comments — never candidate.title (which echoes the customer
      // subject) and never the customer body/details.
      preparation: { prepared: true, meta, replyDraft: final.candidate.comments },
      trail,
    };
  }
}
