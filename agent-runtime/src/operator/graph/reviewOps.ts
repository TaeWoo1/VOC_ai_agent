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
import type { NeedState, ResolvedEntity } from "../plan/InvestigationPlan";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import type { SpecialistInput } from "./specialistInput";
import type { IssueEvidenceSummary, ReviewIssueSummary } from "../../spring/types";
import type { ToolFailure } from "../failure/SpecialistOutcome";
import { attemptTool } from "../failure/SpecialistOutcome";
import { eventRange } from "../scope/EvidenceTime";
import { log } from "../../log";

/** The need kinds this specialist answers. */
export const REVIEW_NEEDS = ["REVIEW_SIGNAL"] as const;

export interface ReviewOpsResult extends SpecialistResult {
  readonly needStates: readonly NeedState[];
}

/** How many issues to surface. Small on purpose: a brief that lists twenty is a list, not a brief. */
const DEFAULT_LIMIT = 3;

/**
 * How many issues get an attribution read when a product is resolved.
 *
 * Wider than {@link DEFAULT_LIMIT} because these reads ANSWER a question rather than fill a brief: an
 * issue whose dominant product is someone else's may still hold this product's rows, and stopping at
 * three would make "이 상품에 귀속된 근거가 없습니다" a statement about the top three. Bounded all the
 * same, and a truncated sweep says so rather than reading as complete.
 */
const ATTRIBUTION_LIMIT = 6;

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

  // <b>A resolved product changes what this read is FOR.</b> The list has no product parameter (B1), so
  // for a product question it is a candidate list and nothing else — never the evidence. What is
  // evidence is which of each issue's review rows belong to THIS product, and only
  // `get_review_issue_evidence_summary` can say. It sat in the catalogue with no caller until 2026-08-23
  // (`docs/agent_real_validation_v1.md` §5 P4, A5/B1), which is why Q4 read the whole org, had every row
  // refused by the scope gate, and told the seller nothing.
  const product = input.resolved.find((e) => e.kind === "PRODUCT");
  if (product) {
    return attributeToProduct(input, issues, product);
  }

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
      events: eventRange(issue.firstEvidenceOn, issue.lastEvidenceOn),
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
      // The issue list is not filtered by period, so "최근" can only be answered by showing WHEN the
      // evidence is from. The date is the row's own last evidence date — event time, never the read time.
      statement: `"${issue.title}"에 대한 리뷰 근거가 ${issue.evidenceCount}건 기록돼 있습니다${change}`
        + (issue.lastEvidenceOn ? ` (최근 근거 ${issue.lastEvidenceOn})` : "")
        + "."
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

/**
 * The product-scoped path: which of these org issues actually hold this product's review rows.
 *
 * <b>An org row is never promoted.</b> Nothing from the issue list becomes a finding here — the only
 * sentences are ones a per-product count supports, and the only number quoted for the product is the
 * product's own. The issue's total is named beside it, in the same sentence, so the smaller number can
 * never be read as the larger one.
 *
 * <b>Zero is an answer, and it is the one this path most often has to give.</b> A product with no rows
 * in any live issue gets a stated, evidenced "없습니다" rather than silence — silence and "we could not
 * look" are the same thing on screen, and only one of them is true here.
 */
