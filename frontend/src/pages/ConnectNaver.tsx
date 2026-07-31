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
  overlayReviewImport,
  saveGuidedProgress,
} from "../lib/guidedConnection";
import type {
  ConnectionCapabilityView,
  ConnectionStatusView,
  CredentialTemplateView,
  SyncRunView,
} from "../lib/types";
import type { GuidedSyncStatus } from "../lib/guidedConnection";

/**
 * NAVER guided-connection wizard page (contract §0 v1 ratification).
 *
 * Thin wiring layer: it owns the guided-journey reducer, resolves the NAVER seller account +
 * credential template from the existing backend boundary, and runs the automated steps
 * (register → test → first sync) as an imperative chain so the Client Secret goes straight to
 * `api.storeCredential` and NEVER through the reducer/an event/storage (§11, §17.4).
 *
 * **Local-Agent-free order connection.** The order connection uses ONLY backend calls — there is no
 * bridge/agent readiness gate. The Local Agent (`useBridge`) is read solely to decide the
 * post-completion REVIEW_IMPORT capability (SETUP_REQUIRED vs GUIDED_CONFIRMATION); it never gates the
 * order flow, and when the bridge feature flag is off the order connection is entirely unaffected.
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
  // The order connection never uses the bridge. Only open a bridge client when the surface flag is on
  // (mirrors AppShell), so a flag-off order connection opens no local connection and prompts for nothing.
  const agentBridgeEnabled = import.meta.env.VITE_ENABLE_AGENT_BRIDGE === "true";
  const bridge = useBridge(agentBridgeEnabled);
  // Lazy init restores a safe, secret-free pre-registration step after a browser refresh; anything
  // else starts fresh and lets the saved-credential re-check drive recovery from the backend.
  const [state, dispatch] = useReducer(guidedConnectionReducer, undefined, () => loadGuidedInitialState());

  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [template, setTemplate] = useState<CredentialTemplateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolveError, setResolveError] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatusView | null>(null);
  const [capability, setCapability] = useState<ConnectionCapabilityView | null>(null);

  // Local Agent pairing — used ONLY to reflect the REVIEW_IMPORT capability, never to gate the order flow.
  // When the bridge surface is off the client is never opened, so review import honestly shows
  // SETUP_REQUIRED — and the order flow is unaffected either way.
  const agentPaired = agentBridgeEnabled && bridge.state.phase === "paired";

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

  // Read-only resume (§flow 1): once the account is known, read the backend capability snapshot — a pure
  // read of PERSISTED state (credential presence + latest ORDER_SUMMARY sync outcome), NO live NAVER call,
  // no token mint, no sync job. It decides where a page load lands WITHOUT running anything:
  //   • a prior first sync succeeded → restore the completed screen (no re-test/re-sync);
  //   • a stored key but not completed → the connection test as a USER CTA (the seller presses it);
  //   • no stored key → the three-path fork.
  // A capability read failure fails SAFE to the fork (never a false completion, never an auto-sync). The
  // `phase === check_saved_credential` guard fires this once per journey and makes StrictMode's double
  // mount at worst one extra read-only GET — never a duplicate test/sync (nothing runs here).
  useEffect(() => {
    if (!accountId || state.phase !== "check_saved_credential") return;
    let alive = true;
    (async () => {
      try {
        const cap = await api.getConnectionCapabilityStrict(accountId);
        if (!alive) return;
        const completed =
          cap.credentialPresent &&
          cap.identityConfirmed &&
          (cap.firstSyncStatus === "SUCCESS" || cap.firstSyncStatus === "PARTIAL");
        if (completed) setCapability(cap); // seed the panel so the restored screen needs no extra read
        dispatch({ type: "RESUME_FROM_CAPABILITY", credentialPresent: cap.credentialPresent, completed });
      } catch {
        // Fail safe: cannot read state → do NOT claim completion and do NOT auto-run anything; land on the
        // fork so the seller can proceed (enter/reuse a key) with an explicit action.
        if (alive) dispatch({ type: "RESUME_FROM_CAPABILITY", credentialPresent: false, completed: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, [accountId, state.phase]);

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

  // Hand off to the existing past-review-import track (§0 review-export-readiness). Reviews are NOT
  // collected here — this only carries the connected seller into the Action Window export journey, which
  // is where the Local Agent (pairing + seller-center login + Action Window) is set up.
  const onGoToReviewExport = useCallback(() => {
    // Completion consumed — clear the resume slice so a later visit starts a fresh journey.
    clearGuidedProgress();
    navigate("/settings/review-import");
  }, [navigate]);

  const credentialUnavailable = useMemo(
    () => !loading && !resolveError && (!accountId || !template),
    [loading, resolveError, accountId, template],
  );

  // Overlay the Local-Agent pairing onto the REVIEW_IMPORT capability line ONLY (bridge → review only).
  const displayCapability = useMemo(
    () => (capability ? overlayReviewImport(capability, agentPaired) : null),
    [capability, agentPaired],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="NAVER 스마트스토어 연결"
        description="주문은 공식 API로 연결합니다. 로컬 에이전트 없이 진행할 수 있고, 리뷰 가져오기는 연결 후 별도로 설정합니다."
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
            capability={displayCapability}
            reviewImportReady={agentPaired}
            dispatch={dispatch}
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
