/**
 * **Browser Projection V0 — wire protocol (G2).** A SEPARATE projection transport boundary from the G1
 * status/events channel (slice `docs/slices/browser-projection-v0.md` §0.7, §6). G1's JSON/text/64 KiB
 * status channel is UNCHANGED and untouched; projection frames travel on their own path (`/projection/ws`)
 * with their own size policy: server→client image frames are **binary**, client→server control messages
 * are small **JSON text**.
 *
 * **Sanitization invariant (slice §0.4, §8.3).** Nothing here carries a raw URL, page title, DOM text,
 * selector, marketplace/account/store identifier, credential, ticket, or personal data. Targets are opaque
 * 16-hex handles; frames are pixels only; coordinates are normalized [0,1] (converted to CSS px in the
 * Local Agent, never round-tripped as page coordinates). Frame bytes never enter logs.
 */

/** Bump on any breaking change to the projection envelopes/frames below. Independent of the G1 version. */
export const PROJECTION_PROTOCOL_VERSION = 1;

/** Projection-specific frame ceiling (separate from G1's 64 KiB status cap). Oversize frames are dropped. */
export const PROJECTION_MAX_FRAME_BYTES = 512 * 1024;
/** Client→server control messages are tiny; the projection WS caps *received* payloads small. */
export const PROJECTION_CLIENT_MAX_BYTES = 16 * 1024;
/** At most this many not-yet-consumed/latest frames are held per viewer before drop-old kicks in (slice §0.7). */
export const PROJECTION_MAX_QUEUE_DEPTH = 2;

/** Capabilities the agent advertises so the frontend can distinguish view-only from control support. */
export interface ProjectionCapabilities {
  view: boolean;
  control: boolean;
  format: "jpeg";
  /** Target frame cadence the agent runs (slice §0.7: start ~10 fps). */
  fps: number;
}

/** Coarse, non-identifying target state — never a URL or title. */
export type ProjectionTargetState = "active" | "navigating" | "popup_available" | "closed";

/** Why an input was rejected (a reason code, never input content). */
export type ProjectionInputRejection =
  | "no_control_lease"
  | "not_started"
  | "forbidden_input"
  | "out_of_bounds"
  | "paused"
  | "disconnected"
  | "closed_target";

/** Why control was lost (a reason code). */
export type ProjectionControlLostReason =
  | "released"
  | "expired"
  | "disconnected"
  | "agent_restart"
  | "target_closed"
  | "projection_stopped"
  | "pairing_revoked";

export type ProjectionRecoverableReason = "cdp_detached" | "reattaching" | "source_stalled";
export type ProjectionTerminalReason = "target_closed" | "browser_closed" | "agent_shutdown" | "pairing_revoked";

/** server → client CONTROL messages (JSON text). Image frames are BINARY (see {@link encodeFrameHeader}). */
export type ProjectionServerMessage =
  | { type: "hello_projection"; protocolVersion: number; capabilities: ProjectionCapabilities }
  | { type: "session_started"; sessionRef: string; targetHandle: string }
  | { type: "viewport"; deviceWidth: number; deviceHeight: number }
  | { type: "target_changed"; targetHandle: string; state: ProjectionTargetState }
  | { type: "control_granted"; expiresInMs: number }
  | { type: "control_available" }
  | { type: "control_held_by_other" }
  | { type: "control_lost"; reason: ProjectionControlLostReason }
  | { type: "input_accepted" }
  | { type: "input_rejected"; reason: ProjectionInputRejection }
  | { type: "paused" }
  | { type: "stopped" }
  | { type: "recoverable_error"; reason: ProjectionRecoverableReason }
  | { type: "terminal_error"; reason: ProjectionTerminalReason };

/** A normalized pointer/key/text input — the ONLY input path (slice §8/§E). Coordinates are [0,1]. */
export type ProjectionInput =
  | { kind: "pointer_move"; x: number; y: number }
  | { kind: "pointer_down"; x: number; y: number; button: "left" }
  | { kind: "pointer_up"; x: number; y: number; button: "left" }
  | { kind: "wheel"; x: number; y: number; dy: number; dx?: number }
  | { kind: "key_down"; key: string; code?: string }
  | { kind: "key_up"; key: string; code?: string }
  | { kind: "text"; text: string };

/** client → server CONTROL messages (JSON text). No marketplace/workflow/navigation commands (slice §4). */
export type ProjectionClientMessage =
  | { type: "request_control" }
  | { type: "release_control" }
  | { type: "input"; input: ProjectionInput }
  | { type: "request_target_switch"; targetHandle: string }
  | { type: "ping" };

/**
 * **Binary frame layout.** A self-describing header + JPEG payload, so a frame needs no accompanying JSON
 * (keeping frame+meta atomic and off the text control path). All ints big-endian.
 *
 *   [0]      kind = 0x01 (frame)
 *   [1..4]   uint32 seq
 *   [5..6]   uint16 deviceWidth  (CSS px, coarse — for aspect-ratio letterboxing only)
 *   [7..8]   uint16 deviceHeight
 *   [9]      format (1 = jpeg)
 *   [10..]   image bytes
 */
export const FRAME_HEADER_BYTES = 10;
export const FRAME_KIND = 0x01;

export function encodeFrameHeader(seq: number, deviceWidth: number, deviceHeight: number): Buffer {
  const h = Buffer.alloc(FRAME_HEADER_BYTES);
  h[0] = FRAME_KIND;
  h.writeUInt32BE(seq >>> 0, 1);
  h.writeUInt16BE(Math.min(65535, Math.max(0, Math.round(deviceWidth))), 5);
  h.writeUInt16BE(Math.min(65535, Math.max(0, Math.round(deviceHeight))), 7);
  h[9] = 1; // jpeg
  return h;
}

export interface DecodedFrameHeader {
  seq: number;
  deviceWidth: number;
  deviceHeight: number;
  format: "jpeg";
}

/** Parse the fixed header from a binary frame; returns null if it is not a well-formed frame. */
export function decodeFrameHeader(buf: Uint8Array): DecodedFrameHeader | null {
  if (buf.length < FRAME_HEADER_BYTES || buf[0] !== FRAME_KIND) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    seq: dv.getUint32(1, false),
    deviceWidth: dv.getUint16(5, false),
    deviceHeight: dv.getUint16(7, false),
    format: "jpeg",
  };
}

/** Pure: are two projection protocol versions compatible? Single major — exact match. */
export function isProjectionCompatible(clientVersion: number, agentVersion: number): boolean {
  return Number.isInteger(clientVersion) && clientVersion === agentVersion;
}
