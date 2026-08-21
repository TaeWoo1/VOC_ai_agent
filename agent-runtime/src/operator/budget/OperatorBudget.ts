/**
 * The Operator's bounded budget, and what happens when it runs out.
 *
 * <b>Exhaustion is a terminal state, not an error.</b> A run that hits a limit returns the findings and
 * evidence it already has, with `stopReason: "BUDGET_EXHAUSTED"` and a note naming what was not
 * reached. Throwing would discard work the seller could have used; returning silently would print a
 * partial answer that looks complete — the failure this repository has already paid for once, when a
 * report counted unanswered inquiries off a 50-row page and printed the number under the same label
 * the home screen used for the real one.
 *
 * <b>The clock is injected.</b> A deadline needs `now()`, and a graph that reads the wall clock
 * directly is a graph whose runs cannot be replayed. The default is the real clock; tests pass a
 * fake one and get a deterministic run.
 */

import type { OperatorStopReason } from "../state/OperatorState";

export interface OperatorBudgetLimits {
  readonly maxIterations: number;
  readonly maxToolCalls: number;
  readonly maxLlmCalls: number;
  readonly deadlineMs: number;
}

/**
 * v2 limits.
 *
 * <b>v1's numbers were sized for fixed sequences and are too small for planned ones.</b> They came from
 * the four demo goals: the widest read four sources and judged a handful of findings, well inside 12
 * tool calls and 6 model calls. A v2 plan declares its own information needs, and a real model asked
 * about a colour discrepancy declared FOUR — listing, product facts, review signal, past responses —
 * across three specialists. Measured live 2026-08-21 at the v1 numbers: that run exhausted its budget
 * with two needs still pending, and reported so honestly rather than pretending.
 *
 * The deadline grows with them: a reasoning model takes tens of seconds to produce a plan, and three
 * specialists' reads follow it. 60s was a limit on the model, not on the work.
 *
 * These are still BOUNDS, not targets. Exhaustion remains a terminal state that returns what it has and
 * says what it did not reach.
 */
export const OPERATOR_BUDGET_V1: OperatorBudgetLimits = {
  maxIterations: 3,
  maxToolCalls: 24,
  maxLlmCalls: 12,
  deadlineMs: 180_000,
};

export type BudgetKind = "tool" | "llm";

/**
 * A run's spend, counted as it happens.
 *
 * Every counter is checked BEFORE the call it guards, never after: a budget enforced afterwards has
 * already paid for the thing it was meant to prevent.
 */
export class OperatorBudget {
  private iterations = 0;
  private toolCalls = 0;
  private llmCalls = 0;
  private exhausted = false;
  private readonly startedAt: number;

  private readonly limitValues: OperatorBudgetLimits;

  constructor(
    limits: OperatorBudgetLimits = OPERATOR_BUDGET_V1,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.limitValues = limits;
    this.startedAt = now();
  }

  /**
   * The system's own ceilings — what a plan's `stoppingCriteria` may lower but never raise.
   *
   * Exposed rather than duplicated in the validator: two copies of a budget are two budgets, and the
   * first symptom would be a plan allowed to ask for more than the runtime will actually pay for.
   */
  limits(): OperatorBudgetLimits {
    return this.limitValues;
  }

  /** True while another plan→dispatch→judge cycle is allowed. */
  canIterate(): boolean {
    return !this.exhausted && this.iterations < this.limitValues.maxIterations && !this.pastDeadline();
  }

  /** Count one cycle. Returns false when the cycle must not start. */
  beginIteration(): boolean {
    if (!this.canIterate()) {
      this.exhausted = true;
      return false;
    }
    this.iterations += 1;
    return true;
  }

  /** Whether one more call of this kind is affordable. Ask BEFORE calling. */
  canSpend(kind: BudgetKind): boolean {
    if (this.exhausted || this.pastDeadline()) {
      return false;
    }
    return kind === "tool"
      ? this.toolCalls < this.limitValues.maxToolCalls
      : this.llmCalls < this.limitValues.maxLlmCalls;
  }

  /**
   * Charge one call. Returns false when it was not affordable — the caller must then SKIP the call
   * and let the run finish with what it has, never proceed anyway.
   */
  spend(kind: BudgetKind): boolean {
    if (!this.canSpend(kind)) {
      this.exhausted = true;
      return false;
    }
    if (kind === "tool") {
      this.toolCalls += 1;
    } else {
      this.llmCalls += 1;
    }
    return true;
  }

  private pastDeadline(): boolean {
    return this.now() - this.startedAt >= this.limitValues.deadlineMs;
  }

  /** The spend so far, for the answer's own report. `stopReason` is decided by the caller. */
  report(stopReason: OperatorStopReason): {
    iterations: number;
    toolCalls: number;
    llmCalls: number;
    elapsedMs: number;
    exhausted: boolean;
    stopReason: OperatorStopReason;
  } {
    const exhausted = this.exhausted || this.pastDeadline();
    return {
      iterations: this.iterations,
      toolCalls: this.toolCalls,
      llmCalls: this.llmCalls,
      elapsedMs: this.now() - this.startedAt,
      exhausted,
      // An exhausted run never reports COMPLETE, whatever the caller believed: the caller's view of
      // "done" and the budget's view of "we stopped early" must not be able to disagree in the answer.
      stopReason: exhausted && stopReason === "COMPLETE" ? "BUDGET_EXHAUSTED" : stopReason,
    };
  }
}
