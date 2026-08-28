/**
 * <b>The palette shortcuts — and exactly what they are.</b>
 *
 * <p>Agentic Operating Workspace v2 §3-C. The home is a CONVERSATION now: a sentence goes to the
 * runtime, where the LLM planner plans it or the turn fails ({@code docs/sellerops_operator_graph_v2.md}
 * — there is no keyword planner, not even as a fallback). What is left of the command palette is an
 * optional LOCAL shortcut: when a typed sentence is exactly one of these labels (tolerating spacing,
 * trailing punctuation and a polite ending), the home shows the object it already has instead of
 * making a round trip. Nothing else matches. 「오늘 새로 달린 리뷰 보여줘」 is not a shortcut; it is a
 * request the planner interprets.
 *
 * <p>Acceptance Closure §9 removed 「리뷰 문제 보여줘」: it answered with the repeated-issues list, which is an
 * INTERPRETATION of a review sentence (rows or problems?) — exactly the decision the planner owns. What is
 * left are two object operations whose semantics are identical however they are reached: the day's brief
 * this screen already renders, and the open-inquiry queue the home KPI already counts.
 */

/** The closed set. Adding one means adding an object that can answer it. */
export type CommandIntentKey = "TODAY" | "UNANSWERED_INQUIRIES";

export interface CommandIntent {
  readonly key: CommandIntentKey;
  /** The exact sentence — the only thing that matches. */
  readonly label: string;
}

export const COMMAND_INTENTS: readonly CommandIntent[] = [
  { key: "UNANSWERED_INQUIRIES", label: "미답변 문의 보여줘" },
  { key: "TODAY", label: "오늘 할 일 알려줘" },
];

/** Spacing, trailing punctuation and the polite endings a seller types — not the words themselves. */
function normalize(text: string): string {
  return text
    .trim()
    .replace(/[?!.。]+$/u, "")
    .replace(/\s+/g, "")
    .replace(/(주세요|줘요|줘|요)$/u, "");
}

/**
 * The shortcut this sentence IS, or null to hand it to the Agent.
 *
 * <b>Null is the ordinary case and it is not a failure.</b> Near-exact only: the label with different
 * spacing, a question mark, or 「요」/「주세요」 on the end.
 */
export function matchCommandIntent(text: string): CommandIntentKey | null {
  const normalized = normalize(text);
  if (!normalized) return null;
  for (const intent of COMMAND_INTENTS) {
    if (normalize(intent.label) === normalized) return intent.key;
  }
  return null;
}

/** What the screen says it is showing, in the seller's words. Never the intent key. */
export const INTENT_HEADING: Record<CommandIntentKey, string> = {
  TODAY: "오늘 확인할 일",
  UNANSWERED_INQUIRIES: "답변이 필요한 문의",
};
