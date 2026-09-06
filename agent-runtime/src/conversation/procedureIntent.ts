/**
 * <b>The closed token a sentence carries INTO procedure routing.</b>
 *
 * AOP Execution Closure v1. The AOP router is a table over closed tokens and reads no sentence — that
 * is what makes it inspectable and what stops it becoming a second planner. But the deterministic
 * lanes DO recognise a few closed intents about the object already on the table, and those intents are
 * exactly the ones that start a business procedure.
 *
 * So the grammar stays here, where it has always lived, and what crosses into `src/aop/` is one token.
 * Nothing downstream of this file sees the seller's words.
 */
import { toneIntentOf } from "./styleIntent";
import { analyzeIntentOf } from "./taskInterpreter";
import { prepareIntentOf } from "./visibleSelection";
import type { ConversationView } from "./contract";

export type ProcedureIntent =
  /** No procedure is being asked for; the ordinary lanes and the planner own this turn. */
  | "NONE"
  /** 「답변 준비해줘」 — an instruction to produce a draft for the object on the table. */
  | "PREPARE_DRAFT"
  /** 「더 부드럽게」 — a new version of the draft already prepared, over the same evidence. */
  | "REVISE_TONE"
  /** 「이 고객한테 뭐라고 답하면 좋을까」 — advice, which for a draftable object IS the draft. */
  | "ADVISE"
  /** The seller is answering the knowledge question this conversation is holding open. */
  | "CAPTURE_ANSWER";

/**
 * What this sentence asks of the object on the table.
 *
 * Order matters and is the order the lanes had: an open knowledge question listens first (it is what
 * the seller is answering), then a tone change over a prepared draft, then the two draft intents.
 */
export function procedureIntentOf(view: ConversationView, text: string): ProcedureIntent {
  if (view.pendingCapture) return "CAPTURE_ANSWER";
  const anchored = view.pendingPrepared || view.workingSet?.selectedInquiry;
  if (anchored && toneIntentOf(text)) return "REVISE_TONE";
  if (analyzeIntentOf(text)) return "ADVISE";
  if (prepareIntentOf(text)) return "PREPARE_DRAFT";
  return "NONE";
}

/**
 * The `requestedAction` token this intent presents to the router.
 *
 * The router's vocabulary is the planner's, so a deterministic intent maps onto it rather than adding
 * a second axis — a procedure's entry condition must read the same way whichever lane reached it.
 */
export function requestedActionFor(intent: ProcedureIntent): string {
  return intent === "NONE" ? "NONE" : "PREPARE_INQUIRY_DRAFT";
}
