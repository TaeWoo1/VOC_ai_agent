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
import { eventRange, temporalDemandOf } from "../scope/EvidenceTime";
import type { GroupedProducts, IssueSlice } from "../group/ProductGrouping";
import { groupByProduct, namedRows } from "../group/ProductGrouping";
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

/**
 * How many issues a GROUPED answer opens, and how many products it then states.
 *
 * <b>Scanned largest-first, and the difference is measured.</b> The demo org holds 19 live issues over
 * 85 evidence rows; the eight largest carry 71 of them (84%), the eight most severe carry 44 (52%).
 * Reading the biggest first buys the most attribution per call — and the number that is DISCLOSED is
 * the coverage, not the rank, so a bounded scan can never read as a complete ranking.
 */
const GROUP_SCAN_LIMIT = 8;
const GROUP_STATE_LIMIT = 5;

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
  // <b>Do not re-buy what the run already proved, and never re-say it in weaker words.</b> When
  // ProductOps has resolved the product it also read that product's OWN issue list — selected by the
  // backend from the product's evidence rows, so complete rather than capped. This specialist's product
  // path is the same question answered from the org side with a bounded sweep: it costs up to six reads
  // and can only produce a smaller, hedged version of a sentence the run already holds. Measured live
  // 2026-08-23 on the canonical Q4: the seller was told "심각한 6건을 확인했지만 … 나머지는 확인하지
  // 않았습니다" while the run held a complete, COVERED zero (defects C3/C4). The precedence is by
  // EVIDENCE, not by specialist name — nothing is skipped unless the proof is actually there.
  const resolvedProduct = input.resolved.find((e) => e.kind === "PRODUCT");
  if (resolvedProduct && alreadyAttributed(input.priorEvidence, resolvedProduct.id)) {
    log("review_ops", { needs: input.needs.length, scope: "PRODUCT", terminal: "OK", skipped: "ALREADY_ATTRIBUTED" });
    return {
      specialist: "REVIEW_OPS",
      failures: [],
      terminal: "OK" as const,
      findings: [],
      evidence: [],
      coverage: [],
      // PENDING, deliberately: this specialist settled nothing, and the merge in `plan/needOutcome.ts`
      // is what keeps the stronger outcome. Claiming a status here would be claiming a read.
      needStates: input.needs.map((n) => ({ id: n.id, status: "PENDING" as const, evidenceIds: [] })),
    };
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

  // <b>The seller asked WHICH products.</b> The issue list answers "which problems" and cannot be made
  // to answer the other question by being read more carefully — every count on it is the issue's,
  // across the whole org. The grouped path opens the biggest issues and reads whose rows they are, so
  // the answer is ranked by a product's own number. No resolver is involved: the ids come out of the
  // evidence (C5). The org brief below still runs on the same list, so nothing that used to be said
  // stops being said.
  const grouped = input.grouping === "PRODUCT"
    ? await groupAcrossProducts(input, issues)
    : null;

  const findings: Finding[] = [...(grouped?.findings ?? [])];
  const refs: EvidenceRef[] = [...(grouped?.evidence ?? [])];
  // One read serves every REVIEW_SIGNAL need the plan declared — the issue list is the same list for
  // all of them, and paying for it once per need would spend budget on identical rows.
  const needId = input.needs[0]!.id;
  const cited: string[] = [...(grouped?.cited ?? [])];
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

  const note = noteOf(issues, grouped);
  log("review_ops", {
    issues: issues.length, surfaced: findings.length, needs: input.needs.length,
    grouping: input.grouping, groupedProducts: grouped?.rows ?? 0,
    scanned: grouped?.checked ?? 0, terminal: "OK",
  });
  return {
    specialist: "REVIEW_OPS",
    failures: grouped?.failures ?? [],
    terminal: "OK" as const,
    findings,
    evidence: refs,
    coverage: [],
    needStates: input.needs.map((n) => ({
      id: n.id,
      status: cited.length > 0 ? ("SATISFIED" as const) : ("UNSATISFIABLE" as const),
      evidenceIds: cited,
      coverage: "COVERED" as const,
      // The org list is read whole; only the BRIEF is capped, and what is cited is what was said. A
      // grouped answer is complete only when its scan reached every issue — six of nineteen is not a
      // ranking of nineteen, and the merge must be able to see that without reading the sentence.
      complete: grouped ? grouped.checked >= issues.length : issues.length <= DEFAULT_LIMIT,
      settledBy: "REVIEW_OPS" as const,
      ...(cited.length === 0 ? { reason: "지금 확인이 필요한 반복 리뷰 문제가 없습니다." } : {}),
    })),
    ...(note ? { note } : {}),
  };
}

