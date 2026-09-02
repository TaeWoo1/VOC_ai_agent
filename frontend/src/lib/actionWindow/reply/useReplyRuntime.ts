// **The runtime's owner.** The DISPOSAL CONTRACT's last open item was "a caller that actually
// invokes dispose()" — this hook is that caller. It resolves which reply runtime a panel drives and
// releases on unmount exactly what it created:
//
//   1. an INJECTED runtime (tests) — passed through untouched; its creator owns its lifecycle,
//      so the hook never disposes it;
//   2. the BRIDGE runtime — connected here (DEV + VITE_AW_BRIDGE + an agent hosting the REPLY
//      carrier), closed on unmount: dispose() rejects anything in flight, then the socket goes;
//   3. the resolveReplyRuntime() fallback — simulated in DEV, null in production. Production
//      therefore still cannot construct a live runtime, and its guided path stays the honest
//      manual handoff.
import { useEffect, useMemo, useState } from "react";
import { connectGuidedReplyRuntime } from "./replyBridge";
import { acquireReplyConnection } from "./replyConnection";
import { resolveReplyRuntime, type ReplyRuntime } from "./replyRuntime";

export function useReplyRuntime(
  injected?: ReplyRuntime,
  connector: typeof connectGuidedReplyRuntime = connectGuidedReplyRuntime,
): ReplyRuntime | null {
  const [bridge, setBridge] = useState<ReplyRuntime | null>(null);
  // The offline fallback, created only when nothing is injected. It stays available while the
  // bridge connects, so a DEV operator is never blocked on a round-trip — a guided run started on
  // it keeps its runtime through the handle it returned; only NEW starts pick up the bridge.
  const fallback = useMemo(() => (injected ? null : resolveReplyRuntime()), [injected]);

  useEffect(() => {
    if (injected) return;
    let unmounted = false;
    // **One session, leased** (`replyConnection.ts`). Connecting per mount minted one single-use ticket and
    // one socket per mounted card AND per StrictMode double-invocation — seven tickets in 70ms, measured in
    // the helper's own log. The lease shares whatever is already connected and closes it when the last
    // holder lets go.
    const lease = acquireReplyConnection(connector);
    // A refusal (bridge-disabled, unpaired, export-hosting agent, …) simply leaves the fallback in
    // place — the same honest-fallback rule the export world follows. In a shipped build the
    // connector refuses before touching the network.
    void lease.result.then((result) => {
      if (!result.ok || unmounted) return;
      setBridge(result.handle.runtime);
    });
    return () => {
      unmounted = true;
      lease.release();
      setBridge(null);
    };
  }, [injected, connector]);

  useEffect(() => {
    if (!fallback) return;
    return () => fallback.dispose();
  }, [fallback]);

  return injected ?? bridge ?? fallback;
}
