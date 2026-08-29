import type { ProgressStageEvent } from "../../lib/conversation/types";

/**
 * Only what the runtime said it reached — the latest stage as one line, the earlier ones as quiet
 * checks — and a measured clock. No bar, no invented steps: a stage the runtime never reported is not
 * drawn (design contract §9). Chat density (Chat UI v1): one row where the answer will appear.
 */
export function ProgressView({ stages, elapsed }: { stages: ProgressStageEvent[]; elapsed: number }) {
  const current = stages[stages.length - 1] ?? null;
  return (
    <div role="status" aria-live="polite" className="flex items-start gap-2" data-testid="conversation-progress">
      <span aria-hidden="true" className="mt-0.5 animate-pulse text-brand-700">✳︎</span>
      <div className="min-w-0 flex-1">
        <p className="text-base text-ink">
          {current ? current.label : "확인하는 중"}
          <span className="ml-2 text-sm tabular-nums text-muted">{elapsed}초</span>
        </p>
        {stages.length > 1 ? (
          <ol className="mt-1 space-y-0.5">
            {stages.slice(0, -1).map((stage, i) => (
              <li key={`${stage.stage}-${i}`} className="flex items-center gap-1.5 text-sm text-muted">
                <span aria-hidden="true" className="text-good">✓</span>
                <span>{stage.label}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
