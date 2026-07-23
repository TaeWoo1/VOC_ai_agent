import type { ActionWindowRunView } from "../../lib/actionWindow/contract";
import { channelLabel } from "../../lib/actionWindow/copy";

/**
 * Completed result — shown when the run has finished successfully.
 *
 * Honesty: this surface knows the run reached its final step and NOTHING about what arrived. The
 * run view carries no acquired-row count (the ingest outcome is reduced to `{ok, processed}` at the
 * handoff and is persisted nowhere), so this component must not imply a finished analysis or a
 * number it cannot show. It states what the run proves — the export was collected and handed on —
 * and points at the surface that does hold the review-ops number ("오늘 확인할 일", which reads the
 * attention endpoint per seller account). Do not restore a completion claim here without a field
 * that backs it; that would be a contract change, not a copy change.
 */
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
        {channelLabel(run.channelCode)} 리뷰를 가져와 SellerOps에 넘겼어요.
      </p>
      <p className="mt-1 text-sm text-muted">
        무엇이 들어왔는지는 리뷰 운영 홈의 &lsquo;최근 가져오기 기록&rsquo;에, 확인이 필요한 리뷰는
        채널 화면의 &lsquo;오늘 확인할 일&rsquo;에 표시돼요.
      </p>
      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
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
