/**
 * The inquiry DRAFT-PREPARATION subgraph as a LangGraph state graph.
 *
 *   goal → search unanswered → prioritize → detail → generate draft → DONE
 *
 * <b>There is no human-checkpoint interrupt and no record step on this path.</b> Unlike the full
 * inquiry approve loop ({@link ./inquiryGraph}), this subgraph only READS the OPEN queue and one
 * item's detail and then GENERATES a rule-based answer draft for a human to review. It never
 * proposes, saves a draft to the backend, or records an approval — the "Human Checkpoint" here is
 * terminal presentation: the run finishes with the draft in hand and hands off to the human, who
 * edits/copies it and posts on the channel manually. So the run goes straight through to DONE, and
 * the caller ({@link ../inquiryDraftRuntime}) projects the final state into a sanitized draft view.
 *
 * The graph is built on the READ-ONLY inquiry tool registry (search + detail only), so it is
 * STRUCTURALLY incapable of mutating anything: there is no propose/save/record tool to reach, no
 * `interrupt`, no resume. It reuses the shared prioritizer and the shared {@link RuleBasedDraftProvider}
 * so ranking and draft text are identical to the approve loop. It also reuses {@link AgentStateAnnotation}
 * for its channels (goal/inquiries/ranked/selected/detail/candidate/trail); the `decision`/`outcome`
 * channels of that shape are simply never written on this path.
 *
 * Determinism: for a fixed backend state the search order, the selection, and the drafted text are
 * deterministic, so re-running the same request reproduces the same draft — the property the
 * idempotent-replay proof rests on. (The generation timestamp is stamped by the runtime, not here,
 * so this graph stays clock-free and pure.)
 */
import { END, START, StateGraph } from "@langchain/langgraph";
import { AgentStateAnnotation } from "../state/AgentState";
import type { AgentState } from "../state/AgentState";
import { TOOL } from "../tools/inquiryTools";
import type { ToolRegistry } from "../tools/ToolRegistry";
import { prioritizeInquiries, selectTop } from "../prioritize/prioritizeInquiries";
import { RuleBasedDraftProvider } from "../provider/DraftModelSeam";
import type { DraftModelProvider } from "../provider/DraftModelSeam";
import type { InquiryDetail, InquiryQueueResponse } from "../spring/types";
import { log } from "../log";

export { ToolRegistry } from "../tools/ToolRegistry";

export interface InquiryDraftGraphDeps {
  readonly registry: ToolRegistry;
  readonly draftProvider?: DraftModelProvider;
}

export function buildInquiryDraftGraph(deps: InquiryDraftGraphDeps) {
  const registry = deps.registry;
  const drafter = deps.draftProvider ?? new RuleBasedDraftProvider();

  async function search(state: AgentState): Promise<Partial<AgentState>> {
    // Same paging discipline as the approve loop: the backend queue is newest-first while the
    // prioritizer is oldest-first, so page through all OPEN items (bounded) before ranking, and
    // say so if the safety cap is hit — never silently truncate.
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
    log("inquiry_draft_search", { fetched: collected.length, totalElements: total, capped });
    return { inquiries: collected, trail: ["searched"] };
  }

  function prioritize(state: AgentState): Partial<AgentState> {
    const ranked = prioritizeInquiries(state.inquiries);
    const top = selectTop(ranked);
    log("inquiry_draft_prioritize", { ranked: ranked.length, selected: top != null });
    if (!top) {
      return { ranked, selected: null, trail: ["prioritized_empty"] };
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
    log("inquiry_draft_detail", { phase: d.phase, status: d.status });
    return { detail: d, trail: ["detailed"] };
  }

  async function generateDraft(state: AgentState): Promise<Partial<AgentState>> {
    const d = state.detail!;
    const candidate = await drafter.draft({
      title: d.title,
      details: d.details,
      status: d.status,
      informStatus: d.informStatus,
    });
    // Log only the coarse category + provenance — never the title/details/comments (content).
    log("inquiry_draft_generated", {
      category: candidate.category,
      providerKind: candidate.provenance.providerKind,
      providerVersion: candidate.provenance.version,
    });
    return { candidate, trail: ["drafted"] };
  }

  // prioritize handles the empty queue (selected=null); only when a row was selected do we
  // continue to the detail read and draft generation.
  const afterPrioritize = (state: AgentState) => (state.selected ? "loadDetail" : END);

  return new StateGraph(AgentStateAnnotation)
    .addNode("search", search)
    .addNode("prioritize", prioritize)
    .addNode("loadDetail", detail)
    .addNode("generateDraft", generateDraft)
    .addEdge(START, "search")
    .addEdge("search", "prioritize")
    .addConditionalEdges("prioritize", afterPrioritize, { loadDetail: "loadDetail", [END]: END })
    .addEdge("loadDetail", "generateDraft")
    .addEdge("generateDraft", END);
}
