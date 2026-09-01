import type { ProgressStageEvent } from "../../lib/conversation/types";

/**
 * Only what the runtime said it reached — the stage it is on, the ones behind it as one quiet trail,
 * and a measured clock. No bar, no invented steps: a stage the runtime never reported is not drawn
 * (design contract §9).
 *
 * <b>One line, not a list</b> (Agentic Experience v2 §7). The finished stages were a stacked checklist
 * that grew while the seller waited and pushed the answer down the moment it arrived; what they say —
 * "these are done" — fits on the same line as what is happening, and a working assistant that reports
 * three finished steps in a column is describing its own machinery, not its progress.
 */
export function ProgressView({ stages, elapsed }: { stages: ProgressStageEvent[]; elapsed: number }) {
  const current = stages[stages.length - 1] ?? null;
  const done = stages.slice(0, -1);
  return (
    <div role="status" aria-live="polite" className="flex items-start gap-2" data-testid="conversation-progress">
      <span aria-hidden="true" className="mt-0.5 animate-pulse text-brand-700">✳︎</span>
      <p className="min-w-0 flex-1 break-keep text-base text-ink">
        {done.length > 0 ? (
          <span className="text-muted">
            {done.map((stage) => stage.label).join(" · ")}
            <span aria-hidden="true" className="mx-1.5">›</span>
          </span>
        ) : null}
        {current ? current.label : "확인하는 중"}
        <span className="ml-2 text-sm tabular-nums text-muted">{elapsed}초</span>
      </p>
    </div>
  );
}
