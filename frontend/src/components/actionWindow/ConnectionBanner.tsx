import { CONNECTION_VIEW } from "../../lib/actionWindow/copy";
import type { SourceConnection } from "../../lib/actionWindow/source";

/** Offline / reconnecting banner — a UI resilience state, shown on both the home
 *  and the run detail. While visible, the pages suppress all command controls;
 *  the last known view stays visible read-only. */
export function ConnectionBanner({ connection }: { connection: SourceConnection }) {
  if (connection === "connected") return null;
  const view = CONNECTION_VIEW[connection];
  return (
    <div role="status" className="rounded-2xl border border-warn/30 bg-warn/5 p-4">
      <p className="font-medium text-ink">
        <span aria-hidden="true">{view.icon} </span>
        {view.title}
      </p>
      <p className="mt-0.5 text-sm text-muted">{view.body}</p>
    </div>
  );
}
