/**
 * How a screen hands the Agent what it was looking at.
 *
 * <b>Structured context, never injected fact.</b> The link carries WHERE the seller came from
 * (`product`, `channel`, `surface`) and, when a screen offers one, a suggested goal SENTENCE. It never
 * carries counts, names of customers, or anything the Agent would then be able to state without
 * reading it — the evidence contract is unchanged, and a planner that was told "unanswered = 69" would
 * be able to say so with no tool call behind it.
 *
 * <b>The seller sends it, not the screen.</b> A suggested goal lands in the Agent's input box; nothing
 * dispatches on navigation. That is the same rule the Action Window follows for the marketplace, one
 * layer up: the human presses the button.
 */
export interface AgentContext {
  /** A suggested sentence for the input box. The seller may edit or delete it before sending. */
  readonly goal?: string;
  /** The canonical product the seller was looking at. An id only — the Agent re-reads it. */
  readonly productId?: string;
  /** The channel filter that was active, as a channel CODE. */
  readonly channelCode?: string;
  /** Which screen this came from, for the Agent's own framing. A closed set of route names. */
  readonly surface?: string;
}

/** Build the `/agent` link. Empty context yields the bare route — no stray `?`. */
export function agentHref(context: AgentContext = {}): string {
  const params = new URLSearchParams();
  if (context.goal) params.set("goal", context.goal);
  if (context.productId) params.set("productId", context.productId);
  if (context.channelCode) params.set("channel", context.channelCode);
  if (context.surface) params.set("from", context.surface);
  const query = params.toString();
  return query ? `/agent?${query}` : "/agent";
}

/** Read a context back off the URL. Unknown params are ignored rather than passed through. */
export function readAgentContext(search: string): AgentContext {
  const params = new URLSearchParams(search);
  const context: AgentContext = {
    ...(params.get("goal") ? { goal: params.get("goal")! } : {}),
    ...(params.get("productId") ? { productId: params.get("productId")! } : {}),
    ...(params.get("channel") ? { channelCode: params.get("channel")! } : {}),
    ...(params.get("from") ? { surface: params.get("from")! } : {}),
  };
  return context;
}
