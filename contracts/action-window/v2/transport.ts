/**
 * **Action Window transport (v1) — nested inside Local Agent Bridge v1.**
 *
 * This module is ADDITIVE to the normative message contract in `./index`. It does NOT redefine or
 * mutate any enum, envelope, View Model, or validator — it only describes how the already-normative
 * `CommandEnvelope` / `EventEnvelope` / `ActionWindowRunView` are *framed* for transport between the
 * SellerOps frontend and the local agent Runtime.
 *
 * Governance (see `README.md` §8 and `docs/action-window-runtime/contract-boundary.md` §1): Action
 * Window messages ride **inside Bridge v1 as opaque payloads** — they are NOT new variants of the
 * Bridge `ClientMessage`/`ServerMessage` union, and `collector/src/bridge/protocol.ts` is unchanged.
 * A frame is serialized to an opaque string and carried as a Bridge payload; the Bridge learns
 * nothing about its contents. This file is the single shared source both FE and Runtime consume, so
 * neither side re-declares the framing.
 *
 * The frames carry ONLY values already sanitized by the message contract (enums, counts, opaque
 * 16-hex refs, dotted copy keys, primitive copy params). No selector, URL, path, id, credential,
 * cookie, token, or page content ever appears here — that invariant is inherited from `./index` and
 * asserted by `findProhibitedFields` in the integration tests.
 */
import type { CommandEnvelope, EventEnvelope, ActionWindowRunView } from "./index";

/** Bump on any breaking change to the *framing* below (independent of the message protocol version). */
export const ACTION_WINDOW_TRANSPORT_VERSION = 1;

/* ────────────────────────────── Frames ────────────────────────────── */

/** Frontend → Runtime. A command intent, or a reconnect resync request. */
export type AwClientFrame =
  | { kind: "aw_command"; command: CommandEnvelope }
  | { kind: "aw_resync"; runId: string; sinceSequence: number };

/** Runtime → Frontend. Ordered events, the latest sanitized View Model, a command ack, or a resync reply. */
export type AwServerFrame =
  | { kind: "aw_event"; event: EventEnvelope }
  | { kind: "aw_view"; view: ActionWindowRunView }
  | { kind: "aw_command_result"; commandId: string; accepted: boolean; reason?: string }
  | { kind: "aw_resync_result"; view: ActionWindowRunView | null; events: readonly EventEnvelope[] };

export type AwFrame = AwClientFrame | AwServerFrame;

/* ─────────────────────── Opaque-string (de)serialization ─────────────────────── */

/** Serialize a frame to the opaque string the Bridge carries as a payload. */
export function serializeFrame(frame: AwFrame): string {
  return JSON.stringify(frame);
}

/** Parse an opaque Bridge payload back into a frame. Throws on malformed JSON (caller decides policy). */
export function deserializeFrame(raw: string): AwFrame {
  return JSON.parse(raw) as AwFrame;
}

/* ───────────────────────────── Transport interfaces ───────────────────────────── */

/** The FE end of the channel: send client frames, subscribe to server frames. */
export interface AwClientTransport {
  send(frame: AwClientFrame): void;
  subscribe(listener: (frame: AwServerFrame) => void): () => void;
}

/** The Runtime end of the channel: send server frames, subscribe to client frames. */
export interface AwServerTransport {
  send(frame: AwServerFrame): void;
  subscribe(listener: (frame: AwClientFrame) => void): () => void;
}

/**
 * A pure in-process loopback channel used for the synthetic E2E (no WebSocket, no Bridge server,
 * no Chrome). It models the real wire faithfully:
 *  - every frame is round-tripped through `serialize`/`deserialize`, so only JSON-safe sanitized
 *    payloads survive (a leaked function/symbol/circular value would throw here, as on a real wire);
 *  - a frame is delivered ONLY to currently-subscribed listeners; if the far end is detached
 *    (unsubscribed), the frame is dropped — exactly the disconnect condition that `aw_resync`
 *    reconnect recovery exists to repair.
 *
 * The real Bridge-WS binding (opaque passthrough) is a follow-up; it implements these same two
 * interfaces without changing this contract.
 */
export function createLoopbackChannel(): { client: AwClientTransport; server: AwServerTransport } {
  const serverInbox = new Set<(frame: AwClientFrame) => void>(); // Runtime-side listeners (client→server)
  const clientInbox = new Set<(frame: AwServerFrame) => void>(); // FE-side listeners (server→client)

  const client: AwClientTransport = {
    send(frame) {
      const wire = deserializeFrame(serializeFrame(frame)) as AwClientFrame;
      for (const l of [...serverInbox]) l(wire);
    },
    subscribe(listener) {
      clientInbox.add(listener);
      return () => clientInbox.delete(listener);
    },
  };

  const server: AwServerTransport = {
    send(frame) {
      const wire = deserializeFrame(serializeFrame(frame)) as AwServerFrame;
      for (const l of [...clientInbox]) l(wire);
    },
    subscribe(listener) {
      serverInbox.add(listener);
      return () => serverInbox.delete(listener);
    },
  };

  return { client, server };
}
