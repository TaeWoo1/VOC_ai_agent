import { useEffect, useRef, useState } from "react";
import { useBridge } from "../../hooks/useBridge";
import type { ActionWindowRunView, CommandType } from "../../lib/actionWindow/contract";
import { blockerView } from "../../lib/actionWindow/copy";
import { ActionWindowControlPanel } from "../actionWindow/ActionWindowControlPanel";
import { BlockerNotice } from "../actionWindow/BlockerNotice";
import { AgentPairingPanel } from "../reviewImport/AgentPairingPanel";
import { AdvertisedCallIpPanel } from "../guidedConnection/AdvertisedCallIpPanel";
import { Spinner } from "../ui/Spinner";
import { CoupangIssuanceTutorial } from "./CoupangIssuanceTutorial";
import { useGuidedIssuance } from "../../lib/actionWindow/issuance/useGuidedIssuance";
import type { GuidedIssuanceRuntime } from "../../lib/actionWindow/issuance/issuanceRuntime";
import { isIssuanceResumeReturn } from "../../lib/coupangTutorial";

/**
 * The Action Window guided walkthrough for Coupang WING Open API key issuance — a fork of
 * `NaverIssuanceGuidedWalkthrough`, sharing the SAME channel-agnostic issuance host stack
 * (`useGuidedIssuance`) and the SAME shared AW surfaces (`OperationRunTimeline`, `ActionWindowControlPanel`,
 * `BlockerNotice`). It is the ONLY place a Local Agent participates in the Coupang order connection: the
 * agent opens real WING in Chrome and highlights each step; SellerOps here renders the sanitized run view.
 *
 * ## The order connection stays Local-Agent-free
 *
 * The bridge lives INSIDE this component, which mounts only in the `issuance` journey phase. Credential
 * entry, the connection test, the first sync, and every already-progressed path never see it. A seller with
 * no helper — or who declines pairing — is never blocked: the screen walk is the PRIMARY path and the resident
 * SellerOps 도우미 brings it up on demand (the tab asks for the `issuance`/`coupang` carrier; the helper
 * assembles the walk and announces it; the WING window opens on the seller's 시작). The text checklist is the
 * FALLBACK, entered only when the walk is known to be impossible on this machine (no helper, pairing will not
 * fix it, or the paired helper cannot host the walk — an older helper, or one holding a different carrier) —
 * with no error, because that is an ordinary way to issue the key, not a failure. While the walk is being
 * prepared a "텍스트로 직접 진행하기" affordance is one click away, and an "이미 키가 있어요" skip on the start
 * gate jumps straight to credential entry. Issuance can always be completed with text alone.
 *
 * ## Never a credential, never a scripted page
 *
 * The FE never scripts or reads the marketplace DOM — highlighting is entirely agent-side. This component
 * consumes only sanitized copy keys / enums / primitives, renders command controls ONLY from
 * `run.allowedCommands`, and `REQUEST_STEP_RECHECK` only reports "I did it" — the runtime alone completes a
 * step. Guidance FINISHING (`status === "COMPLETED"`) connects nothing: it surfaces a completion label + a
 * CTA that fires `onIssued()`, the journey's hand-off to the masked credential form. No credential value,
 * selector, url, or account id is ever rendered.
 *
 * ## Live host + offline-testable
 *
 * In production the run view is sourced from the live issuance host: once the agent is paired the component
 * attaches ONCE, the host resyncs and sends `START_RUN` exactly once (or reattaches to a run already in
 * flight after a refresh). The run's `channelCode` comes from the agent's own announcement ("coupang") — it
 * is never hard-coded here. A supplied `run` prop (fixture tests) or `hostRuntime` (a test seam runtime)
 * overrides the live host, so the component renders with no reachable bridge; `useBridge` is mocked in the
 * component's own tests.
 */
