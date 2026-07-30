/**
 * The issue-memory subgraph as a LangGraph state graph.
 *
 *   goal → search active issues → prioritize (deterministic) → assemble per-issue context
 *        → compose structured operations brief → DONE
 *
 * <b>There is no human checkpoint on this path.</b> The subgraph only READS and DERIVES: it
 * reports which operations issues to look at and why, and never changes an issue's state, starts
 * an action, or writes feedback. So there is no `interrupt`, no resume, and no backend mutation —
 * it runs straight through to a DONE brief. LangGraph still owns the sequencing and fan-out; every
 * read goes through a Tool onto the Spring backend, which remains the system of record for the
 * extraction/aggregation/lifecycle logic this subgraph must never re-implement.
 *
 * Determinism: for a fixed (backend state, referenceDate) the search order, the prioritization,
 * and every per-issue read are deterministic, so the composed brief is reproducible — the property
 * the "same request → same brief, even after a restart" proof rests on.
 */
import { END, START, StateGraph } from "@langchain/langgraph";
import { IssueAgentStateAnnotation } from "../state/IssueAgentState";
import type {
  IssueAgentState,
  IssueBriefEntry,
  IssueOperationsBrief,
} from "../state/IssueAgentState";
import { ISSUE_TOOL } from "../tools/issueTools";
import type { ToolRegistry } from "../tools/ToolRegistry";
import { prioritizeIssues, selectTopIssues } from "../prioritize/prioritizeIssues";
import type {
  IssueChangeInfo,
  IssueContext,
  IssueEvidenceSummary,
  IssueProductEvidence,
  IssueRatingDistribution,
  IssueTrend,
  ReviewIssueSummary,
} from "../spring/types";
import { log } from "../log";

export { ToolRegistry } from "../tools/ToolRegistry";

/** How many issues the brief covers by default when the request gives no explicit size. */
export const DEFAULT_BRIEF_SIZE = 3;
/** Safety cap so an unbounded `size` can't fan out to hundreds of reads. */
export const MAX_BRIEF_SIZE = 20;

export interface IssueGraphDeps {
  readonly registry: ToolRegistry;
}

/**
 * Project a raw issue row onto exactly the typed, quote-free fields. Defence in depth: the issue
 * endpoints are quote-free by construction, but a search row is the analog of the review
 * reply-work row (which does carry a customer excerpt on the real backend), so we never let an
 * unexpected field ride into the graph state — only these named fields, and a fresh `change`
 * object built field-by-field, enter the run.
 */
function projectChange(c: IssueChangeInfo): IssueChangeInfo {
  return {
    kinds: [...c.kinds],
    labelsKo: [...c.labelsKo],
    highSurge: c.highSurge,
    surgeWindowCount: c.surgeWindowCount,
    surgeBaselineWeekly: c.surgeBaselineWeekly,
  };
}

function projectProductEvidence(p: IssueProductEvidence): IssueProductEvidence {
  return { productId: p.productId, productName: p.productName, evidenceCount: p.evidenceCount };
}

function projectRatingDistribution(d: IssueRatingDistribution): IssueRatingDistribution {
  return {
    rating1: d.rating1,
    rating2: d.rating2,
    rating3: d.rating3,
    rating4: d.rating4,
    rating5: d.rating5,
    unrated: d.unrated,
  };
}

function projectIssueSummary(raw: ReviewIssueSummary): ReviewIssueSummary {
  return {
    id: raw.id,
    title: raw.title,
    aspect: raw.aspect,
    problem: raw.problem,
    severity: raw.severity,
    lifecycleState: raw.lifecycleState,
    lifecycleLabelKo: raw.lifecycleLabelKo,
    evidenceCount: raw.evidenceCount,
    firstEvidenceOn: raw.firstEvidenceOn,
    lastEvidenceOn: raw.lastEvidenceOn,
    dominantProductId: raw.dominantProductId,
    dominantProductName: raw.dominantProductName,
    dismissed: raw.dismissed,
    extractorKind: raw.extractorKind,
    change: projectChange(raw.change),
  };
}

