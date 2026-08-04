import { useEffect, useRef } from "react";
import { useBridge } from "../../hooks/useBridge";
import type { ActionWindowRunView, CommandType } from "../../lib/actionWindow/contract";
import { blockerView } from "../../lib/actionWindow/copy";
import { OperationRunTimeline } from "../actionWindow/OperationRunTimeline";
import { ActionWindowControlPanel } from "../actionWindow/ActionWindowControlPanel";
import { BlockerNotice } from "../actionWindow/BlockerNotice";
import { AgentPairingPanel } from "../reviewImport/AgentPairingPanel";
import { useGuidedIssuance } from "../../lib/actionWindow/issuance/useGuidedIssuance";
import type { GuidedIssuanceRuntime } from "../../lib/actionWindow/issuance/issuanceRuntime";
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
  busy?: boolean;
}

export function NaverIssuanceGuidedWalkthrough({
  dispatch,
  run,
  onCommand,
  hostRuntime,
  busy,
}: NaverIssuanceGuidedWalkthroughProps) {
  // The bridge is confined to this component (this phase). Enabled unconditionally here so pairing can begin;
  // the order connection never mounts it.
  const bridge = useBridge(true);
  const phase = bridge.state.phase;
  const paired = phase === "paired";
  // The agent cannot guide and pairing will not fix it → the seller should switch to text. `incompatible_version`
  // needs an app update (AgentPairingPanel renders nothing for it); a denial/revocation is an explicit refusal.
  const cannotPair = phase === "incompatible_version" || phase === "pairing_denied" || phase === "revoked";

  // Live issuance run host — the shared host for BOTH onboarding paths (the runtime picks open-vs-create by
  // observing the API center, so the host carries no path). Inert until `attach()` is called.
  const controlled = run !== undefined;
  const issuance = useGuidedIssuance(hostRuntime);
  const attach = issuance.attach;
  // Attach exactly once, and only once the agent is paired — a ref keeps StrictMode's double-invoke and any
  // re-render from opening a second socket or starting a second walk (the host also guards START_RUN itself).
  const attachedRef = useRef(false);
  useEffect(() => {
    if (controlled || !paired || attachedRef.current) return;
    attachedRef.current = true;
    void attach();
  }, [controlled, paired, attach]);

  // The view and command sink: the controlled prop in fixture mode, the live host otherwise. The host publishes
  // the v2-typed run view; the shared AW surfaces here consume the v1 shape. v2 is structurally v1 plus an
  // optional `intent`, and every enum value an issuance run uses is one these surfaces already render (the
  // fixture tests build v1 issuance views), so the view is adapted with a single documented cast — the same
  // codec-equivalence `issuanceSession.asV2Transport` rests on, in the one place downstream needs v1.
  const liveView = issuance.view as unknown as ActionWindowRunView | null;
  const effectiveRun = controlled ? (run ?? null) : liveView;
  const effectiveCommand = controlled ? onCommand : issuance.send;
  // The host refused (wrong carrier / unreachable / START_RUN rejected) → guidance can't run; point at text.
  const hostRefused = !controlled && issuance.unavailable !== null;
  const cannotGuide = cannotPair || hostRefused;

  // The commands this walkthrough surfaces from the run's `allowedCommands` — the same curation the import
  // sibling uses (`GuidedImportCard.OFFERED_COMMANDS`). A barrier's raw `allowedCommands` also includes
  // PAUSE/RESUME, SET_GUIDANCE_ENABLED, FIND_CURRENT_STEP, and SWITCH_TO_MANUAL; SET_GUIDANCE_ENABLED/
  // FIND_CURRENT_STEP are inert here, and SWITCH_TO_MANUAL has ONE home — the persistent text button below,
  // which both aborts the guided run AND advances the FE journey to the checklist. So only these two render.
  const OFFERED_COMMANDS: readonly CommandType[] = ["REQUEST_STEP_RECHECK", "CANCEL_RUN"];
  const controlExclude = effectiveRun
    ? effectiveRun.allowedCommands.filter((c) => !OFFERED_COMMANDS.includes(c))
    : [];

  const toText = () => {
    // Switching to text IS the manual path: if a guided run is live and the runtime accepts it, tell the
    // runtime first (SWITCH_TO_MANUAL → the run aborts cleanly) so it is not left orphaned when this host
    // unmounts, then advance the FE journey to the static checklist. Best-effort + gated by allowedCommands.
    if (!controlled && effectiveRun?.allowedCommands.includes("SWITCH_TO_MANUAL")) {
      effectiveCommand?.("SWITCH_TO_MANUAL");
    }
    dispatch({ type: "APPLICATION_ISSUANCE_MODE", mode: "text" });
  };

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
      {paired && !effectiveRun && !cannotGuide && (
        <p className="rounded-xl bg-canvas px-4 py-3 text-sm text-muted break-keep" role="status">
          도우미가 연결됐어요. NAVER API 센터 안내를 준비하고 있어요.
        </p>
      )}

      {/* A hosted run → the shared Action Window surfaces. */}
      {effectiveRun && (
        <>
          <OperationRunTimeline run={effectiveRun} />
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
