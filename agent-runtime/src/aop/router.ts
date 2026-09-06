/**
 * <b>Procedure routing — the table LangGraph reads to choose one.</b>
 *
 * LangGraph Orchestration Migration + AOP Runtime Core v1 §2/§3. Routing used to be the shape of
 * {@code ConversationService}: a sequence of `if`s whose order was the answer. It is now a pure
 * function over closed tokens and a priority, which is what makes it inspectable, orderable and
 * testable as a table.
 *
 * <b>This is not a second planner.</b> Nothing here reads the seller's sentence. The inputs are the
 * plan's own closed tokens, the world's readiness, which object the conversation is standing on, and
 * whether a knowledge question is already open — every one of them decided upstream by something that
 * owns that decision.
 */
import type { ProcedureDefinition } from "./ProcedureDefinition";
import { PROCEDURES_BY_PRIORITY } from "./procedures";

/** What routing is allowed to look at. Closed tokens, and nothing the seller typed. */
export interface RoutingContext {
  readonly readiness: "NO_CHANNEL" | "NO_DATA" | "WORKING" | "UNKNOWN";
  /** The object this conversation is standing on, if any. */
  readonly anchor: "INQUIRY" | "REVIEW" | "PRODUCT" | null;
  /** The plan's `requestedAction`. */
  readonly requestedAction: string;
  /** The plan's need kinds. */
  readonly needKinds: readonly string[];
  /** A knowledge question already put to the seller on this conversation. */
  readonly pendingCapture: boolean;
}

/** Does this definition's entry condition hold? Every absent field means «does not care». */
export function admits(definition: ProcedureDefinition, context: RoutingContext): boolean {
  const { entry } = definition;
  if (entry.readiness && !entry.readiness.includes(context.readiness)) return false;
  if (entry.anchor && entry.anchor !== context.anchor) return false;
  if (entry.requestedAction && !entry.requestedAction.includes(context.requestedAction)) return false;
  if (entry.needKinds && !entry.needKinds.some((k) => context.needKinds.includes(k))) return false;
  if (entry.pendingCapture !== undefined && entry.pendingCapture !== context.pendingCapture) return false;
  return true;
}

/**
 * The procedure this turn runs, or `null` when none claims it.
 *
 * <b>`null` is a legitimate answer and always was.</b> Most turns of this product are a question about
 * rows — 「최근 문의 보여줘」 — and no business procedure owns them; they are the planner's read, composed.
 * A router that had to name a procedure for every sentence would be inventing one.
 */
export function selectProcedure(context: RoutingContext): ProcedureDefinition | null {
  return PROCEDURES_BY_PRIORITY.find((definition) => admits(definition, context)) ?? null;
}
