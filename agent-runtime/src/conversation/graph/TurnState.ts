/**
 * <b>What one turn keeps while LangGraph runs it.</b>
 *
 * LangGraph Orchestration Migration + AOP Runtime Core v1 §2/§5. This is the checkpointed state, so it
 * obeys the same rule the procedure state does: <b>ids, closed tokens and counts — never objects</b>.
 * The transcript, the artifacts, the draft and the approval are owned by {@code ConversationStore} and
 * the database; the checkpoint's job is to say WHERE this turn is, not to hold a second copy of what it
 * produced.
 *
 * The turn's non-serialisable collaborators — the Spring clients, the store, the progress callback, the
 * abort signal — travel in {@code config.configurable}, which LangGraph does not checkpoint. That is
 * not a convenience: a checkpoint that could hold a bearer token would be a checkpoint that leaks one.
 */
import { Annotation } from "@langchain/langgraph";
import type { ProcedureId } from "../../operator/procedure/Procedure";
import type { AbsenceReason } from "../../operator/procedure/Procedure";
import type { InterruptKind, TerminalKind } from "../../aop/ProcedureDefinition";

/**
 * Which shape of turn this is — decided once, by {@code route}.
 *
 * These were the first four `if`s of {@code turnNow}, and their ORDER was the answer. Naming them
 * makes the order a table instead of a reading of the file.
 */
export type TurnRoute =
  /** A press on a row already on screen. Same focus transition as naming it; no planner, no transcript. */
  | "CLICK"
  /** The seller's yes/no on a knowledge question bound to a candidate. */
  | "CAPTURE_DECISION"
  /** «the human step is done» — recheck each pending action's own record before spending anything. */
  | "RESUME"
  /** A closed intent about the object already on the table. No planner call and no read. */
  | "DIRECT"
  /** Everything else: the LLM planner, the specialists, the evidence, the judge. */
  | "OPERATOR";

const last = <T>(_prev: T, next: T): T => next;

export const TurnStateAnnotation = Annotation.Root({
  conversationId: Annotation<string>({ reducer: last, default: () => "" }),
  /** The agent turn this run produced, once it exists. */
  turnId: Annotation<string | null>({ reducer: last, default: () => null }),
  route: Annotation<TurnRoute | null>({ reducer: last, default: () => null }),
  /** The one closed enum about this seller's world. `UNKNOWN` asserts nothing. */
  readiness: Annotation<"NO_CHANNEL" | "NO_DATA" | "WORKING" | "UNKNOWN">({
    reducer: last, default: () => "UNKNOWN",
  }),
  /** Which business procedure claimed this turn — `null` is normal and always was. */
  procedureId: Annotation<ProcedureId | null>({ reducer: last, default: () => null }),
  /** That procedure's exact shape, for provenance. */
  procedureVersion: Annotation<string | null>({ reducer: last, default: () => null }),
  /** Why the procedure could not run, when it could not. */
  absence: Annotation<AbsenceReason | null>({ reducer: last, default: () => null }),
  /** How the turn ended. */
  terminal: Annotation<TerminalKind | null>({ reducer: last, default: () => null }),
  /** What it is waiting for a person to do, if anything. */
  interrupt: Annotation<InterruptKind | null>({ reducer: last, default: () => null }),
  /** Which nodes ran, in order. The execution cursor a resume continues from. */
  trail: Annotation<string[]>({ reducer: (prev, next) => [...prev, ...next], default: () => [] }),
});

export type TurnGraphState = typeof TurnStateAnnotation.State;
export type TurnGraphUpdate = Partial<typeof TurnStateAnnotation.Update>;
