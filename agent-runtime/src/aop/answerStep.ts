/**
 * <b>Which step of ANSWER_INQUIRY this sentence asks for</b> — the procedure decision, in the
 * procedure layer.
 *
 * Agent Runtime Production Closure v1 §4. The AOP Execution Closure moved the PRE-plan twin of this
 * judgement into the subgraph and left its POST-plan twin inline in `compose`, where it re-read the
 * seller's sentence with `analyzeIntentOf` and compared the target's actionability itself. Two
 * implementations of one rule, and only one of them was the procedure's.
 *
 * The verdict on that residue was <b>procedure decision, not presentation</b>: it chooses which
 * business step runs — an advisory read over the seller's corpus, or the production draft path — and
 * that choice is the same one whether the planner or the deterministic lane reached the object. So it
 * lives here, both lanes ask it, and what stays in `compose` is the rendering of whichever step ran.
 *
 * <b>Two tokens, not three.</b> There is no REFUSE: `directPrepare` (deterministic lane) and
 * `prepareOneInquiry` (planner lane) each both prepare a draft AND refuse an object that cannot take
 * one, through the same {@code inquiryDraftPrecondition}. Adding a refusal token here would be a
 * second place that decides it.
 */
import type { InquiryActionability } from "../conversation/inquiryActionability";
import type { ProcedureIntent } from "../conversation/procedureIntent";

export type InquiryAnswerStep =
  /** The production draft path — which, for an object that cannot take a draft, is also the refusal. */
  | "PREPARE"
  /** The advisory read: what is known about this inquiry, when no draft may be written for it. */
  | "ADVISE";

/**
 * 「뭐라고 답하면 좋을까」 over a draftable object IS the draft — the strongest advice this product has
 * is the sentence it would send. Over an object that cannot take one, the same question is answered
 * with what is known, never with the gate's refusal.
 */
export function inquiryAnswerStep(
  intent: ProcedureIntent | undefined, actionability: InquiryActionability | null,
): InquiryAnswerStep {
  return intent === "ADVISE" && actionability !== "DRAFTABLE" ? "ADVISE" : "PREPARE";
}
