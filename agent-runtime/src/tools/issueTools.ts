/**
 * Review-issue-memory capabilities exposed as LangChain Tools.
 *
 * Each tool is a thin adapter onto ONE existing read-only Spring endpoint via
 * {@link IssueSpringClient}. No domain logic is re-implemented — the backend owns issue
 * extraction, the severity/trend/concentration judgements, and the lifecycle; a tool only
 * validates its input (zod) and forwards the call. These are real `@langchain/core`
 * StructuredTools, so an LLM planner could later bind and route them; this subgraph routes
 * them deterministically from the graph edges.
 *
 * <b>Read-only, and quote-free.</b> There is no tool that changes an issue, starts an action,
 * or writes feedback — those are out of this subgraph's scope. And none of these reads returns
 * a review/inquiry body, a masked quote, or an operator note, so no customer text can enter the
 * graph through a tool result.
 *
 * The four tools carry their PRODUCT-FACING names (`search_review_issues`,
 * `get_review_issue_detail`, `get_review_issue_evidence_summary`, `get_review_issue_trend`).
 * `get_review_issue_detail` returns the quote-free CONTEXT (identity + note-free lifecycle
 * history) — deliberately not the human detail surface, which carries masked quotes and notes.
 */
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { IssueSpringClient } from "../spring/IssueSpringClient";

export const ISSUE_TOOL = {
  SEARCH_ISSUES: "search_review_issues",
  GET_DETAIL: "get_review_issue_detail",
  GET_EVIDENCE_SUMMARY: "get_review_issue_evidence_summary",
  GET_TREND: "get_review_issue_trend",
} as const;

export type IssueToolName = (typeof ISSUE_TOOL)[keyof typeof ISSUE_TOOL];

/** ISO date-only (YYYY-MM-DD) reproducibility anchor; optional (backend defaults to today). */
const referenceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "referenceDate must be YYYY-MM-DD");

export function buildIssueTools(client: IssueSpringClient): StructuredToolInterface[] {
  const search = tool(
    async ({ referenceDate: ref, dismissed }: { referenceDate?: string; dismissed?: boolean }) =>
      client.searchReviewIssues({ referenceDate: ref, dismissed: dismissed ?? false }),
    {
      name: ISSUE_TOOL.SEARCH_ISSUES,
      description:
        "List the org's active operations issues, worst-first (severity, then whether a change judgement fired, then recency). Each row is a closed-vocabulary signal with severity, trend, evidence count, and dominant product — no review text. dismissed=true returns the set-aside list instead.",
      schema: z.object({
        referenceDate: referenceDate.optional(),
        dismissed: z.boolean().optional(),
      }),
    },
  );

  const detail = tool(
    async ({ issueId, referenceDate: ref }: { issueId: string; referenceDate?: string }) =>
      client.getIssueContext(issueId, ref),
    {
      name: ISSUE_TOOL.GET_DETAIL,
      description:
        "Fetch one issue's identity and its lifecycle history (관찰 중 → 확인 필요 → …), quote-free and note-free. This is the drill-down for 'why am I being told to look at this', not the customer-quote surface.",
      schema: z.object({ issueId: z.string().min(1), referenceDate: referenceDate.optional() }),
    },
  );

  const evidenceSummary = tool(
    async ({ issueId }: { issueId: string }) => client.getIssueEvidenceSummary(issueId),
    {
      name: ISSUE_TOOL.GET_EVIDENCE_SUMMARY,
      description:
        "Fetch one issue's sanitized evidence roll-up: total, per-product split (attributed largest-first, plus an unattributed count), the star-rating distribution, and the all-time span. Aggregate counts only — no review id, no quote.",
      schema: z.object({ issueId: z.string().min(1) }),
    },
  );

  const trend = tool(
    async ({ issueId, referenceDate: ref }: { issueId: string; referenceDate?: string }) =>
      client.getIssueTrend(issueId, ref),
    {
      name: ISSUE_TOOL.GET_TREND,
      description:
        "Fetch one issue's current signal as of the reference date: severity, the change judgements (NEW/증가 중/계속 발생/특정 상품 집중/개선됨) with the surge counts, concentration, and evidence span. No review text.",
      schema: z.object({ issueId: z.string().min(1), referenceDate: referenceDate.optional() }),
    },
  );

  return [search, detail, evidenceSummary, trend];
}
