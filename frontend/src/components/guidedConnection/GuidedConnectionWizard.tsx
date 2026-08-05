import type {
  ConnectionCapabilityView,
  ConnectionStatusView,
  CredentialTemplateView,
} from "../../lib/types";
import { relativeTime } from "../../lib/format";
import { ConnectionCapabilityPanel } from "./ConnectionCapabilityPanel";
import { NaverIssuanceTutorial } from "./NaverIssuanceTutorial";
import { NaverIssuanceModeChoice } from "./NaverIssuanceModeChoice";
import { NaverIssuanceGuidedWalkthrough } from "./NaverIssuanceGuidedWalkthrough";
import {
  ACTOR_COPY,
  DISCONNECT_GUARDRAIL_COPY,
  FAILURE_COPY,
  NAVER_EXISTING_APP_TUTORIAL,
  PHASE_COPY,
  REVIEW_SETUP_COPY,
  SYNC_PROGRESS_COPY,
  reusesExistingApp,
  type GuidedConnectionState,
  type GuidedEvent,
} from "../../lib/guidedConnection";
import { HealthBadge } from "../HealthBadge";
import { SecureCredentialForm } from "./SecureCredentialForm";

/**
 * NAVER Guided Connection wizard (contract §10, §0 v1 ratification). A CONTROLLED, presentational
 * component: the guided-journey `state` comes in, sanitized intent events go out. It renders one
 * phase at a time, always shows the status panel (current step · who acts · safe failure reason),
 * and hands the Client Secret straight to `onSubmitCredentials` — the secret NEVER enters the
 * reducer state, an event, or storage (§11, §17.4).
 *
 * The initial order connection is Local-Agent-free: there is NO readiness/agent/renderer/NAVER-login
 * phase to render. The Local Agent appears only in the post-completion REVIEW_IMPORT setup card, which is
 * optional and never re-opens the order connection.
 *
 * Side-effecting steps are the page's job: the automated phases (registration/test/sync) run their
 * `api` calls in the page and dispatch the result; retries come back in as `onRetryTest` / `onRetrySync`.
 * This keeps the wizard offline-testable with no api.
 */
export interface GuidedConnectionWizardProps {
  state: GuidedConnectionState;
  template: CredentialTemplateView | null;
  busy: boolean;
  /** Real connection health, read after completion so the seller sees the state + last success time
   *  (§2 step 6). `null` until read (or if the read fails) — the completion CTA stands regardless. */
  connectionStatus: ConnectionStatusView | null;
  /** Sanitized capability result (already Local-Agent-overlaid on REVIEW_IMPORT), read after completion.
   *  `null` until read (or if the read fails) — the completion CTA stands regardless. */
  capability: ConnectionCapabilityView | null;
  /** Whether the Local Agent is paired — drives ONLY the REVIEW_IMPORT setup card copy, never the order flow. */
  reviewImportReady: boolean;
  /** Deployment-global advertised call IP(s) for the register-call-IP tutorial step (all issuance paths).
   *  Empty ⇒ the tutorial shows generic guidance, never a fabricated IP. Available before an account exists. */
  advertisedEgressIps?: readonly string[];
  dispatch: (event: GuidedEvent) => void;
  onSubmitCredentials: (secrets: Record<string, string>) => void;
  onRetryTest: () => void;
  onRetrySync: () => void;
  onGoToReviewExport: () => void;
  /**
   * Live first-sync progress while a sync is being watched — the initial run OR a resumed RUNNING job.
   * `null` when no sync is in flight. Carries only `elapsedMs` (real elapsed, NO percentage — the backend
   * exposes no progress fraction) and a `stalled` flag (the poll timed out). Drives the in-progress screen
   * so a long first sync never reads as "stuck", and a refresh resumes the same run rather than re-triggering.
   */
  syncProgress?: { elapsedMs: number; stalled: boolean } | null;
  /** Re-check the running sync ONCE more (read-only poll — NEVER starts a new sync). Used by the stalled UI. */
  onRecheckSync?: () => void;
}

/** Elapsed as m:ss — honest wall-clock, never a fabricated completion percentage. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** How long before the in-progress screen adds a "taking longer than usual" note (still no percentage). */
const SYNC_SLOW_AFTER_MS = 3 * 60_000;

