import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/apiClient";
import { resolveCopy } from "../../lib/actionWindow/copy";
import { isTerminalRunStatus } from "../../lib/actionWindow/homeFixtures";
import { type AcquireRuntime } from "../../lib/actionWindow/acquire/acquireRuntime";
import {
  useGuidedAcquisition,
  type AcquisitionConnect,
  type GuidedAcquisitionPath,
} from "../../lib/actionWindow/acquire/useGuidedAcquisition";
import { useBridge } from "../../hooks/useBridge";
import { AgentPairingPanel } from "../reviewImport/AgentPairingPanel";
import { ActionWindowControlPanel } from "../actionWindow/ActionWindowControlPanel";
import { HumanCheckpointCard, CHECKPOINT_COMMANDS } from "../actionWindow/HumanCheckpointCard";

/**
 * <b>One guided acquisition run, wherever the seller pressed for it.</b>
 *
 * <p>This lived inside the conversation's `HUMAN_ACTION_REQUIRED` artifact and had never moved, which
 * meant 지금 동기화 existed only for a seller who was talking to the agent. It is the same component,
 * lifted unchanged: the chat artifact mounts it and so does the channel screen, and neither owns it.
 *
 * <p>Nothing about the run changed with the move. It still pairs, attaches the carrier for its path,
 * mints ONE single-use ref, sends ONE `START_RUN`, renders controls from the agent's own
 * `allowedCommands`, and finishes only on the agent's own `COMPLETED`. No step is completed and no
 * blocker cleared locally, and nothing here clicks, downloads or writes on a marketplace.
 */
/**
 * The inline guided run. Mounted only after the seller's press, so pairing is asked for by that press and
 * never by a reloaded conversation. Order: pair → attach (carrier by path) → mint the ref (Coupang) → ONE
 * `START_RUN` → controls from `allowedCommands` → the run's own `COMPLETED` resumes the turn.
 */
export function GuidedAcquisitionRun({
  path,
  accountId,
  onCompleted,
  inject,
  connect,
}: {
  path: GuidedAcquisitionPath;
  accountId: string;
  onCompleted: () => void;
  inject?: AcquireRuntime;
  connect?: AcquisitionConnect;
}) {
  const bridge = useBridge(!inject, { autoPair: true });
  const paired = !!inject || bridge.state.phase === "paired";
  const { view, unavailable, ensureRuntime, send } = useGuidedAcquisition(path, inject, connect);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const startedRef = useRef(false);
  /**
   * A start that actually reached `runtime.start` — the ONE thing that must never happen twice, and the one
   * thing `startedRef` alone could not express.
   */
  const committedRef = useRef(false);
  const completedRef = useRef(false);

  /**
   * **Start once per mounted card, and never lock the card out of starting at all.**
   *
   * `startedRef` was set BEFORE the first await and never reset, while the cleanup set `live = false`. Under
   * `React.StrictMode` (this app mounts under it — `main.tsx`) an effect runs, is cleaned up, and runs again:
   * the first pass abandoned itself at `if (!runtime || !live) return;` and the second was refused by the ref,
   * so the run was NEVER started and nothing anywhere said so. Observed live on 2026-09-02: sockets attached,
   * a snapshot arrived, no ticket was minted, no `START_RUN` was sent, no error was shown.
   *
   * The repair is to say what the two flags actually mean. `startedRef` guards an attempt that is still in
   * flight and is RELEASED when that attempt is torn down; `committedRef` is set once a `START_RUN` has been
   * handed to the runtime and is never released, so a re-run of this effect cannot start a second run. An
   * abandoned first pass returns before minting, so it leaves no unspent ticket behind.
   */
  useEffect(() => {
    if (!paired || startedRef.current || committedRef.current) return;
    startedRef.current = true;
    let live = true;
    setStarting(true);
    void (async () => {
      try {
        const runtime = await ensureRuntime();
        if (!runtime || !live) return;
        // Connect first, mint second: a refused attach must not spend a single-use ref.
        // From here the attempt is COMMITTED: a ref is spent-or-spendable and a command is on the wire, so no
        // later invocation of this effect may start another.
        committedRef.current = true;
        try {
          if (path === "WING_READ_ACTION_WINDOW") {
            const minted = await api.startReviewAcquisitionRun(accountId);
            if (!live) return;
            await runtime.start({ intent: "REVIEW_ACQUISITION", acquisitionRef: minted.acquisitionRef });
          } else {
            await runtime.start({ intent: "EXPORT" });
          }
        } catch (e) {
          committedRef.current = false;
          throw e;
        }
      } catch {
        if (live) setError("판매자센터 화면을 준비하지 못했습니다. 아래 다른 방법으로 진행할 수 있습니다.");
      } finally {
        if (live) setStarting(false);
      }
    })();
    return () => {
      live = false;
      // An attempt torn down before it committed started nothing, so the next invocation must be allowed to
      // try. Leaving this set is what made the card permanently dead.
      if (!committedRef.current) startedRef.current = false;
    };
  }, [paired, ensureRuntime, path, accountId]);

  useEffect(() => {
    if (view?.status === "COMPLETED" && !completedRef.current) {
      completedRef.current = true;
      onCompleted();
    }
  }, [view?.status, onCompleted]);

  if (!paired) {
    return (
      <AgentPairingPanel
        phase={bridge.state.phase}
        confirmationCode={bridge.state.confirmationCode}
        confirmUrl={bridge.state.confirmUrl}
        attestedApproval={bridge.state.attestedApproval}
        pairingHint={bridge.state.pairingHint}
        maybeNeedsLocalNetworkAccess={bridge.state.maybeNeedsLocalNetworkAccess}
        onConnect={bridge.requestPairing}
        onRetry={bridge.retry}
      />
    );
  }
  if (unavailable) {
    return (
      <p className="break-keep text-sm text-warn" role="status">
        {unavailable === "wrong_carrier"
          ? "연결된 도우미가 다른 작업을 진행 중입니다. 그 작업을 마친 뒤 다시 시도해 주세요."
          : "내 PC의 도우미와 연결하지 못했습니다. 도우미를 실행한 뒤 다시 시도해 주세요."}
      </p>
    );
  }
  if (error) {
    return <p className="break-keep text-sm text-warn" role="status">{error}</p>;
  }
  if (!view) {
    return <p className="text-sm text-muted" role="status">{starting ? "판매자센터 화면을 준비하는 중…" : "도우미와 연결하는 중…"}</p>;
  }
  const terminal = isTerminalRunStatus(view.status);
  return (
    <div className="space-y-3" data-testid="guided-acquisition-run">
      {view.currentStep && !terminal && view.status !== "WAITING_FOR_HUMAN" ? (
        <p className="break-keep text-sm text-ink">{resolveCopy(view.currentStep.copyKey, view.currentStep.copyParams)}</p>
      ) : null}
      {view.status === "WAITING_FOR_HUMAN" ? <HumanCheckpointCard run={view} onCommand={send} /> : null}
      {view.status === "COMPLETED" ? (
        <p className="break-keep text-sm text-ink" role="status">리뷰 가져오기가 끝났습니다. 이어서 확인하겠습니다.</p>
      ) : null}
      {!terminal ? (
        <ActionWindowControlPanel run={view} onCommand={send} exclude={view.status === "WAITING_FOR_HUMAN" ? CHECKPOINT_COMMANDS : []} />
      ) : null}
    </div>
  );
}
