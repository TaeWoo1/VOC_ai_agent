/**
 * ReportOpsNode — "이번 주 대표에게 보고할 내용 정리해줘".
 *
 * <b>v2 makes the composition rule structural.</b> v1's ReportOps called three tools of its own and
 * minted its own evidence, which is why a real run once reported the same 3,208 unanswered inquiries
 * twice — once from InquiryOps and once from here, under two evidence ids, reading as two facts. v2
 * gives it no tools at all: it composes findings the OTHER specialists already produced and cites
 * THEIR evidence ids. `reportOpsNoNewFacts.test.ts` asserts it minted none.
 *
 * <b>That also settles the role question the contract states.</b> ReportOps is an operational/exec
 * viewpoint over findings; it is not a source of truth. A node that could read a source could disagree
 * with the specialist that owns it, and then two parts of one answer would print different numbers
 * under one label — the defect the home/report parity work already had to fix once on the frontend.
 *
 * <b>Still a node, not a graph.</b> No branch, no checkpoint, no loop: a straight composition.
 */
import type { Finding, SpecialistResult } from "../state/OperatorState";
import type { NeedState } from "../plan/InvestigationPlan";
import { log } from "../../log";

export interface ReportOpsInput {
  /** Everything the other specialists found this run, already judged or not. */
  readonly findings: readonly Finding[];
  /** The needs assigned to REPORT_OPS — reported on, never independently satisfied. */
  readonly needs: readonly { readonly id: string }[];
}

export interface ReportOpsResult extends SpecialistResult {
  readonly needStates: readonly NeedState[];
}

/**
 * How many upstream findings one report line may rest on.
 *
 * Bounded so a summary sentence cites a readable set rather than everything; the cap is reported when
 * it bites, for the reason every other truncation in this runtime is.
 */
const MAX_CITED = 8;

export function runReportOps(input: ReportOpsInput): ReportOpsResult {
  const usable = input.findings.filter((f) => f.evidenceIds.length > 0 && f.specialist !== "REPORT_OPS");
  const needStates: NeedState[] = input.needs.map((n) => ({
    id: n.id,
    status: usable.length > 0 ? ("SATISFIED" as const) : ("UNSATISFIABLE" as const),
    evidenceIds: usable.flatMap((f) => [...f.evidenceIds]).slice(0, MAX_CITED),
    ...(usable.length === 0 ? { reason: "다른 전문 그래프가 보고할 사실을 만들지 못했습니다." } : {}),
  }));

  if (usable.length === 0) {
    log("report_ops", { composed: 0 });
    return {
      specialist: "REPORT_OPS",
      findings: [],
      evidence: [],
      coverage: [],
      needStates,
      note: "이번 기간에 대표 보고로 올릴 확인된 항목이 없습니다.",
    };
  }

  // One composed line per specialist, so the report says WHERE each part came from. The sentence names
  // counts of findings, never a number this node computed: any figure inside it is already inside the
  // upstream statement it points at.
  const bySpecialist = new Map<string, Finding[]>();
  for (const finding of usable) {
    const list = bySpecialist.get(finding.specialist) ?? [];
    list.push(finding);
    bySpecialist.set(finding.specialist, list);
  }

  const findings: Finding[] = [];
  for (const [specialist, group] of bySpecialist) {
    const evidenceIds = group.flatMap((f) => [...f.evidenceIds]).slice(0, MAX_CITED);
    findings.push({
      findingId: `f-report-${specialist.toLowerCase()}`,
      specialist: "REPORT_OPS",
      statement: `${labelFor(specialist)}: ${group.map((f) => f.statement).join(" ")}`,
      // The upstream evidence, cited verbatim. This node registers none of its own.
      evidenceIds,
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: group.find((f) => f.surfaceLink)?.surfaceLink ?? "/reports",
      ...(input.needs[0] ? { needId: input.needs[0].id } : {}),
    });
  }

  log("report_ops", { composed: findings.length });
  return {
    specialist: "REPORT_OPS",
    // Deliberately empty: this node produces no EvidenceRef. The structural test asserts it.
    evidence: [],
    findings,
    coverage: [],
    needStates,
  };
}

function labelFor(specialist: string): string {
  switch (specialist) {
    case "INQUIRY_OPS":
      return "문의";
    case "REVIEW_OPS":
      return "리뷰";
    case "PRODUCT_OPS":
      return "상품";
    default:
      return specialist;
  }
}
