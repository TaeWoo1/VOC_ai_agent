import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/apiClient";
import { blockerView } from "../../lib/actionWindow/copy";
import { commandLabel } from "../../lib/actionWindow/copy";
import { useGuidedImport } from "../../lib/actionWindow/import/useGuidedImport";
import type { GuidedImportRuntime } from "../../lib/actionWindow/import/importRuntime";
import {
  agentAvailabilityCopy,
  completionSummaryText,
  importProgress,
  importStageText,
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
 * ## What one press actually does, in order
 *
 *  1. **Attach to the local agent's import carrier.** First, before anything is spent — an agent that cannot
 *     host a guided run must not cost the seller a single-use authorization they then have to wait out.
 *  2. **Mint the ticket.** No plan yet ⇒ range discovery, which finds what NAVER allows and creates the plan
 *     from it. A plan in progress ⇒ the next segment that still needs a run.
 *  3. **Send `START_RUN`,** binding the run to that ticket, and wait for the agent's acknowledgement.
 *  4. **Hand the ticket back** if the agent refuses or never answers, so a failed attempt costs nothing.
 *
 * From then on the card renders what the RUNTIME publishes: the current step, and a blocker when the run stops.
 * It completes no step and clears no blocker locally — `REQUEST_STEP_RECHECK` says "I did it, look again", and
 * only the runtime decides, by observing. Every command button comes from `allowedCommands`.
 *
 * The launch ref is never rendered. It authorizes action against a live marketplace, so it is a credential.
 */
export interface GuidedImportCardProps {
  account: SellerAccountResponse;
  /** The seller's current plan, or null before the first import. */
  plan: ReviewImportPlanDetailView | null;
  /** Whether the local agent is paired and reachable at all (from the Bridge status channel). */
  agent: AgentAvailability;
  /** Called after a launch is authorized, so the page can refresh plan state. */
  onLaunched?: (launch: ReviewImportLaunchView) => void;
  /** Called when a guided run reaches a terminal state, so the page can re-read the plan it just changed. */
  onRunSettled?: () => void;
  /** Reveals the secondary manual-file path. */
  onUseFileFallback?: () => void;
  /** Test seam: an already-built runtime, so a component test needs no bridge. */
  runtime?: GuidedImportRuntime;
}

/** Commands the seller may be offered on this card, in the order they should appear. */
const OFFERED_COMMANDS = ["REQUEST_STEP_RECHECK", "CANCEL_RUN"] as const;

export function GuidedImportCard({
  account,
  plan,
  agent,
  onLaunched,
  onRunSettled,
  onUseFileFallback,
  runtime,
}: GuidedImportCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<ReviewImportLaunchView | null>(null);
  const guided = useGuidedImport(runtime);
  const settledRef = useRef<string | null>(null);

  const segments = plan?.segments ?? [];
  const progress = importProgress(segments);
  const next = nextRemainingSegment(segments);
  const hasPlan = plan !== null && progress.total > 0;
  const finished = hasPlan && next === null;
  // The status channel answers "is there an agent at all"; the carrier attach answers "can it host THIS".
  // The second is more specific, so it wins once it has spoken.
  const availability = agentAvailabilityCopy(agent !== "ready" ? agent : guided.unavailable ?? "ready");

  const snapshot = guided.snapshot;
  const running = snapshot !== null && !isTerminal(snapshot.status);

  // A finished run changed the plan on the server, so the page re-reads it. Keyed by runId so one run notifies
  // once — a repeated view at the same revision must not spam the refresh.
  useEffect(() => {
    if (!snapshot || !isTerminal(snapshot.status)) return;
    if (settledRef.current === snapshot.runId) return;
    settledRef.current = snapshot.runId;
    onRunSettled?.();
  }, [snapshot, onRunSettled]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      // Attach BEFORE minting. A refused attach after minting would leave an unspent authorization behind.
      const active = await guided.ensureRuntime();
      if (!active) {
        // `guided.unavailable` now explains why, in the same place every other unavailability is explained.
        return;
      }
      // No plan yet ⇒ discovery first: the plan is built from the range NAVER actually allows, so there is
      // nothing to resume and no period to ask the seller for.
      const launch = plan
        ? await api.launchNextReviewImportSegment(plan.plan.id)
        : await api.startReviewImportDiscovery(account.id);
      try {
        await active.start({ launchRef: launch.launchRef, kind: launch.kind });
      } catch (e) {
        // The agent refused or never answered, so the ticket was never spent — hand it back rather than let it
        // sit until it expires and blocks the next attempt.
        await api.expireReviewImportLaunch(launch.launchRef).catch(() => {});
        throw e;
      }
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

      {finished && !running ? (
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

      {/* What the RUNTIME says is happening. Present only while a run is live, so a finished run's last step
          does not linger as though the seller still had something to do. */}
      {running && snapshot?.step ? (
        <div className="flex flex-col gap-2 rounded-xl bg-brand/5 px-4 py-3" data-testid="guided-run-progress">
          <p className="text-sm font-medium text-ink break-keep">
            <span className="text-muted" data-testid="guided-step-count">
              {snapshot.step.totalSteps}단계 중 {snapshot.step.stepNumber}
            </span>{" "}
            · {importStageText(snapshot.step.copyKey)}
          </p>
          {requiredWindowText(snapshot.step.copyParams) ? (
            <p className="text-sm text-muted break-keep" data-testid="guided-required-range">
              가져올 기간: {requiredWindowText(snapshot.step.copyParams)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* A stopped run says WHY and what repairs it. Without this the runtime reported a scope mismatch
          correctly and the seller saw nothing change on their screen. */}
      {running && snapshot?.blocker ? (
        <div className="flex flex-col gap-1 rounded-xl bg-warn/10 px-4 py-3" role="alert" data-testid="guided-run-blocker">
          <p className="text-sm font-semibold text-ink break-keep">{blockerView(snapshot.blocker.code).title}</p>
          <p className="text-sm text-ink break-keep">{blockerView(snapshot.blocker.code).body}</p>
        </div>
      ) : null}

      {/* Rendered from `allowedCommands` alone — never from what the card believes the state to be. */}
      {running && snapshot ? (
        <div className="flex flex-wrap gap-2" data-testid="guided-run-commands">
          {OFFERED_COMMANDS.filter((type) => snapshot.allowedCommands.includes(type)).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => guided.send(type)}
              data-testid={`guided-command-${type}`}
              className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-line/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {commandLabel(type)}
            </button>
          ))}
        </div>
      ) : null}

      {launched && !running ? (
        <p className="rounded-xl bg-brand/5 px-4 py-3 text-sm text-ink break-keep" role="status" data-testid="guided-run-started">
          판매자센터 창에서 안내를 따라 주세요. 파일을 받으면 SellerOps가 자동으로 정리해요.
        </p>
      ) : null}

      {!finished && !running ? (
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

function isTerminal(status: string): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED" || status === "OPERATOR_REPORTED";
}

/**
 * The window a segment run is asking the seller to select, from the step's sanitized copy params.
 *
 * Shown because it is the target they have to match — the gate blocks the export until it does — and a
 * tutorial that highlights a date field without saying which date is not guidance. A discovery run has no
 * required window (it is finding one out), so it carries none and this renders nothing.
 */
function requiredWindowText(params: Record<string, string | number | boolean>): string | null {
  const start = params.requiredStart;
  const end = params.requiredEnd;
  if (typeof start !== "string" || typeof end !== "string" || start === "" || end === "") return null;
  return `${start} ~ ${end}`;
}
