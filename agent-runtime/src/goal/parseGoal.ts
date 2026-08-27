/**
 * Intent validation — the DASHBOARD lane.
 *
 * <b>This file no longer interprets natural language, and that is the point.</b> Until Operator Graph
 * v2 it also held a keyword table that mapped a free sentence onto one of the closed intents. That
 * table is gone: under invariant I2 the interpretation of a seller's own words is done by an LLM
 * planner or not at all, and a keyword table kept "for tests" or "for emergencies" is exactly the
 * escape hatch that would make the invariant a comment (see `docs/sellerops_operator_graph_v2.md` §12.2).
 *
 * <b>What remains is not interpretation.</b> An explicit `intent` is a closed enum a BUTTON sent — a
 * value the frontend chose from `/capabilities`, not a sentence a person typed. Validating it against
 * the known set is a contract check, and rejecting an unknown one is the same fail-closed behaviour it
 * always had. Free text does not enter here at all: it goes to the Operator, whose planner is the only
 * thing allowed to decide what it means.
 */

/** The closed set of intents the runtime can currently orchestrate. */
export type AgentIntent =
  | "HANDLE_UNANSWERED_INQUIRIES"
  | "PREPARE_INQUIRY_DRAFT"
  | "HANDLE_REVIEW_REPLIES"
  | "HANDLE_OPERATIONS_ISSUES"
  /**
   * The Operator goal — anything a seller types in their own words.
   *
   * Reached by an explicit intent, or by the HTTP layer for ANY free text (`AgentRunService.route`).
   * The four intents above each name one SUBGRAPH with its own contract (a checkpoint, a draft, a
   * brief); this one names the orchestrator that plans, and its planning is LLM-only.
   */
  | "OPERATOR_GOAL";

/** The subgraph domain an intent routes to. */
export type AgentDomain = "INQUIRY" | "INQUIRY_DRAFT" | "REVIEW" | "ISSUE" | "OPERATOR";

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
  /**
   * The product the seller was looking at when they asked — a SCOPE HINT, never an asserted fact.
   *
   * It carries an id and nothing else, and the id is worth nothing until an org-scoped read confirms
   * it: {@link OperatorAgentRuntime} spends one tool call to turn it into a verified entity, or drops
   * it. Nothing downstream can tell a hinted entity from one the run resolved by name, because both
   * arrive the same way — through a backend read that could only have returned this org's rows.
   *
   * Unused by every other domain. A caller that omits it gets exactly today's behaviour.
   */
  readonly productId?: string;
}

export class UnrecognizedGoalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecognizedGoalError";
  }
}

const KNOWN_INTENTS: ReadonlySet<string> = new Set<AgentIntent>([
  "HANDLE_UNANSWERED_INQUIRIES",
  "PREPARE_INQUIRY_DRAFT",
  "HANDLE_REVIEW_REPLIES",
  "HANDLE_OPERATIONS_ISSUES",
  "OPERATOR_GOAL",
]);

/** Map an intent onto the subgraph domain that handles it. A contract mapping, not a routing guess. */
export function routeIntent(intent: AgentIntent): AgentDomain {
  switch (intent) {
    case "OPERATOR_GOAL":
      return "OPERATOR";
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
 * Validate an explicit intent, or recognise that this request is free text.
 *
 * An `intent` is checked against the closed set. Text with no intent resolves to `OPERATOR_GOAL` —
 * not because anything here understood it, but because the Operator is where understanding happens.
 * Neither present → {@link UnrecognizedGoalError}.
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

  if (request.text && request.text.trim().length > 0) {
    return { intent: "OPERATOR_GOAL", ...paging };
  }

  throw new UnrecognizedGoalError("request carried neither an intent nor text");
}
