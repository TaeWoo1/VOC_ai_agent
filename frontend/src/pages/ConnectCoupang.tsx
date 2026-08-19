import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/apiClient";
import { selectChannelAccount } from "../lib/channelConnection";
import { CoupangConnectTutorial } from "../components/coupang/CoupangConnectTutorial";
import { CoupangIssuanceGuidedWalkthrough } from "../components/coupang/CoupangIssuanceGuidedWalkthrough";
import { WalkthroughBanner } from "../components/guidedConnection/WalkthroughBanner";
import { WalkthroughMismatch } from "../components/guidedConnection/WalkthroughMismatch";
import { Spinner } from "../components/ui/Spinner";
import {
  evaluateBinding,
  expectedWalkthroughUrl,
  frontendRunId,
  isWalkthroughMode,
  readUrlRunId,
  tabNonce,
  type WalkthroughMismatchReason,
} from "../lib/guidedConnection/walkthrough";
import {
  COUPANG_TUTORIAL_COPY as C,
  INITIAL_COUPANG_STATE,
  coupangTutorialReducer,
  latestOrderRun,
  resolvePhase,
  syncStatusFromRun,
  type CoupangSyncStatus,
} from "../lib/coupangTutorial";
import type {
  ChannelStatus,
  ConnectionStatusView,
  CredentialTemplateView,
  SyncRunView,
  WalkthroughContextView,
} from "../lib/types";
import { analytics } from "../lib/analytics";

/** The channel this page connects — used for the sanitized walkthrough banner + mismatch re-open path. */
const COUPANG_CONNECT_PATH = "/connect/coupang";

/**
 * Coupang first-connection tutorial + guided initial sync (thin wiring layer over the pure engine in
 * `lib/coupangTutorial`). A first-time seller completes API prep → credential → connection test →
 * PREPARING → first ORDER_SUMMARY sync → CONNECTED → Operations entirely in the UI.
 *
 * <p>Server-authoritative recovery: the landing phase is DERIVED from persisted, channel-agnostic reads
 * (the account's two-signal `connectionStatus`, whether a credential is on file, the latest ORDER_SUMMARY
 * run), so a refresh/return re-lands on the correct step and a sync already RUNNING server-side is resumed
 * (observed), never re-triggered.
 *
 * <p>No page-load writes: the seller account is created lazily only on an explicit credential submit.
 *
 * <p>Honest by construction: the secret keys flow straight from the form to the backend Vault via
 * `storeCredential`; a passing connection test is NOT a completed connection (PREPARING); the internal
 * returnShippingCenters→ordersheets test fallback is never surfaced (the backend hides it behind sanitized
 * reason codes).
 */

const ORDER_SUMMARY = "ORDER_SUMMARY";
/** How often the in-progress screen polls the read-only sync-run list for the running sync's terminal status. */
const SYNC_POLL_INTERVAL_MS = 5000;
/** After this long still RUNNING, stop auto-polling and offer a manual re-check — NEVER a new sync. */
const SYNC_POLL_TIMEOUT_MS = 12 * 60_000;

// `startedAt` anchors the DISPLAYED elapsed clock (the sync's real start when resuming an existing run,
// so a mid-sync refresh reports true elapsed, not time-since-observation). `observeStartedAt` anchors the
// poll-window stall timeout (always when THIS tab began observing) — kept separate so resuming an
// already-old run does not instantly read as stalled, and a manual re-check reopens the window without
// resetting the elapsed display.
type SyncWatch = { startedAt: number; observeStartedAt: number; polling: boolean; stalled: boolean };