/** The note this specialist adds: what the grouped scan left unread, or that there is nothing to read. */
function noteOf(issues: readonly ReviewIssueSummary[], grouped: GroupedAnswer | null): string | null {
  if (issues.length === 0) {
    return "지금 확인이 필요한 반복 리뷰 문제는 없습니다.";
  }
  return grouped?.note ?? null;
}

/** What the grouped path hands back to the org brief that keeps running beside it. */
interface GroupedAnswer {
  readonly findings: readonly Finding[];
  readonly evidence: readonly EvidenceRef[];
  readonly cited: readonly string[];
  readonly failures: readonly ToolFailure[];
  readonly checked: number;
  readonly rows: number;
  readonly note: string | null;
}

/**
 * The product axis: whose rows are these?
 *
 * <b>Every number stated here is one product's own.</b> The issue's total is never a product's, the
 * org's total is never a product's, and the rank is by the product's count rather than by the order the
 * issue list happened to come in — the same rule as `attributeToProduct`, applied to a run that has no
 * product to attribute TO (C4).
 *
 * <b>What is disclosed, in the answer and not only in a log:</b> how many issues were opened out of how
 * many exist, how much of the org's evidence that reached, how many products the catalogue could not
 * name, and how many rows belong to no product at all. A bounded scan that says none of this reads as a
 * complete ranking, which is the failure this whole file argues against in its other paths.
 */
