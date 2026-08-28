/**
 * What every specialist receives — and, in v2, what it is allowed to decide.
 *
 * <b>A specialist no longer owns an order.</b> v1's specialists ran fixed sequences: InquiryOps always
 * read the inbox and then the repeats, ProductOps always resolved and then read signals. That is why
 * "폭이 몇 mm인가요?" and "교환 가능한가요?" produced identical investigations — the plan chose WHICH
 * specialist, and the specialist chose everything else. v2 passes {@link needs} in the planner's own
 * order, and a specialist runs one step per need. What it still owns is HOW to satisfy a need it
 * understands; what it no longer owns is whether that need was worth pursuing.
 *
 * <b>`allowedTools` is authorization, not a work list.</b> The registry refuses anything outside it.
 */
import type { EvidenceBuilder } from "../state/evidence";
import type { OperatorToolRegistry } from "../tools/OperatorToolRegistry";
import type { OperatorBudget } from "../budget/OperatorBudget";
import type { InformationNeed, ResolvedEntity } from "../plan/InvestigationPlan";
import type { EvidenceRef } from "../state/OperatorState";
import type { GroupingDimension } from "../group/ProductGrouping";
import type { PlanFilters, PlanTarget, RequestedAction } from "../plan/InvestigationPlan";
import type { ProgressStage, WorkingSetView } from "../../conversation/contract";
import type { LocalAgentHint } from "../capability/ChannelCapability";
import type { ReviewRefresher } from "./reviewRefresh";

export interface SpecialistInput {
  readonly registry: OperatorToolRegistry;
  readonly budget: OperatorBudget;
  readonly evidence: EvidenceBuilder;
  readonly allowedTools: readonly string[];
  /** This specialist's needs, in the plan's retrieval order. Empty ⇒ it contributes nothing. */
  readonly needs: readonly InformationNeed[];
  /** Mentions the plan left unresolved, by kind. A specialist resolves them with a tool, never a guess. */
  readonly mentions: readonly string[];
  /** Entities already resolved this run, so a second pass does not re-resolve and re-charge. */
  readonly resolved: readonly ResolvedEntity[];
  /**
   * The axis this answer is grouped along — a property of the RUN, decided once in
   * `group/ProductGrouping.ts` and passed here so no specialist re-derives it from the sentence.
   *
   * It is not a scope. `PRODUCT` means the seller asked WHICH products, and the run stays org-scoped
   * while the ANSWER is grouped; a run about one product has `NONE` whatever words the goal contains.
   */
  readonly grouping: GroupingDimension;
  /**
   * Whether the seller named a period — the one half of the temporal demand a specialist cannot see.
   *
   * <b>Passed, not derived.</b> A specialist needs it only to SAY what it could not date; the gate
   * still decides what is withheld (`scope/EvidenceScope.checkEvidence`), and the two read the same
   * flag from the same place.
   */
  readonly periodNamed: boolean;
  /**
   * The single channel this run is scoped to, or null — decided once, in `scope/EvidenceScope.ts`.
   *
   * <b>A scope, never an axis.</b> `channelScope: "NAVER"` means the seller asked about NAVER and the
   * answer must be about NAVER only; asking for a per-channel BREAKDOWN is
   * {@link GroupingDimension} carrying `CHANNEL`, and the two are answered by different shapes. A run
   * can have both — "네이버 상품별" — and neither implies the other.
   */
  readonly channelScope: string | null;
  /**
   * Evidence the run already holds, from earlier specialists and earlier passes.
   *
   * <b>The same idea as {@link resolved}, one level up: do not re-buy a fact the run has.</b> It is
   * refs only — ids, counts, closed labels, coverage — so a specialist reading it learns nothing it
   * could not have minted itself. What it is FOR is precedence: when an earlier specialist has already
   * proven something product-scoped and complete, a later one with a weaker, bounded read of the same
   * thing has nothing to add, and adding it anyway prints two answers to one question (C3).
   */
  /**
   * The planner's own restatement of the goal.
   *
   * <b>A fallback, never the authority.</b> `goalText` is what the seller wrote; this is what the
   * planner wrote about it. Where the two could disagree about the MEANING of the answer — which
   * review evidence a question is asking for, `group/ReviewEvidenceSense.ts` — the seller's sentence
   * wins and this is read only when there is no sentence to read.
   */
  readonly plannerGoal?: string;
  readonly priorEvidence?: readonly EvidenceRef[];
  readonly referenceDate?: string;
  readonly goalText?: string;
  /* ── Agentic Operating Workspace v2 — the conversation axis, decided by the PLANNER, read here. ── */
  /**
   * The plan's closed filters (period / rating / channel / scope / topic).
   *
   * <b>Read, never derived from the sentence.</b> Whether a review question wants ROWS or the issue
   * signal is a planner decision expressed in these tokens; a specialist that keyword-matched the goal
   * to decide would be the second planner invariant I2 forbids.
   */
  readonly filters?: PlanFilters;
  readonly target?: PlanTarget;
  readonly requestedAction?: RequestedAction;
  /** What the previous turn put in front of the seller — ids and closed filters. Null on a first turn. */
  readonly workingSet?: WorkingSetView | null;
  /** Human collections this conversation saw finish — see `ConversationRunContext.collected`. */
  /** See `ConversationRunContext.pendingHumanWindow`. */
  readonly pendingHumanWindow?: string | null;
  readonly collected?: ReadonlyArray<{ readonly channelCode: string; readonly dataType: string; readonly finishedAt: string; readonly successRows?: number | null; readonly partial?: boolean }>;
  /** Whether the seller's local agent is paired (frontend hint). Absent ⇒ UNKNOWN. */
  readonly localAgent?: LocalAgentHint;
  /**
   * The conversation lane's bounded refresh seam (`conversation/Refresher.ts`), present only on a
   * conversation run. NOT a tool: the planner cannot select it, the registry does not hold it, and the
   * rows path calls it at most once per stale AUTOMATIC channel (`reviewRows.ts`).
   */
  readonly refresher?: ReviewRefresher;
  /** The conversation lane's stage sink, so a refresh can say 「…새로 가져오고 있습니다」 while it runs. */
  readonly progress?: (stage: ProgressStage, label: string) => void;
}
