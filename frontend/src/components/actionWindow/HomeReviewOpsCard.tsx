import { Link } from "react-router-dom";
import type { ActionWindowRunView } from "../../lib/actionWindow/contract";
import {
  channelLabel,
  resolveCopy,
  CHECKPOINT_PROMPT_TITLE,
  HOME_REVIEW_OPS_COPY,
} from "../../lib/actionWindow/copy";
import { RunStatusBadge } from "./RunStatusBadge";

/**
 * Home "리뷰 운영" activity strip — a compact, read-only summary of the current
 * review run that deep-links into the operations workbench. It NEVER starts or
 * commands a run (that lives on /operations); it only reflects and links.
 *
 * Honesty: the caller (Home) passes `run` ONLY when it is honestly presentable as
 * live activity — a live-bridge run, or the DEV fixture preview — and `null`
 * otherwise, so the real-data Home cockpit never shows a seeded/mock run as a live
 * job. `run === null` renders the calm empty state with a link to open the
 * workbench. A `WAITING_FOR_HUMAN` run surfaces the checkpoint prompt and points
 * the primary action at the run detail ("확인하러 가기").
 */
export function HomeReviewOpsCard({ run }: { run: ActionWindowRunView | null }) {
  return (
    <section aria-label={HOME_REVIEW_OPS_COPY.sectionTitle} className="card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-ink">{HOME_REVIEW_OPS_COPY.sectionTitle}</h2>
        {run ? <RunStatusBadge status={run.status} /> : null}
      </div>
      {run ? <RunSummary run={run} /> : <EmptyReviewOps />}
    </section>
  );
}

function RunSummary({ run }: { run: ActionWindowRunView }) {
  const needsHuman = run.status === "WAITING_FOR_HUMAN";
  return (
    <div>
      <p className="break-keep text-lg font-semibold text-ink">
        {resolveCopy(run.runCopyKey, run.runCopyParams)}
      </p>
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

      <div className="mt-4">
        <Link
          to={needsHuman ? "/connect/imports/current" : "/connect/imports"}
          className={needsHuman ? "btn-primary" : "btn-ghost"}
        >
          {needsHuman ? HOME_REVIEW_OPS_COPY.goToCheckpoint : HOME_REVIEW_OPS_COPY.open} →
        </Link>
      </div>
    </div>
  );
}

function EmptyReviewOps() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted">{HOME_REVIEW_OPS_COPY.emptyBody}</p>
      <Link to="/connect/imports" className="btn-ghost">
        {HOME_REVIEW_OPS_COPY.open} →
      </Link>
    </div>
  );
}
