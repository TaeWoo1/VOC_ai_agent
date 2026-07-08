import type { ActionWindowRunView, CommandType } from "../../lib/actionWindow/contract";
import { blockerView, commandLabel, resolveCopy } from "../../lib/actionWindow/copy";

/**
 * Human Checkpoint card — shown when the run is waiting on the person. The user
 * performs the action on the real marketplace page; pressing "다 했어요" sends
 * REQUEST_STEP_RECHECK (Runtime then verifies). It NEVER marks the step complete
 * on the client — completion is shown only after Runtime confirms.
 */
export function HumanCheckpointCard({
  run,
  onCommand,
}: {
  run: ActionWindowRunView;
  onCommand: (type: CommandType) => void;
}) {
  const step = run.currentStep;
  const blocker = run.blocker ? blockerView(run.blocker.code) : undefined;
  const recheckAllowed = run.allowedCommands.includes("REQUEST_STEP_RECHECK");
  const manualAllowed = run.allowedCommands.includes("SWITCH_TO_MANUAL");

  return (
    <section
      aria-label="확인이 필요한 작업"
      className="rounded-2xl border border-brand-50 bg-brand-50/40 p-5 shadow-card"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-xl">
          🙋
        </span>
        <h2 className="text-lg font-semibold text-ink">지금 해주실 일이 있어요</h2>
      </div>

      {step ? (
        <p className="mt-2 text-ink">{resolveCopy(step.copyKey, step.copyParams)}</p>
      ) : null}
      <p className="mt-1 text-sm text-muted">
        실제 판매자센터 화면에서 직접 진행해 주세요. SellerOps가 대신 클릭하지 않아요.
      </p>

      {blocker ? (
        <div
          role="status"
          className="mt-3 rounded-xl border border-warn/30 bg-warn/5 p-3"
        >
          <p className="font-medium text-ink">
            <span aria-hidden="true">⚠ </span>
            {blocker.title}
            <span className="ml-2 align-middle text-xs text-muted">
              {run.blocker?.recoverable ? "다시 시도할 수 있어요" : "복구할 수 없어요"}
            </span>
          </p>
          <p className="mt-0.5 text-sm text-muted">{blocker.body}</p>
        </div>
      ) : null}

      <div className="mt-4 hidden flex-wrap gap-2 sm:flex">
        {recheckAllowed ? (
          <button
            type="button"
            onClick={() => onCommand("REQUEST_STEP_RECHECK")}
            className="rounded-xl bg-brand px-4 py-2.5 font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            {commandLabel("REQUEST_STEP_RECHECK")}
          </button>
        ) : null}
        {manualAllowed ? (
          <button
            type="button"
            onClick={() => onCommand("SWITCH_TO_MANUAL")}
            className="rounded-xl border border-line bg-surface px-4 py-2.5 font-medium text-ink transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            {commandLabel("SWITCH_TO_MANUAL")}
          </button>
        ) : null}
      </div>

      <p className="mt-3 text-sm text-muted sm:hidden">
        실제 진행과 확인은 데스크톱에서 해주세요. 휴대폰에서는 진행 상황만 볼 수 있어요.
      </p>

      <p className="mt-3 hidden text-xs text-muted sm:block">
        ‘다 했어요’를 누르면 SellerOps가 화면을 다시 확인해요. 단계 완료는 SellerOps가 직접 확인한
        뒤에만 표시돼요.
      </p>
    </section>
  );
}
