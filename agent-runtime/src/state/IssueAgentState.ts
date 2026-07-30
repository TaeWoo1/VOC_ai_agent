/**
 * The issue-memory subgraph's shared state (a LangGraph `Annotation.Root`).
 *
 * <b>No customer text lives here — none is ever fetched.</b> Every channel holds only what the
 * quote-free issue reads return: closed-vocabulary labels, aggregate counts, enum states, ISO
 * dates, and ids. There is no checkpoint on this path (the subgraph runs read → prioritize →
 * assemble → compose → DONE with no human interrupt), so the whole state is safe to persist and
 * log, and a re-run over the same backend state + reference date reproduces it byte-for-byte.
 */
import { Annotation } from "@langchain/langgraph";
import type { AgentGoal } from "../goal/parseGoal";
import type { RankedIssue } from "../prioritize/prioritizeIssues";
import type {
  IssueChangeInfo,
  IssueProductEvidence,
  IssueRatingDistribution,
  ReviewIssueSummary,
} from "../spring/types";

/** The sanitized evidence roll-up carried into a brief entry (no review id, no quote). */
export interface BriefEvidenceSummary {
  readonly totalEvidence: number;
  readonly byProduct: IssueProductEvidence[];
  readonly unattributedEvidence: number;
  readonly ratingDistribution: IssueRatingDistribution;
}

/**
 * One issue in the operations brief. Exactly the allowlisted fields: issue id, product id (+ name),
 * category (aspect/problem/title — closed vocabulary), severity, counts, trend, and a sanitized
 * evidence summary — plus its priority placement and a coarse lifecycle-history depth. No prose.
 */
export interface IssueBriefEntry {
  readonly issueId: string;
  readonly rank: number;
  readonly priorityBucket: string;
  readonly title: string;
  readonly aspect: string;
  readonly problem: string;
  readonly severity: string;
  readonly lifecycleState: string;
  readonly lifecycleLabelKo: string;
  readonly evidenceCount: number;
  readonly firstEvidenceOn: string | null;
  readonly lastEvidenceOn: string | null;
  readonly dominantProductId: string | null;
  readonly dominantProductName: string | null;
  readonly trend: IssueChangeInfo;
  readonly evidenceSummary: BriefEvidenceSummary;
  /** Number of recorded lifecycle transitions (a coarse signal; carries no note text). */
  readonly lifecycleHistoryDepth: number;
}

/**
 * The terminal, structured operations brief — the DONE outcome of an issue-memory run.
 * Deterministic for a fixed (backend state, referenceDate): re-running, in the same process or a
 * fresh one, produces an identical brief.
 */
export interface IssueOperationsBrief {
  readonly referenceDate: string | null;
  readonly totalActiveIssues: number;
  readonly selectedCount: number;
  readonly entries: IssueBriefEntry[];
  readonly note?: string;
}

export const IssueAgentStateAnnotation = Annotation.Root({
  goal: Annotation<AgentGoal | null>({ reducer: (_p, n) => n, default: () => null }),
  referenceDate: Annotation<string | null>({ reducer: (_p, n) => n, default: () => null }),
  issues: Annotation<ReviewIssueSummary[]>({ reducer: (_p, n) => n, default: () => [] }),
  ranked: Annotation<RankedIssue[]>({ reducer: (_p, n) => n, default: () => [] }),
  selected: Annotation<RankedIssue[]>({ reducer: (_p, n) => n, default: () => [] }),
  entries: Annotation<IssueBriefEntry[]>({ reducer: (_p, n) => n, default: () => [] }),
  brief: Annotation<IssueOperationsBrief | null>({ reducer: (_p, n) => n, default: () => null }),
  trail: Annotation<string[]>({ reducer: (p, n) => [...p, ...n], default: () => [] }),
});

export type IssueAgentState = typeof IssueAgentStateAnnotation.State;
