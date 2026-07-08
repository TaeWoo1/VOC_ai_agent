import type { ActionWindowRunView } from "../../lib/actionWindow/contract";
import { resolveCopy, stepStatusView } from "../../lib/actionWindow/copy";

/** Operation Run timeline — the run's semantic step progress. */
export function OperationRunTimeline({ run }: { run: ActionWindowRunView }) {
  const total = run.progress.totalSteps;
  const completed = run.progress.completedSteps;
  const currentNumber = run.currentStep?.stepNumber;

  return (
    <section aria-label="진행 단계" className="rounded-2xl bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-ink">진행 단계</h2>
        <span className="text-muted" aria-hidden="true">
          {completed} / {total}
        </span>
      </div>
      <ol className="flex flex-col gap-2">
        {Array.from({ length: total }, (_, idx) => {
          const n = idx + 1;
          const isCurrent = currentNumber === n;
          const isDone = !isCurrent && n <= completed;
          const tone = isCurrent
            ? "border-brand bg-brand-50 text-ink"
            : isDone
              ? "border-line bg-canvas text-muted"
              : "border-line bg-surface text-muted";
          const marker = isCurrent ? "●" : isDone ? "✓" : "○";
          const stateLabel = isCurrent ? "진행 중" : isDone ? "완료" : "예정";
          const label =
            isCurrent && run.currentStep
              ? resolveCopy(run.currentStep.copyKey, run.currentStep.copyParams)
              : `${n}단계`;
          return (
            <li
              key={n}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${tone}`}
            >
              <span aria-hidden="true" className="w-5 shrink-0 text-center text-lg">
                {marker}
              </span>
              <span className="min-w-0 flex-1 break-keep font-medium">{label}</span>
              <span className="shrink-0 text-sm">
                <span className="sr-only">상태: </span>
                {stateLabel}
              </span>
            </li>
          );
        })}
      </ol>
      {run.currentStep ? (
        <p className="mt-3 text-sm text-muted">
          현재 단계 상태: {stepStatusView(run.currentStep.status).label}
        </p>
      ) : null}
    </section>
  );
}
