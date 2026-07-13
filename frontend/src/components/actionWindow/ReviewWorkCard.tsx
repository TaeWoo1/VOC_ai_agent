import {
  DESKTOP_ONLY_COPY,
  REVIEW_WORK_COPY,
  SECTION_TITLE,
  resolveCopy,
} from "../../lib/actionWindow/copy";

/**
 * First-run review-work surface — shown on the /operations home only, when there is no run.
 * A state-driven current-task card (seller-center worklist style: SmartStore / Wing / Cafe24):
 * it shows ONLY the one actionable step for this state — task title, overall status, the current
 * step, and its action. It is not an onboarding explainer and not a step/result preview: later
 * steps and results appear in <ActiveRunCard> once a run exists (progressive disclosure happens at
 * the page level, when run !== null), never previewed here. Desktop shows the action; mobile is
 * read-only. Copy is FE-owned; the task title reuses the run copy key so the name never drifts.
 * 채널 is omitted (no value before a run).
 *
 * Home-only by design: /operations/current keeps <EmptyStartCard> unchanged.
 */
export function ReviewWorkCard({
  connected,
  onStart,
}: {
  connected: boolean;
  onStart: () => void;
}) {
  const taskTitle = resolveCopy("actionWindow.review.run");
  return (
    <section aria-label={SECTION_TITLE.reviewWork} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">{SECTION_TITLE.reviewWork}</h2>

      <div className="rounded-2xl bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="min-w-0 break-keep text-lg font-semibold text-ink">{taskTitle}</h3>
          <span className="shrink-0 rounded-full bg-canvas px-3 py-1 text-sm text-muted">
            {REVIEW_WORK_COPY.statusLabel}
          </span>
        </div>

        {/* Current step — the only actionable step at this state. Later steps and results are
            revealed by <ActiveRunCard> once a run exists; nothing is previewed before then. */}
        <div className="mt-3 rounded-xl border border-line bg-canvas p-4">
          <p className="text-sm font-medium text-muted">{REVIEW_WORK_COPY.currentStepLabel}</p>
          <p className="mt-1 break-keep text-ink">{REVIEW_WORK_COPY.currentStepText}</p>
        </div>

        {connected ? (
          <button
            type="button"
            onClick={onStart}
            className="mt-4 hidden rounded-xl bg-brand px-5 py-3 font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:inline-block"
          >
            {REVIEW_WORK_COPY.actionLabel}
          </button>
        ) : null}
        <p className="mt-4 text-sm text-muted sm:hidden">{DESKTOP_ONLY_COPY.start}</p>
      </div>
    </section>
  );
}