async function groupAcrossProducts(
  input: SpecialistInput,
  issues: readonly ReviewIssueSummary[],
): Promise<GroupedAnswer> {
  const { registry, budget, evidence, allowedTools } = input;
  const needId = input.needs[0]!.id;
  const findings: Finding[] = [];
  const refs: EvidenceRef[] = [];
  const cited: string[] = [];
  const failures: ToolFailure[] = [];
  const slices: IssueSlice[] = [];
  // Largest first — see GROUP_SCAN_LIMIT. `evidenceCount` is the issue's org-wide total, which is the
  // right thing to sort a SCAN by and the wrong thing to state about a product.
  const candidates = [...issues].sort((a, b) => b.evidenceCount - a.evidenceCount);
  const considered = candidates.slice(0, GROUP_SCAN_LIMIT);
  const totalEvidence = issues.reduce((sum, i) => sum + i.evidenceCount, 0);
  let checked = 0;
  let scannedEvidence = 0;
  let unattributed = 0;

  for (const issue of considered) {
    if (!budget.spend("tool")) {
      break;
    }
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
    const summary = attempt.value;
    scannedEvidence += summary.totalEvidence;
    unattributed += summary.unattributedEvidence;
    // <b>The one case where an issue's dates ARE a product's.</b> All of this issue's evidence belongs
    // to this one product, so its span is that product's span — proven, not borrowed. Any other shape
    // and the slice stays undated, which is what stops another product's recent review from proving
    // this one's "최근".
    const exclusive = summary.byProduct.length === 1 && summary.unattributedEvidence === 0;
    for (const row of summary.byProduct) {
      slices.push({
        issueId: issue.id,
        issueTitle: issue.title,
        productId: row.productId,
        productName: row.productName,
        count: row.evidenceCount,
        issueTotal: summary.totalEvidence,
        events: exclusive ? eventRange(summary.firstEvidenceOn, summary.lastEvidenceOn) : null,
      });
    }
  }

  const grouped = groupByProduct(slices, unattributed);
  for (const row of namedRows(grouped).slice(0, GROUP_STATE_LIMIT)) {
    const ref = evidence.add({
      kind: "ISSUE_EVIDENCE",
      sourceTool: OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY,
      args: { productId: row.productId, issues: row.issueIds.length },
      locator: {
        productId: row.productId,
        productName: row.label,
        count: row.count,
        label: row.topIssueTitle ?? "리뷰 문제 근거",
      },
      // Present only when every slice behind this count was exclusive. Absent is the normal case, and
      // a period question then withholds this row rather than dating it from another product's rows.
      events: row.events,
      coverage: "COVERED",
      provenance: "issue-memory/evidence-summary:by-product",
    });
    refs.push(ref);
    cited.push(ref.evidenceId);
    findings.push({
      findingId: `f-${ref.evidenceId}`,
      specialist: "REVIEW_OPS",
      // <b>"리뷰 문제 근거", not "부정 리뷰".</b> These rows are review-issue evidence: reviews that an
      // extractor tied to a repeated problem. Renaming them would answer a question about negative
      // reviews with a number that counts something else.
      statement: `${row.label}에 리뷰 문제 근거가 ${row.count}건 기록돼 있습니다`
        + (row.topIssueTitle ? ` (가장 많은 것은 "${row.topIssueTitle}" ${row.topIssueCount}건`
          + `${row.issueIds.length > 1 ? `, 확인한 문제 ${row.issueIds.length}건 합계` : ""})` : "")
        + ".",
      evidenceIds: [ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: `/products/${row.productId}`,
      needId,
    });
  }

  // The scan itself, as evidence and as a sentence. Without it a top-five list of eleven products over
  // eight of nineteen issues would read as "these are the products with review problems".
  const scanRef = evidence.add({
    kind: "ISSUE_EVIDENCE",
    sourceTool: OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY,
    args: { issuesChecked: checked, issuesOpen: issues.length, evidenceScanned: scannedEvidence },
    locator: {
      count: grouped.rows.length,
      label: "상품별로 확인한 리뷰 문제 근거",
    },
    coverage: "COVERED",
    provenance: "issue-memory/evidence-summary:grouped-scan",
  });
  refs.push(scanRef);
  findings.push({
    findingId: `f-${scanRef.evidenceId}`,
    specialist: "REVIEW_OPS",
    statement: scanSentence(
      issues.length, checked, totalEvidence, scannedEvidence, grouped,
      // How many of the rows this answer just built cannot be shown for the question that was asked.
      // The gate withholds them either way (`TEMPORAL_UNPROVEN`); what would otherwise be missing is
      // the seller being told that the axis EXISTS and that dating it is what failed.
      temporalDemandOf(input.needs[0]!.kind, input.periodNamed) === "PERIOD_EVENTS"
        ? grouped.rows.filter((r) => r.events == null).length
        : 0,
    ),
    evidenceIds: [scanRef.evidenceId],
    confidence: "NEEDS_REVIEW",
    verdict: null,
    surfaceLink: null,
    // It is a statement about what this answer could and could not see — the coverage claim itself.
    claimsCoverageLimit: true,
    needId,
  });

  log("review_ops_grouped", {
    dimension: "PRODUCT", issues: issues.length, checked,
    products: grouped.rows.length, unnamed: grouped.unnamed.products, unattributed,
    dated: grouped.rows.filter((r) => r.events != null).length,
  });
  return {
    findings,
    evidence: refs,
    cited,
    failures,
    checked,
    rows: grouped.rows.length,
    note: checked < issues.length
      ? `상품별 집계는 열려 있는 반복 리뷰 문제 ${issues.length}건 중 ${checked}건만 확인한 결과입니다.`
      : null,
  };
}

/** What the grouped scan saw and did not see, in one sentence the seller can act on. */
function scanSentence(
  open: number, checked: number, totalEvidence: number, scannedEvidence: number,
  grouped: GroupedProducts, undatable: number,
): string {
  const head = checked >= open
    ? `열려 있는 반복 리뷰 문제 ${open}건을 모두 확인해 상품 ${grouped.rows.length}개로 나눴습니다.`
    : `열려 있는 반복 리뷰 문제 ${open}건 가운데 근거가 많은 ${checked}건`
      + `(전체 근거 ${totalEvidence}건 중 ${scannedEvidence}건)을 확인해 상품 ${grouped.rows.length}개로 `
      + "나눴습니다. 나머지는 확인하지 않았으므로 전체 순위가 아닙니다.";
  const tail: string[] = [];
  if (grouped.unnamed.products > 0) {
    tail.push(`상품명을 확인할 수 없는 ${grouped.unnamed.products}개 상품의 ${grouped.unnamed.count}건은 `
      + "이름 없이 남겨 두었습니다.");
  }
  if (grouped.unattributed > 0) {
    tail.push(`어느 상품에도 연결되지 않은 근거가 ${grouped.unattributed}건 있습니다.`);
  }
  if (undatable > 0) {
    // <b>The honest shape of today's limit.</b> The per-product split carries counts and no dates, so
    // for a question about a period there is nothing to prove WHEN those rows happened — except where
    // an issue's evidence belongs to one product alone. Borrowing the issue's span would let another
    // product's recent review date this one's rows, so the rows are withheld and this says so.
    tail.push(`이 가운데 ${undatable}개 상품은 근거가 언제 발생했는지 확인할 수 없어, `
      + "기간을 묻는 이 질문의 답으로는 상품별 수치를 제시하지 않았습니다.");
  }
  return [head, ...tail].join(" ");
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
      coverage: "COVERED" as const,
      // <b>The axis that stops this sweep speaking over a complete read.</b> Six of nineteen is not a
      // verdict on nineteen, and the merge needs to be able to see that without reading the sentence.
      complete: checked >= issues.length,
      settledBy: "REVIEW_OPS" as const,
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

/**
 * Does the run already hold a product-scoped issue answer for this product?
 *
 * Reads the evidence, not the specialist list: a run where ProductOps was dispatched but could not
 * resolve, or ran out of budget before its issue reads, has proven nothing — and this specialist is
 * then the only path there is.
 */
function alreadyAttributed(
  priorEvidence: readonly EvidenceRef[] | undefined, productId: string,
): boolean {
  return (priorEvidence ?? []).some(
    (e) => e.kind === "ISSUE_EVIDENCE" && e.locator.productId === productId,
  );
}
