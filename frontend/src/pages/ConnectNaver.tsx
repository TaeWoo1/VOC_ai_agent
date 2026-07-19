import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { GuidedConnectionWizard } from "../components/guidedConnection/GuidedConnectionWizard";
import { useBridge } from "../hooks/useBridge";
import { api } from "../lib/apiClient";
import { selectChannelAccount } from "../lib/channelConnection";
import { guidedConnectionReducer, INITIAL_STATE, resolveNaverSession } from "../lib/guidedConnection";
import type { CredentialTemplateView, SyncRunView } from "../lib/types";
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
  const [state, dispatch] = useReducer(guidedConnectionReducer, INITIAL_STATE);

  const [naverAttested, setNaverAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [template, setTemplate] = useState<CredentialTemplateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolveError, setResolveError] = useState(false);

  // Resolve the NAVER account + credential template once (existing backend boundary, fail-closed).
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
        const naver = channels.find((c) => c.code === "NAVER") ?? null;
        setAccountId(naver ? selectChannelAccount(accounts, naver.id)?.id ?? null : null);
        setTemplate(tmpl);
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

  // Feed pairing (+ the seller's login attestation) into the readiness gate. READINESS is idempotent
  // and a no-op past the gate, so re-dispatching on every bridge tick is safe.
  const agentPaired = bridge.state.phase === "paired";
  useEffect(() => {
    // Offline G3-A/B wires NO live session detection yet (that is G3-C), so detection is null and the
    // seller's attestation drives. resolveNaverSession guarantees that once detection IS wired, a
    // detected reconnect/logout outranks attestation (B4) — attestation can never bypass a live reconnect.
    const { signal, source } = resolveNaverSession(naverAttested, null);
    dispatch({
      type: "READINESS",
      agentPaired,
      rendererAvailable: agentPaired, // ACTION_WINDOW renderer is reached through the paired agent
      naverSession: signal,
      sessionSource: source,
    });
  }, [agentPaired, naverAttested]);

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
  const onGoToReviewExport = useCallback(() => {
    navigate(accountId ? `/settings/channels/${accountId}` : "/settings/channels");
  }, [navigate, accountId]);

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
