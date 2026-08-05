import type { AgentEnvStatus } from "../../lib/guidedConnection";
import { AGENT_ENV_COPY } from "../../lib/guidedConnection";

/**
 * Renders the DISTINCT Local-Agent situation from a classified {@link AgentEnvStatus} — the point being that
 * "the agent is not running" and "the agent is hosting a different run/session" are shown as different
 * messages with different next steps, never one catch-all. Copy is FE-owned and sanitized (no selector, url,
 * secret, or account id); the sanitized code is exposed only as an aria-label for the status region.
 *
 * A healthy/transient status (`PAIRED`, and any code whose copy entry is null) renders nothing. A retry
 * affordance appears only when the classifier says a plain retry is the right action (`canRetry`).
 */
export function AgentEnvNotice({
  status,
  onRetry,
}: {
  status: AgentEnvStatus;
  onRetry?: () => void;
}) {
  const copy = AGENT_ENV_COPY[status.code];
  if (!copy) return null;

  return (
    <div
      className="space-y-1 rounded-xl bg-warn/10 px-4 py-3"
      role="status"
      aria-label={`AGENT_ENV_${status.code}`}
    >
      <p className="text-sm font-medium text-ink break-keep">{copy.title}</p>
      <p className="text-sm text-muted break-keep">{copy.body}</p>
      {status.canRetry && onRetry ? (
        <button
          type="button"
          className="self-start rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-line/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          onClick={onRetry}
          data-testid="agent-env-retry"
        >
          다시 시도
        </button>
      ) : null}
    </div>
  );
}
