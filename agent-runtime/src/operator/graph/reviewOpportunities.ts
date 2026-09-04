/**
 * ReviewOps — the IMPROVEMENT_OPPORTUNITY half (Opportunity Engine v1).
 *
 * <b>The runtime derives nothing here.</b> The backend turns an issue (aspect × problem × evidence) and the
 * seller's own knowledge into an opportunity with a closed kind, fact sentences and a recommendation; this
 * read cites those rows and draws them as the same object the product and issue screens draw. No sentence
 * about a cause or an effect is written on this side — there is nothing here that could know one.
 *
 * <b>A resolved product narrows the read; none is required.</b> 「최근 반복 문제에서 개선할 만한 것 있어?」
 * is the org question and the common one; 「이 상품에서 개선할 거 있어?」 passes the resolved id, and the
 * backend answers from that product's own issue list — so the rows can never name an issue the product's
 * signal card does not.
 *
 * <b>Quote-free.</b> The rows carry titles, counts, labels and the backend's sentences; the customer's
 * words stay behind the `/memory/{issueId}` link every row opens.
 */
import type { EvidenceRef, Finding } from "../state/OperatorState";
import type { SpecialistInput } from "./specialistInput";
import type { ReviewOpsResult } from "./reviewOps";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import { attemptTool } from "../failure/SpecialistOutcome";
import { eventRange } from "../scope/EvidenceTime";
import type { ImprovementOpportunitySummary } from "../../spring/types";
import type { OpportunityListArtifact } from "../../conversation/contract";
import { log } from "../../log";

/** How many opportunities the brief states in prose; the card carries the rest. */
const FINDING_LIMIT = 3;
/** How many rows the card carries — the seller's screen shows the same set with the same order. */
const CARD_LIMIT = 10;

export async function readOpportunities(input: SpecialistInput): Promise<ReviewOpsResult> {
  const { registry, budget, evidence, allowedTools } = input;
  const needId = input.needs[0]?.id;
  const pending = (reason: string): ReviewOpsResult => ({
    specialist: "REVIEW_OPS", findings: [], evidence: [], coverage: [],
    needStates: input.needs.map((n) => ({ id: n.id, status: "PENDING" as const, evidenceIds: [] })),
    note: reason,
  });
  if (!needId) {
    return { specialist: "REVIEW_OPS", findings: [], evidence: [], coverage: [], needStates: [] };
  }
  if (!budget.spend("tool")) {
    return pending("개선 기회를 읽기 전에 예산이 끝났습니다.");
  }
  const product = input.resolved.find((e) => e.kind === "PRODUCT");
  const args = {
    ...(product ? { productId: product.id } : {}),
    ...(input.referenceDate ? { referenceDate: input.referenceDate } : {}),
  };
  const attempt = await attemptTool(
    { specialist: "REVIEW_OPS", tool: OPERATOR_TOOL.LIST_IMPROVEMENT_OPPORTUNITIES, needId },
    () => registry.invoke<ImprovementOpportunitySummary[]>(
      OPERATOR_TOOL.LIST_IMPROVEMENT_OPPORTUNITIES, args, allowedTools,
    ),
  );
  if (!attempt.ok) {
    return { ...pending("개선 기회를 읽지 못했습니다."), failures: [attempt.failure], terminal: "FAILED" };
  }
  // The backend already withholds dismissed rows; the filter is a fence against an older backend.
  const rows = attempt.value.filter((r) => r.status !== "DISMISSED");

  const refs: EvidenceRef[] = [];
  const findings: Finding[] = [];
  for (const row of rows.slice(0, FINDING_LIMIT)) {
    const ref = evidence.add({
      kind: "IMPROVEMENT_OPPORTUNITY",
      sourceTool: OPERATOR_TOOL.LIST_IMPROVEMENT_OPPORTUNITIES,
      args,
      locator: {
        issueId: row.issueId,
        count: row.evidenceCount,
        label: row.issueTitle,
        severity: row.severity,
        ...(row.productId ? { productId: row.productId } : {}),
        ...(row.productName ? { productName: row.productName } : {}),
      },
      events: eventRange(row.firstEvidenceOn, row.lastEvidenceOn),
      coverage: "COVERED",
      provenance: "opportunity-engine/v1",
    });
    refs.push(ref);
    findings.push({
      findingId: `f-${ref.evidenceId}`,
      specialist: "REVIEW_OPS",
      // The backend's own sentence, with the fact it rests on. Nothing is added to it.
      statement: `${row.kindLabelKo} — ${row.recommendationKo} (근거 리뷰 ${row.evidenceCount}건`
        + (row.productName ? `, ${row.productName}` : "") + ")",
      evidenceIds: [ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: `/memory/${row.issueId}`,
      needId,
    });
  }

  const artifact: OpportunityListArtifact = {
    artifactId: "a-opportunities",
    type: "OPPORTUNITY_LIST",
    title: product ? `${product.label} 개선 기회` : "개선할 만한 기회",
    titleSaid: true,
    productId: product?.id ?? null,
    items: rows.slice(0, CARD_LIMIT).map((r) => ({
      issueId: r.issueId, kind: r.kind, kindLabelKo: r.kindLabelKo, status: r.status, statusLabelKo: r.statusLabelKo,
      issueTitle: r.issueTitle, recommendationKo: r.recommendationKo, evidenceCount: r.evidenceCount,
      productId: r.productId, productName: r.productName, to: `/memory/${r.issueId}`,
    })),
    ...(rows.length > CARD_LIMIT ? { note: `나머지 ${rows.length - CARD_LIMIT}건은 상품 화면과 고객운영 메모리에 있습니다.` } : {}),
  };

  log("review_ops_opportunities", {
    rows: rows.length, surfaced: findings.length, scope: product ? "PRODUCT" : "ORG", terminal: "OK",
  });
  const cited = refs.map((r) => r.evidenceId);
  return {
    specialist: "REVIEW_OPS",
    failures: [],
    terminal: "OK" as const,
    findings,
    evidence: refs,
    coverage: [],
    artifacts: [artifact],
    needStates: input.needs.map((n) => ({
      id: n.id,
      status: cited.length > 0 ? ("SATISFIED" as const) : ("UNSATISFIABLE" as const),
      evidenceIds: cited,
      coverage: "COVERED" as const,
      complete: rows.length <= CARD_LIMIT,
      settledBy: "REVIEW_OPS" as const,
      ...(cited.length === 0 ? { reason: "지금 제안할 개선 기회가 없습니다." } : {}),
    })),
  };
}
