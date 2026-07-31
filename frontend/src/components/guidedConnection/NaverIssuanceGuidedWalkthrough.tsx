import { useBridge } from "../../hooks/useBridge";
import type { ActionWindowRunView, CommandType } from "../../lib/actionWindow/contract";
import { blockerView } from "../../lib/actionWindow/copy";
import { OperationRunTimeline } from "../actionWindow/OperationRunTimeline";
import { ActionWindowControlPanel } from "../actionWindow/ActionWindowControlPanel";
import { BlockerNotice } from "../actionWindow/BlockerNotice";
import { AgentPairingPanel } from "../reviewImport/AgentPairingPanel";
import type { GuidedEvent } from "../../lib/guidedConnection";

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
 * Guidance FINISHING (`run.status === "COMPLETED"`) does not connect anything: it surfaces a "발급 안내가
 * 끝났어요, 이제 입력할게요" CTA that fires `onComplete` → `ISSUANCE_COMPLETE`, which the reducer maps to
 * `credential_issued` (the secure-entry hand-off), NOT a stored credential. This component never renders or
 * requests a credential value, and it surfaces no selector, url, or account id — only sanitized copy keys/codes.
 *
 * ## Offline-testable
 *
 * The issuance run view is a prop (`run`), fed by fixture views in tests and by a live session in production; the
 * component does not require a reachable bridge to render. `useBridge` is mocked in the component's own tests.
 */
export interface NaverIssuanceGuidedWalkthroughProps {
  /** Journey events (the text fallback + the completion hand-off). Never carries a credential. */
  dispatch: (event: GuidedEvent) => void;
  /** The sanitized issuance run view, or null before a run is being hosted. Fixture-fed in tests. */
  run?: ActionWindowRunView | null;
  /** Forward an operator command to the hosted run. Only ever called with a command from `allowedCommands`. */
  onCommand?: (type: CommandType) => void;
  busy?: boolean;
}

export function NaverIssuanceGuidedWalkthrough({
  dispatch,
  run = null,
  onCommand,
  busy,
}: NaverIssuanceGuidedWalkthroughProps) {
  // The bridge is confined to this component (this phase). Enabled unconditionally here so pairing can begin;
  // the order connection never mounts it.
  const bridge = useBridge(true);
  const phase = bridge.state.phase;
  const paired = phase === "paired";
  // The agent cannot guide and pairing will not fix it → the seller should switch to text. `incompatible_version`
  // needs an app update (AgentPairingPanel renders nothing for it); a denial/revocation is an explicit refusal.
  const cannotGuide = phase === "incompatible_version" || phase === "pairing_denied" || phase === "revoked";

  const toText = () => dispatch({ type: "APPLICATION_ISSUANCE_MODE", mode: "text" });

  return (
    <div className="space-y-4" aria-label="화면 안내 발급">
      {/* Pairing (guided path only). AgentPairingPanel self-hides when paired or on an incompatible version. */}
      {!paired && (
        <AgentPairingPanel
          phase={phase}
          confirmationCode={bridge.state.confirmationCode ?? null}
          onConnect={bridge.requestPairing}
          onRetry={bridge.retry}
        />
      )}

      {/* The agent can't guide (needs update / declined) — say so and point at text, which always works. */}
      {cannotGuide && (
        <p className="rounded-xl bg-warn/10 px-4 py-3 text-sm text-ink break-keep" role="status">
          화면 안내를 사용할 수 없어요. 텍스트로 진행해 주세요.
        </p>
      )}

      {/* Paired but no run yet: the agent is connected; the guidance run is starting. */}
      {paired && !run && (
        <p className="rounded-xl bg-canvas px-4 py-3 text-sm text-muted break-keep" role="status">
          도우미가 연결됐어요. NAVER API 센터 안내를 준비하고 있어요.
        </p>
      )}

      {/* A hosted run → the shared Action Window surfaces. */}
      {run && (
        <>
          <OperationRunTimeline run={run} />
          {run.blocker && (
            <BlockerNotice
              title={blockerView(run.blocker.code).title}
              body={blockerView(run.blocker.code).body}
              recoverable={run.blocker.recoverable}
              variant="standalone"
            />
          )}
          <ActionWindowControlPanel run={run} onCommand={(type) => onCommand?.(type)} />
          {run.status === "COMPLETED" && (
            <button
              type="button"
              className="btn-primary block w-full"
              onClick={() => dispatch({ type: "ISSUANCE_COMPLETE" })}
              disabled={busy}
            >
              발급 안내가 끝났어요, 이제 입력할게요
            </button>
          )}
        </>
      )}

      {/* Persistent text fallback — always available, whatever the bridge state. */}
      <button type="button" className="btn-ghost text-sm" onClick={toText} disabled={busy}>
        텍스트로 직접 진행하기
      </button>
    </div>
  );
}