export function buildIssueGraph(deps: IssueGraphDeps) {
  const registry = deps.registry;

  async function search(state: IssueAgentState): Promise<Partial<IssueAgentState>> {
    const referenceDate = state.goal?.referenceDate ?? null;
    const raw = await registry.invoke<ReviewIssueSummary[]>(ISSUE_TOOL.SEARCH_ISSUES, {
      dismissed: false,
      ...(referenceDate ? { referenceDate } : {}),
    });
    const issues = raw.map(projectIssueSummary);
    log("issue_search", { found: issues.length, pinnedReferenceDate: referenceDate != null });
    return { issues, referenceDate, trail: ["searched"] };
  }

  function prioritize(state: IssueAgentState): Partial<IssueAgentState> {
    const ranked = prioritizeIssues(state.issues);
    const requested = state.goal?.size ?? DEFAULT_BRIEF_SIZE;
    const size = Math.max(0, Math.min(requested, MAX_BRIEF_SIZE));
    const selected = selectTopIssues(ranked, size);
    log("issue_prioritize", { ranked: ranked.length, selected: selected.length });

    if (selected.length === 0) {
      const brief: IssueOperationsBrief = {
        referenceDate: state.referenceDate,
        totalActiveIssues: ranked.length,
        selectedCount: 0,
        entries: [],
        note: ranked.length === 0 ? "no active operations issues" : "no issues selected",
      };
      return { ranked, selected, brief, trail: ["prioritized_empty"] };
    }
    return { ranked, selected, trail: ["prioritized"] };
  }

  /**
   * Fetch each selected issue's quote-free context, evidence summary, and trend, and fold them
   * into a brief entry. Three distinct reads per issue — the same tools an LLM planner would use —
   * kept deterministic by the graph edges. Never fetches the human detail surface, so no quote is
   * pulled even transiently.
   */
  async function assemble(state: IssueAgentState): Promise<Partial<IssueAgentState>> {
    const referenceDate = state.referenceDate ?? undefined;
    const entries: IssueBriefEntry[] = [];
    for (const r of state.selected) {
      const issueId = r.item.id;
      const [context, evidenceSummary, trend] = await Promise.all([
        registry.invoke<IssueContext>(ISSUE_TOOL.GET_DETAIL, { issueId, ...(referenceDate ? { referenceDate } : {}) }),
        registry.invoke<IssueEvidenceSummary>(ISSUE_TOOL.GET_EVIDENCE_SUMMARY, { issueId }),
        registry.invoke<IssueTrend>(ISSUE_TOOL.GET_TREND, { issueId, ...(referenceDate ? { referenceDate } : {}) }),
      ]);
      // Trend is the authoritative current signal (as of referenceDate); prefer it over the row
      // captured at search time for severity/labels/counts/product, so the brief is internally
      // consistent with the trend read.
      const t = trend;
      entries.push({
        issueId,
        rank: r.rank,
        priorityBucket: r.priorityBucket,
        title: t.title,
        aspect: t.aspect,
        problem: t.problem,
        severity: t.severity,
        lifecycleState: t.lifecycleState,
        lifecycleLabelKo: t.lifecycleLabelKo,
        evidenceCount: t.evidenceCount,
        firstEvidenceOn: t.firstEvidenceOn,
        lastEvidenceOn: t.lastEvidenceOn,
        dominantProductId: t.dominantProductId,
        dominantProductName: t.dominantProductName,
        // Project the sub-objects field-by-field too (symmetry with the search-node hardening),
        // so a future text field added inside change/byProduct cannot ride into the brief.
        trend: projectChange(t.change),
        evidenceSummary: {
          totalEvidence: evidenceSummary.totalEvidence,
          byProduct: evidenceSummary.byProduct.map(projectProductEvidence),
          unattributedEvidence: evidenceSummary.unattributedEvidence,
          ratingDistribution: projectRatingDistribution(evidenceSummary.ratingDistribution),
        },
        lifecycleHistoryDepth: context.history.length,
      });
    }
    log("issue_assemble", { entries: entries.length });
    return { entries, trail: ["assembled"] };
  }

  function compose(state: IssueAgentState): Partial<IssueAgentState> {
    const brief: IssueOperationsBrief = {
      referenceDate: state.referenceDate,
      totalActiveIssues: state.ranked.length,
      selectedCount: state.entries.length,
      entries: state.entries,
    };
    log("issue_compose", { totalActive: brief.totalActiveIssues, selected: brief.selectedCount });
    return { brief, trail: ["composed"] };
  }

  // prioritize sets a DONE brief for the empty case, so only the non-empty path continues.
  const afterPrioritize = (state: IssueAgentState) => (state.selected.length > 0 ? "assemble" : END);

  return new StateGraph(IssueAgentStateAnnotation)
    .addNode("search", search)
    .addNode("prioritize", prioritize)
    .addNode("assemble", assemble)
    .addNode("compose", compose)
    .addEdge(START, "search")
    .addEdge("search", "prioritize")
    .addConditionalEdges("prioritize", afterPrioritize, { assemble: "assemble", [END]: END })
    .addEdge("assemble", "compose")
    .addEdge("compose", END);
}
