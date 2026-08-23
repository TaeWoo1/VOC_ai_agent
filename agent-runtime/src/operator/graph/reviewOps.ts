/**
 * ReviewOps — what the review side of the operation looks like right now.
 *
 * <b>A specialist, not an AI employee.</b> The reply-preparation journey with its human checkpoint is
 * {@code graph/reviewGraph.ts} and it is untouched — approving a reply is a decision a person makes on
 * the review screen, reached through its own intent. What this adds is the READ half: which repeated
 * problems are live, how severe, and whether anything is getting worse.
 *
 * <b>No review text, ever.</b> The issue reads are quote-free by construction ({@code issueTools.ts}
 * says so at length), so nothing here can carry a customer sentence even by accident.
 */
import type { EvidenceRef, Finding, SpecialistResult } from "../state/OperatorState";
import type { NeedState } from "../plan/InvestigationPlan";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import type { SpecialistInput } from "./specialistInput";
import type { ReviewIssueSummary } from "../../spring/types";
import { attemptTool } from "../failure/SpecialistOutcome";
import { log } from "../../log";

/** The need kinds this specialist answers. */
export const REVIEW_NEEDS = ["REVIEW_SIGNAL"] as const;

export interface ReviewOpsResult extends SpecialistResult {
  readonly needStates: readonly NeedState[];
}

/** How many issues to surface. Small on purpose: a brief that lists twenty is a list, not a brief. */
const DEFAULT_LIMIT = 3;

export async function runReviewOps(input: SpecialistInput): Promise<ReviewOpsResult> {
  const { registry, budget, evidence, allowedTools } = input;
  const pending = (reason: string): ReviewOpsResult => ({
    specialist: "REVIEW_OPS", findings: [], evidence: [], coverage: [],
    // Every need stays PENDING rather than vanishing: a run must be able to say what it did not get to.
    needStates: input.needs.map((n) => ({ id: n.id, status: "PENDING" as const, evidenceIds: [] })),
    note: reason,
  });
  if (input.needs.length === 0) {
    return pending("리뷰 신호는 이번 조사 계획에 포함되지 않았습니다.");
  }
  if (!budget.spend("tool")) {
    return pending("반복 문제를 읽기 전에 예산이 끝났습니다.");
  }

  // The one read this specialist makes, isolated the same way InquiryOps' are: a failing issue-memory
  // call loses this specialist's contribution and nothing else, and it says so instead of throwing.
  const attempt = await attemptTool(
    { specialist: "REVIEW_OPS", tool: OPERATOR_TOOL.SEARCH_REVIEW_ISSUES, needId: input.needs[0]?.id },
    () => registry.invoke<ReviewIssueSummary[]>(
      OPERATOR_TOOL.SEARCH_REVIEW_ISSUES,
      { ...(input.referenceDate ? { referenceDate: input.referenceDate } : {}) },
      allowedTools,
    ),
  );
  if (!attempt.ok) {
    return {
      ...pending("반복 문제를 읽지 못했습니다."),
      failures: [attempt.failure],
      terminal: "FAILED",
    };
  }
  const issues = attempt.value;

  const findings: Finding[] = [];
  const refs: EvidenceRef[] = [];
  // One read serves every REVIEW_SIGNAL need the plan declared — the issue list is the same list for
  // all of them, and paying for it once per need would spend budget on identical rows.
  const needId = input.needs[0]!.id;
  const cited: string[] = [];
  for (const issue of issues.slice(0, DEFAULT_LIMIT)) {
    const ref = evidence.add({
      kind: "REVIEW_ISSUE",
      sourceTool: OPERATOR_TOOL.SEARCH_REVIEW_ISSUES,
      args: { referenceDate: input.referenceDate ?? null },
      locator: {
        issueId: issue.id,
        count: issue.evidenceCount,
        label: issue.title,
        severity: issue.severity,
        ...(issue.dominantProductId ? { productId: issue.dominantProductId } : {}),
        ...(issue.dominantProductName ? { productName: issue.dominantProductName } : {}),
      },
      observedOn: issue.lastEvidenceOn,
      coverage: "COVERED",
      provenance: `issue-memory/${issue.extractorKind}`,
    });
    refs.push(ref);
    cited.push(ref.evidenceId);
    const change = issue.change.labelsKo.length > 0 ? ` (${issue.change.labelsKo.join(", ")})` : "";
    // "…에 대한 리뷰가 N건 기록돼 있습니다" — a record, not a diagnosis. The change labels come from
    // IssueChangeRules, so the only trend words in this sentence are ones the backend decided.
    findings.push({
      findingId: `f-${ref.evidenceId}`,
      specialist: "REVIEW_OPS",
      statement: `"${issue.title}"에 대한 리뷰 근거가 ${issue.evidenceCount}건 기록돼 있습니다${change}.`
        + (issue.dominantProductName ? ` 주로 ${issue.dominantProductName}입니다.` : ""),
      evidenceIds: [ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: `/memory/${issue.id}`,
      needId,
    });
  }

  log("review_ops", {
    issues: issues.length, surfaced: findings.length, needs: input.needs.length, terminal: "OK",
  });
  return {
    specialist: "REVIEW_OPS",
    failures: [],
    terminal: "OK" as const,
    findings,
    evidence: refs,
    coverage: [],
    needStates: input.needs.map((n) => ({
      id: n.id,
      status: cited.length > 0 ? ("SATISFIED" as const) : ("UNSATISFIABLE" as const),
      evidenceIds: cited,
      ...(cited.length === 0 ? { reason: "지금 확인이 필요한 반복 리뷰 문제가 없습니다." } : {}),
    })),
    ...(issues.length === 0 ? { note: "지금 확인이 필요한 반복 리뷰 문제는 없습니다." } : {}),
  };
}
