import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { GuidedConnectionWizard } from "../components/guidedConnection/GuidedConnectionWizard";
import { useBridge } from "../hooks/useBridge";
import { api } from "../lib/apiClient";
import { selectChannelAccount } from "../lib/channelConnection";
import {
  clearGuidedProgress,
  guidedConnectionReducer,
  loadGuidedInitialState,
  resolveNaverSession,
  saveGuidedProgress,
} from "../lib/guidedConnection";
import { bridgeSessionDetection } from "../lib/guidedConnection/bridgeSession";
import type {
  ConnectionCapabilityView,
  ConnectionStatusView,
  CredentialTemplateView,
  SyncRunView,
} from "../lib/types";
import type { GuidedSyncStatus } from "../lib/guidedConnection";

/**
 * NAVER guided-connection wizard page (contract §0 v1 ratification, §16.10 six steps).
 *
 * Thin wiring layer: it owns the guided-journey reducer, resolves the NAVER seller account +
 * credential template from the existing backend boundary, feeds bridge pairing into the readiness
 * gate, and runs the automated steps (register → test → first sync) as an imperative chain so the
 * Client Secret goes straight to `api.storeCredential` and NEVER through the reducer/an event/storage
 * (§11, §17.4). No new backend capability, no live NAVER, no cropped/projection UI.
 */

/** Map the backend SyncRunView.status onto the guided sync vocabulary. */
function toSyncStatus(run: SyncRunView): GuidedSyncStatus {
  switch (run.status) {
    case "SUCCESS":
    case "PARTIAL":
    case "FAILED":
    case "RUNNING":
      return run.status;
    default:
      // Unknown/absent status is treated as a non-advancing signal (fail-closed).
      return "RUNNING";
  }
}

