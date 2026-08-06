import { useEffect, useRef, useState } from "react";
import { useBridge } from "../../hooks/useBridge";
import type { ActionWindowRunView, CommandType } from "../../lib/actionWindow/contract";
import { blockerView, renewalStepDetail } from "../../lib/actionWindow/copy";
import { OperationRunTimeline } from "../actionWindow/OperationRunTimeline";
import { ActionWindowControlPanel } from "../actionWindow/ActionWindowControlPanel";
import { BlockerNotice } from "../actionWindow/BlockerNotice";
import { AgentPairingPanel } from "../reviewImport/AgentPairingPanel";
import { AgentEnvNotice } from "../guidedConnection/AgentEnvNotice";
import { CoupangIssuanceTutorial } from "./CoupangIssuanceTutorial";
import { COUPANG_RENEWAL_TUTORIAL } from "../../lib/guidedConnection";
import { useGuidedIssuance } from "../../lib/actionWindow/issuance/useGuidedIssuance";
import type { GuidedIssuanceRuntime } from "../../lib/actionWindow/issuance/issuanceRuntime";
import { classifyAgentEnv, type AgentEnvStatus } from "../../lib/guidedConnection";

/**
 * The Action Window guided walkthrough for Coupang WING Open API key RENEWAL — a fork of
 * {@link CoupangIssuanceGuidedWalkthrough}. It reuses the SAME channel-agnostic hosted-run stack
 * (`useGuidedIssuance`) and the SAME shared AW surfaces (`OperationRunTimeline`, `ActionWindowControlPanel`,
 * `BlockerNotice`); the RUNTIME drives the renewal step plan (highlight 유효기간 + 재발급, human checkpoint
 * before 재발급). SellerOps here renders only the sanitized run view.
 *
 * ## Renewal, not issuance
 *
 * Entered from an ALREADY-CONNECTED account whose credential is expiring. On completion it hands off to the
 * masked credential REPLACE form (not a fresh credential-entry): `onComplete()` is the renewal-flow's
 * guide → replace transition. The "이미 새 키가 있어요" skip jumps straight to the replace form.
 *
 * ## Never a credential, never a scripted page
 *
 * The FE never scripts or reads the marketplace DOM — highlighting is entirely agent-side. This component
 * consumes only sanitized copy keys / enums / primitives, renders command controls ONLY from
 * `run.allowedCommands`, and `REQUEST_STEP_RECHECK` only reports "I did it" — the runtime alone completes a
 * step. No credential value, selector, url, or account id is ever rendered.
 *
 * ## Live host + offline-testable
 *
 * A supplied `run` prop (fixture tests) or `hostRuntime` (a test seam runtime) overrides the live host, so
 * the component renders with no reachable bridge; `useBridge` is mocked in the component's own tests.
 */
export interface CoupangRenewalGuidedWalkthroughProps {
  /** Advance the renewal flow to the masked REPLACE form — renewal walk complete, text checklist done, or
   *  "이미 새 키가 있어요". NEVER carries a credential. */
  onComplete: () => void;
  /**
   * CONTROLLED seam. When a `run` prop is supplied (including `null`) the component renders that view and
   * does NOT open a live host. When OMITTED (production) the run is sourced from the live host, which
   * attaches once the agent is paired. `undefined` ⇒ live; `null`/a view ⇒ controlled.
   */
  run?: ActionWindowRunView | null;
  /** Forward an operator command to the hosted run (controlled seam). Live mode forwards to the host. */
  onCommand?: (type: CommandType) => void;
  /** Test seam: an already-built host runtime, so a component test needs no bridge socket. */
  hostRuntime?: GuidedIssuanceRuntime;
  busy?: boolean;
}

