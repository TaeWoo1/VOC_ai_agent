import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/apiClient";
import { blockerView } from "../../lib/actionWindow/copy";
import { commandLabel } from "../../lib/actionWindow/copy";
import { useGuidedImport } from "../../lib/actionWindow/import/useGuidedImport";
import type { GuidedImportRuntime } from "../../lib/actionWindow/import/importRuntime";
import {
  agentAvailabilityCopy,
  buildImportGuidancePack,
  completionSummaryText,
  importProgress,
  importStageText,
  nextRemainingSegment,
  primaryActionLabel,
  recheckLabel,
  segmentRangeText,
  type AgentAvailability,
} from "../../lib/reviewImport";
import type { ReviewImportPlanDetailView, ReviewImportLaunchView, SellerAccountResponse } from "../../lib/types";
import { AgentPairingPanel } from "./AgentPairingPanel";
import { ImportRangeChooser } from "./ImportRangeChooser";

/**
 * The seller's whole historical import: one decision here, then the work happens in their seller center.
 *
 * ## The journey, as the product owner set it (2026-07-26)
 *
 * The seller answers ONE question in SellerOps — how far back to import — sees the period and how many monthly
 * exports it becomes, and confirms. From then on **everything is in the SmartStore window**: the local agent
 * highlights each control, and a SellerOps panel in that same page says what to do, why a run stopped, and how to
 * fix it. They come back here when it is done.
 *
 * That is a reversal of what shipped on 2026-07-25, and it was a measured failure rather than a preference: the
 * old flow put the instructions in this window and the highlight in the other one, so the seller alternated
 * between two tabs and a text change in the tab they were not watching was a text change nobody read. The scope
 * gate stopped a run correctly and the operator kept changing a date for thirty seconds afterwards.
 *
 * ## What one press of the CTA does, in order
 *
 *  1. **Attach to the local agent's import carrier.** First, before anything is spent — an agent that cannot
 *     host a guided run must not cost the seller a single-use authorization they then have to wait out.
 *  2. **Hand it the words.** The guidance pack is this frontend's copy; the runtime renders it in the
 *     marketplace page and authors none of it (contract §6 held, not relaxed).
 *  3. **Mint the ticket** for the next segment that still needs a run — most recent month first.
 *  4. **Send `START_RUN`,** binding the run to that ticket, and wait for the agent's acknowledgement.
 *  5. **Hand the ticket back** if the agent refuses or never answers, so a failed attempt costs nothing.
 *
 * From then on the card renders what the RUNTIME publishes: the current step, and a blocker when the run stops.
 * It completes no step and clears no blocker locally — `REQUEST_STEP_RECHECK` says "I did it, look again", and
 * only the runtime decides, by observing. Every command button comes from `allowedCommands`.
 *
 * The launch ref is never rendered. It authorizes action against a live marketplace, so it is a credential.
 */
export interface GuidedImportCardProps {
  account: SellerAccountResponse;
  /** The seller's current plan, or null before they have chosen a period. */
  plan: ReviewImportPlanDetailView | null;
  /** Whether the local agent is paired and reachable at all (from the Bridge status channel). */
  agent: AgentAvailability;
  /**
   * The Bridge pairing surface, owned by the page.
   *
   * Passed in rather than hooked here so the pairing action can appear ON this card without a second bridge
   * client on the same screen — the entry point the live run found missing entirely (finding 14).
   */
  pairing?: { phase: string; confirmationCode?: string | null; onConnect: () => void; onRetry: () => void };
  /** Called once the seller's chosen period has become a plan, so the page can re-read it. */
  onPlanCreated?: (plan: ReviewImportPlanDetailView) => void;
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
  pairing,
  onPlanCreated,
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
      // The words the seller will read in their SmartStore window, before the run that renders them exists. The
      // runtime re-sends this for each segment's session; it never writes a sentence of its own.
      active.setGuidancePack(buildImportGuidancePack());
      if (!plan) {
        // Unreachable through the CTA — with no plan the card shows the chooser instead of this button — but a
        // guard rather than a `!`: a launch minted against no plan would be a ticket for unknown work.
        return;
      }
      const launch = await api.launchNextReviewImportSegment(plan.plan.id);
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
          {account.alias ?? account.channelNameKo} · 판매자센터 화면에서 순서대로 안내해 드려요.
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
              {/* "가져올 기간", not "가져올 수 있는 기간": this is the period the SELLER chose, and nothing
                  here has measured what the marketplace allows (finding 16). */}
              <dt className="text-sm text-muted">가져올 기간</dt>
              <dd className="text-sm text-ink break-keep" data-testid="selected-range">
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

      {/* And the way to FIX it, here, on the card that is blocked without it. The live run had no seller-facing
          pairing entry point at all — it existed only behind a developer env flag (finding 14). */}
      {!availability.canGuide && pairing ? (
        <AgentPairingPanel
          phase={pairing.phase}
          confirmationCode={pairing.confirmationCode ?? null}
          onConnect={pairing.onConnect}
          onRetry={pairing.onRetry}
        />
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
              {type === "REQUEST_STEP_RECHECK"
                ? recheckLabel({ copyKey: snapshot.step?.copyKey ?? null, blockerCode: snapshot.blocker?.code ?? null })
                : commandLabel(type)}
            </button>
          ))}
        </div>
      ) : null}

      {launched && !running ? (
        <p className="rounded-xl bg-brand/5 px-4 py-3 text-sm text-ink break-keep" role="status" data-testid="guided-run-started">
          판매자센터 창으로 이동해 주세요. 이 화면으로 돌아오지 않아도 그 창에서 안내가 계속 나와요.
        </p>
      ) : null}

      {/* No plan yet ⇒ the ONE question this screen asks. A plan ⇒ the button that continues it. The chooser is
          not gated on the agent: deciding how far back to import needs no local helper, and refusing to let the
          seller answer until they have paired one is how an onboarding step becomes a dead end. */}
      {!hasPlan && !running ? (
        <ImportRangeChooser accountId={account.id} onCreated={(created) => onPlanCreated?.(created)} />
      ) : null}

      {hasPlan && !finished && !running ? (
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
