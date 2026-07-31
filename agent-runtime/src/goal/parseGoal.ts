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
export type AgentIntent =
  | "HANDLE_UNANSWERED_INQUIRIES"
  | "PREPARE_INQUIRY_DRAFT"
  | "HANDLE_REVIEW_REPLIES"
  | "HANDLE_OPERATIONS_ISSUES";

/** The subgraph domain an intent routes to. */
export type AgentDomain = "INQUIRY" | "INQUIRY_DRAFT" | "REVIEW" | "ISSUE";

export interface AgentGoal {
  readonly intent: AgentIntent;
  /** Optional paging hints for the search step; defaults applied downstream. */
  readonly page?: number;
  readonly size?: number;
  /**
   * Seller account the run acts within. Required for the REVIEW domain (its endpoints are
   * account-scoped); unused by the org-scoped inquiry queue and issue memory.
   */
  readonly accountId?: string;
  /**
   * ISO date-only (YYYY-MM-DD) reproducibility anchor for the ISSUE domain's change/trend
   * judgements. When set, the whole run is pinned to that date and is deterministic across a
   * restart; when absent, the backend uses today. Unused by the inquiry/review domains.
   */
  readonly referenceDate?: string;
}

export interface GoalRequest {
  readonly intent?: string;
  readonly text?: string;
  readonly page?: number;
  readonly size?: number;
  readonly accountId?: string;
  readonly referenceDate?: string;
}

export class UnrecognizedGoalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecognizedGoalError";
  }
}

/**
 * Fixed keyword table for the free-text path. Deterministic; the first matching row wins.
 * Ordered review → issue → inquiry-draft → inquiry so that a request mentioning both a review word
 * and the broad inquiry "답변" resolves to review; the issue row sits before inquiry so an operations
 * request is never shadowed by a broad inquiry word; the inquiry-draft row (a "초안"/draft request)
 * sits before the broad inquiry row so "문의 답변 초안 만들어줘" prepares a draft rather than starting
 * the full approve loop. The keyword sets are mutually substring-free (no set's keyword contains, or
 * is contained by, another set's — "초안"/"draft" appear in no other set, and "답변 초안" contains no
 * bare keyword), so canonical requests route the same regardless of order.
 */
const INTENT_KEYWORDS: ReadonlyArray<{ intent: AgentIntent; keywords: readonly string[] }> = [
  {
    intent: "HANDLE_REVIEW_REPLIES",
    keywords: ["리뷰", "후기", "리뷰 답변", "답글", "review", "review reply", "review replies"],
  },
  {
    // Operations-issue signals. Listed before the inquiry rows so an issue request that also says
    // a broad inquiry word does not get shadowed; none of these keywords overlaps the review or
    // inquiry rows, so the examples ("악화된 상품 문제", "반복되는 고객 불만", "먼저 확인할 운영
    // 이슈") resolve here regardless of order.
    intent: "HANDLE_OPERATIONS_ISSUES",
    keywords: [
      "운영 이슈",
      "이슈",
      "악화",
      "반복",
      "고객 불만",
      "불만",
      "상품 문제",
      "먼저 확인",
      "operations issue",
      "issue",
      "recurring",
      "worsening",
      "complaint",
    ],
  },
  {
    // Draft-preparation: read one inquiry and show a rule-based answer DRAFT, ending at the human
    // checkpoint with no send. Listed BEFORE the broad inquiry row so a "초안"/draft request prepares
    // a draft instead of entering the full unanswered-inquiry approve loop.
    intent: "PREPARE_INQUIRY_DRAFT",
    keywords: ["초안", "답변 초안", "draft", "reply draft"],
  },
  {
    intent: "HANDLE_UNANSWERED_INQUIRIES",
    keywords: ["미답변", "문의", "답변 필요", "unanswered", "inquiry", "inquiries"],
  },
];

const KNOWN_INTENTS: ReadonlySet<string> = new Set<AgentIntent>([
  "HANDLE_UNANSWERED_INQUIRIES",
  "PREPARE_INQUIRY_DRAFT",
  "HANDLE_REVIEW_REPLIES",
  "HANDLE_OPERATIONS_ISSUES",
]);

/** Map an intent onto the subgraph domain that handles it — the goal router's core. */
export function routeIntent(intent: AgentIntent): AgentDomain {
  switch (intent) {
    case "HANDLE_REVIEW_REPLIES":
      return "REVIEW";
    case "HANDLE_OPERATIONS_ISSUES":
      return "ISSUE";
    case "PREPARE_INQUIRY_DRAFT":
      return "INQUIRY_DRAFT";
    default:
      return "INQUIRY";
  }
}

/**
 * Parse an operator request into a supported goal. Precedence: an explicit `intent`
 * wins; otherwise the `text` is matched against the keyword table. Neither present, or
 * no match → {@link UnrecognizedGoalError}.
 */
export function parseGoal(request: GoalRequest): AgentGoal {
  const paging = {
    page: request.page,
    size: request.size,
    accountId: request.accountId,
    referenceDate: request.referenceDate,
  };

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
