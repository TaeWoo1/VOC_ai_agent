/**
 * The analytics vocabulary — docs/auth_growth_instrumentation_v1.md §5, §2-9.
 *
 * Every event has a FIXED prop key set, and every prop value must be one of an enum. That is the whole PII
 * story: a page cannot put an email, a name, a 상호, a review sentence, or a marketplace id into an event
 * because there is no prop that accepts a free-form string. `sanitize` enforces it at runtime as well as in
 * the types, so a sink never sees anything that is not in this file.
 */

export const AUTH_METHODS = ["email", "google", "naver"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** Analytics channel labels — the product-visible set, lowercase (never a seller account id). */
export const ANALYTICS_CHANNELS = ["naver", "coupang", "cafe24"] as const;
export type AnalyticsChannel = (typeof ANALYTICS_CHANNELS)[number];

/** Which kind of work a proactive case is about — the only prop the proactive events carry. */
export const PROACTIVE_KINDS = ["inquiry", "review"] as const;
export type ProactiveKind = (typeof PROACTIVE_KINDS)[number];

/** Where a conversation turn was typed — the home workspace or the contextual panel. */
export const CONVERSATION_SURFACES = ["home", "panel"] as const;
export type ConversationSurface = (typeof CONVERSATION_SURFACES)[number];

/** The outcome of one agent turn, never its content. */
export const AGENT_RESULT_STATUSES = ["done", "failed", "waiting_human"] as const;
export type AgentResultStatus = (typeof AGENT_RESULT_STATUSES)[number];

/** The closed artifact vocabulary, lowercase — `ArtifactType` in `lib/conversation/types.ts`. */
export const ARTIFACT_TYPES = [
  "summary", "metric", "list", "table", "review_list", "inquiry_list", "product_list", "issue_list",
  "order_summary", "chart", "draft", "evidence", "checklist", "human_action_required", "approval",
  "execution_result", "workspace_link", "guided_execution", "knowledge_capture", "inquiry_detail", "review_detail",
] as const;
export type ArtifactTypeLabel = (typeof ARTIFACT_TYPES)[number];

/** The kinds of one-step human action the agent may ask for. */
export const HUMAN_ACTION_TYPES = ["review_import", "channel_connect", "knowledge_entry", "variant_clarification"] as const;
export type HumanActionTypeLabel = (typeof HUMAN_ACTION_TYPES)[number];

export interface AnalyticsEvents {
  sign_up: { method: AuthMethod };
  login: { method: AuthMethod };
  onboarding_started: Record<string, never>;
  onboarding_completed: Record<string, never>;
  channel_connect_started: { channel: AnalyticsChannel };
  channel_connected: { channel: AnalyticsChannel };
  first_sync_completed: { channel: AnalyticsChannel };
  today_inbox_viewed: Record<string, never>;
  review_attention_opened: Record<string, never>;
  inquiry_opened: Record<string, never>;
  /** The proactive section was rendered with at least one prepared case. */
  proactive_cases_viewed: Record<string, never>;
  /** The seller opened one prepared case. `kind` is the subject, never its content. */
  proactive_case_opened: { kind: ProactiveKind };
  /** Agentic Operating Workspace v2 — the conversation loop. Props are closed enums; never text. */
  conversation_started: Record<string, never>;
  conversation_turn_sent: { surface: ConversationSurface };
  agent_result_shown: { status: AgentResultStatus };
  artifact_shown: { type: ArtifactTypeLabel };
  artifact_opened: { type: ArtifactTypeLabel };
  human_action_requested: { type: HumanActionTypeLabel };
  human_action_completed: { type: HumanActionTypeLabel };
  approval_opened: Record<string, never>;
  conversation_resumed: Record<string, never>;
  /** The seller pressed Stop on a turn in flight (Chat UI v1). */
  conversation_turn_stopped: Record<string, never>;
  /** Agent Interaction Model v2 §3: a shown object was clicked into conversation focus. No ids, no text. */
  conversation_object_selected: Record<string, never>;
}

export type AnalyticsEventName = keyof AnalyticsEvents;

/** Allowed prop keys per event and the enum each key may take. Anything else is dropped. */
const ALLOWED: { [E in AnalyticsEventName]: Record<string, readonly string[]> } = {
  sign_up: { method: AUTH_METHODS },
  login: { method: AUTH_METHODS },
  onboarding_started: {},
  onboarding_completed: {},
  channel_connect_started: { channel: ANALYTICS_CHANNELS },
  channel_connected: { channel: ANALYTICS_CHANNELS },
  first_sync_completed: { channel: ANALYTICS_CHANNELS },
  today_inbox_viewed: {},
  review_attention_opened: {},
  inquiry_opened: {},
  proactive_cases_viewed: {},
  proactive_case_opened: { kind: PROACTIVE_KINDS },
  conversation_started: {},
  conversation_turn_sent: { surface: CONVERSATION_SURFACES },
  agent_result_shown: { status: AGENT_RESULT_STATUSES },
  artifact_shown: { type: ARTIFACT_TYPES },
  artifact_opened: { type: ARTIFACT_TYPES },
  human_action_requested: { type: HUMAN_ACTION_TYPES },
  human_action_completed: { type: HUMAN_ACTION_TYPES },
  approval_opened: {},
  conversation_resumed: {},
  conversation_turn_stopped: {},
  conversation_object_selected: {},
};

export const ANALYTICS_EVENT_NAMES = Object.keys(ALLOWED) as AnalyticsEventName[];

export function isAnalyticsEvent(name: string): name is AnalyticsEventName {
  return Object.prototype.hasOwnProperty.call(ALLOWED, name);
}

/**
 * Keep only allow-listed keys whose value is one of that key's enum values. Returns the clean props and the
 * keys that were dropped (for a dev-time warning — the drop itself is silent in production).
 */
export function sanitize(
  event: AnalyticsEventName,
  props: Record<string, unknown> | undefined,
): { props: Record<string, string>; dropped: string[] } {
  const allowed = ALLOWED[event];
  const clean: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(props ?? {})) {
    const values = allowed[key];
    if (values && typeof value === "string" && values.includes(value)) {
      clean[key] = value;
    } else {
      dropped.push(key);
    }
  }
  return { props: clean, dropped };
}

/** Map a product channel code (`NAVER` / `COUPANG` / `CAFE24`, any case) to its analytics label, or null. */
export function analyticsChannel(code: string | null | undefined): AnalyticsChannel | null {
  const lower = (code ?? "").toLowerCase();
  return (ANALYTICS_CHANNELS as readonly string[]).includes(lower) ? (lower as AnalyticsChannel) : null;
}
