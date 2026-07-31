import type {
  ConnectionCapabilityView,
  ConnectionStatusView,
  CredentialTemplateView,
} from "../../lib/types";
import { relativeTime } from "../../lib/format";
import { ConnectionCapabilityPanel } from "./ConnectionCapabilityPanel";
import {
  ACTOR_COPY,
  DISCONNECT_GUARDRAIL_COPY,
  FAILURE_COPY,
  PHASE_COPY,
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
 * Side-effecting steps are the page's job: the automated phases (registration/test/sync) run their
 * `api` calls in the page and dispatch the result; retries and readiness re-checks come back in as
 * `onRetryTest` / `onRetrySync` / `onRecheck`. This keeps the wizard offline-testable with no api.
 */
export interface GuidedConnectionWizardProps {
  state: GuidedConnectionState;
  template: CredentialTemplateView | null;
  busy: boolean;
  /** Real connection health, read after completion so the seller sees the state + last success time
   *  (§2 step 6). `null` until read (or if the read fails) — the completion CTA stands regardless. */
  connectionStatus: ConnectionStatusView | null;
  /** Sanitized capability result, read after completion (order/review/inquiry status + identity +
   *  first-sync). `null` until read (or if the read fails) — the completion CTA stands regardless. */
  capability: ConnectionCapabilityView | null;
  dispatch: (event: GuidedEvent) => void;
  onRecheck: () => void;
  onConfirmLogin: () => void;
  onSubmitCredentials: (secrets: Record<string, string>) => void;
  onRetryTest: () => void;
  onRetrySync: () => void;
  onGoToReviewExport: () => void;
}

// Issuance guidance uses ONLY facts confirmed from the official NAVER commerce-API docs (slice §4):
// integration-manager permission, the app + API-group + call-IP registration, one app per store, and the
// ID/secret issuance. Exact button labels / layout / 2FA point stay unstated (deferred to live recon, §4).
const ISSUANCE_STEPS = [
  "NAVER 커머스 API 센터에 접속합니다. (애플리케이션 발급에는 통합 매니저 권한이 필요합니다.)",
  "애플리케이션을 생성하고 상품·주문(판매자) 등 필요한 API 그룹을 추가합니다. (스토어별 애플리케이션은 1개만 만들 수 있습니다.)",
  "권한과 호출 IP 설정을 검토한 뒤 발급을 확정합니다.",
  "발급된 애플리케이션 ID와 시크릿을 확인합니다. (시크릿은 다음 단계에서 SellerOps 보안 입력란에 직접 입력합니다.)",
] as const;

export function GuidedConnectionWizard({
  state,
  template,
  busy,
  connectionStatus,
  capability,
  dispatch,
  onRecheck,
  onConfirmLogin,
  onSubmitCredentials,
  onRetryTest,
  onRetrySync,
  onGoToReviewExport,
}: GuidedConnectionWizardProps) {
  const { phase, failureReason } = state;

  return (
    <section className="card p-6" aria-label="NAVER 연결 마법사">
      <StatusPanel state={state} />

      <div className="mt-5">
        {(phase === "readiness_checking" ||
          phase === "credential_registration" ||
          phase === "check_saved_credential") && (
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

        {(phase === "agent_unavailable" || phase === "renderer_unavailable") && (
          <button type="button" className="btn-primary" onClick={onRecheck} disabled={busy}>
            다시 확인
          </button>
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

        {phase === "naver_login_required" &&
          (state.sessionSource === "detected" ? (
            // Live detection is driving: the seller logs in inside the dedicated window and we re-detect —
            // attestation would be ignored here (detection outranks it), so offer a re-check, not attest.
            <button type="button" className="btn-primary" onClick={onRecheck} disabled={busy}>
              로그인 후 다시 확인
            </button>
          ) : (
            // No live detection available (offline / not wired): the seller logs in in the dedicated window
            // and attests it here. Attestation, not a bypass or auto-login.
            <button type="button" className="btn-primary" onClick={onConfirmLogin} disabled={busy}>
              로그인했어요
            </button>
          ))}

        {phase === "naver_reconnect_required" && (
          // A DETECTED reconnect can't be cleared by mere attestation (B4): the seller re-logs-in inside
          // the dedicated window, then we re-check the live session — no password autofill, no bypass.
          <button type="button" className="btn-primary" onClick={onRecheck} disabled={busy}>
            로그인 후 다시 확인
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
          <div className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-base text-ink">
              {ISSUANCE_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <button
              type="button"
              className="btn-primary"
              onClick={() => dispatch({ type: "ISSUANCE_COMPLETE" })}
            >
              발급을 완료했어요
            </button>
          </div>
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
            <div className="space-y-3">
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
            {failureReason && (
              <button type="button" className="btn-ghost" onClick={onRetryTest} disabled={busy}>
                다시 확인
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

        {phase === "first_order_sync" && (
          <div className="space-y-3" role="status" aria-live="polite">
            <p className="text-muted">{PHASE_COPY.first_order_sync.body}</p>
            {failureReason && (
              <button type="button" className="btn-ghost" onClick={onRetrySync} disabled={busy}>
                다시 시도
              </button>
            )}
          </div>
        )}

        {phase === "completed" && (
          <div className="space-y-4">
            {capability && <ConnectionCapabilityPanel capability={capability} />}
            <ConnectionSummary status={connectionStatus} />
            <div className="rounded-lg bg-canvas px-4 py-3" role="note">
              <p className="text-sm font-medium text-muted">{DISCONNECT_GUARDRAIL_COPY.title}</p>
              <p className="mt-1 text-sm text-muted">{DISCONNECT_GUARDRAIL_COPY.body}</p>
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() => dispatch({ type: "CONTINUE_TO_REVIEW_EXPORT" })}
            >
              과거 리뷰 가져오기로 이동
            </button>
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
