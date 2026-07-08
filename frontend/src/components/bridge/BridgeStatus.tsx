import { useBridge } from "../../hooks/useBridge";
import type { BridgeConnectionState, BridgePendingUserAction } from "../../lib/bridge/bridgeProtocol";

/**
 * Minimal Local Agent Bridge status surface (slice §Phase C — Frontend). Seller-facing language only — it
 * shows presence/pairing/connection state and the pairing action, and nothing more (no Browser Projection
 * UI, no navigation changes, no future capabilities). Mounted behind `VITE_ENABLE_AGENT_BRIDGE` so it is
 * absent from the default app until the bridge is enabled.
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

export function BridgeStatus() {
  const { state, requestPairing, revoke, retry } = useBridge();

  return (
    <section className="card p-5" aria-label="로컬 에이전트 연결 상태">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">내 PC 연결</h2>
        <StatusDot phase={state.phase} />
      </div>

      {state.phase === "connecting" && <p className="text-muted">로컬 에이전트를 확인하고 있습니다…</p>}

      {state.phase === "unreachable" && (
        <div className="space-y-3">
          <p className="text-muted">내 PC의 로컬 에이전트에 연결하지 못했습니다. 에이전트가 실행 중인지 확인해 주세요.</p>
          {state.maybeNeedsLocalNetworkAccess && (
            <p className="text-muted">
              브라우저에서 <strong className="text-ink">로컬 네트워크 접근</strong> 권한을 물어보면 허용해 주세요.
            </p>
          )}
          <button className="btn-ghost" onClick={retry}>다시 시도</button>
        </div>
      )}

      {state.phase === "unpaired" && (
        <div className="space-y-3">
          <p className="text-muted">이 PC에서 로컬 에이전트를 찾았습니다. 이 브라우저와 연결하세요.</p>
          <button className="btn-primary" onClick={requestPairing}>연결하기</button>
        </div>
      )}

      {state.phase === "pairing_pending" && (
        <div className="space-y-3">
          <p className="text-muted">내 PC에 열린 확인 창에서 아래 코드가 같은지 확인하고 <strong className="text-ink">허용</strong>을 눌러 주세요.</p>
          {state.confirmationCode && (
            <div className="rounded-xl bg-canvas px-4 py-3 text-center text-2xl font-bold tracking-widest text-ink">
              {state.confirmationCode}
            </div>
          )}
          <p className="text-muted">확인을 기다리는 중…</p>
        </div>
      )}

      {state.phase === "pairing_denied" && (
        <div className="space-y-3">
          <p className="text-muted">연결이 거부되었습니다.</p>
          <button className="btn-primary" onClick={requestPairing}>다시 연결</button>
        </div>
      )}

      {state.phase === "connecting_ws" && <p className="text-muted">연결하는 중…</p>}

      {state.phase === "paired" && (
        <div className="space-y-3">
          <p className="font-medium text-good">이 브라우저가 내 PC와 연결되어 있습니다.</p>
          <ul className="space-y-1">
            {(state.snapshot?.connections ?? []).length === 0 && (
              <li className="text-muted">연결된 채널이 아직 없습니다.</li>
            )}
            {(state.snapshot?.connections ?? []).map((c) => (
              <li key={c.ref} className="flex items-center justify-between rounded-xl bg-canvas px-3 py-2">
                <span className="font-mono text-sm text-muted">{c.ref.slice(0, 8)}</span>
                <span className="text-ink">
                  {STATE_LABEL[c.state]}
                  {c.pendingUserAction && ` · ${ACTION_LABEL[c.pendingUserAction]}`}
                  {c.browserOpen && " · 브라우저 열림"}
                </span>
              </li>
            ))}
          </ul>
          <button className="btn-ghost" onClick={revoke}>연결 해제</button>
        </div>
      )}

      {state.phase === "incompatible_version" && (
        <p className="text-muted">버전이 호환되지 않습니다. SellerOps 또는 로컬 에이전트를 최신 버전으로 업데이트해 주세요.</p>
      )}

      {state.phase === "disconnected" && <p className="text-muted">연결이 끊어졌습니다. 다시 연결하는 중…</p>}

      {state.phase === "revoked" && (
        <div className="space-y-3">
          <p className="text-muted">연결이 해제되었습니다.</p>
          <button className="btn-primary" onClick={requestPairing}>다시 연결</button>
        </div>
      )}
    </section>
  );
}

function StatusDot({ phase }: { phase: string }) {
  const tone =
    phase === "paired" ? "bg-good"
      : phase === "unreachable" || phase === "revoked" || phase === "incompatible_version" || phase === "pairing_denied" ? "bg-bad"
      : phase === "disconnected" || phase === "connecting" || phase === "connecting_ws" || phase === "pairing_pending" ? "bg-warn"
      : "bg-muted";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${tone}`} aria-hidden="true" />;
}
