import { useEffect, useRef, useState } from "react";
import { useBridge } from "../../hooks/useBridge";
import type { ActionWindowRunView, CommandType } from "../../lib/actionWindow/contract";
import type { IssuanceAppBranch } from "../../../../contracts/action-window/v2/index";
import { blockerView, issuanceStepDetail } from "../../lib/actionWindow/copy";
import { OperationRunTimeline } from "../actionWindow/OperationRunTimeline";
import { ActionWindowControlPanel } from "../actionWindow/ActionWindowControlPanel";
import { BlockerNotice } from "../actionWindow/BlockerNotice";
import { AgentPairingPanel } from "../reviewImport/AgentPairingPanel";
import { AgentEnvNotice } from "./AgentEnvNotice";
import { AdvertisedCallIpPanel } from "./AdvertisedCallIpPanel";
import { useGuidedIssuance } from "../../lib/actionWindow/issuance/useGuidedIssuance";
import type { GuidedIssuanceRuntime } from "../../lib/actionWindow/issuance/issuanceRuntime";
import { classifyAgentEnv, type AgentEnvStatus, type GuidedEvent } from "../../lib/guidedConnection";

/**
 * The Action Window guided walkthrough for NAVER API-center issuance (`application_issuance_guided`).
 *
 * This is the ONLY place the Local Agent participates in the order connection. It pairs the agent here (via
 * `useBridge` + the shared `AgentPairingPanel`), and once the agent is hosting an issuance run it renders the
 * SAME Action Window surfaces the review-import world uses — `OperationRunTimeline`, `ActionWindowControlPanel`
 * (controls strictly from `run.allowedCommands`, including the abort/CANCEL_RUN control), and `BlockerNotice` —
 * so a step, a blocker, and the allowed commands are shown identically. Step prose is resolved by copy key
 * (never authored from runtime prose), and `REQUEST_STEP_RECHECK` only reports "I did it" — the runtime alone
 * completes a step.
 *
 * ## The order connection stays Local-Agent-free
 *
 * The bridge lives INSIDE this component, which mounts only in `application_issuance_guided`. Credential entry,
 * the connection test, the first sync, and the saved/existing paths never see it. A seller with no helper — or
 * who declines pairing — is never blocked: a persistent "텍스트로 직접 진행하기" button (and, when the agent
 * cannot guide, an explicit affordance) dispatches `APPLICATION_ISSUANCE_MODE {mode:"text"}` back to the static
 * checklist. Issuance can always be completed with text alone.
 *
 * ## Never a credential
 *
 * Guidance FINISHING (`run.status === "COMPLETED"`) does not connect anything: it surfaces a completion label
 * plus a "SellerOps로 돌아가 연결 정보 입력하기" CTA that fires `ISSUANCE_COMPLETE`, which the reducer maps to
 * `credential_issued` for a new-app seller (the secure-entry hand-off) or back to `existing_credential_entry`
 * for an existing/saved seller — NEVER a stored credential. The completion label alone is path-aware (via the
 * `reuseExistingApp` copy prop): a new-app seller just issued an app ("애플리케이션 발급 완료"), an existing/saved
 * seller only CONFIRMED where their existing app's fields live, so no "발급" is shown ("기존 애플리케이션 확인
 * 완료"). Routing stays path-agnostic — the reducer decides the destination from `path`, not this component. It
 * never renders or requests a credential value, and surfaces no selector, url, or account id — sanitized keys only.
 *
 * ## Live host + offline-testable
 *
 * In production the run view is sourced from the live issuance host (`useGuidedIssuance`): once the agent is
 * paired the component attaches ONCE, the host resyncs and sends `START_RUN` exactly once (or reattaches to a
 * run already in flight after a refresh), and its published `ActionWindowRunView`s drive these surfaces. The host
 * is the SHARED infrastructure for both onboarding paths — the runtime decides open-vs-create by observing the
 * API center, so this component carries no path. A supplied `run` prop (fixture tests) or `hostRuntime` (a test
 * seam runtime) overrides the live host, so the component renders with no reachable bridge; `useBridge` is
 * likewise mocked in the component's own tests.
 */
