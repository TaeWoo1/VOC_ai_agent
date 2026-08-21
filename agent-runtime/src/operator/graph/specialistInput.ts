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
  readonly referenceDate?: string;
  readonly goalText?: string;
}
