import { ruleTypeForAskedTopic } from "./knowledgeWords";
import type { GeneratedDraftView, OrgKnowledgeType } from "./types";

/** The three answers to "can this question be answered". Mirrors com.sellerops.inquiry.draft.AnswerBasisState. */
export type AnswerBasis = GeneratedDraftView["answerBasis"];

/**
 * What the inquiry screen shows after the seller asks for a draft.
 *
 * <b>One card, three shapes</b> (Core Daily Loop UX Integration v1 §5). Before this, only
 * `NO_ANSWER_BASIS` had a card of its own; a grounded draft got the same orange caution box as a
 * failure, and `NEEDS_CLARIFICATION` — the state where the draft is a QUESTION back to the customer
 * — was rendered nowhere at all. A seller reading a polite request for the 규격 had no way to know
 * that asking WAS the reply, so it read as an answer that had come out short.
 *
 * <b>The words are the backend's.</b> `note` and `action` come from `AnswerBasisState`; this module
 * decides only which shape they go in. Re-authoring the sentences here would be the second copy that
 * drifts.
 */
export interface AnswerStateView {
  basis: AnswerBasis;
  /** The one line naming the state. */
  note: string;
  /** What is missing, for the two states where something is. Null on GROUNDED. */
  action: string | null;
  /** The product the missing knowledge would be attached to, when there is one. */
  productId: string | null;
  /**
   * Which corpus a quick-add here should write into.
   *
   * <b>PRODUCT when the inquiry resolved to a product; ORG when it did not and the question named
   * an operating topic; null when neither.</b> One editor, chosen by what the question was about —
   * a question with no product and no topic has nowhere honest to save, and a box with nowhere to
   * save is worse than no box.
   *
   * Before Knowledge Setup & Inbox UX v1 only the PRODUCT case existed, so 「제주도인데 배송이 며칠
   * 걸리나요?」 — a question with a perfectly ordinary answer the company has — named what was
   * missing and offered nothing to do about it.
   */
  gapScope: "PRODUCT" | "ORG" | null;
  /**
   * The operating rule TYPE to preselect, when the question named a topic that has one.
   *
   * Crossed through `ruleTypeForAskedTopic`, never passed through raw: `knowledgeGap.topic` speaks
   * the ASKED vocabulary (`SHIPPING`) and a write speaks the STORED one (`SHIPPING_POLICY`).
   */
  topic: OrgKnowledgeType | null;
}

/**
 * The state of a generate, or null when the MACHINERY is why there is nothing.
 *
 * `unavailableMessage` answers a different question — did it run — and it wins, because a spent
 * budget proves nothing about the seller's library. Sending them to write knowledge on a vendor
 * timeout is the 2026-08-27 defect, and this is where it stays closed.
 */
export function answerStateOf(generated: GeneratedDraftView): AnswerStateView | null {
  if (generated.unavailableMessage) return null;
  const gap = generated.knowledgeGap ?? null;
  const topic = ruleTypeForAskedTopic(gap?.topic);
  return {
    basis: generated.answerBasis,
    note: generated.answerBasisNote,
    action: generated.answerBasisAction,
    productId: generated.productId,
    gapScope: generated.productId ? "PRODUCT" : topic ? "ORG" : null,
    topic,
  };
}

/**
 * Whether this state is good news.
 *
 * GROUNDED is the only one. `NEEDS_CLARIFICATION` is a real, correct reply and still needs the
 * seller's attention before it goes out — the customer is being asked a question, not answered — so
 * it keeps the colour that means "read this".
 */
export function answerStateIsGood(basis: AnswerBasis): boolean {
  return basis === "GROUNDED";
}