/**
 * Read the sanitized issuance app-branch off a run view. `appBranch` is a v2 ISSUANCE-only field, so it is
 * not declared on the v1-shaped view type the shared Action Window surfaces consume here — but the live host
 * publishes the v2 view, and a fixture may supply it. Read it structurally and VALIDATE the value, so a
 * missing / unexpected field just reads as "not yet observed" (null) rather than mis-routing the journey.
 */
function readIssuanceAppBranch(view: ActionWindowRunView | null): IssuanceAppBranch | null {
  const branch = (view as { appBranch?: unknown } | null)?.appBranch;
  return branch === "existing" || branch === "new" ? branch : null;
}

export interface NaverIssuanceGuidedWalkthroughProps {
  /** Journey events (the text fallback + the completion hand-off). Never carries a credential. */
  dispatch: (event: GuidedEvent) => void;
  /**
   * CONTROLLED seam. When a `run` prop is supplied (including `null`) the component renders that view and does
   * NOT open a live host — this is the fixture path the component's own tests drive. When the prop is OMITTED
   * (production), the run is sourced from the live issuance host (`useGuidedIssuance`), which attaches once the
   * agent is paired. `undefined` ⇒ live; `null`/a view ⇒ controlled.
   */
  run?: ActionWindowRunView | null;
  /** Forward an operator command to the hosted run (controlled seam). Live mode forwards to the host instead. */
  onCommand?: (type: CommandType) => void;
  /** Test seam: an already-built host runtime, so a component test needs no bridge socket. */
  hostRuntime?: GuidedIssuanceRuntime;
  /**
   * COPY ONLY. An existing/saved-app seller reuses their store's single app, so the completion label reads
   * "기존 애플리케이션 확인 완료" (no "발급"); a new-app seller ("false", the default) reads "애플리케이션 발급
   * 완료". This never changes routing — the reducer routes `ISSUANCE_COMPLETE` from `path`, not from this flag.
   */
  reuseExistingApp?: boolean;
  busy?: boolean;
  /** Deployment-global advertised call IP(s) shown as a persistent advisory during the guided walk, so
   *  the guided path (not just the text checklist) tells the seller to register the fixed call IP.
   *  Empty ⇒ generic guidance, never a fabricated IP. */
  advertisedEgressIps?: readonly string[];
}