export interface CoupangIssuanceGuidedWalkthroughProps {
  /** Advance the journey to credential entry — issuance complete, text checklist done, or "I already have
   *  the key". NEVER carries a credential. */
  onIssued: () => void;
  /**
   * CONTROLLED seam. When a `run` prop is supplied (including `null`) the component renders that view and
   * does NOT open a live host — the fixture path the component's own tests drive. When OMITTED (production)
   * the run is sourced from the live issuance host, which attaches once the agent is paired. `undefined` ⇒
   * live; `null`/a view ⇒ controlled.
   */
  run?: ActionWindowRunView | null;
  /** Forward an operator command to the hosted run (controlled seam). Live mode forwards to the host. */
  onCommand?: (type: CommandType) => void;
  /** Test seam: an already-built host runtime, so a component test needs no bridge socket. */
  hostRuntime?: GuidedIssuanceRuntime;
  busy?: boolean;
  /** Deployment-global advertised call IP(s) shown as a persistent advisory during the guided walk, so the
   *  guided path (not just the text checklist) tells the seller to register the fixed call IP. Empty ⇒
   *  generic guidance, never a fabricated IP. */
  advertisedEgressIps?: readonly string[];
}

export function CoupangIssuanceGuidedWalkthrough({
  onIssued,
  run,
  onCommand,
  hostRuntime,
  busy,
  advertisedEgressIps = [],
}: CoupangIssuanceGuidedWalkthroughProps) {
  // GUIDED-FIRST start gate. Guided is the default path; a single CTA ("쿠팡 연결 안내 시작") begins pairing +
  // hosting. Pairing is deferred until the seller starts, so the dedicated WING window / agent handshake only
  // begins on an explicit action. Fixture renders (a `run` prop) start immediately.
  const controlled = run !== undefined;
  // …and a RETURN is not an arrival. The agent's own "SellerOps에 연결" appends `?issuance=resume`, which is the
  // only thing on this page that can know a run is already in flight: the journey phase is derived from
  // persisted state (nothing is persisted mid-issuance) and this flag is component-local, so a fresh tab
  // otherwise re-offers "쿠팡 연결 안내 시작" to a seller who has just finished. It skips a gate the seller can
  // press themselves and adopts whatever run the agent is hosting — it authorizes nothing.
  const resumed = !controlled && isIssuanceResumeReturn(typeof window === "undefined" ? "" : window.location.search);
  const [started, setStarted] = useState(controlled || resumed);
  // The seller's explicit switch to the text checklist. Local to this phase — the pure journey reducer only
  // owns the issuance→connect transition (via `onIssued`), not the guided/text sub-mode.
  const [textMode, setTextMode] = useState(false);

  // The bridge is confined to this component (this phase). Enabled ONLY after the seller starts; the order
  // connection never mounts it.
  const bridge = useBridge(started);
  const phase = bridge.state.phase;
  const paired = phase === "paired";
  // The agent cannot guide and pairing will not fix it. `incompatible_version` needs an app update; a
  // denial/revocation is an explicit refusal.
  const cannotPair = phase === "incompatible_version" || phase === "pairing_denied" || phase === "revoked";
  // The agent is simply not there (off / not installed / LNA-blocked).
  const agentUnreachable = phase === "unreachable";
  // The bridge is still finding out (first detection, a websocket reconnect). Not a verdict yet.
  const agentSettling = phase === "connecting" || phase === "connecting_ws" || phase === "disconnected";

  // Live issuance run host — the SHARED host for every channel (the run's channelCode comes from the agent
  // announcement). Inert until `attach()` is called. `channelCode` here is the ASK, not the answer: the resident
  // SellerOps 도우미 hosts no carrier until a tab asks, and this is the tab asking for the Coupang guided walk —
  // the announced channelCode still decides what the run is.
  const issuance = useGuidedIssuance(hostRuntime, { channelCode: "coupang" });
  const attach = issuance.attach;
  // Attach exactly once, and only once the seller has started AND the agent is paired — a ref keeps
  // StrictMode's double-invoke and any re-render from opening a second socket or starting a second walk (the
  // host also guards START_RUN itself).
  const attachedRef = useRef(false);
  useEffect(() => {
    if (controlled || !started || !paired || attachedRef.current) return;
    attachedRef.current = true;
    void attach();
  }, [controlled, started, paired, attach]);

  // The view and command sink: the controlled prop in fixture mode, the live host otherwise. The host
  // publishes the v2-typed run view; the shared AW surfaces here consume the v1 shape (structurally v1 plus
  // an optional `intent`), adapted with a single documented cast — the same codec-equivalence the issuance
  // session rests on, in the one place downstream needs v1.
  const liveView = issuance.view as unknown as ActionWindowRunView | null;
  // **Whether this account ALREADY had a key**, as the agent read it — v2-only and issuance-only, so it is
  // taken from the v2 view before the cast rather than added to the shared v1 shape. `KEY_PRESENT` means the
  // run skipped issuance entirely and went straight to the hand-off; the copy has to say so, because telling
  // someone "발급 완료" when they issued nothing is a claim about their account that is not true.
  const credentialState = controlled ? null : (issuance.view?.credentialState ?? null);
  const alreadyHadKey = credentialState === "KEY_PRESENT";
  const effectiveRun = controlled ? (run ?? null) : liveView;
  const effectiveCommand = controlled ? onCommand : issuance.send;
  // The host refused (no carrier announced / wrong carrier / unreachable / START_RUN rejected) → guidance can't
  // run on this helper. WHICH of those it was is an internal agent-runtime fact (which carrier the resident
  // helper happens to host); a seller cannot act on it and is not shown it.
  const hostRefusal = controlled ? null : issuance.unavailable;
  const hostRefused = hostRefusal !== null;
  // **Guidance only when it can actually run.** Whenever the screen walk is known to be impossible — the agent
  // is not there, pairing will not fix it, or the paired helper cannot host the walk — the walkthrough goes
  // straight to the ordinary text issuance flow. No error is shown for it: the text flow is a complete,
  // first-class way to issue the key and connect (credential → verify → first sync), not a degraded one.
  // Reported live 2026-08-19: a resident helper without an Action Window carrier left the seller on
  // "화면 안내를 실행할 수 없어요" after a 4s timeout, for a state that was never theirs to fix.
  const guidanceImpossible = agentUnreachable || cannotPair || hostRefused;
  // **The seller ENDED the walk** (취소, or the runtime failed it). Live-observed 2026-08-19: the screen kept
  // saying "쿠팡(윙) 창에서 화면 안내를 따라 진행하세요 · 0/8" beside "지금은 할 수 있는 동작이 없어요" — a walk
  // that is over, presented as one in progress, with nothing to press. A cancelled walk is not an error and not
  // a dead end: it hands over to the ordinary text checklist, which finishes the issuance.
  const walkEnded = !!effectiveRun && (effectiveRun.status === "CANCELLED" || effectiveRun.status === "FAILED");
  // Still deciding: detecting the helper, pairing, or attaching to the host (no run yet, no refusal yet).
  const guidancePreparing = !guidanceImpossible && !effectiveRun;
  // The text flow is the way out of every waiting state too — a seller never has to wait on (or pair) the
  // helper to proceed. It disappears only once a hosted run is actually on screen.
  const offerTextFallback = guidancePreparing;

  // WING-RESIDENT walk: the FE is NOT the per-step controller. Step advance happens ON the WING page (the
  // overlay's own "다음" button), so this screen surfaces NO per-step recheck control during a healthy barrier —
  // only an escape (CANCEL_RUN). When the run is PARKED on a recoverable blocker, recovery is the FE's job, so it
  // additionally surfaces REQUEST_STEP_RECHECK ("다시 확인" — re-probe/re-guide; it never completes a step). This
  // is the one place `REQUEST_STEP_RECHECK` is offered, and only for recovery.
  const isBlocked = !!effectiveRun?.blocker;
  const OFFERED_COMMANDS: readonly CommandType[] = isBlocked
    ? ["REQUEST_STEP_RECHECK", "CANCEL_RUN"]
    : ["CANCEL_RUN"];
  // The walk happens in a window SellerOps opened, and a seller who switches away can lose it behind everything
  // else — reported live on 2026-08-12, with this screen offering no way back to it. `FIND_CURRENT_STEP` is
  // already in `allowedCommands` at every non-terminal stage and the runtime treats it as "show me where I am";
  // on this walk that means RAISING the WING window. It is rendered as its own control rather than through the
  // generic panel so the label can say what it actually does here.
  const canRaiseWindow = effectiveRun?.allowedCommands.includes("FIND_CURRENT_STEP") ?? false;
  const controlExclude = effectiveRun
    ? effectiveRun.allowedCommands.filter((c) => !OFFERED_COMMANDS.includes(c))
    : [];

  const toText = () => {
    // Switching to text IS the manual path: if a guided run is live and the runtime accepts it, tell the
    // runtime first (SWITCH_TO_MANUAL → the run aborts cleanly) so it is not left orphaned, then show the
    // static checklist. Best-effort + gated by allowedCommands.
    if (!controlled && effectiveRun?.allowedCommands.includes("SWITCH_TO_MANUAL")) {
      effectiveCommand?.("SWITCH_TO_MANUAL");
    }
    setTextMode(true);
  };

  // The text flow: the static WING checklist. Entered by the seller's own click, automatically the moment
  // guidance is known to be impossible, or after the seller ended the walk (once started, never on the start gate). The seller completes issuance
  // here and hands off to credential entry via `onIssued`. SellerOps never scripts WING — the checklist only
  // opens it in a new tab.
  if (textMode || (started && (guidanceImpossible || walkEnded))) {
    return (
      <div className="space-y-3" aria-label="쿠팡 Open API 키 발급 (텍스트 안내)">
        <p className="text-sm text-muted break-keep">
          화면 안내 대신 아래 순서대로 직접 진행하세요. 발급을 마치면 연결 정보 입력 단계로 넘어갑니다.
        </p>
        <CoupangIssuanceTutorial
          onComplete={onIssued}
          busy={busy}
          advertisedEgressIps={advertisedEgressIps}
        />
      </div>
    );
  }

  // GUIDED-FIRST start screen: one CTA begins the walk, plus a skip for a seller who already issued the key.
  if (!started) {
    return (
      <div className="space-y-3" aria-label="쿠팡 연결 안내 시작">
        <p className="text-sm text-ink break-keep">
          쿠팡 윙에서 Open API 키를 발급하도록 화면으로 안내해 드릴게요.
        </p>
        <p className="text-sm text-muted break-keep">
          시작하면 전용 쿠팡 윙 창이 열립니다. 로그인·클릭·발급은 직접 하시면 되고, SellerOps는 어디를 봐야
          하는지 화면으로 안내만 합니다 — 값·클립보드·화면을 읽지 않습니다.
        </p>
        <button
          type="button"
          className="btn-primary block w-full"
          onClick={() => setStarted(true)}
          disabled={busy}
        >
          쿠팡 연결 안내 시작
        </button>
        <button type="button" className="btn-ghost block w-full text-sm" onClick={onIssued} disabled={busy}>
          이미 키가 있어요
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label="화면 안내 발급">
      {/* The seller already had a key, so no issuance happened and none will. Said out loud: the rest of this
          screen is a walk, and a walk with no issuance step in it needs to explain itself. */}
      {alreadyHadKey && (
        <p className="rounded-xl bg-ok/10 px-4 py-3 text-sm text-ink break-keep" role="status">
          이미 발급된 Open API 키가 있어요. 새로 발급하지 않고, 연결에 필요한 정보만 확인합니다.
        </p>
      )}
      {/* Persistent advisory: the guided path must also tell the seller to register the fixed call IP
          (the WING walkthrough covers the key issuance, but the 'API 호출 IP' field is easy to miss). */}
      <section className="space-y-1 rounded-lg border border-line px-4 py-3" aria-label="API 호출 IP 등록 안내">
        <p className="text-sm font-medium text-ink">API 호출 IP 등록</p>
        <p className="text-xs text-muted">
          발급 화면의 'API 호출 IP'에 SellerOps 고정 호출 IP를 등록하세요. 등록하지 않으면 첫 주문 수집이
          호출 IP 오류로 실패할 수 있습니다.
        </p>
        <AdvertisedCallIpPanel ips={advertisedEgressIps} />
      </section>

      {/* Still deciding whether the walk can run. Two honest faces, neither an error: a neutral "preparing"
          line (detecting the helper / attaching to the host) and, when the helper is there but not yet paired,
          the pairing action itself. An impossible state never reaches this render — it is the text flow above. */}
      {guidancePreparing && (paired || agentSettling) && (
        <div className="flex items-center gap-3 rounded-xl bg-canvas px-4 py-3" role="status">
          <Spinner />
          <p className="text-sm text-muted break-keep">
            {paired ? "도우미가 연결됐어요. 쿠팡 윙 안내를 준비하고 있어요." : "내 PC의 SellerOps 도우미를 찾고 있어요…"}
          </p>
        </div>
      )}
      {guidancePreparing && !paired && !agentSettling && (
        <AgentPairingPanel
          phase={phase}
          confirmationCode={bridge.state.confirmationCode ?? null}
          confirmUrl={bridge.state.confirmUrl ?? null}
          maybeNeedsLocalNetworkAccess={bridge.state.maybeNeedsLocalNetworkAccess}
          onConnect={bridge.requestPairing}
          onRetry={bridge.retry}
        />
      )}

      {/* The text flow is always one click away while the walk is being prepared; it disappears once a hosted
          run is on screen (the walk is then really running). */}
      {offerTextFallback && (
        <button type="button" className="btn-ghost text-sm" onClick={toText} disabled={busy}>
          텍스트로 직접 진행하기
        </button>
      )}

      {/* A hosted run → the WING-resident status surface. The seller's primary screen is the 쿠팡 윙 창; this
          screen shows live status + progress and only steps in for recovery or the final hand-off. */}
      {effectiveRun && (
        <>
          {/* Healthy barrier: STATUS ONLY. The step-by-step guidance and the "다음" button live ON the WING page
              (the overlay), not here — so this screen never mirrors or drives the walk step by step. */}
          {effectiveRun.status !== "COMPLETED" && !effectiveRun.blocker && (
            <section
              className="space-y-1 rounded-xl bg-canvas px-4 py-3"
              role="status"
              aria-label="화면 안내 진행 상태"
            >
              <p className="text-sm font-medium text-ink break-keep">
                쿠팡(윙) 창에서 화면 안내를 따라 진행하세요
              </p>
              <p className="text-xs text-muted break-keep">
                열린 쿠팡 윙 창의 안내(하이라이트와 '다음' 버튼)를 따라가시면 됩니다. 각 단계는 윙 화면에서 직접
                진행되고, 이 화면은 진행 상태만 보여줍니다.
              </p>
              {effectiveRun.progress && (
                <p className="text-xs text-muted">
                  {effectiveRun.progress.completedSteps} / {effectiveRun.progress.totalSteps} 단계 완료
                </p>
              )}
            </section>
          )}

          {/* The way back to the WING window, and it is deliberately the LOUDEST thing on this screen.
              Reported live twice (2026-08-12): the seller could not find it. It was a ghost-styled line of text
              at the bottom of a status box, and it was hidden entirely at a blocker — which is precisely when a
              seller has lost the window and comes here looking. It is now its own control, full width, rendered
              for every non-terminal run. It raises the EXISTING window; it opens nothing and navigates nothing. */}
          {effectiveRun.status !== "COMPLETED" && canRaiseWindow && (
            <button
              type="button"
              className="btn-ghost block w-full"
              onClick={() => effectiveCommand?.("FIND_CURRENT_STEP")}
              disabled={busy}
            >
              쿠팡 윙 창 앞으로 가져오기
            </button>
          )}

          {/* Recovery is the FE's job: at a recoverable blocker, surface the blocker + the recovery control
              ("다시 확인" / 취소). REQUEST_STEP_RECHECK re-probes/re-guides; it never completes a step. */}
          {effectiveRun.blocker && (
            <BlockerNotice
              title={blockerView(effectiveRun.blocker.code).title}
              body={blockerView(effectiveRun.blocker.code).body}
              recoverable={effectiveRun.blocker.recoverable}
              variant="standalone"
            />
          )}
          {effectiveRun.status !== "COMPLETED" && (
            <ActionWindowControlPanel
              run={effectiveRun}
              exclude={controlExclude}
              onCommand={(type) => effectiveCommand?.(type)}
            />
          )}

          {effectiveRun.status === "COMPLETED" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink break-keep" role="status">
                {alreadyHadKey ? "이미 발급된 Open API 키를 확인했어요" : "Open API 키 발급 완료"}
              </p>
              <button
                type="button"
                className="btn-primary block w-full"
                onClick={onIssued}
                disabled={busy}
              >
                SellerOps로 돌아가 연결 정보 입력하기
              </button>
              {/* The keys are on a WING window SellerOps opened, and WING shows the secret key ONCE — so the
                  end of the walk is the WORST moment to lose that window behind the others. The label says
                  what it is for here rather than naming a step, because there is no step left to find. It
                  raises the EXISTING window and can open nothing: the runtime refuses unless one is open. */}
              {canRaiseWindow && (
                <button
                  type="button"
                  className="btn-ghost block w-full"
                  onClick={() => effectiveCommand?.("FIND_CURRENT_STEP")}
                  disabled={busy}
                >
                  쿠팡 윙 키 화면 다시 보기
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