/**
 * First ORDER_SUMMARY sync in-progress screen. Shows the honest elapsed time (aria-hidden so a per-second
 * tick never spams the live region) plus a static, screen-reader-announced reassurance that refreshing
 * resumes the same run. On a poll timeout (`stalled`) it offers a manual re-check that only polls — it
 * never starts a second collection (the backend single-flight would coalesce it anyway).
 */
function FirstSyncProgress({
  progress,
  onRecheck,
}: {
  progress: { elapsedMs: number; stalled: boolean };
  onRecheck?: () => void;
}) {
  if (progress.stalled) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">{SYNC_PROGRESS_COPY.stalledTitle}</p>
        <p className="text-muted">{SYNC_PROGRESS_COPY.stalledBody}</p>
        <p className="text-sm text-muted" aria-hidden="true">
          {SYNC_PROGRESS_COPY.elapsedLabel}: {formatElapsed(progress.elapsedMs)}
        </p>
        {onRecheck && (
          <button type="button" className="btn-primary" onClick={onRecheck}>
            {SYNC_PROGRESS_COPY.recheckCta}
          </button>
        )}
      </div>
    );
  }
  const slow = progress.elapsedMs >= SYNC_SLOW_AFTER_MS;
  return (
    <div className="space-y-2">
      <p className="text-muted">{SYNC_PROGRESS_COPY.body}</p>
      <div className="flex items-center gap-2" aria-hidden="true">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current text-muted" />
        <span className="text-sm text-muted">
          {SYNC_PROGRESS_COPY.elapsedLabel}: {formatElapsed(progress.elapsedMs)}
        </span>
      </div>
      <p className="text-sm text-muted">{SYNC_PROGRESS_COPY.reassurance}</p>
      {slow && (
        <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-muted">{SYNC_PROGRESS_COPY.slowNote}</p>
      )}
    </div>
  );
}

