// FE-owned source seam for the Action Window store (FE-2.5).
//
// `ActionWindowSource` is an FE-only TypeScript interface — NOT a wire protocol,
// never exported as one, and it defines no Runtime behavior. It exists so the
// store consumes "some source of sanitized run views" without knowing whether the
// source is the FE-1 fixture adapter (default), the DEV-only simulated stream, or
// — in FE-3, once Runtime R2 lands — a real Bridge-backed implementation. Only the
// source implementation changes then; the store, resilience rules, UI states, and
// tests stay put.

import type { ActionWindowRunView, CommandType } from "./contract";

/** FE-owned command envelope handed to a source. Not a wire type. */
export interface SourceCommand {
  commandId: string;
  type: CommandType;
  /** Revision the UI acted on; null when there is no active run. */
  expectedRevision: number | null;
}

/** Connection status of a source — a UI resilience state, not Runtime state. */
export type SourceConnection = "connected" | "offline" | "reconnecting";

export type CommandRejectionReason = "not-allowed" | "stale-revision";

/** Updates a source pushes to its single subscriber (the store). */
export type SourceUpdate =
  | { kind: "view"; sequence: number; run: ActionWindowRunView | null; note?: string }
  | { kind: "snapshot"; sequence: number; run: ActionWindowRunView | null }
  | { kind: "connection"; connection: SourceConnection }
  | { kind: "command-rejected"; commandId: string; reason: CommandRejectionReason };

export interface ActionWindowSource {
  /** Single-subscriber stream of updates; returns an unsubscribe function. */
  subscribe(listener: (update: SourceUpdate) => void): () => void;
  /** Surface a user intent; the source alone decides the outcome. */
  dispatch(command: SourceCommand): void;
  /** Ask for an authoritative snapshot (e.g. after a detected sequence gap). */
  requestSnapshot(): void;
}

/** A source that is advanced manually (the DEV simulated stream). Structural
 *  interface so the store never imports the simulation module itself. */
export interface SteppableSource extends ActionWindowSource {
  /** Emit the next scripted update; false when the script is exhausted. */
  step(): boolean;
  /** Scripted updates left to step through. */
  remaining(): number;
}
