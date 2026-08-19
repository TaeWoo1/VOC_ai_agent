import { useEffect, useRef, useState } from "react";
import { useBridge } from "../../hooks/useBridge";
import type { BridgeConnectionState, BridgePendingUserAction } from "../../lib/bridge/bridgeProtocol";
import type { BridgePhase } from "../../lib/bridge/bridgeClient";
import {
  DOCK_COPY,
  dockView,
  hasStoredPairing,
  initialDockMemory,
  nextDockMemory,
  type DockMemory,
} from "../../lib/bridge/agentDock";

/**
 * The SellerOps 도우미 dock (bottom-right, mounted by the shell behind `VITE_ENABLE_AGENT_BRIDGE`).
 *
 * Quiet by default: nothing for a seller who never connected the helper — the screens that need it carry their
 * own "SellerOps 도우미가 필요합니다" panel. Connected → a small chip (details on tap). Previously connected and now
 * broken → a reconnect notice. The rule lives in `lib/bridge/agentDock.ts`; this component only renders it and
 * wires the same three bridge actions the old status console had (connect / retry / revoke). Pairing, the bridge
 * client and every live flow are untouched.
 */

const STATE_LABEL: Record<BridgeConnectionState, string> = {
  starting: "시작 중",
  inspecting: "세션 확인 중",
  ready: "정상",
  reconnecting: "다시 연결 중",
  waiting_for_user: "사용자 확인 필요",
  verifying: "로그인 확인 중",
  human_reconnect_required: "다시 로그인 필요",
  syncing: "동기화 중",
  paused: "일시 중지",
  degraded: "일부 제한",
  stopped: "중지됨",
};

const ACTION_LABEL: Record<BridgePendingUserAction, string> = {
  select_saved_credential: "저장된 로그인 선택이 필요합니다",
  enter_missing_username: "아이디 입력이 필요합니다",
  complete_manual_login: "직접 로그인이 필요합니다",
  complete_additional_authentication: "추가 인증이 필요합니다",
  provide_api_credential: "연결 정보 입력이 필요합니다",
  reauthorize_api_access: "연결 권한 재승인이 필요합니다",
};

/** How often, while unpaired, the dock looks for a pairing another screen (the 도우미 panel) just completed. */
const PAIRING_WATCH_MS = 2000;

export function AgentDock() {
  const { state, requestPairing, revoke, retry } = useBridge();
  const [memory, setMemory] = useState<DockMemory>(() => initialDockMemory(hasStoredPairing()));
  const [expanded, setExpanded] = useState(false);
  const phaseRef = useRef<BridgePhase>(state.phase);
  phaseRef.current = state.phase;

  useEffect(() => {
    setMemory((m) => nextDockMemory(m, state.phase));
  }, [state.phase]);

  // The connect action for a first pairing lives on the screen that needs the helper, with its own bridge binding.
  // This dock's binding stops at `unpaired` and would not learn about that pairing until a reload — so while
  // unpaired it watches for the stored pairing to appear and then reconnects, so the chip shows up when the
  // seller connects. Presence of the token only; the value is never read here.
  useEffect(() => {
    if (state.phase !== "unpaired") return;
    const id = setInterval(() => {
      if (phaseRef.current === "unpaired" && hasStoredPairing()) retry();
    }, PAIRING_WATCH_MS);
    return () => clearInterval(id);
  }, [state.phase, retry]);

  const view = dockView(memory, state.phase);
  if (view.kind === "hidden") return null;

  if (view.kind === "connected") {
    const connections = state.snapshot?.connections ?? [];
    return (
      <section className="flex flex-col items-end gap-2" aria-label="SellerOps 도우미 연결 상태" data-testid="agent-dock">
        {expanded && (
          <div className="card w-full p-4" data-testid="agent-dock-detail">
            <p className="text-sm font-medium text-ink">{DOCK_COPY.connectedDetail}</p>
            <ul className="mt-2 space-y-1">
              {connections.length === 0 && <li className="text-sm text-muted">{DOCK_COPY.noChannels}</li>}
              {connections.map((c) => (
                <li key={c.ref} className="flex items-center justify-between rounded-xl bg-canvas px-3 py-2 text-sm">
                  <span className="font-mono text-muted">{c.ref.slice(0, 8)}</span>
                  <span className="text-ink">
                    {STATE_LABEL[c.state]}
                    {c.pendingUserAction && ` · ${ACTION_LABEL[c.pendingUserAction]}`}
                    {c.browserOpen && " · 브라우저 열림"}
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="btn-ghost mt-3" onClick={revoke} data-testid="agent-dock-revoke">
              {DOCK_COPY.disconnect}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          data-testid="agent-dock-chip"
          className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink shadow-sm transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-good" aria-hidden="true" />
          {DOCK_COPY.connected}
        </button>
      </section>
    );
  }

  if (view.kind === "pairing") {
    return (
      <section className="card p-4" aria-label="SellerOps 도우미 다시 연결" data-testid="agent-dock">
        <p className="text-sm text-ink break-keep">{DOCK_COPY.pairing}</p>
        {state.confirmationCode && (
          <p className="mt-2 rounded-lg bg-canvas px-3 py-2 text-center text-xl font-bold tracking-widest text-ink" data-testid="agent-dock-code">
            {state.confirmationCode}
          </p>
        )}
        {state.confirmUrl && (
          <a href={state.confirmUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-brand-700 underline">
            {DOCK_COPY.pairingReopen}
          </a>
        )}
        <p className="mt-2 text-sm text-muted">{DOCK_COPY.pairingWaiting}</p>
      </section>
    );
  }

  const copy = DOCK_COPY.notice[view.notice];
  // Helper off / socket dropped: the client already retries by itself, so the action is a nudge to look now.
  // Revoked / denied: the pairing itself is gone — the action starts a new pairing. Incompatible: nothing to press.
  const action =
    view.notice === "revoked" || view.notice === "denied"
      ? { label: DOCK_COPY.reconnect, onClick: requestPairing }
      : view.notice === "incompatible"
        ? null
        : { label: DOCK_COPY.reconnect, onClick: retry };
  return (
    <section className="card p-4" role="status" aria-label="SellerOps 도우미 다시 연결" data-testid="agent-dock">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink break-keep">{copy.title}</p>
          <p className="mt-1 text-sm text-muted break-keep">{copy.body}</p>
          {state.maybeNeedsLocalNetworkAccess && view.notice === "agent_off" && (
            <p className="mt-1 text-sm text-muted break-keep">
              브라우저에서 <strong className="text-ink">로컬 네트워크 접근</strong> 권한을 물어보면 허용해 주세요.
            </p>
          )}
          <div className="mt-2 flex items-center gap-3">
            {action && (
              <button
                type="button"
                onClick={action.onClick}
                disabled={view.retrying}
                data-testid="agent-dock-reconnect"
                className="rounded-xl bg-brand px-3 py-1.5 text-sm font-semibold text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
              >
                {action.label}
              </button>
            )}
            {view.retrying && <span className="text-xs text-muted">{DOCK_COPY.retrying}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
