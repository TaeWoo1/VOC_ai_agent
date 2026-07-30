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
export type AgentIntent = "HANDLE_UNANSWERED_INQUIRIES" | "HANDLE_REVIEW_REPLIES";

/** The subgraph domain an intent routes to. */
export type AgentDomain = "INQUIRY" | "REVIEW";

export interface AgentGoal {
  readonly intent: AgentIntent;
  /** Optional paging hints for the search step; defaults applied downstream. */
  readonly page?: number;
  readonly size?: number;
  /**
   * Seller account the run acts within. Required for the REVIEW domain (its endpoints are
   * account-scoped); unused by the org-scoped inquiry queue.
   */
  readonly accountId?: string;
}

export interface GoalRequest {
  readonly intent?: string;
  readonly text?: string;
  readonly page?: number;
  readonly size?: number;
  readonly accountId?: string;
}

export class UnrecognizedGoalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecognizedGoalError";
  }
}

/**
 * Fixed keyword table for the free-text path. Deterministic, order-independent. The review
 * row is listed FIRST so a request that mentions both (e.g. "리뷰 답변") resolves to the
 * review intent; the inquiry keywords are broader ("답변") and would otherwise shadow it.
 */
const INTENT_KEYWORDS: ReadonlyArray<{ intent: AgentIntent; keywords: readonly string[] }> = [
  {
    intent: "HANDLE_REVIEW_REPLIES",
    keywords: ["리뷰", "후기", "리뷰 답변", "답글", "review", "review reply", "review replies"],
  },
  {
    intent: "HANDLE_UNANSWERED_INQUIRIES",
    keywords: ["미답변", "문의", "답변 필요", "unanswered", "inquiry", "inquiries"],
  },
];

const KNOWN_INTENTS: ReadonlySet<string> = new Set<AgentIntent>([
  "HANDLE_UNANSWERED_INQUIRIES",
  "HANDLE_REVIEW_REPLIES",
]);

/** Map an intent onto the subgraph domain that handles it — the goal router's core. */
export function routeIntent(intent: AgentIntent): AgentDomain {
  return intent === "HANDLE_REVIEW_REPLIES" ? "REVIEW" : "INQUIRY";
}

/**
 * Parse an operator request into a supported goal. Precedence: an explicit `intent`
 * wins; otherwise the `text` is matched against the keyword table. Neither present, or
 * no match → {@link UnrecognizedGoalError}.
 */
export function parseGoal(request: GoalRequest): AgentGoal {
  const paging = { page: request.page, size: request.size, accountId: request.accountId };

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
