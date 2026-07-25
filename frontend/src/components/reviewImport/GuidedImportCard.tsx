import { useState } from "react";
import { api } from "../../lib/apiClient";
import {
  agentAvailabilityCopy,
  completionSummaryText,
  importProgress,
  nextRemainingSegment,
  primaryActionLabel,
  segmentRangeText,
  type AgentAvailability,
} from "../../lib/reviewImport";
import type { ReviewImportPlanDetailView, ReviewImportLaunchView, SellerAccountResponse } from "../../lib/types";

/**
 * The seller's whole historical import, as ONE action.
 *
 * The seller does not choose a period, does not manage segments, and never touches a file: they press
 * 과거 리뷰 전체 연동하기, the local agent opens their seller center, a tutorial walks them through the
 * dates and the export, and the download is detected and merged automatically. The monthly plan,
 * segments, attempts, and coverage all still exist — as the internal orchestration this card summarises,
 * not as the workflow.
 *
 * Pressing the button mints a single-use launch ticket; the agent presents that opaque ref to learn what
 * the run may touch. The ref is never rendered — it authorizes action against a live marketplace.
 *
 * When no agent can host a run, the CTA is withheld with a reason rather than failing silently, and the
 * manual file import is offered as an explicit fallback. A button that looks pressable and does nothing is
 * the worst of the available behaviours.
 */
export interface GuidedImportCardProps {
  account: SellerAccountResponse;
  /** The seller's current plan, or null before the first import. */
  plan: ReviewImportPlanDetailView | null;
  /** Whether the local agent can host a guided run right now. */
  agent: AgentAvailability;
  /** Called after a launch is authorized, so the page can refresh plan state. */
  onLaunched?: (launch: ReviewImportLaunchView) => void;
  /** Reveals the secondary manual-file path. */
  onUseFileFallback?: () => void;
}

export function GuidedImportCard({ account, plan, agent, onLaunched, onUseFileFallback }: GuidedImportCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<ReviewImportLaunchView | null>(null);

  const segments = plan?.segments ?? [];
  const progress = importProgress(segments);
  const next = nextRemainingSegment(segments);
  const hasPlan = plan !== null && progress.total > 0;
  const finished = hasPlan && next === null;
  const availability = agentAvailabilityCopy(agent);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      // No plan yet ⇒ discovery first: the plan is built from the range NAVER actually allows, so there is
      // nothing to resume and no period to ask the seller for.
      const launch = plan
        ? await api.launchNextReviewImportSegment(plan.plan.id)
        : await api.startReviewImportDiscovery(account.id);
      setLaunched(launch);
      onLaunched?.(launch);
    } catch {
      setError("가져오기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="과거 리뷰 연동" className="flex flex-col gap-4 rounded-2xl bg-surface p-5 shadow-card">
      <header className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-ink">과거 리뷰 연동</h3>
        <p className="text-sm text-muted break-keep">
          {account.alias ?? account.channelNameKo} · 판매자센터를 열어 순서대로 안내해 드려요.
        </p>
      </header>

      {hasPlan ? (
        <dl className="flex flex-col gap-2 rounded-xl bg-canvas px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-muted">진행</dt>
            <dd className="text-base font-semibold text-ink" data-testid="import-progress">
              {progress.text}
            </dd>
          </div>
          {plan ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-muted">가져올 수 있는 기간</dt>
              <dd className="text-sm text-ink break-keep" data-testid="discovered-range">
                {plan.plan.requestedStart} ~ {plan.plan.requestedEnd}
              </dd>
            </div>
          ) : null}
          {next ? (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-muted">다음 구간</dt>
              <dd className="text-sm text-ink break-keep" data-testid="next-segment-range">
                {segmentRangeText(next)}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {finished ? (
        <p className="rounded-xl bg-good/5 px-4 py-3 text-sm text-ink break-keep" data-testid="completion-summary">
          {completionSummaryText(progress)}
        </p>
      ) : null}

      {/* An unavailable agent explains itself. Collapsing every cause into "offline" is what leaves a
          seller unable to act; each state names its own fix. */}
      {!availability.canGuide ? (
        <p className="rounded-xl bg-warn/5 px-4 py-3 text-sm text-ink break-keep" role="status" data-testid="agent-unavailable">
          {availability.message}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl bg-bad/5 px-4 py-3 text-sm text-bad break-keep" role="alert">
          {error}
        </p>
      ) : null}

      {launched ? (
        <p className="rounded-xl bg-brand/5 px-4 py-3 text-sm text-ink break-keep" role="status" data-testid="guided-run-started">
          판매자센터 창에서 안내를 따라 주세요. 파일을 받으면 SellerOps가 자동으로 정리해요.
        </p>
      ) : null}

      {!finished ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={start}
            disabled={busy || !availability.canGuide}
            data-testid="guided-import-cta"
            className="rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {busy ? "여는 중…" : primaryActionLabel(hasPlan)}
          </button>
          {/* Secondary on purpose: a link, not a button, and only surfaced when guiding cannot happen. */}
          {availability.offerFallback && onUseFileFallback ? (
            <button
              type="button"
              onClick={onUseFileFallback}
              data-testid="file-fallback-link"
              className="self-start text-sm text-brand underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              파일로 가져오기
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