export function NaverIssuanceGuidedWalkthrough({
  dispatch,
  run,
  onCommand,
  hostRuntime,
  reuseExistingApp = false,
  busy,
  advertisedEgressIps = [],
}: NaverIssuanceGuidedWalkthroughProps) {
  // GUIDED-FIRST start gate. Guided is the default path, so the seller reaches here without a guided/text
  // choice; a single CTA ("네이버 연결 안내 시작") begins pairing + hosting. Pairing is deferred until the
  // seller starts, so the dedicated NAVER window / agent handshake only begins on an explicit action. Fixture
  // renders (a `run` prop) start immediately — they drive the surfaces directly, not the live start flow.
  const controlled = run !== undefined;
  const [started, setStarted] = useState(controlled);

  // The bridge is confined to this component (this phase). Enabled ONLY after the seller starts, and the order
  // connection never mounts it.
  const bridge = useBridge(started);
  const phase = bridge.state.phase;
  const paired = phase === "paired";
  // The agent cannot guide and pairing will not fix it → the seller should switch to text. `incompatible_version`
  // needs an app update (AgentPairingPanel renders nothing for it); a denial/revocation is an explicit refusal.
  const cannotPair = phase === "incompatible_version" || phase === "pairing_denied" || phase === "revoked";
  // The agent is simply not there (off / not installed / LNA-blocked). AgentPairingPanel already offers a retry;
  // we ALSO surface the text fallback here, because a seller with no Local Agent must have a way forward.
  const agentUnreachable = phase === "unreachable";

  // Live issuance run host — the shared host for BOTH onboarding paths (the runtime picks open-vs-create by
  // observing the API center, so the host carries no path). Inert until `attach()` is called.
  const issuance = useGuidedIssuance(hostRuntime, { channelCode: "naver" });
  const attach = issuance.attach;
  // Attach exactly once, and only once the seller has started AND the agent is paired — a ref keeps StrictMode's
  // double-invoke and any re-render from opening a second socket or starting a second walk (the host also guards
  // START_RUN itself).
  const attachedRef = useRef(false);
  useEffect(() => {
    if (controlled || !started || !paired || attachedRef.current) return;
    attachedRef.current = true;
    void attach();
  }, [controlled, started, paired, attach]);

  // The view and command sink: the controlled prop in fixture mode, the live host otherwise. The host publishes
  // the v2-typed run view; the shared AW surfaces here consume the v1 shape. v2 is structurally v1 plus an
  // optional `intent`, and every enum value an issuance run uses is one these surfaces already render (the
  // fixture tests build v1 issuance views), so the view is adapted with a single documented cast — the same
  // codec-equivalence `issuanceSession.asV2Transport` rests on, in the one place downstream needs v1.
  const liveView = issuance.view as unknown as ActionWindowRunView | null;
  const effectiveRun = controlled ? (run ?? null) : liveView;
  const effectiveCommand = controlled ? onCommand : issuance.send;
  // The host refused (wrong carrier / unreachable / START_RUN rejected) → guidance can't run; point at text.
  const hostRefusal = controlled ? null : issuance.unavailable;
  const hostRefused = hostRefusal !== null;
  const cannotGuide = cannotPair || hostRefused;
  // Classify the host-refusal into a DISTINCT situation so "the agent is hosting a different run/session"
  // (carrier-mismatch → SESSION_MISMATCH) is guided differently from "cannot host" or "not running" — never
  // the old single catch-all. `start-refused` is an issuance-level (not a bridge) reason: the agent is paired
  // but the run would not start, i.e. it cannot host right now. Derived only from existing signals.
  const hostAgentEnv: AgentEnvStatus | null = !hostRefused
    ? null
    : hostRefusal === "start-refused"
      ? { code: "HOST_UNAVAILABLE", fault: "agent", canRetry: true, offerTextFallback: true }
      : classifyAgentEnv({ bridgePhase: phase, hostRefusal });
  // A guided walk that ENDED WITHOUT COMPLETING — the seller pressed 취소, or the runtime failed. The run view
  // survives, so without this the screen kept showing the timeline ("0 / N 단계 완료") beside an empty control
  // panel: a step count, no allowed command, and nothing to press. The Coupang sibling had the identical dead
  // end and it was fixed the same way on 2026-08-19 — an ended walk hands over to the text checklist. COMPLETED
  // is deliberately NOT here: that path has its own hand-off CTA below.
  const walkEnded = !!effectiveRun && (effectiveRun.status === "CANCELLED" || effectiveRun.status === "FAILED");
  // Text is a FALLBACK, never a co-equal choice: it is offered ONLY when guidance cannot run — the agent can't
  // pair (incompatible/denied/revoked), the host refused, the agent is unreachable, or the walk ended without
  // completing. On the healthy paired path it never appears.
  const offerTextFallback = cannotGuide || agentUnreachable || walkEnded;

  // The runtime reveals existing-vs-new by OBSERVING NAVER's application list, and publishes that as the
  // sanitized `appBranch` on the issuance run view (contract). Read it once and set the journey path so
  // completion routes correctly — the seller never pre-declares have/new (guided-first), and the FE no longer
  // decodes the step-2 copy key. `appBranch` absent ⇒ not yet observed ⇒ the path stays `unknown` (fail-safe).
  const branchObservedRef = useRef(false);
  const observedBranch = readIssuanceAppBranch(effectiveRun);
  useEffect(() => {
    if (branchObservedRef.current || !observedBranch) return;
    branchObservedRef.current = true;
    dispatch({ type: "ISSUANCE_APP_BRANCH_OBSERVED", branch: observedBranch });
  }, [observedBranch, dispatch]);

  // The commands this walkthrough surfaces from the run's `allowedCommands` — the same curation the import
  // sibling uses (`GuidedImportCard.OFFERED_COMMANDS`). A barrier's raw `allowedCommands` also includes
  // PAUSE/RESUME, SET_GUIDANCE_ENABLED, FIND_CURRENT_STEP, and SWITCH_TO_MANUAL; SET_GUIDANCE_ENABLED/
  // FIND_CURRENT_STEP are inert here, and SWITCH_TO_MANUAL is reached only through the failure-only text
  // fallback (`toText`), which aborts the run cleanly before advancing to text. So only these two render.
  const OFFERED_COMMANDS: readonly CommandType[] = ["REQUEST_STEP_RECHECK", "CANCEL_RUN"];
  const controlExclude = effectiveRun
    ? effectiveRun.allowedCommands.filter((c) => !OFFERED_COMMANDS.includes(c))
    : [];

  // Retry for a HOST refusal (agent paired but hosting a different run / cannot host right now). The bridge is
  // already paired, so re-detecting it (`bridge.retry`) is not the fix — the issuance HOST must be re-attached.
  // Reset the attach once-guard and re-attach: a successful reattach clears `issuance.unavailable`
  // (useGuidedIssuance sets it back to null), recovering the guided walk; a still-refusing agent simply
  // re-sets the same reason (the notice persists, fail-closed). `attach()` is idempotent, so this cannot open
  // a second socket. This is what makes "restart the agent, then retry" (the SESSION_MISMATCH copy) actually work.
  const retryHost = () => {
    attachedRef.current = false;
    void attach();
  };

  const toText = () => {
    // Switching to text IS the manual path: if a guided run is live and the runtime accepts it, tell the
    // runtime first (SWITCH_TO_MANUAL → the run aborts cleanly) so it is not left orphaned when this host
    // unmounts, then advance the FE journey to the static checklist. Best-effort + gated by allowedCommands.
    if (!controlled && effectiveRun?.allowedCommands.includes("SWITCH_TO_MANUAL")) {
      effectiveCommand?.("SWITCH_TO_MANUAL");
    }
    dispatch({ type: "APPLICATION_ISSUANCE_MODE", mode: "text" });
  };

  // GUIDED-FIRST start screen: one CTA begins the walk. No guided/text choice — text is a failure-only
  // fallback surfaced later. The dedicated NAVER window / pairing only starts on this explicit action.
  if (!started) {
    return (
      <div className="space-y-3" aria-label="네이버 연결 안내 시작">
        <p className="text-sm text-ink break-keep">네이버 API 센터에서 연결 정보를 확인하도록 안내해 드릴게요.</p>
        <p className="text-sm text-muted break-keep">
          시작하면 전용 NAVER 창이 열립니다. 로그인·클릭·복사는 직접 하시면 되고, SellerOps는 어디를 봐야
          하는지 화면으로 안내만 합니다 — 값·클립보드·화면을 읽지 않습니다.
        </p>
        <button
          type="button"
          className="btn-primary block w-full"
          onClick={() => setStarted(true)}
          disabled={busy}
        >
          네이버 연결 안내 시작
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label={reuseExistingApp ? "화면 안내" : "화면 안내 발급"}>
      {/* Persistent advisory: the guided path must also tell the seller to register the fixed call IP
          (the API-center walkthrough covers the app/API-group/credentials, not the 'API 호출 IP' field). */}
      <section className="space-y-1 rounded-lg border border-line px-4 py-3" aria-label="API 호출 IP 등록 안내">
        <p className="text-sm font-medium text-ink">API 호출 IP 등록</p>
        <p className="text-xs text-muted">
          애플리케이션 설정의 'API 호출 IP'에 SellerOps 고정 호출 IP를 등록하세요. 등록하지 않으면 첫 주문 수집이
          호출 IP 오류로 실패할 수 있습니다.
        </p>
        <AdvertisedCallIpPanel ips={advertisedEgressIps} />
      </section>

      {/* Pairing (guided path only). AgentPairingPanel self-hides when paired or on an incompatible version. */}
      {!paired && (
        <AgentPairingPanel
          phase={phase}
          confirmationCode={bridge.state.confirmationCode ?? null}
          confirmUrl={bridge.state.confirmUrl ?? null}
          maybeNeedsLocalNetworkAccess={bridge.state.maybeNeedsLocalNetworkAccess}
          onConnect={bridge.requestPairing}
          onRetry={bridge.retry}
        />
      )}

      {/* Pairing itself won't help (needs an update / declined / revoked) — the generic guidance to text. */}
      {cannotPair && (
        <p className="rounded-xl bg-warn/10 px-4 py-3 text-sm text-ink break-keep" role="status">
          화면 안내를 사용할 수 없어요. 텍스트로 진행해 주세요.
        </p>
      )}

      {/* Agent paired but the host refused → a DISTINCT notice: "hosting a different run/session"
          (carrier-mismatch → restart the agent, then retry) vs "cannot host right now" — never conflated
          with "the agent is not running". */}
      {hostAgentEnv && <AgentEnvNotice status={hostAgentEnv} onRetry={retryHost} />}

      {/* The walk ended without completing → say so, then offer the way forward. Without this the seller is
          left reading a step counter with no control under it. */}
      {walkEnded && (
        <p className="rounded-xl bg-canvas px-4 py-3 text-sm text-ink break-keep" role="status">
          화면 안내를 끝냈어요. 아래에서 텍스트 안내로 계속 진행하실 수 있습니다.
        </p>
      )}

      {/* Text is a FALLBACK, shown ONLY when guidance cannot run (can't pair / host refused / agent
          unreachable) or the walk ended without completing. On the healthy paired path it never appears. */}
      {offerTextFallback && (
        <button type="button" className="btn-ghost text-sm" onClick={toText} disabled={busy}>
          텍스트로 직접 진행하기
        </button>
      )}

      {/* Paired but no run yet: the agent is connected; the guidance run is starting. */}
      {paired && !effectiveRun && !cannotGuide && (
        <p className="rounded-xl bg-canvas px-4 py-3 text-sm text-muted break-keep" role="status">
          도우미가 연결됐어요. NAVER API 센터 안내를 준비하고 있어요.
        </p>
      )}

      {/* A hosted run → the shared Action Window surfaces. */}
      {effectiveRun && (
        <>
          <OperationRunTimeline run={effectiveRun} />
          {/* FULL instruction for the current step, so this screen is self-sufficient and the seller does not
              have to decode the in-NAVER highlight (which only points at a control). FE-owned copy by step key;
              a step with no detail renders nothing. */}
          {(() => {
            const detail = issuanceStepDetail(effectiveRun.currentStep?.copyKey);
            return detail ? (
              <p className="rounded-lg bg-canvas px-4 py-3 text-sm text-ink break-keep" role="note">
                {detail}
              </p>
            ) : null;
          })()}
          {effectiveRun.blocker && (
            <BlockerNotice
              title={blockerView(effectiveRun.blocker.code).title}
              body={blockerView(effectiveRun.blocker.code).body}
              recoverable={effectiveRun.blocker.recoverable}
              variant="standalone"
            />
          )}
          <ActionWindowControlPanel
            run={effectiveRun}
            exclude={controlExclude}
            onCommand={(type) => effectiveCommand?.(type)}
          />
          {effectiveRun.status === "COMPLETED" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink break-keep" role="status">
                {reuseExistingApp ? "기존 애플리케이션 확인 완료" : "애플리케이션 발급 완료"}
              </p>
              <button
                type="button"
                className="btn-primary block w-full"
                onClick={() => dispatch({ type: "ISSUANCE_COMPLETE" })}
                disabled={busy}
              >
                SellerOps로 돌아가 연결 정보 입력하기
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
