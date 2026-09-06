/**
 * <b>What a procedure keeps while it runs — and what it deliberately does not.</b>
 *
 * LangGraph Orchestration Migration + AOP Runtime Core v1 §5. This is the state a checkpoint holds, so
 * the rule is stated here rather than remembered: <b>references, never objects</b>. The draft, the
 * evidence, the approval and the marketplace outcome are facts owned by the database; a copy of one in
 * a checkpoint is a second source of truth, and after a resume the two can disagree with nobody to
 * say which is right.
 *
 * Everything below is an id, a closed token, or a count. A customer's sentence never reaches it — the
 * conversation transcript already owns that text, once, under its own sanitisation fence.
 */
import { Annotation } from "@langchain/langgraph";
import type { AbsenceReason, ProcedureId } from "../operator/procedure/Procedure";
import type { InterruptKind, TerminalKind } from "./ProcedureDefinition";

/** The ids a procedure may carry. Every field is a database key or a closed channel token. */
export interface ProcedureRefs {
  readonly workItemId?: string | null;
  readonly inquiryId?: string | null;
  readonly reviewId?: string | null;
  readonly productId?: string | null;
  readonly issueId?: string | null;
  readonly candidateId?: string | null;
  readonly channelCode?: string | null;
  readonly draftVersion?: number | null;
}

const last = <T>(_prev: T, next: T): T => next;

export const ProcedureStateAnnotation = Annotation.Root({
  /** Which procedure is running, and the exact shape of it — provenance, like a prompt version. */
  procedureId: Annotation<ProcedureId>({ reducer: last, default: () => "DAILY_WORK" as ProcedureId }),
  version: Annotation<string>({ reducer: last, default: () => "" }),
  /** Database keys only. */
  refs: Annotation<ProcedureRefs>({
    reducer: (prev, next) => ({ ...prev, ...next }), default: () => ({}),
  }),
  /** Set by any step that ends the run. A non-null value routes to END. */
  terminal: Annotation<TerminalKind | null>({ reducer: last, default: () => null }),
  /** Why it could not run, when it could not. */
  absence: Annotation<AbsenceReason | null>({ reducer: last, default: () => null }),
  /** What this procedure is waiting for a person to do. */
  interrupt: Annotation<InterruptKind | null>({ reducer: last, default: () => null }),
  /**
   * The standing approval this run is waiting on, by id.
   *
   * <b>An id, never a decision.</b> The approval's validity is read from its own record every time
   * (§6); carrying the verdict here would let a resume inherit a yes nobody gave twice.
   */
  approvalId: Annotation<string | null>({ reducer: last, default: () => null }),
  /** Which steps actually ran, in order — the trace, and what a resume continues after. */
  stepTrail: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next], default: () => [],
  }),
});

export type ProcedureState = typeof ProcedureStateAnnotation.State;
export type ProcedureUpdate = Partial<typeof ProcedureStateAnnotation.Update>;