export function ConnectCoupang() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(coupangTutorialReducer, INITIAL_COUPANG_STATE);
  // Growth funnel (docs/auth_growth_instrumentation_v1.md §5). `preparing` is reached only by a passing
  // connection test from `submitting`; `connected` only by a finished first sync from `syncing` — the initial
  // server read (`resolving` → any phase) is a returning seller, not a new connection, and fires nothing.
  const previousPhase = useRef(state.phase);
  useEffect(() => {
    analytics.track("channel_connect_started", { channel: "coupang" });
  }, []);
  useEffect(() => {
    const before = previousPhase.current;
    previousPhase.current = state.phase;
    if (before === "submitting" && state.phase === "preparing") {
      analytics.track("channel_connected", { channel: "coupang" });
    }
    if (before === "syncing" && state.phase === "connected") {
      analytics.trackOnce("first_sync_completed", { channel: "coupang" });
    }
  }, [state.phase]);

  // Walkthrough environment binding. Outside walkthrough mode the gate opens immediately (`matched`) so the
  // page behaves exactly as before; in walkthrough mode it stays `checking` until the 3-way run/origin match
  // + operator-tab handshake prove this tab is bound to the bootstrapped run. Mismatch fails closed.
  const walkthrough = isWalkthroughMode();
  const [gate, setGate] = useState<"checking" | "matched" | "mismatch">(walkthrough ? "checking" : "matched");
  const [wtContext, setWtContext] = useState<WalkthroughContextView | null>(null);
  const [mismatchReasons, setMismatchReasons] = useState<Array<WalkthroughMismatchReason | "HANDSHAKE_FAILED">>([]);
  const ready = gate === "matched";
  // Coupang-affecting calls this tab has initiated (connection test + first sync). 0 until an explicit submit.
  const [coupangCalls, setCoupangCalls] = useState(0);

  const [loading, setLoading] = useState(true);
  const [resolveError, setResolveError] = useState(false);
  const [template, setTemplate] = useState<CredentialTemplateView | null>(null);
  const [coupangChannelId, setCoupangChannelId] = useState<string | null>(null);
  const [advertisedEgressIps, setAdvertisedEgressIps] = useState<readonly string[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatusView | null>(null);
  const [busy, setBusy] = useState(false);
  // Which part of the credential submit is in flight, for the waiting screen: saving the key (our vault) or
  // verifying it against Coupang (the backend's authentication + order-access probes, one call). Honest
  // granularity only — the two probes are one backend call, so they are one stage here, never two pretend ones.
  const [submitStage, setSubmitStage] = useState<"storing" | "verifying" | null>(null);

  const [accountId, setAccountId] = useState<string | null>(null);
  const accountIdRef = useRef<string | null>(null); // synchronous mirror so a just-created id is usable at once

  // First-sync progress. `inFlightRef` is the AUTHORITATIVE synchronous guard against a double-fire of any
  // action; `syncWatchRef` blocks a new trigger while a sync is observed (lags one render, but no trigger is
  // rendered during a watch, so inFlightRef alone already closes the window). The backend single-flight is
  // the real enforcement — this is the client half so the UI never even attempts a duplicate run.
  const [syncWatch, setSyncWatch] = useState<SyncWatch | null>(null);
  const [syncNow, setSyncNow] = useState(0);
  const syncWatchRef = useRef<SyncWatch | null>(null);
  const inFlightRef = useRef(false);
  useEffect(() => {
    syncWatchRef.current = syncWatch;
  }, [syncWatch]);

  // Prove the environment binding (walkthrough mode only) BEFORE anything else runs. This is the only backend
  // contact allowed before the gate opens: read-only /context + a 0-DB-write handshake. Mirrors ConnectNaver.
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
      // Binding matched → the operator-tab handshake (0 DB writes). Send the run id from THIS TAB'S URL (the
      // address bar), NOT the /context echo — so the backend cross-checks its authoritative run id against
      // what the tab actually carries, from a different source than /context.
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

  // Deployment-global setup (advertised calling IP). Isolated + fail-safe: a failure here must never break
  // the page — it then shows generic guidance, never a fabricated IP. Gated on the binding: in walkthrough
  // mode it waits for the gate to open (no Coupang-adjacent read before the tab is proven bound).
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    (async () => {
      try {
        const setup = await api.getCoupangSetup();
        if (alive) setAdvertisedEgressIps(setup.advertisedEgressIps ?? []);
      } catch {
        if (alive) setAdvertisedEgressIps([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready]);

  // Resolve the landing phase — reads ONLY (channel + existing account + template; if an account exists, its
  // credential presence + latest ORDER_SUMMARY run). Never creates an account, so a load/refresh writes
  // nothing. This is the whole of refresh/leave recovery: the phase is derived from persisted state. Gated on
  // the binding: in walkthrough mode it waits for the gate, and the same server-authoritative resolvePhase
  // (incl. reattaching a running sync) still drives refresh/agent-reconnect recovery once the gate opens.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    (async () => {
      try {
        const [channels, accounts, tmpl] = await Promise.all([
          api.getChannelsStrict(),
          api.getSellerAccountsStrict(),
          api.getCredentialTemplateStrict("COUPANG"),
        ]);
        if (!alive) return;
        setTemplate(tmpl);
        const coupang = channels.find((c) => c.code === "COUPANG") ?? null;
        setCoupangChannelId(coupang?.id ?? null);
        const existing = coupang ? selectChannelAccount(accounts, coupang.id) : null;
        const id = existing?.id ?? null;
        accountIdRef.current = id;
        setAccountId(id);

        const channelReady = Boolean(tmpl && coupang);
        const connStatus: ChannelStatus | null = existing?.connectionStatus ?? null;
        let credentialPresent = false;
        let latestSyncStatus: CoupangSyncStatus | null = null;
        let latestRun: SyncRunView | null = null;

        if (id) {
          // Credential presence (404 → null) and the latest ORDER_SUMMARY run, both read-only + sanitized.
          const [info, runs] = await Promise.all([
            api.getConnectionInfoStrict(id).catch(() => null),
            api.getSyncRunsStrict({ sellerAccountId: id, dataType: ORDER_SUMMARY }).catch(() => [] as SyncRunView[]),
          ]);
          if (!alive) return;
          credentialPresent = info != null;
          latestRun = latestOrderRun(runs, id);
          latestSyncStatus = latestRun ? syncStatusFromRun(latestRun) : null;
        }

        const phase = resolvePhase({ ready: channelReady, connectionStatus: connStatus, credentialPresent, latestSyncStatus });
        // Resuming a sync already RUNNING server-side → observe it (never re-trigger). Anchor the displayed
        // elapsed to the run's real start so a mid-sync refresh shows true elapsed, not 0:00; anchor the
        // stall window to now so an already-old run does not read as instantly stalled.
        if (phase === "syncing") {
          const startedAt = Date.parse(latestRun?.startedAt ?? "") || Date.now();
          setSyncWatch({ startedAt, observeStartedAt: Date.now(), polling: true, stalled: false });
          setSyncNow(Date.now());
        }
        dispatch({ type: "RESOLVED", phase });
      } catch {
        if (alive) setResolveError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready]);

  // The first ORDER_SUMMARY sync STEP (no guard of its own — the guarded public entries own that). Triggers
  // the sync ONCE. A terminal result advances the journey; a RUNNING result means the backend single-flight
  // coalesced this onto an in-flight run — switch to polling the read-only run list for the real status.
  const firstSyncStep = useCallback(async (id: string) => {
    const now = Date.now();
    const fresh = { startedAt: now, observeStartedAt: now, polling: true as const, stalled: false };
    setSyncWatch({ ...fresh, polling: false });
    setSyncNow(now);
    setCoupangCalls((n) => n + 1);
    try {
      const run = await api.manualSync(id, ORDER_SUMMARY);
      const status = syncStatusFromRun(run);
      if (status === "RUNNING") {
        setSyncWatch((w) => (w ? { ...w, polling: true } : fresh));
      } else {
        setSyncWatch(null);
        dispatch({ type: "SYNC_RESULT", status });
      }
    } catch {
      // The long-held initial sync request may be cut by an infra idle-timeout while the job keeps running.
      // Disambiguate via the read-only run list before surfacing a failure: an actually-RUNNING job → keep
      // observing; an already-settled job → reflect it; only a genuinely failed/absent run fails closed.
      try {
        const runs = await api.getSyncRunsStrict({ sellerAccountId: id, dataType: ORDER_SUMMARY });
        const st = syncStatusFromRun(latestOrderRun(runs, id));
        if (st === "RUNNING") {
          setSyncWatch((w) => (w ? { ...w, polling: true } : fresh));
          return;
        }
        if (st === "SUCCESS" || st === "PARTIAL") {
          setSyncWatch(null);
          dispatch({ type: "SYNC_RESULT", status: st });
          return;
        }
      } catch {
        /* run-list read also failed → fall through to the fail-closed result below */
      }
      setSyncWatch(null);
      dispatch({ type: "SYNC_RESULT", status: "FAILED" });
    }
  }, []);

  // The connection-test STEP (unguarded); on SUCCESS it lands on PREPARING (NO auto-sync — the seller starts
  // the first sync explicitly via the CTA).
  const testStep = useCallback(async (id: string) => {
    setCoupangCalls((n) => n + 1);
    try {
      const result = await api.testConnection(id);
      dispatch({ type: "TEST_RESULT", status: result.status === "SUCCESS" ? "SUCCESS" : "FAILED", reasonCode: result.reasonCode });
    } catch {
      dispatch({ type: "SUBMIT_FAILED" });
    }
  }, []);

  // Public entry: submit the credential (lazy account-create → store → test). Guarded single-flight.
  const onSubmitCredentials = useCallback(
    async (secrets: Record<string, string>) => {
      if (!template || inFlightRef.current || syncWatchRef.current) return;
      inFlightRef.current = true;
      dispatch({ type: "SUBMIT" });
      setBusy(true);
      setSubmitStage("storing");
      try {
        let id = accountIdRef.current;
        if (!id) {
          if (!coupangChannelId) throw new Error("no COUPANG channel");
          const created = await api.createApiChannelAccount(coupangChannelId);
          id = created.id;
          accountIdRef.current = id;
          setAccountId(id);
        }
        await api.storeCredential(id, {
          connectorClass: template.connectorClass,
          authType: template.authType,
          secrets,
        });
        setSubmitStage("verifying");
        await testStep(id);
      } catch {
        dispatch({ type: "SUBMIT_FAILED" });
      } finally {
        inFlightRef.current = false;
        setBusy(false);
        setSubmitStage(null);
      }
    },
    [template, coupangChannelId, testStep],
  );

  // Public entry: re-verify the stored credential without re-typing the secret (recovery screen).
  const onRetest = useCallback(async () => {
    const id = accountIdRef.current;
    if (!id || inFlightRef.current || syncWatchRef.current) return;
    inFlightRef.current = true;
    dispatch({ type: "RETEST" });
    setBusy(true);
    setSubmitStage("verifying");
    try {
      await testStep(id);
    } finally {
      inFlightRef.current = false;
      setBusy(false);
      setSubmitStage(null);
    }
  }, [testStep]);

  const onReenter = useCallback(() => dispatch({ type: "REENTER" }), []);

  // Public entry: run the first sync (the "첫 주문 불러오기" CTA and the sync-retry). Guarded so a
  // double-click / an in-flight or being-observed sync never fires a second job.
  const onRunSync = useCallback(async () => {
    const id = accountIdRef.current;
    if (!id || inFlightRef.current || syncWatchRef.current) return;
    inFlightRef.current = true;
    dispatch({ type: "RUN_SYNC" });
    setBusy(true);
    try {
      await firstSyncStep(id);
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }, [firstSyncStep]);

  // Re-check a stalled sync — re-opens the poll window on the SAME run WITHOUT resetting the displayed
  // elapsed (only the stall anchor moves). NEVER starts a new sync.
  const onRecheckSync = useCallback(() => {
    const now = Date.now();
    setSyncNow(now);
    setSyncWatch((w) =>
      w && w.stalled ? { ...w, observeStartedAt: now, polling: true, stalled: false } : w,
    );
  }, []);

  // Elapsed clock: tick once a second while a sync is actively watched (frozen once stalled).
  useEffect(() => {
    if (!syncWatch || syncWatch.stalled) return;
    setSyncNow(Date.now());
    const id = window.setInterval(() => setSyncNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [syncWatch]);

  // Progress poller: while polling a RUNNING sync, read the READ-ONLY run list for its terminal status. No
  // Coupang outbound and no write — it only observes. A terminal status advances the journey; a timeout
  // stops polling and surfaces a manual re-check (never an auto-created sync).
  useEffect(() => {
    if (!syncWatch || !syncWatch.polling || syncWatch.stalled || !accountId) return;
    let alive = true;
    let reading = false;
    const observeStartedAt = syncWatch.observeStartedAt;
    const id = window.setInterval(async () => {
      if (!alive || reading) return;
      if (Date.now() - observeStartedAt >= SYNC_POLL_TIMEOUT_MS) {
        setSyncNow(Date.now());
        setSyncWatch((w) => (w ? { ...w, polling: false, stalled: true } : w));
        return;
      }
      reading = true;
      try {
        const runs = await api.getSyncRunsStrict({ sellerAccountId: accountId, dataType: ORDER_SUMMARY });
        if (!alive) return;
        const st = syncStatusFromRun(latestOrderRun(runs, accountId));
        if (st === "SUCCESS" || st === "PARTIAL") {
          setSyncWatch(null);
          dispatch({ type: "SYNC_RESULT", status: st });
        } else if (st === "FAILED") {
          setSyncWatch(null);
          dispatch({ type: "SYNC_RESULT", status: "FAILED" });
        }
        // RUNNING → keep polling.
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

  // On completion, read the real connection health (read-only) for the summary line.
  useEffect(() => {
    if (state.phase !== "connected" || !accountId) return;
    let alive = true;
    (async () => {
      try {
        const status = await api.getConnectionStatusStrict(accountId);
        if (alive) setConnectionStatus(status);
      } catch {
        /* summary omitted on failure — the completion stands regardless */
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.phase, accountId]);

  // Issuance → credential entry hand-off. A pure phase transition — no api call, no account creation (the
  // account is still created lazily on the first credential submit), so the single-flight guards are
  // untouched. Fired by the guided walkthrough (WING issuance complete), the text checklist, or the seller's
  // "이미 키가 있어요" skip.
  const onIssued = useCallback(() => dispatch({ type: "ISSUANCE_DONE" }), []);

  const onGoToOrders = useCallback(() => navigate("/orders"), [navigate]);
  const onViewChannelRuns = useCallback(() => {
    if (accountId) navigate(`/connect/channels/${accountId}`);
    else navigate("/connect");
  }, [navigate, accountId]);

  // Enter guided renewal from the completion screen's expiry panel (renewRecommended). The renewal page
  // replaces the credential in place — it creates no account and starts no sync (the existing account /
  // orders / cursor are kept).
  const onRenew = useCallback(() => {
    if (accountId) navigate(`/connect/coupang/renew/${accountId}`);
  }, [navigate, accountId]);

  // Operator-confirmed key expiry (state UNKNOWN — Coupang WING expiry is not machine-readable). Stored via
  // the credential intake's `tokenExpiresAt` (a NON-secret date), never auto-estimated; then re-read the
  // connection status so the panel reflects the freshly stored date. No secrets are sent.
  const onConfirmExpiry = useCallback(
    async (tokenExpiresAtIso: string) => {
      const id = accountIdRef.current;
      if (!id || !template || inFlightRef.current) return;
      inFlightRef.current = true;
      setBusy(true);
      try {
        // Dedicated expiry-only endpoint — the credential intake rejects secret-less updates by design, so a
        // date confirmation sends ONLY the date (no secret), stored exactly (never an estimate).
        await api.confirmCredentialExpiry(id, tokenExpiresAtIso);
        const status = await api.getConnectionStatusStrict(id);
        setConnectionStatus(status);
      } catch {
        /* fail-soft: the completion stands; the panel keeps offering the confirm path */
      } finally {
        inFlightRef.current = false;
        setBusy(false);
      }
    },
    [template],
  );

  const syncProgress = useMemo(
    () => (syncWatch ? { elapsedMs: Math.max(0, syncNow - syncWatch.startedAt), stalled: syncWatch.stalled } : null),
    [syncWatch, syncNow],
  );

  // The Coupang journey — identical to the pre-walkthrough page. Outside walkthrough mode it is returned
  // as-is (nothing changes); in walkthrough mode it renders ONLY once the environment-binding gate is open.
  const journey = (() => {
    if (loading || state.phase === "resolving") {
      return (
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-10" role="status">
          <Spinner />
          <p className="text-base text-muted">{C.loading}</p>
        </div>
      );
    }

    if (resolveError) {
      return (
        <div className="mx-auto max-w-2xl px-5 py-10">
          <h1 className="text-xl font-bold text-ink">{C.pageTitle}</h1>
          <p className="mt-3 text-base text-bad" role="alert">
            {C.resolveError}
          </p>
          <button type="button" className="btn-secondary mt-5" onClick={() => navigate("/connect")}>
            {C.backToChannels}
          </button>
        </div>
      );
    }

    if (state.phase === "unavailable") {
      return (
        <div className="mx-auto max-w-2xl px-5 py-10">
          <h1 className="text-xl font-bold text-ink">{C.unavailableTitle}</h1>
          <p className="mt-3 text-base text-muted">{C.unavailableBody}</p>
          <button type="button" className="btn-secondary mt-5" onClick={() => navigate("/connect")}>
            {C.backToChannels}
          </button>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-xl font-bold text-ink">{C.pageTitle}</h1>
        <p className="mt-2 text-base text-muted break-keep">{C.pageIntro}</p>

        <div className="mt-6">
          {state.phase === "issuance" ? (
            // Agent-driven WING Open API key issuance walkthrough — the first journey phase, before credential
            // entry. It hosts the Action Window issuance run (channelCode announced by the agent) and hands off
            // to the credential form on completion / text-checklist done / "이미 키가 있어요".
            <CoupangIssuanceGuidedWalkthrough
              onIssued={onIssued}
              busy={busy}
              advertisedEgressIps={advertisedEgressIps}
            />
          ) : (
            <CoupangConnectTutorial
              state={state}
              template={template}
              busy={busy}
              submitStage={submitStage}
              advertisedEgressIps={advertisedEgressIps}
              connectionStatus={connectionStatus}
              syncProgress={syncProgress}
              onSubmitCredentials={onSubmitCredentials}
              onRetest={onRetest}
              onReenter={onReenter}
              onRunSync={onRunSync}
              onRecheckSync={onRecheckSync}
              onGoToOrders={onGoToOrders}
              onViewChannelRuns={onViewChannelRuns}
              onRenew={onRenew}
              onConfirmExpiry={onConfirmExpiry}
            />
          )}
        </div>
      </div>
    );
  })();

  // Outside walkthrough mode the page is EXACTLY as before — no banner, no gate, no extra wrapper.
  if (!walkthrough) return journey;

  const expectedUrl = wtContext
    ? expectedWalkthroughUrl(wtContext.frontendOrigin, wtContext.walkthroughRunId, COUPANG_CONNECT_PATH)
    : null;

  // Walkthrough mode: an always-visible disposable-run banner (the human check against the CLI preflight),
  // the fail-closed mismatch screen on any binding failure, and the Coupang journey ONLY once `ready`.
  return (
    <div className="mx-auto max-w-2xl px-5 pt-6">
      <WalkthroughBanner context={wtContext} channelCode="COUPANG" channelCalls={coupangCalls} />
      {gate === "checking" && (
        <p className="mt-4 text-muted" role="status">
          walkthrough 환경을 확인하는 중입니다…
        </p>
      )}
      {gate === "mismatch" && (
        <div className="mt-4">
          <WalkthroughMismatch reasons={mismatchReasons} expectedUrl={expectedUrl} />
        </div>
      )}
      {ready && journey}
    </div>
  );
}
