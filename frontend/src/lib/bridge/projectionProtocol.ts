/**
 * Frontend mirror of the Browser Projection V0 wire protocol (`collector/src/bridge/projection-protocol.ts`).
 * A temporary hand-kept mirror until a generated/shared contract exists — keep the two in sync on any change.
 *
 * Everything crossing this boundary is a sanitized scalar/enum, an opaque 16-hex target handle, or pixel
 * bytes. No raw URL, page title, DOM text, selector, credential, ticket, account/store id ever crosses it.
 */

export const PROJECTION_PROTOCOL_VERSION = 1;
export const FRAME_HEADER_BYTES = 10;
export const FRAME_KIND = 0x01;
/** Keep at most this many not-yet-rendered/latest frames before drop-old (slice §0.7). */
export const PROJECTION_MAX_QUEUE_DEPTH = 2;

export interface ProjectionCapabilities {
  view: boolean;
  control: boolean;
  format: "jpeg";
  fps: number;
}

export type ProjectionTargetState = "active" | "navigating" | "popup_available" | "closed";
export type ProjectionInputRejection =
  | "no_control_lease" | "not_started" | "forbidden_input" | "out_of_bounds" | "paused" | "disconnected" | "closed_target";
export type ProjectionControlLostReason =
  | "released" | "expired" | "disconnected" | "agent_restart" | "target_closed" | "projection_stopped" | "pairing_revoked";
export type ProjectionRecoverableReason = "cdp_detached" | "reattaching" | "source_stalled";
export type ProjectionTerminalReason = "target_closed" | "browser_closed" | "agent_shutdown" | "pairing_revoked";

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

export type ProjectionInput =
  | { kind: "pointer_move"; x: number; y: number }
  | { kind: "pointer_down"; x: number; y: number; button: "left" }
  | { kind: "pointer_up"; x: number; y: number; button: "left" }
  | { kind: "wheel"; x: number; y: number; dy: number; dx?: number }
  | { kind: "key_down"; key: string; code?: string }
  | { kind: "key_up"; key: string; code?: string }
  | { kind: "text"; text: string };

export type ProjectionClientMessage =
  | { type: "request_control" }
  | { type: "release_control" }
  | { type: "input"; input: ProjectionInput }
  | { type: "request_target_switch"; targetHandle: string }
  | { type: "ping" };

export interface DecodedFrameHeader {
  seq: number;
  deviceWidth: number;
  deviceHeight: number;
  format: "jpeg";
}

/** Parse the fixed 10-byte header from a binary frame; null if not a well-formed frame. */
export function decodeFrameHeader(buf: Uint8Array): DecodedFrameHeader | null {
  if (buf.length < FRAME_HEADER_BYTES || buf[0] !== FRAME_KIND) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { seq: dv.getUint32(1, false), deviceWidth: dv.getUint16(5, false), deviceHeight: dv.getUint16(7, false), format: "jpeg" };
}

/**
 * Client-side input allow/deny mirror (slice §8/§E). The Local Agent re-validates every input, but the
 * frontend must not even attempt to send a forbidden one. Coordinates are normalized [0,1].
 */
export function isAllowedInput(input: ProjectionInput): boolean {
  const inRange = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= 1;
  switch (input.kind) {
    case "pointer_move": return inRange(input.x) && inRange(input.y);
    case "pointer_down":
    case "pointer_up": return inRange(input.x) && inRange(input.y) && input.button === "left";
    case "wheel": return inRange(input.x) && inRange(input.y) && Number.isFinite(input.dy);
    case "key_down":
    case "key_up": return typeof input.key === "string" && input.key.length > 0 && input.key !== "F12";
    case "text": {
      if (typeof input.text !== "string") return false;
      for (let i = 0; i < input.text.length; i++) { const c = input.text.charCodeAt(i); if (c <= 0x1f || c === 0x7f) return false; }
      return true;
    }
    default: return false;
  }
}

export function isProjectionCompatible(clientVersion: number, agentVersion: number): boolean {
  return Number.isInteger(clientVersion) && clientVersion === agentVersion;
}
