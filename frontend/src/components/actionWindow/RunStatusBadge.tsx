import type { RunStatus } from "../../lib/actionWindow/contract";
import { runStatusView, type StatusTone } from "../../lib/actionWindow/copy";

const TONE_CLASS: Record<StatusTone, string> = {
  active: "bg-brand-50 text-brand-700",
  human: "bg-warn/10 text-warn",
  neutral: "bg-canvas text-muted",
  good: "bg-good/10 text-good",
  bad: "bg-bad/10 text-bad",
};

/** Run status pill — icon + label + tone; shared by the home and the run detail. */
export function RunStatusBadge({ status }: { status: RunStatus }) {
  const view = runStatusView(status);
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${TONE_CLASS[view.tone]}`}
    >
      <span aria-hidden="true">{view.icon}</span>
      {view.label}
    </span>
  );
}
