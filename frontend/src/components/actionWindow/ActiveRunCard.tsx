import { Link } from "react-router-dom";
import type { ActionWindowRunView } from "../../lib/actionWindow/contract";
import {
  channelLabel,
  resolveCopy,
  CHECKPOINT_PROMPT_TITLE,
  DESKTOP_ONLY_COPY,
  START_NEW_RUN_LABEL,
} from "../../lib/actionWindow/copy";
import { canStartNewRun } from "../../lib/actionWindow/operationsStore";
import { RunStatusBadge } from "./RunStatusBadge";

/**
 * Home active-zone card — a summary of the current run plus navigation to the run
 * detail. Summary + navigation only: command controls render exclusively on
 * /operations/current (the single `allowedCommands` surface). The one exception is
 * the start-new affordance on a terminal run, which is the idle start affordance —
 * not a run command. `actionsEnabled` is false while the source is offline /
 * reconnecting — navigation stays, command affordances hide.
 */
export function ActiveRunCard({
  run,
  onStartNew,
  actionsEnabled = true,
}: {
  run: ActionWindowRunView;
  onStartNew: () => void;
  actionsEnabled?: boolean;
}) {
  const needsHuman = run.status === "WAITING_FOR_HUMAN";
  const terminal = canStartNewRun(run);

  return (
    <section aria-label="현재 작업" className="rounded-2xl bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="min-w-0 break-keep text-lg font-semibold text-ink">
          {resolveCopy(run.runCopyKey, run.runCopyParams)}
        </h2>
        <RunStatusBadge status={run.status} />
      </div>
      <p className="mt-1 text-sm text-muted">
        채널: {channelLabel(run.channelCode)} · 진행 {run.progress.completedSteps} /{" "}
        {run.progress.totalSteps} 단계
      </p>

      {needsHuman ? (
        <div className="mt-3 rounded-xl border border-warn/30 bg-warn/5 p-3">
          <p className="font-medium text-ink">{CHECKPOINT_PROMPT_TITLE}</p>
          {run.currentStep ? (
            <p className="mt-0.5 text-sm text-muted">
              {resolveCopy(run.currentStep.copyKey, run.currentStep.copyParams)}
            </p>
          ) : null}
        </div>
      ) : null}

      {terminal && run.status === "COMPLETED" ? (
        <p className="mt-3 text-sm text-muted">
          새 작업을 시작하면 이 작업은 최근 활동으로 이동해요.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          to="/operations/current"
          className={
            "rounded-xl px-4 py-2.5 font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 " +
            (needsHuman
              ? "bg-brand text-white hover:bg-brand-600"
              : "border border-line bg-surface text-ink hover:bg-canvas")
          }
        >
          {needsHuman ? "확인하러 가기" : "자세히 보기"}
        </Link>
        {terminal && actionsEnabled ? (
          <button
            type="button"
            onClick={onStartNew}
            className="hidden rounded-xl bg-brand px-4 py-2.5 font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:inline-block"
          >
            {START_NEW_RUN_LABEL}
          </button>
        ) : null}
      </div>
      {terminal && actionsEnabled ? (
        <p className="mt-2 text-sm text-muted sm:hidden">{DESKTOP_ONLY_COPY.startNew}</p>
      ) : null}
    </section>
  );
}
