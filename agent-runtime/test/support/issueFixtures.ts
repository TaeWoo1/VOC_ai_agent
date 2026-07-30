/**
 * Deterministic issue-memory fixtures. Every field is a closed-vocabulary label, an enum, a count,
 * or an id — there is NO customer text here, because the issue endpoints carry none.
 *
 * The four issues below span severities and trends so the prioritization order is unambiguous:
 * severity first (HIGH → NORMAL → LOW), then fired-vs-quiet, then high-surge. The expected
 * worst-first order is therefore HIGH-quiet, NORMAL-surging, NORMAL-concentrated, LOW-surging.
 */
import type {
  IssueChangeInfo,
  IssueEvidenceSummary,
  IssueTransition,
  ReviewIssueSummary,
} from "../../src/spring/types";

export const ISSUE_HIGH_QUIET = "11111111-1111-1111-1111-111111111111";
export const ISSUE_NORMAL_SURGING = "44444444-4444-4444-4444-444444444444";
export const ISSUE_NORMAL_CONCENTRATED = "33333333-3333-3333-3333-333333333333";
export const ISSUE_LOW_SURGING = "22222222-2222-2222-2222-222222222222";

/** The unambiguous worst-first order the prioritizer must produce over {@link fourIssues}. */
export const EXPECTED_PRIORITY_ORDER = [
  ISSUE_HIGH_QUIET,
  ISSUE_NORMAL_SURGING,
  ISSUE_NORMAL_CONCENTRATED,
  ISSUE_LOW_SURGING,
];

const noChange: IssueChangeInfo = {
  kinds: [],
  labelsKo: [],
  highSurge: false,
  surgeWindowCount: 0,
  surgeBaselineWeekly: 0,
};

function change(partial: Partial<IssueChangeInfo>): IssueChangeInfo {
  return { ...noChange, ...partial };
}

export interface MakeIssueOpts {
  readonly severity: string;
  readonly change?: IssueChangeInfo;
  readonly lastEvidenceOn?: string | null;
  readonly firstEvidenceOn?: string | null;
  readonly evidenceCount?: number;
  readonly dominantProductId?: string | null;
  readonly dominantProductName?: string | null;
  readonly lifecycleState?: string;
  readonly dismissed?: boolean;
  readonly aspect?: string;
  readonly problem?: string;
}

export function makeIssue(id: string, o: MakeIssueOpts): ReviewIssueSummary {
  const aspect = o.aspect ?? "배송";
  const problem = o.problem ?? "지연";
  const lifecycleState = o.lifecycleState ?? "OBSERVING";
  const labelKo: Record<string, string> = {
    OBSERVING: "관찰 중",
    NEEDS_REVIEW: "확인 필요",
    ACTING: "조치 중",
    VERIFYING: "개선 확인 중",
    RESOLVED: "해결됨",
  };
  return {
    id,
    title: `${aspect} ${problem}`,
    aspect,
    problem,
    severity: o.severity,
    lifecycleState,
    lifecycleLabelKo: labelKo[lifecycleState] ?? "관찰 중",
    evidenceCount: o.evidenceCount ?? 3,
    firstEvidenceOn: o.firstEvidenceOn ?? "2026-06-01",
    lastEvidenceOn: o.lastEvidenceOn ?? "2026-07-20",
    dominantProductId: o.dominantProductId ?? null,
    dominantProductName: o.dominantProductName ?? null,
    dismissed: o.dismissed ?? false,
    extractorKind: "RULE_BASED",
    change: o.change ?? noChange,
  };
}

export function fourIssues(): ReviewIssueSummary[] {
  return [
    // Intentionally NOT in priority order, to prove the prioritizer reorders.
    makeIssue(ISSUE_LOW_SURGING, {
      severity: "LOW",
      aspect: "설치",
      problem: "난이도",
      change: change({ kinds: ["SURGING"], labelsKo: ["증가 중"], highSurge: true, surgeWindowCount: 9, surgeBaselineWeekly: 1.2 }),
      lastEvidenceOn: "2026-07-25",
    }),
    makeIssue(ISSUE_HIGH_QUIET, {
      severity: "HIGH",
      aspect: "포장",
      problem: "파손",
      change: noChange,
      lastEvidenceOn: "2026-05-10",
    }),
    makeIssue(ISSUE_NORMAL_CONCENTRATED, {
      severity: "NORMAL",
      change: change({ kinds: ["CONCENTRATED"], labelsKo: ["특정 상품 집중"], highSurge: false }),
      dominantProductId: "aaaaaaaa-0000-0000-0000-000000000001",
      dominantProductName: "몰딩 화이트 10m",
      lastEvidenceOn: "2026-07-22",
    }),
    makeIssue(ISSUE_NORMAL_SURGING, {
      severity: "NORMAL",
      change: change({ kinds: ["SURGING"], labelsKo: ["증가 중"], highSurge: true, surgeWindowCount: 5, surgeBaselineWeekly: 0.8 }),
      lastEvidenceOn: "2026-07-24",
    }),
  ];
}

export function historyFor(_id: string): IssueTransition[] {
  return [
    { fromState: null, toState: "OBSERVING", toStateLabelKo: "관찰 중", actor: "SYSTEM", reason: "CREATED", at: "2026-06-01T00:00:00Z" },
    { fromState: "OBSERVING", toState: "NEEDS_REVIEW", toStateLabelKo: "확인 필요", actor: "SYSTEM", reason: "NEW", at: "2026-07-20T00:00:00Z" },
  ];
}

export function evidenceSummaryFor(issue: ReviewIssueSummary): IssueEvidenceSummary {
  const total = issue.evidenceCount;
  const byProduct = issue.dominantProductId
    ? [{ productId: issue.dominantProductId, productName: issue.dominantProductName, evidenceCount: total }]
    : [];
  const unattributed = issue.dominantProductId ? 0 : total;
  return {
    totalEvidence: total,
    byProduct,
    unattributedEvidence: unattributed,
    ratingDistribution: { rating1: total, rating2: 0, rating3: 0, rating4: 0, rating5: 0, unrated: 0 },
    firstEvidenceOn: issue.firstEvidenceOn,
    lastEvidenceOn: issue.lastEvidenceOn,
  };
}