export function CoupangRenewalGuidedWalkthrough({
  onComplete,
  run,
  onCommand,
  hostRuntime,
  busy,
}: CoupangRenewalGuidedWalkthroughProps) {
  // GUIDED-FIRST start gate. A single CTA begins pairing + hosting; pairing is deferred until the seller
  // starts. Fixture renders (a `run` prop) start immediately.
  const controlled = run !== undefined;
  const [started, setStarted] = useState(controlled);
  const [textMode, setTextMode] = useState(false);

  const bridge = useBridge(started);
  const phase = bridge.state.phase;
  const paired = phase === "paired";
  const cannotPair = phase === "incompatible_version" || phase === "pairing_denied" || phase === "revoked";
  const agentUnreachable = phase === "unreachable";

  const issuance = useGuidedIssuance(hostRuntime);
  const attach = issuance.attach;
  const attachedRef = useRef(false);
  useEffect(() => {
    if (controlled || !started || !paired || attachedRef.current) return;
    attachedRef.current = true;
    void attach();
  }, [controlled, started, paired, attach]);

  const liveView = issuance.view as unknown as ActionWindowRunView | null;
  const effectiveRun = controlled ? (run ?? null) : liveView;
  const effectiveCommand = controlled ? onCommand : issuance.send;
  const hostRefusal = controlled ? null : issuance.unavailable;
  const hostRefused = hostRefusal !== null;
  const cannotGuide = cannotPair || hostRefused;
  const hostAgentEnv: AgentEnvStatus | null = !hostRefused
    ? null
    : hostRefusal === "start-refused"
      ? { code: "HOST_UNAVAILABLE", fault: "agent", canRetry: true, offerTextFallback: true }
      : classifyAgentEnv({ bridgePhase: phase, hostRefusal });
  const offerTextFallback = cannotGuide || agentUnreachable;

  const OFFERED_COMMANDS: readonly CommandType[] = ["REQUEST_STEP_RECHECK", "CANCEL_RUN"];
  const controlExclude = effectiveRun
    ? effectiveRun.allowedCommands.filter((c) => !OFFERED_COMMANDS.includes(c))
    : [];

  const retryHost = () => {
    attachedRef.current = false;
    void attach();
  };

  const toText = () => {
    if (!controlled && effectiveRun?.allowedCommands.includes("SWITCH_TO_MANUAL")) {
      effectiveCommand?.("SWITCH_TO_MANUAL");
    }
    setTextMode(true);
  };

  // Text fallback: the static WING RENEWAL checklist. The seller re-issues at WING and hands off to the
  // masked REPLACE form via `onComplete`. SellerOps never scripts WING — the checklist only opens it.
  if (textMode) {
    return (
      <div className="space-y-3" aria-label="쿠팡 Open API 키 갱신 (텍스트 안내)">
        <p className="text-sm text-muted break-keep">
          화면 안내 대신 아래 순서대로 직접 진행하세요. 재발급을 마치면 새 키로 교체하는 입력 단계로 넘어갑니다.
        </p>
        <CoupangIssuanceTutorial
          onComplete={onComplete}
          completeLabel="재발급을 완료했어요"
          busy={busy}
          steps={COUPANG_RENEWAL_TUTORIAL}
          ariaLabel="쿠팡 Open API 키 갱신 안내"
        />
      </div>
    );
  }

  // GUIDED-FIRST start screen: one CTA begins the walk, plus a skip for a seller who already re-issued.
  if (!started) {
    return (
      <div className="space-y-3" aria-label="쿠팡 API 키 갱신 안내 시작">
        <p className="text-sm text-ink break-keep">
          쿠팡 윙에서 새 Open API 키를 재발급하도록 화면으로 안내해 드릴게요.
        </p>
        <p className="text-sm text-muted break-keep">
          시작하면 전용 쿠팡 윙 창이 열립니다. 로그인·클릭·재발급은 직접 하시면 되고, SellerOps는 어디를 봐야
          하는지 화면으로 안내만 합니다 — 값·클립보드·화면을 읽지 않습니다.
        </p>
        <button
          type="button"
          className="btn-primary block w-full"
          onClick={() => setStarted(true)}
          disabled={busy}
        >
          쿠팡 API 키 갱신 안내 시작
        </button>
        <button type="button" className="btn-ghost block w-full text-sm" onClick={onComplete} disabled={busy}>
          이미 새 키가 있어요
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label="화면 안내 갱신">
      {!paired && (
        <AgentPairingPanel
          phase={phase}
          confirmationCode={bridge.state.confirmationCode ?? null}
          maybeNeedsLocalNetworkAccess={bridge.state.maybeNeedsLocalNetworkAccess}
          onConnect={bridge.requestPairing}
          onRetry={bridge.retry}
        />
      )}

      {cannotPair && (
        <p className="rounded-xl bg-warn/10 px-4 py-3 text-sm text-ink break-keep" role="status">
          화면 안내를 사용할 수 없어요. 텍스트로 진행해 주세요.
        </p>
      )}

      {hostAgentEnv && <AgentEnvNotice status={hostAgentEnv} onRetry={retryHost} />}

      {offerTextFallback && (
        <button type="button" className="btn-ghost text-sm" onClick={toText} disabled={busy}>
          텍스트로 직접 진행하기
        </button>
      )}

      {paired && !effectiveRun && !cannotGuide && (
        <p className="rounded-xl bg-canvas px-4 py-3 text-sm text-muted break-keep" role="status">
          도우미가 연결됐어요. 쿠팡 윙 갱신 안내를 준비하고 있어요.
        </p>
      )}

      {effectiveRun && (
        <>
          <OperationRunTimeline run={effectiveRun} />
          {(() => {
            const detail = renewalStepDetail(effectiveRun.currentStep?.copyKey);
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
                새 API 키 재발급 완료
              </p>
              <button
                type="button"
                className="btn-primary block w-full"
                onClick={onComplete}
                disabled={busy}
              >
                SellerOps로 돌아가 새 키 입력하기
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
