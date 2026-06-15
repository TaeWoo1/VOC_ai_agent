// Pure view helpers for the Product Issues page. No React, no I/O — every value is
// derived by joining the Inbox feed to stored item analyses, exactly the way the
// Inbox card does. Kept out of the page component so the type checker covers these
// shapes (the frontend has no unit-test runner).
//
// This page is read-only and frames everything as 이슈 후보 / 운영 신호 — never an
// AI diagnosis (the only analyzer is rule-based). It shows no raw body, only the
// already-masked FeedItem.snippet.
import type { FeedItem, ItemAnalysis } from "./types";
import { analysisKey, buildAnalysisIndex, type ChipTone } from "./inboxView";

/** A product's count of related signals at/above which it reads as a repeated
 *  (반복/누적) pattern rather than a one-off. */
export const REPEAT_THRESHOLD = 2;

export interface JoinedItem {
  item: FeedItem;
  analysis: ItemAnalysis;
}

// recommendedAction vocabulary, fixed by RuleBasedInboxItemAnalyzer. Order is the
// display/severity priority used to pick a product's single "top" action.
export const ISSUE_ACTIONS = [
  "상세페이지 개선 후보",
  "답변 필요",
  "FAQ 후보",
  "확인 필요",
] as const;

export const ACTION_TONE: Record<string, ChipTone> = {
  "상세페이지 개선 후보": "bad",
  "답변 필요": "warn",
  "FAQ 후보": "neutral",
  "확인 필요": "neutral",
};

function actionPriority(action: string): number {
  const i = (ISSUE_ACTIONS as readonly string[]).indexOf(action);
  return i === -1 ? ISSUE_ACTIONS.length : i;
}

/** How strongly one joined item signals attention — used to order example
 *  snippets (negative / high-urgency / unanswered first). */
function signalWeight(j: JoinedItem): number {
  let w = 0;
  if (j.analysis.sentiment === "NEGATIVE") {
    w += 2;
  }
  if (j.analysis.urgency === "HIGH") {
    w += 2;
  }
  if (j.item.type === "INQUIRY" && j.item.status === "UNANSWERED") {
    w += 1;
  }
  return w;
}

export interface ProductIssueCandidate {
  productName: string;
  relatedCount: number;
  dominantCategories: string[];
  categoryCounts: Record<string, number>;
  actionCounts: Record<string, number>;
  negativeCount: number;
  highUrgencyCount: number;
  unansweredCount: number;
  topAction: string;
  exampleSnippets: string[];
  severity: number;
  joined: JoinedItem[];
}

/** Join inbox items to their stored analyses, group per product, and rank by
 *  signal strength. Only inbox items that HAVE an analysis contribute — analyses
 *  for items outside the inbox window have no product name to group by. */
export function buildIssueCandidates(
  items: FeedItem[],
  analyses: ItemAnalysis[],
): ProductIssueCandidate[] {
  const index = buildAnalysisIndex(analyses);
  const byProduct = new Map<string, JoinedItem[]>();
  for (const item of items) {
    const analysis = index.get(analysisKey(item.type, item.id));
    if (!analysis) {
      continue;
    }
    const list = byProduct.get(item.productName) ?? [];
    list.push({ item, analysis });
    byProduct.set(item.productName, list);
  }

  const candidates: ProductIssueCandidate[] = [];
  for (const [productName, joined] of byProduct) {
    const categoryCounts: Record<string, number> = {};
    const actionCounts: Record<string, number> = {};
    let negativeCount = 0;
    let highUrgencyCount = 0;
    let unansweredCount = 0;
    for (const { item, analysis } of joined) {
      categoryCounts[analysis.category] = (categoryCounts[analysis.category] ?? 0) + 1;
      actionCounts[analysis.recommendedAction] =
        (actionCounts[analysis.recommendedAction] ?? 0) + 1;
      if (analysis.sentiment === "NEGATIVE") {
        negativeCount += 1;
      }
      if (analysis.urgency === "HIGH") {
        highUrgencyCount += 1;
      }
      if (item.type === "INQUIRY" && item.status === "UNANSWERED") {
        unansweredCount += 1;
      }
    }

    const dominantCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([c]) => c);
    const topAction =
      Object.keys(actionCounts).sort((a, b) => actionPriority(a) - actionPriority(b))[0] ??
      "확인 필요";
    const exampleSnippets = [...joined]
      .sort((a, b) => signalWeight(b) - signalWeight(a))
      .map((j) => j.item.snippet)
      .filter((s) => Boolean(s && s.trim()))
      .slice(0, 3);
    const severity =
      negativeCount * 2 + highUrgencyCount * 2 + unansweredCount + joined.length;

    candidates.push({
      productName,
      relatedCount: joined.length,
      dominantCategories,
      categoryCounts,
      actionCounts,
      negativeCount,
      highUrgencyCount,
      unansweredCount,
      topAction,
      exampleSnippets,
      severity,
      joined,
    });
  }

  return candidates.sort(
    (a, b) => b.severity - a.severity || b.relatedCount - a.relatedCount,
  );
}

export interface IssuesSummary {
  candidateCount: number;
  attentionProductCount: number;
  detailPageCandidateCount: number;
  faqCandidateCount: number;
}

/** The four summary-card numbers, computed across all candidates. */
export function issuesSummary(candidates: ProductIssueCandidate[]): IssuesSummary {
  let attentionProductCount = 0;
  let detailPageCandidateCount = 0;
  let faqCandidateCount = 0;
  for (const c of candidates) {
    if (c.negativeCount > 0 || c.highUrgencyCount > 0) {
      attentionProductCount += 1;
    }
    detailPageCandidateCount += c.actionCounts["상세페이지 개선 후보"] ?? 0;
    faqCandidateCount += c.actionCounts["FAQ 후보"] ?? 0;
  }
  return {
    candidateCount: candidates.length,
    attentionProductCount,
    detailPageCandidateCount,
    faqCandidateCount,
  };
}

export interface IssueFilter {
  product: string | null;
  category: string | null;
  action: string | null;
}

/** Does a candidate belong under the active filters? null = no filter on that axis.
 *  Category/action match when the product has at least one item of that kind. */
export function candidateMatches(c: ProductIssueCandidate, f: IssueFilter): boolean {
  if (f.product && c.productName !== f.product) {
    return false;
  }
  if (f.category && !(f.category in c.categoryCounts)) {
    return false;
  }
  if (f.action && !(f.action in c.actionCounts)) {
    return false;
  }
  return true;
}

/** Distinct category values present across candidates, most-common first. */
export function presentCategories(candidates: ProductIssueCandidate[]): string[] {
  const totals: Record<string, number> = {};
  for (const c of candidates) {
    for (const [cat, n] of Object.entries(c.categoryCounts)) {
      totals[cat] = (totals[cat] ?? 0) + n;
    }
  }
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat);
}

/** recommendedAction values present across candidates, in fixed priority order. */
export function presentActions(candidates: ProductIssueCandidate[]): string[] {
  const present = new Set<string>();
  for (const c of candidates) {
    for (const a of Object.keys(c.actionCounts)) {
      present.add(a);
    }
  }
  return (ISSUE_ACTIONS as readonly string[]).filter((a) => present.has(a));
}
