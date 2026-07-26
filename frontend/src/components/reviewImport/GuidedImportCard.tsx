import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/apiClient";
import { blockerView } from "../../lib/actionWindow/copy";
import { commandLabel } from "../../lib/actionWindow/copy";
import { useGuidedImport } from "../../lib/actionWindow/import/useGuidedImport";
import type { GuidedImportRuntime } from "../../lib/actionWindow/import/importRuntime";
import {
  agentAvailabilityCopy,
  buildImportGuidancePack,
  completionSummaryText,
  continuationAfterNext,
  importProgress,
  importStageText,
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
 *     marketplace page and authors none of it (contract §6 held, not relaxed). It now includes what the panel
 *     says when the run FINISHES — the next month and how many are left — because only this side can see a plan.
 *  3. **Mint the ticket** for the next segment that still needs a run — most recent month first.
 *  4. **Send `START_RUN`,** binding the run to that ticket, and wait for the agent's acknowledgement.
 *  5. **Hand the ticket back** if the agent refuses or never answers, so a failed attempt costs nothing.
 *
 * ## And the seller never has to come back for step 2 of 13 (2026-07-26)
 *
 * A completed segment leaves a panel in the SmartStore window offering the next one. Pressing it runs the exact
 * sequence above — this component's own `start`, the same `POST /plans/{id}/launches/next-segment`, the same
 * agent connection. It reaches here as an `aw_guidance_intent`, which is a REQUEST: the runtime cannot mint a
 * ticket (it holds no plan identity by design) and the local agent has no minting path at all, so the authority
 * for starting a run is exactly where it was before this existed.
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
  const settledRef = useRef<string | null>(null);
  /**
   * `start`, reachable from the panel-intent listener.
   *
   * A ref because the two are mutually dependent — the listener has to exist before `useGuidedImport` is called,
   * and `start` needs the binding that call returns. The alternative was a second copy of the launch sequence for
   * the in-page path, which is exactly how the two entry points would drift apart.
   */
  const startRef = useRef<(() => Promise<void>) | null>(null);
  /**
   * A launch already in flight. A ref rather than the `busy` state because the listener's closure would read a
   * stale one, and a double press on the panel would mint two tickets for one segment.
   */
  const startingRef = useRef(false);

  const onPanelIntent = useCallback((intent: string) => {
    // The seller pressed "continue" inside their SmartStore window. This is the ONLY thing that changes: the
    // ticket still comes from the backend, through the same endpoint the button on this card calls.
    if (intent !== "CONTINUE_NEXT_SEGMENT") return;
    void startRef.current?.();
  }, []);

  const guided = useGuidedImport(runtime, onPanelIntent);

  const segments = plan?.segments ?? [];
  const progress = importProgress(segments);
  // The next segment is the BACKEND's authoritative choice (the same one the ticket authorizes) — not a local
  // re-derivation. The card only resolves that id to the segment it should name.
  const next = plan?.nextSegmentId ? (segments.find((s) => s.id === plan.nextSegmentId) ?? null) : null;
  const hasPlan = plan !== null && progress.total > 0;
  const finished = hasPlan && next === null;
  // The status channel answers "is there an agent at all"; the carrier attach answers "can it host THIS".
  // The second is more specific, so it wins once it has spoken.
  const availability = agentAvailabilityCopy(agent !== "ready" ? agent : guided.unavailable ?? "ready");

  const snapshot = guided.snapshot;
  const running = snapshot !== null && !isTerminal(snapshot.status);

  /**
   * **Attach as soon as this card exists, not only when the CTA is pressed.**
   *
   * The runtime has always known how to recover a live run — `ensureRuntime` resyncs on attach for exactly that
   * reason — but nothing called it until the seller pressed 계속 가져오기. So a page LOAD over a run already in
   * flight built a fresh card: no step, no blocker, and no `다시 확인`.
   *
   * Measured live on 2026-07-26. A run was parked on a recoverable `LOGIN_REQUIRED`; the operator logged into NAVER
   * as asked, came back here, and found a card offering to start something rather than the control that would have
   * resumed what was already running. Pressing the CTA again could not help either: the ticket is idempotent and
   * the agent ignores a replayed `START_RUN` for the run it is already hosting, so the press did nothing at all.
   *
   * Gated on the agent being reachable, so a seller with no helper installed gets no pointless socket — and it
   * runs ONCE, because attaching is the expensive half of this component.
   */
  const attachedRef = useRef(false);
  const ensureRuntime = guided.ensureRuntime;
  useEffect(() => {
    if (attachedRef.current || agent !== "ready") return;
    attachedRef.current = true;
    void ensureRuntime();
  }, [agent, ensureRuntime]);

  // A finished run changed the plan on the server, so the page re-reads it. Keyed by runId so one run notifies
  // once — a repeated view at the same revision must not spam the refresh.
  useEffect(() => {
    if (!snapshot || !isTerminal(snapshot.status)) return;
    if (settledRef.current === snapshot.runId) return;
    settledRef.current = snapshot.runId;
    onRunSettled?.();
  }, [snapshot, onRunSettled]);

  /**
   * Start the next segment — from the button on this card, or from the panel in the seller's SmartStore window.
   *
   * ONE function for both on purpose. The in-page press does not shortcut anything: it arrives as a request, and
   * everything after it is this same sequence, including the backend mint. What the panel changes is where the
   * seller is standing, not who authorizes a run.
   */
  const start = useCallback(async (): Promise<void> => {
    if (!plan) {
      // Unreachable through the CTA — with no plan the card shows the chooser instead of this button — and the
      // guard that makes the panel path safe too: a launch minted against no plan would be a ticket for unknown
      // work.
      return;
    }
    // Two presses (a fast double-click, or the panel while the card is already launching) must not mint two
    // tickets for one segment.
    if (startingRef.current) return;
    startingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      // Attach BEFORE minting. A refused attach after minting would leave an unspent authorization behind.
      const active = await guided.ensureRuntime();
      if (!active) {
        // `guided.unavailable` now explains why, in the same place every other unavailability is explained.
        return;
      }
      // Re-read the plan rather than trust the prop. On the panel path this runs moments after a segment
      // completed, and the props are one render behind — so the continuation copy would name the month that just
      // finished. The ticket would still be right (the server picks the segment), but the panel would be wrong,
      // and a panel that names the wrong month is worse than one that names none.
      const fresh = await api.getReviewImportPlan(plan.plan.id).catch(() => plan);
      // The words the seller will read in their SmartStore window, before the run that renders them exists —
      // including what to do once it finishes. The runtime re-sends this for each segment's session; it never
      // writes a sentence of its own.
      active.setGuidancePack(buildImportGuidancePack(continuationAfterNext(fresh.segments, fresh.nextSegmentId)));
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
      startingRef.current = false;
      setBusy(false);
    }
  }, [plan, guided, onLaunched]);

  startRef.current = start;

  return (
    <section aria-label="과거 리뷰 연동" className="flex flex-col gap-4 rounded-2xl bg-surface p-5 shadow-card">
      <header className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-ink">과거 리뷰 연동</h3>
        {/* The channel is named even when the account has an alias: every step after this is specific to one
            marketplace, and an alias alone does not say which. A seller reached the confirm button with only
            "쿠팡" on screen on 2026-07-26 while the run would have guided NAVER. */}
        <p className="text-sm text-muted break-keep" data-testid="guided-account">
          {account.alias ? `${account.alias} · ${account.channelNameKo}` : account.channelNameKo} · 판매자센터
          화면에서 순서대로 안내해 드려요.
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
          판매자센터 창을 띄웠어요. 남은 구간도 그 창에서 이어서 진행할 수 있으니, 이 화면으로 돌아오지 않아도
          괜찮아요.
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
            onClick={() => void start()}
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
