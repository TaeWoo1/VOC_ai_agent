/**
 * The first vertical slice as a LangGraph state graph.
 *
 *   goal → search unanswered → prioritize → detail → generate draft
 *        → HUMAN CHECKPOINT (interrupt) → record approval result
 *
 * LangGraph owns the orchestration: sequencing, the human-checkpoint interrupt, and
 * resume. Every side-effecting step goes through a Tool onto the Spring backend, which
 * remains the system of record. Nothing is written to the backend before the checkpoint
 * — propose/draft/confirm run only in the approve branch (via {@link performRecord}) —
 * so the graph can only mutate anything after the checkpoint is resumed with an approval,
 * and even then the backend's fail-closed publish gate means no external reply is sent.
 *
 * `interrupt`/`Command` require a checkpointer; the graph is compiled with one in
 * {@link ../runtime}.
 */
import { END, START, StateGraph, interrupt } from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { AgentStateAnnotation } from "../state/AgentState";
import type { AgentState } from "../state/AgentState";
import { TOOL } from "../tools/inquiryTools";
import type { ToolRegistry } from "../tools/ToolRegistry";
import { prioritizeInquiries, selectTop } from "../prioritize/prioritizeInquiries";
import { RuleBasedDraftProvider } from "../provider/DraftModelSeam";
import type { DraftModelProvider } from "../provider/DraftModelSeam";
import {
  CHECKPOINT_KIND,
  parseDecision,
  type CheckpointRequest,
} from "../checkpoint/CheckpointContract";
import type { InquiryDetail, InquiryQueueResponse } from "../spring/types";
import { performRecord } from "./performRecord";
import { log } from "../log";

// Re-export so callers import these from one place.
export { ToolRegistry } from "../tools/ToolRegistry";
export { approvalCommandId } from "./performRecord";

export interface InquiryGraphDeps {
  readonly registry: ToolRegistry;
  readonly draftProvider?: DraftModelProvider;
}

function threadId(config: LangGraphRunnableConfig): string {
  const id = config.configurable?.thread_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("missing thread_id in run config");
  }
  return id;
}

