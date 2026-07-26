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
 *
 * **One frame carries prose, in one direction: {@link AwGuidancePack}.** It is FE → Runtime, it is the
 * frontend's own copy being handed to the surface that has to display it, and it is never echoed back. The
 * Runtime→FE invariant above is therefore unchanged, and the normative contract in `./index` needed no edit.
 * See that type's note for why this is §6 held rather than §6 relaxed.
 *
 * **And one frame carries a press back: {@link AwGuidanceIntent}.** Runtime → FE, a single closed-set enum and
 * nothing else. It is deliberately NOT a command envelope: the thing the seller asked for is work the FRONTEND
 * has to authorize (see that type's note), so putting it on the command path would be modelling it as something
 * the Runtime can act on alone.
 */
import type { CommandEnvelope, EventEnvelope, ActionWindowRunView } from "./index";

/** Bump on any breaking change to the *framing* below (independent of the message protocol version). */
export const ACTION_WINDOW_TRANSPORT_VERSION = 1;

/* ────────────────────────────── Guidance pack (FE → Runtime) ────────────────────────────── */

/**
 * **The prose the Runtime is allowed to render, authored by the frontend.**
 *
 * ## Why this exists, and why it does not weaken §6
 *
 * §6 says the Runtime supplies semantic identifiers and the FE owns every word. That held as long as every
 * word was read in the SellerOps window. It stopped holding when guidance moved INTO the marketplace page:
 * the seller works in the SmartStore tab, and a sentence that only exists in the other window is a sentence
 * they never see (product-owner decision, 2026-07-26 — one start in SellerOps, then finish inside SmartStore).
 *
 * The rule §6 protects is *who decides the wording*, not *which process holds the string*. So the direction
 * is inverted rather than relaxed: the FE composes the prose and hands it down, and the Runtime does lookup
 * and `{param}` substitution — nothing else. A copy key with no entry here renders NO sentence; the Runtime
 * has no fallback prose to fall back to, which is what makes "the FE owns all copy" structural instead of
 * aspirational. (`collector` proves it: a source guard asserts the panel modules contain no Hangul.)
 *
 * ## What this frame is NOT
 *
 *  - It is **FE → Runtime only.** Nothing here is ever echoed back on an event, a view, or a resync reply,
 *    so the Runtime→FE privacy invariant and `findProhibitedFields` are untouched — this is why the
 *    normative message contract in `./index` needed no change at all.
 *  - It is **never logged and never persisted.** The Runtime logs a count of entries, never a sentence.
 *  - It carries **no run state**: no status, no step number, no blocker. Those still come from the Runtime,
 *    which is the only thing that knows them. This is a dictionary, not a view.
 */
export interface AwGuidancePack {
  /**
   * Panel furniture. `stepCounter` may use `{step}` / `{total}`; `requiredRange` may use `{start}` / `{end}`.
   * Present so even the frame around the guidance is the FE's wording and not the Runtime's.
   */
  chrome: {
    product: string;
    stepCounter: string;
    requiredRange: string;
    blockedLabel: string;
  };
  /** Step `copyKey` → sentence template. `{param}` placeholders are filled from that step's `copyParams`. */
  steps: Record<string, string>;
  /**
   * `BlockerCode` → why it stopped and how to repair it.
   *
   * Two fields rather than one because a stopped run has two obligations to the seller, and collapsing them
   * is what left the 2026-07-25 run's operator changing a date nobody was watching: `title` says what is
   * wrong, `fix` says the one thing that clears it.
   */
  blockers: Record<string, { title: string; fix: string }>;
  /** `CommandType` → button label for the controls the Runtime reports as allowed. */
  commands: Record<string, string>;
  /**
   * Situation-specific wording for `REQUEST_STEP_RECHECK`, because one label cannot be right everywhere.
   *
   * "확인 완료" is correct at a date field and wrong at a download barrier, and on the 2026-07-25 run the
   * operator could not find the button they had been told to press. Resolution order is blocker → step →
   * fallback: what the run is BLOCKED on describes the repair better than what step it is nominally at.
   */
  recheck: {
    byBlocker: Record<string, string>;
    byStep: Record<string, string>;
    fallback: string;
  };
  /**
   * What the panel says once THIS run has finished, and whether it offers to continue.
   *
   * Absent ⇒ a finished run takes its panel down, which is what shipped on 2026-07-26. The product owner's
   * next decision (2026-07-26) is that a seller who has just finished one of thirteen monthly exports should
   * not have to find the SellerOps tab to start the fourteenth, so the panel now closes one segment and opens
   * the next from inside the marketplace window.
   *
   * **Every field is FINAL TEXT with no placeholders, unlike the rest of this pack.** The continuation lines
   * name a date range and a count, and both are facts about the PLAN — which segment comes next, how many are
   * left. The Runtime holds no plan: it is handed one ref at a time and cannot see past it. So there is nothing
   * for it to substitute, and asking it to would mean shipping plan state down this frame. The frontend composes
   * the sentences whole and the Runtime prints them.
   *
   * The branch is chosen by emptiness, so even that decision stays the frontend's:
   *  - `nextLine` non-empty ⇒ there IS a next segment; the panel shows it and offers `continueLabel`;
   *  - `nextLine` empty ⇒ nothing remains; the panel shows `allDoneLine` and offers no control.
   */
  continuation?: {
    /** Heading for a finished segment, e.g. a "this part is done" label. */
    doneLabel: string;
    /** The next segment and how many are left, fully composed. Empty ⇒ this was the last one. */
    nextLine: string;
    /** Shown instead of {@link nextLine} when the whole plan is finished. */
    allDoneLine: string;
    /** Label for the continue control. Empty ⇒ no control, whatever else this block says. */
    continueLabel: string;
  };
}

/* ────────────────────────── Guidance intent (Runtime → FE) ────────────────────────── */

/**
 * **A press on the in-page panel that the RUNTIME cannot answer by itself.**
 *
 * ## Why this is not a command
 *
 * The panel's other two buttons (`REQUEST_STEP_RECHECK`, `CANCEL_RUN`) are contract commands: they act on the
 * run the Runtime is hosting, so it applies them locally. "Continue with the next segment" is a different kind
 * of thing entirely, and the repository says so:
 *
 *  - a run is authorized by a single-use launch ref, minted by the BACKEND
 *    (`ReviewImportLaunchService.mintNextSegment`, `POST /plans/{planId}/launches/next-segment`, org from the
 *    JWT);
 *  - only the FRONTEND can ask for one, because the Action Window wire carries no plan or segment identity by
 *    design — the Runtime is handed a ref and resolves it, and has no way to name "the next segment";
 *  - the Local Agent has no minting path at all, and giving it one would be a new authorization route created
 *    to serve a UI affordance.
 *
 * So the press travels: seller's page → Runtime → this frame → frontend → backend mint → `START_RUN` on the
 * SAME socket. Nothing about who may authorize a run changes; only where the button lives.
 *
 * ## What it carries
 *
 * One enum value. No plan id, no segment id, no dates, no ref, no run state — a request, not an instruction,
 * and the frontend is free to refuse it (no plan, nothing remaining, a run already in flight). The seller's
 * page is where the flag that produces this lives, so the Runtime treats it as untrusted input and forwards
 * only a value the panel actually offered.
 */
export type AwGuidanceIntent = "CONTINUE_NEXT_SEGMENT";

/** The closed set, for runtime validation on both ends. */
export const AW_GUIDANCE_INTENTS: readonly AwGuidanceIntent[] = ["CONTINUE_NEXT_SEGMENT"];

/* ────────────────────────────── Frames ────────────────────────────── */

/**
 * Frontend → Runtime. A command intent, a reconnect resync request, or the guidance prose the Runtime
 * renders in the marketplace page ({@link AwGuidancePack}).
 */
export type AwClientFrame =
  | { kind: "aw_command"; command: CommandEnvelope }
  | { kind: "aw_resync"; runId: string; sinceSequence: number }
  | { kind: "aw_guidance_pack"; pack: AwGuidancePack };

/**
 * Runtime → Frontend. Ordered events, the latest sanitized View Model, a command ack, a resync reply, or a
 * press on the in-page panel that only the frontend can act on ({@link AwGuidanceIntent}).
 */
export type AwServerFrame =
  | { kind: "aw_event"; event: EventEnvelope }
  | { kind: "aw_view"; view: ActionWindowRunView }
  | { kind: "aw_command_result"; commandId: string; accepted: boolean; reason?: string }
  | { kind: "aw_resync_result"; view: ActionWindowRunView | null; events: readonly EventEnvelope[] }
  | { kind: "aw_guidance_intent"; intent: AwGuidanceIntent };

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
