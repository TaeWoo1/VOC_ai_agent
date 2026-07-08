import type { ActionWindowRunView } from "../../lib/actionWindow/contract";
import { channelLabel } from "../../lib/actionWindow/copy";

/** Completed result — shown when the run has finished successfully. */
export function CompletedResult({ run }: { run: ActionWindowRunView }) {
  return (
    <section
      aria-label="완료 결과"
      className="rounded-2xl border border-good/30 bg-good/5 p-5 shadow-card"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-xl">
          ✓
        </span>
        <h2 className="text-lg font-semibold text-ink">리뷰 내려받기를 마쳤어요</h2>
      </div>
      <p className="mt-2 text-ink">
        {channelLabel(run.channelCode)} 리뷰를 가져와 정리·분석까지 끝냈어요.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-muted">완료 단계</dt>
          <dd className="mt-0.5 font-semibold text-ink">
            {run.progress.completedSteps} / {run.progress.totalSteps}
          </dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-muted">채널</dt>
          <dd className="mt-0.5 font-semibold text-ink">{channelLabel(run.channelCode)}</dd>
        </div>
      </dl>
    </section>
  );
}
