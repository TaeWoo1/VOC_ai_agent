/**
 * Goal parsing — deterministic, no LLM.
 *
 * "Goal parsing" in this slice means mapping an operator request onto one of a small,
 * closed set of supported intents. There is no natural-language model here: an explicit
 * `intent` is validated directly, and a free-text `text` is matched against a fixed
 * keyword table. An unrecognized request is rejected (fail closed) rather than guessed.
 * A real LLM planner can replace this later behind the same `parseGoal` seam.
 */

/** The closed set of intents the runtime can currently orchestrate. */
export type AgentIntent = "HANDLE_UNANSWERED_INQUIRIES";

export interface AgentGoal {
  readonly intent: AgentIntent;
  /** Optional paging hints for the search step; defaults applied downstream. */
  readonly page?: number;
  readonly size?: number;
}

export interface GoalRequest {
  readonly intent?: string;
  readonly text?: string;
  readonly page?: number;
  readonly size?: number;
}

export class UnrecognizedGoalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecognizedGoalError";
  }
}

/** Fixed keyword table for the free-text path. Deterministic, order-independent. */
const INTENT_KEYWORDS: ReadonlyArray<{ intent: AgentIntent; keywords: readonly string[] }> = [
  {
    intent: "HANDLE_UNANSWERED_INQUIRIES",
    keywords: ["미답변", "문의", "답변 필요", "unanswered", "inquiry", "inquiries"],
  },
];

const KNOWN_INTENTS: ReadonlySet<string> = new Set<AgentIntent>(["HANDLE_UNANSWERED_INQUIRIES"]);

/**
 * Parse an operator request into a supported goal. Precedence: an explicit `intent`
 * wins; otherwise the `text` is matched against the keyword table. Neither present, or
 * no match → {@link UnrecognizedGoalError}.
 */
export function parseGoal(request: GoalRequest): AgentGoal {
  const paging = { page: request.page, size: request.size };

  if (request.intent) {
    if (!KNOWN_INTENTS.has(request.intent)) {
      throw new UnrecognizedGoalError(`unsupported intent: ${request.intent}`);
    }
    return { intent: request.intent as AgentIntent, ...paging };
  }

  if (request.text) {
    const lower = request.text.toLowerCase();
    for (const row of INTENT_KEYWORDS) {
      if (row.keywords.some((k) => lower.includes(k.toLowerCase()))) {
        return { intent: row.intent, ...paging };
      }
    }
    throw new UnrecognizedGoalError("no supported intent matched the request text");
  }

  throw new UnrecognizedGoalError("request carried neither an intent nor text");
}
