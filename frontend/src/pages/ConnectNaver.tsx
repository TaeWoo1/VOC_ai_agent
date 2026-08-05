import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { GuidedConnectionWizard } from "../components/guidedConnection/GuidedConnectionWizard";
import { WalkthroughBanner } from "../components/guidedConnection/WalkthroughBanner";
import { WalkthroughMismatch } from "../components/guidedConnection/WalkthroughMismatch";
import { useBridge } from "../hooks/useBridge";
import { api } from "../lib/apiClient";
import { selectChannelAccount } from "../lib/channelConnection";
import {
  clearGuidedProgress,
  evaluateBinding,
  expectedWalkthroughUrl,
  frontendRunId,
  guidedConnectionReducer,
  isWalkthroughMode,
  loadGuidedInitialState,
  overlayReviewImport,
  readUrlRunId,
  saveGuidedProgress,
  tabNonce,
  withWalkthroughRun,
  type WalkthroughMismatchReason,
} from "../lib/guidedConnection";
import type {
  ConnectionCapabilityView,
  ConnectionStatusView,
  CredentialTemplateView,
  SyncRunView,
  WalkthroughContextView,
} from "../lib/types";
import type { GuidedSyncStatus } from "../lib/guidedConnection";

/**
 * NAVER guided-connection wizard page (contract §0 v1 ratification).
 *
 * Thin wiring layer over the guided-journey reducer. The Client Secret goes straight to
 * `api.storeCredential` and NEVER through the reducer/an event/storage (§11, §17.4). The order connection
 * is Local-Agent-free (the bridge only informs the post-completion REVIEW_IMPORT line).
 *
 * **Environment binding (walkthrough mode).** When `VITE_WALKTHROUGH_MODE` is on, the page proves — before
 * it will show the wizard, bootstrap an account, or make any NAVER call — that this tab is bound to the
 * bootstrapped run: the URL run id, the frontend build run id, and the backend `/context` run id must all
 * match, the origin must match, and an operator-tab handshake must confirm it. Any failure renders a
 * fail-closed WALKTHROUGH_ENVIRONMENT_MISMATCH screen. A disposable-run banner is always shown so the
 * operator can eyeball the run id against the CLI preflight. Outside walkthrough mode none of this renders.
 *
 * **No page-load writes.** Loading/refreshing the page performs ZERO DB writes: the seller account is
 * created lazily only on explicit credential submit — so refreshes and stale-tab checks never accumulate
 * PENDING accounts.
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
      return "RUNNING"; // unknown/absent → non-advancing (fail-closed)
  }
}

/** How often the in-progress screen polls the read-only capability for the running sync's terminal status. */
const SYNC_POLL_INTERVAL_MS = 5000;
/** After this long with the sync still RUNNING, stop auto-polling and offer a manual re-check — NEVER a new
 *  sync. Comfortably past the observed worst-case first run (~8.6 min) so a live run is not cut short. */
const SYNC_POLL_TIMEOUT_MS = 12 * 60_000;

/**
 * A first ORDER_SUMMARY sync being watched. `startedAt` anchors the elapsed clock; `polling` = the page is
 * actively polling the read-only capability for the terminal status (true for a coalesced/resumed RUNNING
 * job; false while the initial synchronous request is still held open, which resolves the run itself);
 * `stalled` = the poll timed out (show the manual re-check). Never carries a job id, secret, or account id.
 */
type SyncWatch = { startedAt: number; polling: boolean; stalled: boolean };

