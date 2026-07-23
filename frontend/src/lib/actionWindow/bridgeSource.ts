// FE-3 — Bridge-backed ActionWindowSource.
//
// Thin translation between the R2 `BridgeClient` (bridgeAdapter/wsTransport,
// landed via the integration workstream, PRs #216–218) and the FE-2.5 source
// seam. The client owns every wire concern — real `CommandEnvelope`s with
// commandId/expectedRevision/runId, event dedupe + ordering, highest-revision
// view adoption, resync — so this file only reframes its state changes as
// `SourceUpdate` frames. The store, its resilience rules, the UI states, and
// the tests are identical across the fixture, simulated, and Bridge sources.

import { createBridgeClient, type BridgeClient } from "./bridgeAdapter";
import { resolveBridgeSession } from "./devMode";
import { adoptBridgeSource, setBridgeBootAttempted, setBridgeRefusal } from "./operationsStore";
import type { ActionWindowSource, SourceCommand, SourceConnection, SourceUpdate } from "./source";

export interface BridgeBackedSource extends ActionWindowSource {
  /** Detach from the client and close it (the WS session is closed separately). */
  close(): void;
  /** Forward a REAL transport status into the seam as a `connection` frame, so the
   *  Operations UI shows the offline/reconnecting banner and suppresses action
   *  buttons while SellerOps is not actually connected (the transport's
   *  `AwConnectionStatus` uses the same three literals as `SourceConnection`). */
  notifyStatus(status: SourceConnection): void;
}

export function createBridgeSource(client: BridgeClient): BridgeBackedSource {
  let sequence = 0;
  let lastNote = "";
  let listener: ((update: SourceUpdate) => void) | null = null;
  let detach: (() => void) | null = null;

  // The client already dedupes/orders at the wire level and only adopts equal-
  // or-higher-revision views, so frames here are locally sequenced (+1 each) —
  // the store's transport rules see a clean stream and its revision guard is a
  // second belt, never the primary defense.
  function push(): void {
    if (!listener) return;
    const note = client.getNote();
    const noteChanged = note !== "" && note !== lastNote;
    lastNote = note;
    listener({
      kind: "view",
      sequence: ++sequence,
      run: client.getView(),
      ...(noteChanged ? { note } : {}),
    });
  }

  return {
    subscribe(next) {
      listener = next;
      detach = client.subscribe(push);
      client.connect(); // attach to the transport + hydrate via resync
      return () => {
        if (listener === next) listener = null;
        detach?.();
        detach = null;
      };
    },
    dispatch(command: SourceCommand) {
      // The client mints the real CommandEnvelope; the seam's FE-owned
      // commandId/expectedRevision fields are only advisory for mock sources.
      client.send(command.type);
    },
    requestSnapshot() {
      client.resync();
    },
    close() {
      detach?.();
      detach = null;
      client.close();
    },
    notifyStatus(status: SourceConnection) {
      listener?.({ kind: "connection", connection: status });
      // On restore, the transport has already resynced from zero; the client's
      // follow-up view lands through push(). Nothing else to do here.
    },
  };
}

// ── Boot: opt-in live connection, honest fallback ────────────────────────────

let bootAttempted = false;

/**
 * Try once per app session to go live over the Local Agent Bridge. Resolves
 * false — leaving the fixture source untouched — unless bridge mode is enabled
 * (DEV + `VITE_AW_BRIDGE=1`) AND a live agent session is actually established
 * (`resolveBridgeSession` → non-null). This is R2's honest-fallback rule: the
 * screen degrades to the contract-backed demo, never to a broken live view.
 */
export async function connectBridgeIfEnabled(): Promise<boolean> {
  if (bootAttempted) return false;
  bootAttempted = true;
  setBridgeBootAttempted(true); // mirror into reactive store so the DEV panel re-renders (incl. the fixture-fallback path)
  // Real transport status → seam `connection` frames. The relay is set up before
  // the session resolves; transitions arriving before adoption are dropped (the
  // store starts a bridge world as "connected" anyway).
  let source: BridgeBackedSource | null = null;
  const result = await resolveBridgeSession((status) => source?.notifyStatus(status));
  if (!result.ok) {
    // Record WHY before falling back. The fallback itself is unchanged — the fixture source stays —
    // but "the agent is hosting the reply carrier" and "you never paired" are different problems with
    // different fixes, and collapsing both into a silent false is what made a working agent look
    // broken. Sanitized enums only; safe to surface and safe to log.
    setBridgeRefusal(result.reason, result.announcedCarrier);
    return false;
  }
  const session = result.session;
  setBridgeRefusal(null);
  const client = createBridgeClient(session.transport, {
    runId: session.runId,
    channelCode: session.channelCode,
  });
  source = createBridgeSource(client);
  const adopted = source;
  adoptBridgeSource(adopted, () => {
    source = null; // stop forwarding transport status after teardown
    adopted.close();
    session.close();
  });
  return true;
}

/** FE-5 diagnostics: whether a live-Bridge boot has been attempted this session
 *  (the flag flips synchronously at the start of `connectBridgeIfEnabled`, before
 *  the async resolve). Lets the DEV panel distinguish "never tried" from "tried
 *  and fell back to the fixture". Read-only; no wire state.
 *  NOTE: the DEV panel reads the REACTIVE mirror `state.bootAttempted` (set via
 *  `setBridgeBootAttempted`) so it re-renders on the fixture-fallback path; this
 *  getter remains for the module guard and any non-React caller. */
export function isBridgeBootAttempted(): boolean {
  return bootAttempted;
}

/** DEV-only boot retry: allow another live-connection attempt (e.g. the local
 *  agent came online after page load). Same opt-in gating and honest fallback
 *  as the initial boot. */
export function retryBridgeBoot(): Promise<boolean> {
  bootAttempted = false;
  return connectBridgeIfEnabled();
}

/** Test-only: allow another boot attempt. */
export function resetBridgeBootForTests(): void {
  bootAttempted = false;
  setBridgeBootAttempted(false);
}
