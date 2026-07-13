import { CONNECTION_VIEW } from "../../lib/actionWindow/copy";
import type { SourceConnection } from "../../lib/actionWindow/source";

/** Offline / reconnecting banner — a UI resilience state, shown on both the home
 *  and the run detail. While visible, the pages suppress all command controls;
 *  the last known view stays visible read-only.
 *
 *  FE-4: when the source is a live Bridge that has gone offline (terminal — the
 *  transport stopped auto-retrying), the page passes `onReconnect` so the banner
 *  offers a manual reconnect. It is omitted for the fixture/simulated offline
 *  preview (nothing live to reconnect), so the button appears only where it acts. */
export function ConnectionBanner({
  connection,
  retryPending = false,
  onReconnect,
}: {
  connection: SourceConnection;
  retryPending?: boolean;
  onReconnect?: () => void;
}) {
  if (connection === "connected") return null;
  const view = CONNECTION_VIEW[connection];
  const showReconnect = connection === "offline" && onReconnect !== undefined;
  return (
    <div role="status" className="rounded-2xl border border-warn/30 bg-warn/5 p-4">
      <p className="font-medium text-ink">{view.title}</p>
      <p className="mt-0.5 text-sm text-muted">{view.body}</p>
      {showReconnect ? (
        <button
          type="button"
          onClick={onReconnect}
          disabled={retryPending}
          aria-busy={retryPending}
          className="mt-3 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {retryPending ? view.actionPending : view.action}
        </button>
      ) : null}
    </div>
  );
}