export function ConnectNaver() {
  const navigate = useNavigate();
  const agentBridgeEnabled = import.meta.env.VITE_ENABLE_AGENT_BRIDGE === "true";
  const bridge = useBridge(agentBridgeEnabled);
  const [state, dispatch] = useReducer(guidedConnectionReducer, undefined, () => loadGuidedInitialState());

  const walkthrough = isWalkthroughMode();
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const accountIdRef = useRef<string | null>(null); // synchronous mirror so a just-created id is usable at once
  const [naverChannelId, setNaverChannelId] = useState<string | null>(null);
  const [template, setTemplate] = useState<CredentialTemplateView | null>(null);
  const [resolved, setResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resolveError, setResolveError] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatusView | null>(null);
  const [capability, setCapability] = useState<ConnectionCapabilityView | null>(null);
  // Deployment-global advertised call IP(s) for the issuance tutorial — fetched WITHOUT an account so
  // the guided walkthrough can show them at first-time connection. Fail-safe: [] on any fetch failure.
  const [advertisedEgressIps, setAdvertisedEgressIps] = useState<readonly string[]>([]);

  // NAVER-affecting calls this tab has initiated (test + first sync). 0 until an explicit credential submit.
  const [naverCalls, setNaverCalls] = useState(0);

  // First-sync progress/observation. `syncWatch` is set while a first sync is in flight (initial run or a
  // resumed RUNNING job); `syncNow` ticks the elapsed clock. `inFlightRef` is the AUTHORITATIVE synchronous
  // guard — set before the first await in every public entry, so a double-click cannot fire a second
  // test/sync. `syncWatchRef` is a best-effort secondary guard (updated post-commit, so it lags one render);
  // it blocks a new trigger during an active watch, but no trigger control is ever rendered while a watch is
  // active, so `inFlightRef` alone already closes the double-fire window. The backend single-flight is the
  // real enforcement — this is the client-side half so the UI never even attempts a duplicate.
  const [syncWatch, setSyncWatch] = useState<SyncWatch | null>(null);
  const [syncNow, setSyncNow] = useState(0);
  const syncWatchRef = useRef<SyncWatch | null>(null);
  const inFlightRef = useRef(false);
  useEffect(() => {
    syncWatchRef.current = syncWatch;
  }, [syncWatch]);

  // Walkthrough environment binding.
  const [gate, setGate] = useState<"checking" | "matched" | "mismatch">(walkthrough ? "checking" : "matched");
  const [wtContext, setWtContext] = useState<WalkthroughContextView | null>(null);
  const [mismatchReasons, setMismatchReasons] = useState<Array<WalkthroughMismatchReason | "HANDSHAKE_FAILED">>([]);
  const ready = gate === "matched";

  const agentPaired = agentBridgeEnabled && bridge.state.phase === "paired";

  // Prove the environment binding (walkthrough mode only) BEFORE anything else runs. This is the only
  // backend contact allowed before the gate opens: read-only /context + a 0-DB-write handshake.
  useEffect(() => {
    if (!walkthrough) return;
    let alive = true;
    (async () => {
      let ctx: WalkthroughContextView | null = null;
      try {
        ctx = await api.getWalkthroughContext();
      } catch {
        ctx = null;
      }
      if (!alive) return;
      setWtContext(ctx);
      const urlRunId = readUrlRunId(window.location.search);
      const binding = evaluateBinding({
        urlRunId,
        frontendRunId: frontendRunId(),
        contextRunId: ctx?.walkthroughRunId ?? null,
        contextFrontendOrigin: ctx?.frontendOrigin ?? null,
        currentOrigin: window.location.origin,
      });
      if (binding.status === "mismatch") {
        setMismatchReasons(binding.reasons);
        setGate("mismatch");
        return;
      }
      // Binding matched → the operator-tab handshake (0 DB writes). Send the run id from THIS TAB'S URL
      // (the address bar), NOT the value just read from /context — so the backend cross-checks its own
      // authoritative run id against what the tab actually carries, from a different source than /context.
      try {
        const hs = await api.walkthroughHandshake({
          walkthroughRunId: urlRunId!, // present: a matched binding requires a non-null URL run id
          tabNonce: tabNonce(),
          origin: window.location.origin,
        });
        if (!alive) return;
        if (hs.runMatched && hs.originMatched) {
          setGate("matched");
        } else {
          setMismatchReasons(["HANDSHAKE_FAILED"]);
          setGate("mismatch");
        }
      } catch {
        if (alive) {
          setMismatchReasons(["HANDSHAKE_FAILED"]);
          setGate("mismatch");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [walkthrough]);

  useEffect(() => {
    saveGuidedProgress(state);
  }, [state.phase, state.path]);

  // Resolve the connection context — reads ONLY (find the existing NAVER account + template + channel id).
  // It NEVER creates an account (that is deferred to an explicit credential submit), so a page load/refresh
  // is a 0-write operation. Gated on the environment binding: in walkthrough mode it waits for the gate.
  // Deployment-global setup facts (advertised call IP). Isolated + fail-safe: a failure here must never
  // break the connect page — the tutorial then shows generic guidance, never a fabricated IP.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    (async () => {
      try {
        const setup = await api.getNaverSetup();
        if (alive) setAdvertisedEgressIps(setup.advertisedEgressIps ?? []);
      } catch {
        if (alive) setAdvertisedEgressIps([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
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
        setNaverChannelId(naver?.id ?? null);
        const existing = naver ? selectChannelAccount(accounts, naver.id) : null;
        const id = existing?.id ?? null;
        accountIdRef.current = id;
        setAccountId(id);
      } catch {
        if (alive) setResolveError(true);
      } finally {
        if (alive) {
          setResolved(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready]);

  // On completion, read the real connection health (read-only; completion stands on its milestones).
  useEffect(() => {
    if (state.phase !== "completed" || !accountId) return;
    let alive = true;
    (async () => {
      try {
        const status = await api.getConnectionStatusStrict(accountId);
        if (alive) setConnectionStatus(status);
      } catch {
        /* status line omitted on failure */
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.phase, accountId]);

  // On completion, read the sanitized capability result (read-only).
  useEffect(() => {
    if (state.phase !== "completed" || !accountId) return;
    let alive = true;
    (async () => {
      try {
        const cap = await api.getConnectionCapabilityStrict(accountId);
        if (alive) setCapability(cap);
      } catch {
        /* capability panel omitted on failure */
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.phase, accountId]);

  // The first-sync STEP (no busy/guard of its own — the guarded public entries below own that). Triggers the
  // sync ONCE. A terminal result advances the journey; a RUNNING result means the backend single-flight
  // coalesced this onto an in-flight run — we do NOT treat it as success, we switch to polling the read-only
  // capability for the real terminal status. Either way it counts as one NAVER-affecting call.
  const firstSyncStep = useCallback(async (id: string) => {
    setSyncWatch({ startedAt: Date.now(), polling: false, stalled: false });
    setSyncNow(Date.now());
    setNaverCalls((n) => n + 1);
    try {
      const run = await api.manualSync(id, "ORDER_SUMMARY");
      const status = toSyncStatus(run);
      if (status === "RUNNING") {
        // Coalesced onto an already-running job — keep the progress screen and start polling for the result.
        setSyncWatch((w) =>
          w ? { ...w, polling: true } : { startedAt: Date.now(), polling: true, stalled: false },
        );
      } else {
        setSyncWatch(null);
        dispatch({ type: "SYNC_RESULT", status });
      }
    } catch {
      // The trigger request was dropped (e.g., an infra idle-timeout can cut the long-held initial sync
      // request even though the job keeps running server-side). Disambiguate via the read-only capability
      // before surfacing a failure: a job that is actually RUNNING → keep observing by polling (no spurious
      // mid-run failure); an already-settled job → reflect it; only a genuinely failed/absent run fails closed.
      try {
        const cap = await api.getConnectionCapabilityStrict(id);
        const st = cap.firstSyncStatus;
        if (st === "RUNNING") {
          setSyncWatch((w) =>
            w ? { ...w, polling: true } : { startedAt: Date.now(), polling: true, stalled: false },
          );
          return;
        }
        if (st === "SUCCESS" || st === "PARTIAL") {
          setSyncWatch(null);
          dispatch({ type: "SYNC_RESULT", status: st });
          return;
        }
      } catch {
        /* capability read also failed → fall through to the fail-closed result below */
      }
      setSyncWatch(null);
      dispatch({ type: "SYNC_RESULT", status: "FAILED" });
    }
  }, []);

  // The connection-test STEP (unguarded); on SUCCESS it chains straight into the first sync.
  const testStep = useCallback(
    async (id: string) => {
      setNaverCalls((n) => n + 1);
      try {
        const result = await api.testConnection(id);
        dispatch({ type: "TEST_RESULT", status: result.status, reasonCode: result.reasonCode });
        if (result.status === "SUCCESS") await firstSyncStep(id);
      } catch {
        dispatch({ type: "TEST_RESULT", status: "FAILED", reasonCode: "TEMPORARY_PROVIDER_ERROR" });
      }
    },
    [firstSyncStep],
  );

  // Public entry: run only the first sync (the sync-retry CTA). Guarded so a double-click / an in-flight or
  // being-observed sync never fires a second job.
  const runFirstSync = useCallback(async () => {
    const id = accountIdRef.current;
    if (!id || inFlightRef.current || syncWatchRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    try {
      await firstSyncStep(id);
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }, [firstSyncStep]);

  // Public entry: run the connection test (→ first sync on success). Same guard.
  const runTest = useCallback(async () => {
    const id = accountIdRef.current;
    if (!id || inFlightRef.current || syncWatchRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    try {
      await testStep(id);
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }, [testStep]);

  // Re-check a stalled sync — re-opens the poll window on the SAME run (restart the clock so the poller
  // doesn't immediately re-stall against the old start). It NEVER starts a new sync.
  const onRecheckSync = useCallback(() => {
    const now = Date.now();
    setSyncNow(now);
    setSyncWatch((w) => (w && w.stalled ? { startedAt: now, polling: true, stalled: false } : w));
  }, []);

  // Elapsed clock: tick once a second while a sync is actively being watched (frozen once stalled).
  useEffect(() => {
    if (!syncWatch || syncWatch.stalled) return;
    setSyncNow(Date.now());
    const id = window.setInterval(() => setSyncNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [syncWatch]);

  // Progress poller: while polling a RUNNING sync, read the READ-ONLY capability for its terminal status.
  // No NAVER outbound and no write — it only observes. A terminal status advances the journey; a timeout
  // stops polling and surfaces a manual re-check (never an auto-created sync).
  useEffect(() => {
    if (!syncWatch || !syncWatch.polling || syncWatch.stalled || !accountId) return;
    let alive = true;
    let reading = false; // skip a tick if the previous capability read is still in flight (no pile-up)
    const startedAt = syncWatch.startedAt;
    const id = window.setInterval(async () => {
      if (!alive || reading) return;
      if (Date.now() - startedAt >= SYNC_POLL_TIMEOUT_MS) {
        setSyncNow(Date.now());
        setSyncWatch((w) => (w ? { ...w, polling: false, stalled: true } : w));
        return;
      }
      reading = true;
      try {
        const cap = await api.getConnectionCapabilityStrict(accountId);
        if (!alive) return;
        const st = cap.firstSyncStatus;
        if (st === "SUCCESS" || st === "PARTIAL") {
          setSyncWatch(null);
          dispatch({ type: "SYNC_RESULT", status: st });
        } else if (st === "FAILED") {
          setSyncWatch(null);
          dispatch({ type: "SYNC_RESULT", status: "FAILED" });
        }
        // RUNNING / NONE → keep polling.
      } catch {
        /* transient read error → retry on the next tick (no new sync, no state change) */
      } finally {
        reading = false;
      }
    }, SYNC_POLL_INTERVAL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [syncWatch, accountId]);

  // Read-only resume: once resolution is done (and the binding gate is open), decide where the page lands
  // WITHOUT running anything. No existing account → the fork (no capability read, no write). An existing
  // account → read the read-only capability snapshot: prior sync succeeded → restore completed; credential
  // present but not completed → the connection-test CTA; else the fork. Fail-safe to the fork on error.
  useEffect(() => {
    if (!ready || !resolved || state.phase !== "check_saved_credential") return;
    let alive = true;
    (async () => {
      if (!accountId) {
        dispatch({ type: "RESUME_FROM_CAPABILITY", credentialPresent: false, completed: false });
        return;
      }
      try {
        const cap = await api.getConnectionCapabilityStrict(accountId);
        if (!alive) return;
        const completed =
          cap.credentialPresent &&
          cap.identityConfirmed &&
          (cap.firstSyncStatus === "SUCCESS" || cap.firstSyncStatus === "PARTIAL");
        // A first sync is still RUNNING (backend-verified) → resume OBSERVING the same run, never re-running
        // the test or starting a second sync. This is the fix for the refresh-then-re-trigger duplicate sync.
        const syncing = cap.credentialPresent && cap.firstSyncStatus === "RUNNING";
        if (completed) setCapability(cap);
        dispatch({ type: "RESUME_FROM_CAPABILITY", credentialPresent: cap.credentialPresent, completed, syncing });
        if (syncing) setSyncWatch({ startedAt: Date.now(), polling: true, stalled: false });
      } catch {
        if (alive) dispatch({ type: "RESUME_FROM_CAPABILITY", credentialPresent: false, completed: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, resolved, accountId, state.phase]);

  const onSubmitCredentials = useCallback(
    async (secrets: Record<string, string>) => {
      // Same single-flight guard as the other entries: a re-submit while a chain is in flight is ignored.
      if (!template || inFlightRef.current || syncWatchRef.current) return;
      inFlightRef.current = true;
      dispatch({ type: "SUBMIT_CREDENTIALS" });
      setBusy(true);
      try {
        // Create the seller account lazily HERE — the first and only DB write, on an explicit user action.
        let id = accountIdRef.current;
        if (!id) {
          if (!naverChannelId) throw new Error("no NAVER channel");
          const created = await api.createApiChannelAccount(naverChannelId);
          id = created.id;
          accountIdRef.current = id;
          setAccountId(id);
        }
        // The secret leaves here directly for the backend Vault — never into the reducer/an event.
        await api.storeCredential(id, {
          connectorClass: template.connectorClass,
          authType: template.authType,
          secrets,
        });
        dispatch({ type: "CREDENTIAL_REGISTERED" });
        // Chain into the test STEP directly (not the guarded public entry, which the guard would re-block).
        await testStep(id);
      } catch {
        dispatch({ type: "REGISTRATION_FAILED" });
      } finally {
        inFlightRef.current = false;
        setBusy(false);
      }
    },
    [template, naverChannelId, testStep],
  );

  const onGoToReviewExport = useCallback(() => {
    clearGuidedProgress();
    // Preserve the bound run id across this internal navigation so the disposable walkthrough run is not
    // dropped from the URL (a plain navigate would strip `?walkthroughRun=`). Outside walkthrough mode the
    // run id is null and the path is returned unchanged.
    const runId = walkthrough ? readUrlRunId(window.location.search) : null;
    navigate(withWalkthroughRun("/settings/review-import", runId));
  }, [navigate, walkthrough]);

  const credentialUnavailable = useMemo(
    () => !loading && !resolveError && !template,
    [loading, resolveError, template],
  );

  const displayCapability = useMemo(
    () => (capability ? overlayReviewImport(capability, agentPaired) : null),
    [capability, agentPaired],
  );

  // Sanitized first-sync progress for the wizard: elapsed wall-clock + a stalled flag, or null when idle.
  const syncProgress = useMemo(
    () => (syncWatch ? { elapsedMs: Math.max(0, syncNow - syncWatch.startedAt), stalled: syncWatch.stalled } : null),
    [syncWatch, syncNow],
  );

  const expectedUrl = wtContext
    ? expectedWalkthroughUrl(wtContext.frontendOrigin, wtContext.walkthroughRunId)
    : null;

  const wizardBlock = (
    <>
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
            advertisedEgressIps={advertisedEgressIps}
            reviewImportReady={agentPaired}
            dispatch={dispatch}
            onSubmitCredentials={onSubmitCredentials}
            onRetryTest={runTest}
            onRetrySync={runFirstSync}
            onGoToReviewExport={onGoToReviewExport}
            syncProgress={syncProgress}
            onRecheckSync={onRecheckSync}
          />
        </>
      )}
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="NAVER 스마트스토어 연결"
        description="주문은 공식 API로 연결합니다. 로컬 에이전트 없이 진행할 수 있고, 리뷰 가져오기는 연결 후 별도로 설정합니다."
      />

      {walkthrough && <WalkthroughBanner context={wtContext} naverCalls={naverCalls} />}

      {walkthrough && gate === "checking" && (
        <p className="text-muted" role="status">
          walkthrough 환경을 확인하는 중입니다…
        </p>
      )}
      {walkthrough && gate === "mismatch" && (
        <WalkthroughMismatch reasons={mismatchReasons} expectedUrl={expectedUrl} />
      )}
      {ready && wizardBlock}
    </div>
  );
}