async function attributeToProduct(
  input: SpecialistInput,
  issues: readonly ReviewIssueSummary[],
  product: ResolvedEntity,
): Promise<ReviewOpsResult> {
  const { registry, budget, evidence, allowedTools } = input;
  const needId = input.needs[0]!.id;
  const findings: Finding[] = [];
  const refs: EvidenceRef[] = [];
  const cited: string[] = [];
  const failures: ToolFailure[] = [];
  const notes: string[] = [];
  const considered = issues.slice(0, ATTRIBUTION_LIMIT);
  let checked = 0;

  for (const issue of considered) {
    if (!budget.spend("tool")) {
      notes.push(`예산이 끝나 반복 문제 ${considered.length}건 중 ${checked}건까지만 상품 귀속을 확인했습니다.`);
      break;
    }
    // Isolated per issue: one unreadable summary costs that issue's attribution and nothing else. A2.
    const attempt = await attemptTool(
      { specialist: "REVIEW_OPS", tool: OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY, needId },
      () => registry.invoke<IssueEvidenceSummary>(
        OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY, { issueId: issue.id }, allowedTools,
      ),
    );
    if (!attempt.ok) {
      failures.push(attempt.failure);
      continue;
    }
    checked += 1;
    const row = attempt.value.byProduct.find((p) => p.productId === product.id);
    if (!row || row.evidenceCount <= 0) {
      continue;
    }
    const ref = evidence.add({
      kind: "ISSUE_EVIDENCE",
      sourceTool: OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY,
      args: { issueId: issue.id },
      locator: {
        issueId: issue.id,
        productId: product.id,
        productName: product.label,
        count: row.evidenceCount,
        label: issue.title,
        severity: issue.severity,
      },
      // <b>No event range, deliberately.</b> The summary's first/last dates span the WHOLE issue, and
      // this row is one product's slice of it. Lending the issue's dates to a product's count would let
      // another product's recent review prove this product's "최근" — the A1 failure in temporal
      // clothing. A period question therefore withholds this, correctly.
      coverage: "COVERED",
      provenance: `issue-memory/${issue.extractorKind}:evidence-summary`,
    });
    refs.push(ref);
    cited.push(ref.evidenceId);
    findings.push({
      findingId: `f-${ref.evidenceId}`,
      specialist: "REVIEW_OPS",
      statement: `${product.label}에 "${issue.title}" 문제로 기록된 리뷰 근거가 ${row.evidenceCount}건 `
        + `있습니다 (이 문제 전체 ${attempt.value.totalEvidence}건 중).`,
      evidenceIds: [ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: `/memory/${issue.id}`,
      needId,
    });
  }

  if (cited.length === 0) {
    // The measured zero. Its evidence is the sweep itself — how many live issues were opened and
    // checked — so the sentence rests on a read rather than on nothing having been found.
    const ref = evidence.add({
      kind: "ISSUE_EVIDENCE",
      sourceTool: OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY,
      args: { productId: product.id, issuesChecked: checked, issuesOpen: issues.length },
      locator: {
        productId: product.id,
        productName: product.label,
        count: 0,
        label: "이 상품에 귀속된 리뷰 이슈 근거",
      },
      coverage: "COVERED",
      provenance: "issue-memory/evidence-summary",
    });
    refs.push(ref);
    findings.push({
      findingId: `f-${ref.evidenceId}`,
      specialist: "REVIEW_OPS",
      // <b>"모두" is a claim, and it is only made when it is true.</b> The sweep is bounded; the demo
      // org held 19 open issues the first time this ran live and the cap reads six of them. A zero over
      // the top six is not a zero over the list, and a sentence that rounds the difference away is the
      // invented completeness this graph refuses everywhere else.
      statement: checked === 0
        ? `지금 열려 있는 반복 리뷰 문제가 없어 ${product.label}에 대해 확인할 리뷰 문제도 없습니다.`
        : checked >= issues.length
          ? `지금 열려 있는 반복 리뷰 문제 ${checked}건을 모두 확인했지만, ${product.label}에 귀속된 `
            + "리뷰 근거는 없습니다."
          : `열려 있는 반복 리뷰 문제 ${issues.length}건 가운데 심각한 ${checked}건을 확인했지만, `
            + `${product.label}에 귀속된 리뷰 근거는 없습니다. 나머지는 확인하지 않았습니다.`,
      evidenceIds: [ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: null,
      // It is a statement about what the data does NOT hold for this product, which is exactly what
      // this flag marks — and what keeps the honest empty answer from being dropped as unsupported.
      claimsCoverageLimit: true,
      needId,
    });
  }

  log("review_ops", {
    issues: issues.length, attributed: cited.length, checked,
    // Named in the log too, so a bounded sweep is visible in an operator's trace and not only on screen.
    truncated: checked < issues.length, needs: input.needs.length,
    scope: "PRODUCT", terminal: failures.length > 0 ? "PARTIAL" : "OK",
  });
  return {
    specialist: "REVIEW_OPS",
    failures,
    // Every issue unreadable AND nothing attributed is a failed read, not a quiet product.
    terminal: failures.length > 0 && checked === 0 ? "FAILED" : "OK",
    findings,
    evidence: refs,
    coverage: [],
    needStates: input.needs.map((n) => ({
      id: n.id,
      status: cited.length > 0 ? ("SATISFIED" as const) : ("UNSATISFIABLE" as const),
      evidenceIds: cited,
      ...(cited.length === 0
        ? {
            reason: checked >= issues.length
              ? `${product.label}에 귀속된 리뷰 이슈 근거가 없습니다.`
              : `확인한 반복 리뷰 문제 ${checked}건 중에는 ${product.label}에 귀속된 근거가 없습니다.`,
          }
        : {}),
    })),
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}
