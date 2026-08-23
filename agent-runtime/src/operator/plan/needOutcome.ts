/**
 * Which of two outcomes for one information need is the one the run keeps.
 *
 * <b>Why a merge rule and not an assignment.</b> Two specialists routinely answer the same need: the
 * plan's need kinds overlap by design (`REVIEW_SIGNAL` belongs to ProductOps AND ReviewOps,
 * `INQUIRY_VOLUME` to ProductOps AND InquiryOps), and a second pass answers again. Until 2026-08-23 the
 * last writer won. Measured live on the canonical Q4: ProductOps resolved the product, read its signals
 * through a source whose coverage was `COVERED`, and established that the product had zero issue
 * evidence — a measured zero, complete, product-scoped. ReviewOps then swept six of nineteen org issues,
 * found nothing attributable, and overwrote that need with its own weaker verdict. The seller was told
 * "심각한 6건을 확인했지만 … 나머지는 확인하지 않았습니다" when the run in fact held a complete answer.
 *
 * <b>Strength, in order, and nothing else.</b> Status first (an answer beats no answer), then coverage
 * (a source that could see the scope beats one that could not), then completeness (a whole read beats a
 * capped one). Ties keep the INCUMBENT — the merge never overwrites without a reason, which is precisely
 * what "remove last-writer-wins" means.
 *
 * <b>What it must never do is promote silence to calm.</b> Nothing here turns a PENDING into a
 * SATISFIED, and nothing invents a coverage value: a need whose read never happened stays the weakest
 * thing in the room. "문제 없음" survives a merge only when some specialist actually proved it under
 * `COVERED`, which is the rule `docs/sellerops_operator_graph_v2.md` §2.1 already applies to evidence.
 */
import type { NeedState } from "./InvestigationPlan";

/** An answered need beats an unanswerable one; both beat one nobody reached. */
const STATUS_RANK: Record<NeedState["status"], number> = {
  SATISFIED: 2,
  UNSATISFIABLE: 1,
  PENDING: 0,
};

/**
 * A source that could see the scope beats one that could not.
 *
 * An ABSENT value sits between them on purpose: a specialist that does not report coverage has not
 * claimed it could see everything, and it has not admitted a blind spot either. Ranking it with the
 * blind spots would let any coverage-reporting specialist overwrite it; ranking it with `COVERED` would
 * be this file inventing the guarantee.
 */
function coverageRank(state: NeedState): number {
  if (state.coverage === undefined) return 1;
  return state.coverage === "COVERED" ? 2 : 0;
}

/** A whole read beats a bounded one. Unstated completeness is treated as bounded — the safe direction. */
function completeRank(state: NeedState): number {
  return state.complete === true ? 1 : 0;
}

/** The three axes as one comparable tuple, strongest last. */
function strength(state: NeedState): [number, number, number] {
  return [STATUS_RANK[state.status], coverageRank(state), completeRank(state)];
}

/** True when `next` is strictly stronger than `prev` on the first axis that differs. */
export function isStronger(next: NeedState, prev: NeedState): boolean {
  const a = strength(next);
  const b = strength(prev);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

/**
 * Fold one new outcome into what the run already had for that need.
 *
 * The loser is dropped whole rather than field-merged: a `reason` belongs to the read that produced it,
 * and pairing the winner's status with the loser's sentence would describe a read that never happened.
 */
export function mergeNeedState(prev: NeedState | undefined, next: NeedState): NeedState {
  if (!prev) return next;
  return isStronger(next, prev) ? next : prev;
}