export function buildInquiryGraph(deps: InquiryGraphDeps) {
  const registry = deps.registry;
  const drafter = deps.draftProvider ?? new RuleBasedDraftProvider();

  async function search(state: AgentState): Promise<Partial<AgentState>> {
    // The backend queue is paged and sorted newest-first; prioritization here is
    // oldest-first, so ranking a single page would pick the wrong inquiry. Page through
    // all OPEN items (bounded) so the ranking sees the whole queue. If the safety cap is
    // hit, say so — never silently truncate.
    const PAGE_SIZE = 100;
    const MAX_PAGES = 10; // safety bound: 1000 open items
    const startPage = state.goal?.page ?? 0;
    const collected: InquiryQueueResponse["content"] = [];
    let total = 0;
    let pagesFetched = 0;
    for (let page = startPage; pagesFetched < MAX_PAGES; page++, pagesFetched++) {
      const res = await registry.invoke<InquiryQueueResponse>(TOOL.SEARCH_UNANSWERED, {
        page,
        size: state.goal?.size ?? PAGE_SIZE,
      });
      total = res.totalElements;
      collected.push(...res.content);
      if (res.content.length === 0 || collected.length >= res.totalElements) break;
    }
    const capped = collected.length < total;
    log("inquiry_search", { fetched: collected.length, totalElements: total, capped });
    return { inquiries: collected, trail: ["searched"] };
  }

  function prioritize(state: AgentState): Partial<AgentState> {
    const ranked = prioritizeInquiries(state.inquiries);
    const top = selectTop(ranked);
    log("inquiry_prioritize", { ranked: ranked.length, selected: top != null });
    if (!top) {
      return {
        ranked,
        selected: null,
        outcome: {
          recorded: false,
          decision: "NONE",
          workItemId: null,
          phase: null,
          executionStatus: null,
          category: null,
          approvedFingerprint: null,
          externalSendAttempted: false,
          note: "no unanswered inquiries in queue",
        },
        trail: ["prioritized_empty"],
      };
    }
    return {
      ranked,
      selected: {
        workItemId: top.item.workItemId,
        inquiryId: top.item.inquiryId,
        priorityBucket: top.priorityBucket,
        rank: top.rank,
      },
      trail: ["prioritized"],
    };
  }

  async function detail(state: AgentState): Promise<Partial<AgentState>> {
    const workItemId = state.selected!.workItemId;
    const d = await registry.invoke<InquiryDetail>(TOOL.GET_DETAIL, { workItemId });
    log("inquiry_detail", { phase: d.phase, status: d.status });
    return { detail: d, trail: ["detailed"] };
  }

  function generateDraft(state: AgentState): Partial<AgentState> {
    const d = state.detail!;
    const candidate = drafter.draft({
      title: d.title,
      details: d.details,
      status: d.status,
      informStatus: d.informStatus,
    });
    log("inquiry_draft", {
      category: candidate.category,
      providerKind: candidate.provenance.providerKind,
      providerVersion: candidate.provenance.version,
    });
    return { candidate, trail: ["drafted"] };
  }

  /**
   * The human checkpoint. `interrupt` pauses the graph and surfaces the candidate for
   * review; the run resumes only when a human returns a {@link CheckpointDecision}. On
   * resume the node re-executes and `interrupt` returns that decision.
   */
  function humanCheckpoint(state: AgentState): Partial<AgentState> {
    const request: CheckpointRequest = {
      kind: CHECKPOINT_KIND,
      workItemId: state.selected!.workItemId,
      inquiryId: state.selected!.inquiryId,
      phase: state.detail?.phase ?? "OPEN",
      priorityBucket: state.selected!.priorityBucket,
      category: state.candidate!.category,
      candidate: state.candidate!,
    };
    // The resume value comes from outside the graph — validate it (fail closed to reject).
    const decision = parseDecision(interrupt(request));
    log("inquiry_checkpoint_resumed", { approved: decision.approved });
    return { decision, trail: ["checkpoint_resumed"] };
  }

  async function record(state: AgentState, config: LangGraphRunnableConfig): Promise<Partial<AgentState>> {
    const decision = state.decision!;
    const workItemId = state.selected!.workItemId;
    const title = decision.editedTitle ?? state.candidate!.title;
    const comments = decision.editedComments ?? state.candidate!.comments;

    // Shared with the durable restart-resume path so both behave identically and stay
    // idempotent. Nothing here sends an external reply.
    const outcome = await performRecord(registry, {
      threadId: threadId(config),
      workItemId,
      approved: decision.approved,
      title,
      comments,
      rejectPhase: state.detail?.phase ?? null,
    });

    return { outcome, trail: [decision.approved ? "recorded_approved" : "recorded_rejected"] };
  }

  // `prioritize` also handles the empty queue (sets a NONE outcome), so search always
  // flows into it; only after prioritization do we branch on whether a row was selected.
  const afterPrioritize = (state: AgentState) => (state.selected ? "loadDetail" : END);

  // Node names must not collide with state channel names (LangGraph constraint), hence
  // "loadDetail" for the node that populates the `detail` channel.
  return new StateGraph(AgentStateAnnotation)
    .addNode("search", search)
    .addNode("prioritize", prioritize)
    .addNode("loadDetail", detail)
    .addNode("generateDraft", generateDraft)
    .addNode("humanCheckpoint", humanCheckpoint)
    .addNode("record", record)
    .addEdge(START, "search")
    .addEdge("search", "prioritize")
    .addConditionalEdges("prioritize", afterPrioritize, { loadDetail: "loadDetail", [END]: END })
    .addEdge("loadDetail", "generateDraft")
    .addEdge("generateDraft", "humanCheckpoint")
    .addEdge("humanCheckpoint", "record")
    .addEdge("record", END);
}
