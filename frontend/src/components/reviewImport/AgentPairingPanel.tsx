/**
 * **Connecting the local helper, from the screen that needs it.**
 *
 * ## Why this exists (proof record, finding 14)
 *
 * The pairing UI already existed — `BridgeStatus` — but it is mounted only when `VITE_ENABLE_AGENT_BRIDGE=true`,
 * which is a developer flag. On the 2026-07-25 live run the seated operator could not find any way to connect
 * their local helper from the product, and the run only proceeded because the flag was set by hand. A guided
 * import that cannot start without an environment variable has no seller-facing entry point at all.
 *
 * So the pairing action lives HERE, on the card that is blocked without it, ungated. It is deliberately not a
 * second copy of `BridgeStatus`: that surface is an operator status console (per-connection states, revoke), and
 * this is the two sentences and one button a seller needs at the moment they are stopped.
 *
 * ## Props, not a hook
 *
 * The bridge binding is owned by the page and passed down. A hook here would either run twice on the same screen
 * (the page already holds one) or have to be conditionally called to allow injection, and a conditionally called
 * hook is not a hook.
 *
 * ## What it does NOT do
 *
 * It never bypasses the approval. Pairing still shows a code the seller confirms in the agent's own window on
 * their machine — that is the whole point of the handshake. That confirmation control was NOT exercised on the
 * live run (a `--dev-insecure-auto-approve` flag stood in for it), so it remains unproven rather than proven.
 */
export interface AgentPairingPanelProps {
  /** The Local Agent Bridge phase, verbatim from `useBridge().state.phase`. */
  phase: string;
  /** The code the seller must match in the agent's own approval window, when one is pending. */
  confirmationCode?: string | null;
  /**
   * The agent's approval page for the pending request. The client opens it on the seller's own click, but a
   * browser may block that tab — so the affordance stays on screen. Without it a blocked pop-up leaves the
   * seller waiting on a window that never appeared, with nothing to press.
   */
  confirmUrl?: string | null;
  /**
   * `useBridge().state.maybeNeedsLocalNetworkAccess` — true when the page is served from a secure, non-loopback
   * origin and the bridge is unreachable, which on Chrome is indistinguishable from a blocked Local Network
   * Access permission. When set, the searching branch adds the "허용해 주세요" hint so a seller whose helper IS
   * running but is being blocked by the browser permission is told what to do, rather than only "run the helper".
   */
  maybeNeedsLocalNetworkAccess?: boolean;
  onConnect: () => void;
  onRetry: () => void;
}

export function AgentPairingPanel({
  phase,
  confirmationCode,
  confirmUrl,
  maybeNeedsLocalNetworkAccess,
  onConnect,
  onRetry,
}: AgentPairingPanelProps) {
  // Nothing to offer: either it is connected, or the fix is not pairing (a version mismatch needs an update).
  if (phase === "paired" || phase === "incompatible_version") return null;

  const searching =
    phase === "unreachable" || phase === "connecting" || phase === "connecting_ws" || phase === "disconnected";

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-canvas px-4 py-3" data-testid="agent-pairing">
      {phase === "pairing_pending" ? (
        <>
          <p className="text-sm text-ink break-keep">
            내 PC에 열린 창에서 아래 숫자가 같은지 확인하고 <strong>허용</strong>을 눌러 주세요.
          </p>
          {confirmationCode ? (
            <p
              className="rounded-lg bg-surface px-3 py-2 text-center text-xl font-bold tracking-widest text-ink"
              data-testid="agent-pairing-code"
            >
              {confirmationCode}
            </p>
          ) : null}
          {confirmUrl ? (
            <a
              href={confirmUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="agent-pairing-confirm-link"
              className="self-start rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-line/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              허용 창이 안 열렸나요? 다시 열기
            </a>
          ) : null}
          <p className="text-sm text-muted">확인을 기다리는 중…</p>
        </>
      ) : searching ? (
        <>
          {/* "Not running" and "not connected" need different fixes, so they are never one message. */}
          <p className="text-sm text-ink break-keep">
            내 PC의 SellerOps 도우미를 찾지 못했어요. 도우미를 실행한 뒤 다시 시도해 주세요.
          </p>
          {/* Helper running but blocked by the browser permission looks identical to "not running" at the socket
              layer — so when the origin makes that plausible, tell the seller how to allow it. The second
              sentence covers the likeliest running-but-blocked state: a seller who ALREADY denied the permission,
              whom the browser will not prompt again — so "when asked" alone would be dead advice. */}
          {maybeNeedsLocalNetworkAccess ? (
            <p className="text-sm text-muted break-keep" data-testid="agent-pairing-local-network-hint">
              브라우저에서 <strong className="text-ink">로컬 네트워크 접근</strong> 권한을 물어보면 허용해 주세요.
              이미 거부했다면 주소창의 사이트 설정에서 권한을 허용할 수 있어요.
            </p>
          ) : null}
          <button
            type="button"
            onClick={onRetry}
            data-testid="agent-pairing-retry"
            className="self-start rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-line/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            다시 찾기
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-ink break-keep">
            {phase === "pairing_denied"
              ? "연결이 거부됐어요. 다시 연결하고, 내 PC에 열리는 창에서 허용을 눌러 주세요."
              : phase === "revoked"
                ? "연결이 해제됐어요. 다시 연결해 주세요."
                : "이 브라우저를 내 PC의 SellerOps 도우미와 연결해 주세요."}
          </p>
          <button
            type="button"
            onClick={onConnect}
            data-testid="agent-pairing-connect"
            className="self-start rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            도우미 연결하기
          </button>
        </>
      )}
    </div>
  );
}
