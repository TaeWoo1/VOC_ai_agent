/**
 * <b>The home command box, and exactly what it is.</b>
 *
 * <p>Agent Command Center v1 §6/§7. This is a <b>command palette over screens that already exist</b>
 * — it decides which workspace object to put on the screen, and nothing else. It is deliberately NOT
 * a planner: it never chooses tools, never claims evidence, never writes, and never states a fact it
 * did not read from the object it is showing.
 *
 * <p>That distinction is the product contract this file has to respect. {@code
 * docs/sellerops_operator_graph_v2.md} says an Agent run's plan is made by the LLM planner or the run
 * FAILS — there is no deterministic keyword planner, not even as a fallback. Nothing here is one:
 * <b>a sentence this file does not recognise is handed to the Agent unchanged</b>, where the planner
 * either plans it or the run fails exactly as it does today. What is matched here is resolved to a
 * ROUTE, the way a command palette resolves 「설정」 to a settings page.
 *
 * <p><b>Narrow on purpose.</b> A sentence has to name one of the nouns AND ask to be shown something.
 * 「3호 몰딩 문의 몇 건이야」 is a question about the seller's catalogue, not a request for the inquiry
 * list, and it goes to the Agent. Guessing is the one thing this box must not do, and the chips under
 * the input are there so the supported set is visible rather than folklore.
 */

/** The closed set. Adding one means adding an object that can answer it. */
export type CommandIntentKey = "TODAY" | "UNANSWERED_INQUIRIES" | "REVIEW_ISSUES";

export interface CommandIntent {
  readonly key: CommandIntentKey;
  /** The chip, and the exact sentence it puts in the box. */
  readonly label: string;
  /** Nouns, any one of which must appear. */
  readonly nouns: readonly string[];
}

/**
 * Order matters: 「오늘 할 일」 names no noun of its own and would otherwise never match, and
 * 「오늘 들어온 문의」 is a request for the inquiry list rather than for the briefing.
 */
export const COMMAND_INTENTS: readonly CommandIntent[] = [
  { key: "UNANSWERED_INQUIRIES", label: "미답변 문의 보여줘", nouns: ["문의"] },
  { key: "REVIEW_ISSUES", label: "리뷰 문제 보여줘", nouns: ["리뷰"] },
  { key: "TODAY", label: "오늘 할 일 알려줘", nouns: ["할 일", "할일", "오늘 뭐", "오늘의 일"] },
];

/**
 * The verbs that turn a noun into a request to be shown something.
 *
 * <p>Without one of these the sentence is a question, and a question is the Agent's job. This list is
 * short and stays short: every word added to it is a sentence that stops reaching the planner.
 */
const SHOW_VERBS = ["보여", "알려", "보기", "목록", "열어", "확인해", "정리해", "뭐 있", "뭐있"];

/** Whitespace and the punctuation a seller types around a request. Not the words themselves. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").replace(/[?!.]+$/u, "");
}

/**
 * Which object answers this sentence, or null to hand it to the Agent.
 *
 * <b>Null is the ordinary case and it is not a failure.</b> It means this box has no object for the
 * question, which is different from the question being unanswerable.
 */
export function matchCommandIntent(text: string): CommandIntentKey | null {
  const normalized = normalize(text);
  if (!normalized) return null;
  if (!SHOW_VERBS.some((verb) => normalized.includes(verb))) return null;
  for (const intent of COMMAND_INTENTS) {
    if (intent.nouns.some((noun) => normalized.includes(noun))) {
      return intent.key;
    }
  }
  return null;
}

/** What the screen says it is showing, in the seller's words. Never the intent key. */
export const INTENT_HEADING: Record<CommandIntentKey, string> = {
  TODAY: "오늘 확인할 일",
  UNANSWERED_INQUIRIES: "답변이 필요한 문의",
  REVIEW_ISSUES: "리뷰에서 반복되는 문제",
};