export function ConnectNaver() {
  const navigate = useNavigate();
  const bridge = useBridge();
  // Lazy init restores a safe, secret-free pre-registration step after a browser refresh; anything
  // else starts fresh and lets the saved-credential re-check drive recovery from the backend.
  const [state, dispatch] = useReducer(guidedConnectionReducer, undefined, () => loadGuidedInitialState());

  const [naverAttested, setNaverAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [template, setTemplate] = useState<CredentialTemplateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolveError, setResolveError] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatusView | null>(null);
  const [capability, setCapability] = useState<ConnectionCapabilityView | null>(null);

  // Persist the sanitized, resumable slice (phase + path only — never a secret) so a refresh can
  // restore a pre-registration step. Automated/terminal phases are written too but are non-restorable
  // on reload (they fall back to the backend-driven recovery), so this can never strand a spinner.
  useEffect(() => {
    saveGuidedProgress(state);
  }, [state.phase, state.path]);

  // Resolve (or START) the NAVER connection: find the API-mode account this org attaches credentials
  // to, and if a first-time seller has none, create it. Creating a PENDING account is the "연결 시작"
  // step — it records the account only (idempotent server-side, no secret, no live provider call), so
  // the wizard is never stranded with nothing to register against. Existing backend boundary, fail-closed.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [channels, accounts, tmpl] = await Promise.all([
          api.getChannelsStrict(),
          api.getSellerAccountsStrict(),
          api.getCredentialTemplateStrict("NAVER"),
        ]);
        if (!alive) return;
        setTemplate(tmpl);
        const naver = channels.find((c) => c.code === "NAVER") ?? null;
        if (!naver) {
          setAccountId(null);
          return;
        }
        const existing = selectChannelAccount(accounts, naver.id);
        if (existing) {
          setAccountId(existing.id);
          return;
        }
        const created = await api.createApiChannelAccount(naver.id);
        if (alive) setAccountId(created.id);
      } catch {
        if (alive) setResolveError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // On completion, read the real connection health so the seller sees the connection state + last
  // successful collection time (§2 step 6). Non-fatal: a read failure just omits the status line — the
  // journey is already `completed` from the registration→test→sync milestones, not from this read.
  useEffect(() => {
    if (state.phase !== "completed" || !accountId) return;
    let alive = true;
    (async () => {
      try {
        const status = await api.getConnectionStatusStrict(accountId);
        if (alive) setConnectionStatus(status);
      } catch {
        /* status line omitted on failure; completion stands on its milestones */
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.phase, accountId]);

  // On completion, read the sanitized capability result (order/review/inquiry status + identity +
  // first-sync) so the seller sees the honest per-surface capability contract. Non-fatal: a read
  // failure just omits the panel — completion already stands on the registration→test→sync milestones.
  useEffect(() => {
    if (state.phase !== "completed" || !accountId) return;
    let alive = true;
    (async () => {
      try {
        const cap = await api.getConnectionCapabilityStrict(accountId);
        if (alive) setCapability(cap);
      } catch {
        /* capability panel omitted on failure; completion stands on its milestones */
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.phase, accountId]);

  // Feed pairing (+ the seller's login attestation) into the readiness gate. READINESS is idempotent
  // and a no-op past the gate, so re-dispatching on every bridge tick is safe.
  const agentPaired = bridge.state.phase === "paired";
  // Live session detection from the paired bridge (B4). `null` when unavailable → attestation fallback.
  const detected = bridgeSessionDetection(bridge.state);
  useEffect(() => {
    // resolveNaverSession makes a detected reconnect/logout outrank attestation (B4) — the seller can
    // never attest past a live-observed reconnect; attestation drives only when detection is unavailable.
    const { signal, source } = resolveNaverSession(naverAttested, detected);
    dispatch({
      type: "READINESS",
      agentPaired,
      rendererAvailable: agentPaired, // ACTION_WINDOW renderer is reached through the paired agent
      naverSession: signal,
      sessionSource: source,
    });
    // `state.phase` is a dep so the gate re-evaluates the moment the saved-credential check hands off to
    // `readiness_checking` (READINESS is a no-op in any non-gate phase, so this cannot loop).
  }, [agentPaired, naverAttested, detected, state.phase]);

  const runFirstSync = useCallback(async () => {
    if (!accountId) return;
    setBusy(true);
    try {
      const run = await api.manualSync(accountId, "ORDER_SUMMARY");
      dispatch({ type: "SYNC_RESULT", status: toSyncStatus(run) });
    } catch {
      dispatch({ type: "SYNC_RESULT", status: "FAILED" });
    } finally {
      setBusy(false);
    }
  }, [accountId]);

  const runTest = useCallback(async () => {
    if (!accountId) return;
    setBusy(true);
    try {
      const result = await api.testConnection(accountId);
      dispatch({ type: "TEST_RESULT", status: result.status, reasonCode: result.reasonCode });
      if (result.status === "SUCCESS") await runFirstSync();
    } catch {
      dispatch({ type: "TEST_RESULT", status: "FAILED", reasonCode: "TEMPORARY_PROVIDER_ERROR" });
    } finally {
      setBusy(false);
    }
  }, [accountId, runFirstSync]);

  // Saved-credential check (§flow 1): once the account is known, ask the backend whether a credential is
  // already on file. If so, reuse it — go straight to the connection test with NO re-entry (a stored key
  // means registration already happened). A failed/absent read fails closed to the normal gate/entry path,
  // never a false reuse. The `phase === check_saved_credential` guard makes this fire exactly once per
  // journey: the dispatch moves the phase off the entry, so any later run early-returns. (No ref guard —
  // a ref would persist across StrictMode's remount and suppress the only surviving dispatch; the phase
  // guard + `alive` handle StrictMode correctly, at worst one extra harmless GET in dev.)
  useEffect(() => {
    if (!accountId || state.phase !== "check_saved_credential") return;
    let alive = true;
    (async () => {
      let hasSaved = false;
      try {
        hasSaved = (await api.getConnectionInfoStrict(accountId)) !== null;
      } catch {
        hasSaved = false; // fail closed: never reuse a key we could not confirm
      }
      if (!alive) return;
      dispatch({ type: "SAVED_CREDENTIAL_CHECKED", hasSavedCredential: hasSaved });
      if (hasSaved) void runTest();
    })();
    return () => {
      alive = false;
    };
  }, [accountId, state.phase, runTest]);

  const onSubmitCredentials = useCallback(
    async (secrets: Record<string, string>) => {
      if (!accountId || !template) return;
      dispatch({ type: "SUBMIT_CREDENTIALS" });
      setBusy(true);
      try {
        // The secret leaves here directly for the backend Vault — never into the reducer/an event.
        await api.storeCredential(accountId, {
          connectorClass: template.connectorClass,
          authType: template.authType,
          secrets,
        });
        dispatch({ type: "CREDENTIAL_REGISTERED" });
        await runTest();
      } catch {
        dispatch({ type: "REGISTRATION_FAILED" });
      } finally {
        setBusy(false);
      }
    },
    [accountId, template, runTest],
  );

  const onConfirmLogin = useCallback(() => setNaverAttested(true), []);
  const onRecheck = useCallback(() => bridge.retry(), [bridge]);
  // Hand off to the existing past-review-import track (§0 review-export-readiness). Reviews are NOT
  // collected here — this only carries the connected seller into the Action Window export journey.
  const onGoToReviewExport = useCallback(() => {
    // Completion consumed — clear the resume slice so a later visit starts a fresh journey.
    clearGuidedProgress();
    navigate("/settings/review-import");
  }, [navigate]);

  const credentialUnavailable = useMemo(
    () => !loading && !resolveError && (!accountId || !template),
    [loading, resolveError, accountId, template],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="NAVER 스마트스토어 연결"
        description="주문은 공식 API로 연결하고, 리뷰는 작업 창에서 직접 내보냅니다. 로그인·인증은 직접 진행합니다."
      />

      {loading && <p className="text-muted">연결 준비 정보를 불러오는 중입니다…</p>}

      {resolveError && (
        <p className="card p-5 text-bad" role="alert">
          연결 준비 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      )}

      {!loading && !resolveError && (
        <>
          {credentialUnavailable && (
            <p className="card p-5 text-muted" role="status">
              NAVER 채널 준비가 필요합니다. 연결 정보를 입력하려면 먼저 채널을 준비해 주세요.
            </p>
          )}
          <GuidedConnectionWizard
            state={state}
            template={template}
            busy={busy}
            connectionStatus={connectionStatus}
            capability={capability}
            dispatch={dispatch}
            onRecheck={onRecheck}
            onConfirmLogin={onConfirmLogin}
            onSubmitCredentials={onSubmitCredentials}
            onRetryTest={runTest}
            onRetrySync={runFirstSync}
            onGoToReviewExport={onGoToReviewExport}
          />
        </>
      )}
    </div>
  );
}
