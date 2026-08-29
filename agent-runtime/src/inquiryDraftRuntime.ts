/**
 * The runnable façade over the inquiry draft-preparation graph — a sibling of {@link IssueAgentRuntime}:
 * this subgraph has no human-checkpoint interrupt, so a run goes straight from a request to a DONE
 * draft. There is no `resume`.
 *
 * What it does: reads the OPEN inquiry queue, picks the top-priority item, reads its seller-owned
 * detail, and asks the product's own draft path for the answer draft — then STOPS. Since Knowledge
 * Context v1-A closure (2026-08-30) the drafter is {@link ComposerDraftProvider}: `InquiryDraftComposer`
 * behind `POST /api/inquiries/{id}/draft/generate`, the same call the inquiry screen and the chat lane
 * make. That path PREPARES — an OPEN item moves to PROPOSED and one MODEL version is appended — and
 * moves nothing toward a channel. This runtime never records an approval and never sends.
 *
 * The graph's tool registry is READ-ONLY (search + detail): there is no propose/save/record tool to
 * reach and no interrupt to resume; the one PREPARE goes through the drafter seam.
 *
 * Transient text: the draft body (`replyDraft`) is returned in the live result and NEVER persisted by
 * this runtime — the run store keeps only the sanitized {@link InquiryDraftMeta}. The text itself lives
 * where the product keeps it: the saved version on the inquiry (`draftVersion`), which the inquiry
 * screen shows. Re-running the same request appends another version (a regenerate), exactly as the
 * screen's 「다시 만들기」 does.
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
   * Prepare a draft for the top-priority OPEN inquiry through the product's own draft path: no
   * interrupt, no approval, no send. Persists only the sanitized metadata (never the draft body) so a
   * reloaded run cannot re-surface the text here; the saved version lives on the inquiry itself.
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

    const c = final.candidate;
    const basis = {
      answerBasis: c.answerBasis ?? null,
      answerBasisNote: c.answerBasisNote ?? null,
      evidenceSummary: c.evidenceSummary ?? [],
    };
    // Knowledge Context v1-A: a candidate with no text is not a prepared draft. The composer wrote
    // nothing (no answer basis, capability off, vendor failure) and the rule categoriser names the
    // category and nothing else; saying `prepared` would hand the operator an empty box that looks
    // reviewed. Fail closed: not prepared, and the reason is the backend's own sentence.
    if (c.comments.trim().length === 0) {
      const reason = c.unavailableMessage ? "UNAVAILABLE" : "NO_ANSWER_BASIS";
      await this.runStore.save({ threadId, status: "DONE", prepared: false, meta, trail: [...trail, "no_answer_basis"] });
      log("inquiry_draft_run_done", { prepared: false, reason, category: meta.category });
      return {
        status: "DONE",
        preparation: { prepared: false, meta, replyDraft: null, ...basis,
          note: c.unavailableMessage
            ?? c.answerBasisNote
            ?? "답변 기준이 없어 초안을 만들지 않았습니다. 문의 화면에서 답변 기준을 등록하면 초안을 준비합니다." },
        trail: [...trail, "no_answer_basis"],
      };
    }

    // Snapshot is body-free: metadata only, never candidate.comments/title.
    await this.runStore.save({ threadId, status: "DONE", prepared: true, meta, trail });
    // Log coarse, non-content scalars only. (An "isSecret" key would be dropped by the log filter's
    // secret-key rule anyway, so the secret flag is intentionally not logged here.)
    log("inquiry_draft_run_done", {
      prepared: true,
      category: meta.category,
      channelCode: meta.channelCode,
      answerBasis: basis.answerBasis,
      draftVersion: c.draftVersion ?? null,
    });

    return {
      status: "DONE",
      // Expose ONLY the reply comments — never candidate.title (which echoes the customer subject)
      // and never the customer body/details.
      preparation: {
        prepared: true, meta, replyDraft: c.comments, ...basis,
        draftVersion: c.draftVersion ?? null, contentFingerprint: c.contentFingerprint ?? null,
      },
      trail,
    };
  }
}
