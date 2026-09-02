// **One reply-carrier session for the whole app, leased by whoever needs it.**
//
// Observed 2026-09-01 in the helper's own log: seven `bridge_ticket_minted` lines inside 70ms and
// `aw_reply_client_attached {clients:1}` … `{clients:3}` — for one screen. The cause was structural, not a
// race to patch: `useReplyRuntime` connected per MOUNT, and a conversation can hold several reply cards at
// once, each mounted twice under `React.StrictMode`. Every one of those minted a single-use ticket and
// opened a socket, and each unmount tore one down again.
//
// A refcount is the honest shape because the thing being shared is a fact about the machine, not about a
// card: there is one local helper, hosting one reply carrier, for one seated operator. The first lease
// connects; the rest wait on the same promise; the last release closes it.
//
// **The grace period is not a heuristic.** StrictMode's double-invocation unmounts and remounts
// synchronously, so a release that closed immediately would tear down the session the very next mount is
// about to ask for — trading a storm of tickets for a churn of them. A short window makes the pair a no-op
// and changes nothing else: a genuinely last release still closes, one tick later.
import { connectGuidedReplyRuntime, type GuidedReplyConnectResult, type GuidedReplyHandle } from "./replyBridge";

export type ReplyConnector = () => Promise<GuidedReplyConnectResult>;

/** One holder's claim on the shared session. `release()` is idempotent — a double cleanup is not a leak. */
export interface ReplyLease {
  readonly result: Promise<GuidedReplyConnectResult>;
  release(): void;
}

const GRACE_MS = 500;

interface Shared {
  connector: ReplyConnector;
  result: Promise<GuidedReplyConnectResult>;
  handle: GuidedReplyHandle | null;
  refs: number;
  closeTimer: ReturnType<typeof setTimeout> | null;
}

let shared: Shared | null = null;

function closeNow(entry: Shared): void {
  if (shared !== entry) return;
  shared = null;
  entry.handle?.close();
  entry.handle = null;
}

/**
 * Take a lease on the shared reply session, connecting it if nobody holds one.
 *
 * The connector is injectable for tests; a lease taken with a DIFFERENT connector than the live session's
 * gets its own session rather than silently reusing one it did not ask for.
 */
export function acquireReplyConnection(connector: ReplyConnector = connectGuidedReplyRuntime): ReplyLease {
  if (shared && shared.connector !== connector) {
    // A different connector is a different thing to connect to. Let the current one go by its own rules.
    shared.refs = Math.max(0, shared.refs);
  }
  let entry = shared && shared.connector === connector ? shared : null;
  if (!entry) {
    const created: Shared = { connector, result: null as never, handle: null, refs: 0, closeTimer: null };
    created.result = connector().then((result) => {
      if (result.ok) {
        if (shared === created && created.refs > 0) {
          created.handle = result.handle;
        } else {
          // Resolved after the last holder left (or after another session took over): nothing will ever use
          // this socket, so it is released here rather than leaked.
          result.handle.close();
        }
      }
      return result;
    });
    shared = created;
    entry = created;
  }
  if (entry.closeTimer) {
    clearTimeout(entry.closeTimer);
    entry.closeTimer = null;
  }
  entry.refs += 1;

  let released = false;
  const held = entry;
  return {
    result: held.result,
    release() {
      if (released) return;
      released = true;
      held.refs -= 1;
      if (held.refs > 0 || shared !== held) return;
      held.closeTimer = setTimeout(() => {
        held.closeTimer = null;
        if (held.refs === 0) closeNow(held);
      }, GRACE_MS);
    },
  };
}

/** Test seam: drop the shared session without waiting for the grace window. */
export function resetReplyConnection(): void {
  const entry = shared;
  if (!entry) return;
  if (entry.closeTimer) clearTimeout(entry.closeTimer);
  entry.refs = 0;
  closeNow(entry);
}

/** Test seam: how many holders the shared session has right now (0 when there is none). */
export function replyConnectionRefs(): number {
  return shared?.refs ?? 0;
}
