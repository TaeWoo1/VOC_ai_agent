import type { ActionWindowRunView, CommandType } from "../../lib/actionWindow/contract";
import {
  blockerView,
  commandLabel,
  resolveCopy,
  CHECKPOINT_PROMPT_TITLE,
  DESKTOP_ONLY_COPY,
} from "../../lib/actionWindow/copy";
import { BlockerNotice } from "./BlockerNotice";

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
      className="rounded-2xl border-2 border-brand/40 bg-brand-50/60 p-5 shadow-card"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-xl">
          🙋
        </span>
        <h2 className="text-lg font-semibold text-brand-700">{CHECKPOINT_PROMPT_TITLE}</h2>
      </div>

      {step ? (
        <p className="mt-2 break-keep text-xl font-semibold text-ink">
          {resolveCopy(step.copyKey, step.copyParams)}
        </p>
      ) : null}
      <p className="mt-1.5 text-sm text-muted">
        실제 판매자센터 화면에서 직접 진행해 주세요. SellerOps가 대신 클릭하지 않아요.
      </p>

      {blocker ? (
        <BlockerNotice
          title={blocker.title}
          body={blocker.body}
          recoverable={!!run.blocker?.recoverable}
          variant="nested"
        />
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

      <p className="mt-3 text-sm text-muted sm:hidden">{DESKTOP_ONLY_COPY.act}</p>

      <p className="mt-3 hidden text-xs text-muted sm:block">
        ‘다 했어요’를 누르면 SellerOps가 화면을 다시 확인해요. 단계 완료는 SellerOps가 직접 확인한
        뒤에만 표시돼요.
      </p>
    </section>
  );
}