export function GuidedConnectionWizard({
  state,
  template,
  busy,
  connectionStatus,
  capability,
  reviewImportReady,
  advertisedEgressIps = [],
  dispatch,
  onSubmitCredentials,
  onRetryTest,
  onRetrySync,
  onGoToReviewExport,
  syncProgress = null,
  onRecheckSync,
}: GuidedConnectionWizardProps) {
  const { phase, failureReason } = state;

  return (
    <section className="card p-6" aria-label="NAVER 연결 마법사">
      <StatusPanel state={state} />

      <div className="mt-5">
        {(phase === "credential_registration" || phase === "check_saved_credential") && (
          <p className="text-muted" role="status" aria-live="polite">
            {PHASE_COPY[phase].body}
          </p>
        )}

        {phase === "application_path_choice" && (
          <div className="space-y-2">
            <button
              type="button"
              className="btn-primary block w-full"
              onClick={() => dispatch({ type: "APPLICATION_PATH", choice: "have" })}
            >
              이미 애플리케이션이 있어요
            </button>
            <button
              type="button"
              className="btn-ghost block w-full"
              onClick={() => dispatch({ type: "APPLICATION_PATH", choice: "unknown" })}
            >
              있는지 잘 모르겠어요
            </button>
            <button
              type="button"
              className="btn-ghost block w-full"
              onClick={() => dispatch({ type: "APPLICATION_PATH", choice: "new" })}
            >
              처음 발급할게요
            </button>
          </div>
        )}

        {phase === "application_status_unknown" && (
          <div className="space-y-3">
            <p className="text-muted">{PHASE_COPY.application_status_unknown.body}</p>
            <div className="space-y-2">
              <button
                type="button"
                className="btn-primary block w-full"
                onClick={() => dispatch({ type: "APPLICATION_LIST_RESULT", found: true })}
              >
                목록에서 애플리케이션을 찾았어요
              </button>
              <button
                type="button"
                className="btn-ghost block w-full"
                onClick={() => dispatch({ type: "APPLICATION_LIST_RESULT", found: false })}
              >
                애플리케이션이 없어요
              </button>
            </div>
          </div>
        )}

        {(phase === "recoverable_ui_drift" || phase === "unsupported_state") && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => dispatch({ type: "RESUME" })}
            disabled={busy}
          >
            화면을 확인했어요, 계속
          </button>
        )}

        {phase === "account_store_choice_required" && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => dispatch({ type: "ACCOUNT_STORE_RESOLVED" })}
          >
            계정·스토어를 선택했어요
          </button>
        )}

        {phase === "application_issuance" && (
          <NaverIssuanceModeChoice
            dispatch={dispatch}
            busy={busy}
            advertisedEgressIps={advertisedEgressIps}
          />
        )}

        {phase === "application_issuance_guided" && (
          <NaverIssuanceGuidedWalkthrough
            dispatch={dispatch}
            reuseExistingApp={reusesExistingApp(state.path)}
            busy={busy}
            advertisedEgressIps={advertisedEgressIps}
          />
        )}

        {phase === "credential_issued" && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => dispatch({ type: "BEGIN_CREDENTIAL_ENTRY" })}
          >
            발급된 정보를 입력할게요
          </button>
        )}

        {phase === "sellerops_credential_entry" &&
          (template ? (
            <SecureCredentialForm template={template} onSubmit={onSubmitCredentials} submitting={busy} />
          ) : (
            <p className="text-muted" role="status">
              연결에 필요한 정보를 불러오는 중입니다…
            </p>
          ))}

        {phase === "existing_credential_entry" &&
          (template ? (
            <div className="space-y-4">
              {/* Reached AFTER the guided walk (or a re-entry). The seller has just found the two values, so
                  this is the input screen — no guided/text choice here (guided is the default entry). */}
              <p className="text-sm text-ink break-keep">방금 복사한 애플리케이션 ID와 시크릿을 입력해 주세요.</p>
              {/* Supplementary help if the seller returned without the values (collapsed by default). */}
              <details className="rounded-lg border border-line px-4 py-3">
                <summary className="cursor-pointer select-none text-sm font-medium text-ink">
                  기존 앱에서 어디를 확인하나요?
                </summary>
                <div className="mt-3">
                  <NaverIssuanceTutorial
                    steps={NAVER_EXISTING_APP_TUTORIAL}
                    advertisedEgressIps={advertisedEgressIps}
                  />
                </div>
              </details>
              <SecureCredentialForm template={template} onSubmit={onSubmitCredentials} submitting={busy} />
              <button
                type="button"
                className="btn-ghost"
                onClick={() => dispatch({ type: "SECRET_UNAVAILABLE" })}
                disabled={busy}
              >
                시크릿을 찾지 못했어요
              </button>
            </div>
          ) : (
            <p className="text-muted" role="status">
              연결에 필요한 정보를 불러오는 중입니다…
            </p>
          ))}

        {phase === "credential_recovery_required" && (
          <div className="space-y-3">
            <p className="text-muted">{PHASE_COPY.credential_recovery_required.body}</p>
            <button
              type="button"
              className="btn-primary block w-full"
              onClick={() => dispatch({ type: "SECRET_RECHECKED" })}
            >
              시크릿을 다시 확인했거나 재발급했어요
            </button>
          </div>
        )}

        {phase === "connection_testing" && (
          <div className="space-y-3" role="status" aria-live="polite">
            <p className="text-muted">{PHASE_COPY.connection_testing.body}</p>
            {/* When a test is actually running (the in-session submit chain), show only the progress line.
                Otherwise — a read-only resume that landed here, or a prior failure — the seller triggers the
                check themselves; the page never auto-runs a test/sync on load. */}
            {!busy && (
              <button type="button" className="btn-primary" onClick={onRetryTest}>
                연결 확인
              </button>
            )}
          </div>
        )}

        {phase === "permission_review_required" && (
          <div className="space-y-3">
            <p className="text-muted">{PHASE_COPY.permission_review_required.body}</p>
            <button type="button" className="btn-primary" onClick={onRetryTest} disabled={busy}>
              권한을 확인했어요, 다시 시도
            </button>
          </div>
        )}

        {phase === "call_environment_mismatch" && (
          <div className="space-y-3">
            <p className="text-muted">{PHASE_COPY.call_environment_mismatch.body}</p>
            <button type="button" className="btn-primary" onClick={onRetryTest} disabled={busy}>
              호출 환경을 확인했어요, 다시 시도
            </button>
          </div>
        )}

        {phase === "order_access_denied" && (
          <div className="space-y-3">
            <p className="text-muted">{PHASE_COPY.order_access_denied.body}</p>
            <button type="button" className="btn-primary" onClick={onRetryTest} disabled={busy}>
              권한·호출 IP를 확인했어요, 다시 시도
            </button>
          </div>
        )}

        {phase === "first_order_sync" && (
          <div className="space-y-3" role="status" aria-live="polite">
            {failureReason ? (
              // A settled failure: the safe reason is in the status panel; offer an explicit retry.
              <>
                <p className="text-muted">{PHASE_COPY.first_order_sync.body}</p>
                <button type="button" className="btn-ghost" onClick={onRetrySync} disabled={busy}>
                  다시 시도
                </button>
              </>
            ) : syncProgress ? (
              // Actively running (initial run or a resumed RUNNING job): show progress, never a retry — a
              // second trigger here would only duplicate work the single-flight backend already coalesces.
              <FirstSyncProgress progress={syncProgress} onRecheck={onRecheckSync} />
            ) : (
              <p className="text-muted">{PHASE_COPY.first_order_sync.body}</p>
            )}
          </div>
        )}

        {phase === "completed" && (
          <div className="space-y-4">
            {capability && <ConnectionCapabilityPanel capability={capability} />}
            <ConnectionSummary status={connectionStatus} />
            <ReviewSetupCard
              ready={reviewImportReady}
              onContinue={() => dispatch({ type: "CONTINUE_TO_REVIEW_EXPORT" })}
            />
            <div className="rounded-lg bg-canvas px-4 py-3" role="note">
              <p className="text-sm font-medium text-muted">{DISCONNECT_GUARDRAIL_COPY.title}</p>
              <p className="mt-1 text-sm text-muted">{DISCONNECT_GUARDRAIL_COPY.body}</p>
            </div>
          </div>
        )}

        {phase === "review_export_readiness" && (
          <div className="space-y-3">
            <p className="text-muted">{PHASE_COPY.review_export_readiness.body}</p>
            <button type="button" className="btn-primary" onClick={onGoToReviewExport}>
              리뷰 내보내기로 이동
            </button>
          </div>
        )}

        {phase === "terminal_failure" && (
          <button type="button" className="btn-primary" onClick={() => dispatch({ type: "RESET" })}>
            다시 시도
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Post-completion REVIEW_IMPORT setup card. The order connection is done and Local-Agent-free; review
 * import is a SEPARATE optional step that needs the Local Agent. `ready` reflects bridge pairing (review
 * capability only) and switches only the copy — the CTA always hands off to the review-export setup track.
 */
function ReviewSetupCard({ ready, onContinue }: { ready: boolean; onContinue: () => void }) {
  return (
    <div className="space-y-2 rounded-lg border border-line px-4 py-3" role="note" aria-label="리뷰 가져오기 설정">
      <p className="text-sm font-medium text-ink">{REVIEW_SETUP_COPY.title}</p>
      <p className="text-sm text-muted">{ready ? REVIEW_SETUP_COPY.readyBody : REVIEW_SETUP_COPY.setupRequiredBody}</p>
      <button type="button" className="btn-primary" onClick={onContinue}>
        {REVIEW_SETUP_COPY.cta}
      </button>
    </div>
  );
}

/** Post-completion connection summary: the real connection health + last successful collection time
 *  (§2 step 6). Rendered only once a status has been read; a null status simply omits the block. */
function ConnectionSummary({ status }: { status: ConnectionStatusView | null }) {
  if (!status) return null;
  return (
    <div className="space-y-2 rounded-lg bg-canvas px-4 py-3" role="status">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted">연결 상태</span>
        <HealthBadge state={status.state} />
      </div>
      <p className="text-sm text-muted">
        마지막 성공 수집: {status.lastSuccessAt ? relativeTime(status.lastSuccessAt) : "아직 없음"}
      </p>
    </div>
  );
}

/** Always-visible status: current step, who acts next, and the safe failure reason (if any). */
function StatusPanel({ state }: { state: GuidedConnectionState }) {
  const { phase, actor, failureReason } = state;
  const copy = PHASE_COPY[phase];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">{copy.title}</h2>
        <span className="rounded-full bg-canvas px-3 py-1 text-sm font-medium text-muted">
          {ACTOR_COPY[actor]}
        </span>
      </div>
      <p className="text-base text-muted">{copy.body}</p>
      {failureReason && (
        <p className="rounded-lg bg-warn/60 px-3 py-2 text-sm text-ink" role="alert">
          {FAILURE_COPY[failureReason]}
        </p>
      )}
    </div>
  );
}
