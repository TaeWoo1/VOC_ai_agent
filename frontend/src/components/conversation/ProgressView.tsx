import type { ProgressStageEvent } from "../../lib/conversation/types";

/**
 * Only what the runtime said it reached — each stage with a check as it arrives — and a measured
 * clock. No bar, no invented steps: a stage the runtime never reported is not drawn (design contract §9).
 */
export function ProgressView({ stages, elapsed }: { stages: ProgressStageEvent[]; elapsed: number }) {
  return (
    <div role="status" aria-live="polite" className="rounded-2xl border border-line bg-canvas px-4 py-3" data-testid="conversation-progress">
      <ol className="space-y-1">
        {stages.map((stage, i) => (
          <li key={`${stage.stage}-${i}`} className="flex items-center gap-2 text-sm text-ink">
            <span aria-hidden="true" className="text-good">✓</span>
            <span>{stage.label}</span>
          </li>
        ))}
      </ol>
      <p className={`text-sm tabular-nums text-muted ${stages.length > 0 ? "mt-1.5" : ""}`}>
        확인하는 중 · {elapsed}초
      </p>
    </div>
  );
}
