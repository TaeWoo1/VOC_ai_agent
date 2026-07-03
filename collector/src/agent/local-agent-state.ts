/**
 * Pure **Local Agent lifecycle** state machine (M-Agent-1A).
 *
 * Models the device-local ESM+ workday lifecycle:
 *   *"assisted reconnect at the start of the workday, followed by unattended
 *    review collection while the seller's PC and browser context remain alive."*
 *
 * This is a NEW runtime axis, deliberately SEPARATE from — and never a writer of —
 * `CapabilityStatus` / `schemaMappingConfirmed` / `dedupKeyConfirmed` (plan §10):
 * a running Local Agent is NOT a CONFIRMED capability, and no transition here ever
 * touches capability/schema/dedup verification.
 *
 * It sits ALONGSIDE the server-side `WorkerSessionState`
 * (`../esm/worker-session-state.ts`): that axis models a centrally-hosted
 * scheduled worker; this axis models the seller's own device, whose distinguishing
 * concern is the human-assisted reconnect (credential-selection handoff) that the
 * server path does not have. It reuses the server axis's `InspectionVerdict` and,
 * in the runtime layer, the shared context/single-flight/signature/operational
 * primitives — it does not duplicate the worker's sync logic.
 *
 * **Pure only** — no I/O, no persistence, no timers, no browser, no Playwright, no
 * scheduler, no upload. Every function is a deterministic reducer over sanitized
 * structured inputs, so the whole lifecycle is offline-unit-testable with zero
 * browser.
 *
 * Key invariants encoded here:
 *  - A restart is NEVER treated as session-restoration success: `RESTART` always
 *    returns to `STARTING`, and `READY` is reachable ONLY via a fresh no-click
 *    inspection (`SESSION_INSPECTED: LOGGED_IN`) or a post-submit verification
 *    (`LOGIN_VERIFIED: LOGGED_IN`).
 *  - A sync (`SYNC_STARTED`) is reachable ONLY from `READY` — never from a
 *    reconnect/verify/paused state.
 *  - The agent never authenticates itself: the reconnect path stops at a
 *    human-performed credential selection, and a failed verification goes to
 *    `HUMAN_RECONNECT_REQUIRED` with NO automatic retry.
 */

import type { InspectionVerdict } from "../esm/worker-session-state";
import type { SanitizedAccountRef } from "../connection/sync-state";

export type { InspectionVerdict, SanitizedAccountRef };

/**
 * The runtime lifecycle state of one account's Local Agent. Distinct from the
 * operational `SyncStatus`/`AuthStatus` axes and from `CapabilityStatus`.
 */
export type LocalAgentState =
  | "STOPPED"
  | "STARTING"
  | "INSPECTING_SESSION"
  | "READY"
  | "PREPARING_RECONNECT"
  | "WAITING_FOR_CREDENTIAL_SELECTION"
  | "VERIFYING_LOGIN"
  | "HUMAN_RECONNECT_REQUIRED"
  | "SYNCING"
  | "PAUSED"
  | "DEGRADED";

/**
 * The per-account login mode (which marketplace login surface the seller
 * authenticates through). Per-connection metadata — NOT a global constant.
 */
export type LoginMode = "ESM_PLUS" | "GMARKET" | "AUCTION";

/**
 * How the assisted reconnect actually resolves for a connection. Deliberately NOT
 * asserted in 1A — the agent starts every connection at `UNKNOWN`; **M-Agent-1B**
 * determines which category is achievable from live evidence. The product must
 * never claim reconnect is always "one click".
 */
export type ReconnectInteractionCategory =
  | "ONE_CLICK_CREDENTIAL_SELECTION"
  | "TWO_STEP_FIELD_AND_CREDENTIAL_SELECTION"
  | "MANUAL_LOGIN_REQUIRED"
  | "UNKNOWN";

/**
 * The non-secret per-account connection metadata the Local Agent operates on.
 *
 * **Privacy invariant (hard):** this model NEVER carries username, password,
 * cookie, token, marketplace ID, DOM text, selector, or URL. The `loginModeSignature`
 * is a one-way salted fingerprint of the login-mode selector's sanitized shape
 * (the `computeCandidateSignature` convention); the account reference is hash-only.
 * Consents are kept as SEPARATE grants — never bundled — so a seller can opt into
 * session inspection without opting into auto-reconnect, and so on.
 */
export interface LocalAgentConnection {
  /** Hash-safe account/store reference — never raw identity/PII. */
  account: SanitizedAccountRef;
  /** Which login surface this connection authenticates through. */
  loginMode: LoginMode;
  /** Schema version the stored `loginModeSignature` was computed under. */
  loginModeSignatureVersion: number;
  /** One-way salted fingerprint of the approved login-mode selector's shape. */
  loginModeSignature: string;
  /** Separate grant: may run a no-click session inspection. */
  sessionInspectionConsent: boolean;
  /** Separate grant: may auto-select (normalize to) the configured login mode. */
  loginModeAutoSelectionConsent: boolean;
  /** Separate grant: may drive the assisted-reconnect surface preparation. */
  assistedReconnectConsent: boolean;
  /** Separate grant: may fire ONE login submit after the human selects saved credentials. */
  autoSubmitAfterCredentialSelectionConsent: boolean;
  /** Separate grant: may perform review export (reserved; the sync leg's gate). */
  reviewExportConsent: boolean;
  /** Separate grant: may upload a captured export (reserved; the upload leg's gate). */
  uploadConsent: boolean;
}

/**
 * A SANITIZED observation of the credential-selection surface, pushed to the agent
 * after the human interacts with the browser's saved-credential prompt. Carries
 * ONLY four booleans — never field values, DOM, selectors, or URLs.
 */
export interface CredentialPopulationObservation {
  /** The username field became populated. */
  usernamePopulated: boolean;
  /** The password field became populated. */
  passwordPopulated: boolean;
  /** A CAPTCHA / 2FA / interstitial challenge is present. */
  challengePresent: boolean;
  /** The live login-form signature still matches the one bound at preparation. */
  formSignatureMatch: boolean;
}

/**
 * The sanitized events that drive the Local Agent lifecycle. Each carries only a
 * kind (plus, for inspection/verification, a coarse verdict) — never raw content.
 */
export type LocalAgentEvent =
  /** Boot a fresh lifecycle. */
  | { kind: "START" }
  /** Begin a no-click session inspection. */
  | { kind: "INSPECT" }
  /** A startup/re-inspection completed with the given verdict. */
  | { kind: "SESSION_INSPECTED"; verdict: InspectionVerdict }
  /** Reconnect surface prepared (mode normalized, form shape ok, user notified). */
  | { kind: "RECONNECT_PREPARED" }
  /** A reconnect gate failed closed (signature/consent/form drift/challenge/ambiguity). */
  | { kind: "RECONNECT_FAILED" }
  /** The single gated login submit fired (only legal after every gate passed). */
  | { kind: "CREDENTIALS_SUBMITTED" }
  /** The one post-submit no-click verification completed with the given verdict. */
  | { kind: "LOGIN_VERIFIED"; verdict: InspectionVerdict }
  /** A workday sync cycle began (only from `READY`). */
  | { kind: "SYNC_STARTED" }
  /** A workday sync cycle finished (the operational axis records its outcome). */
  | { kind: "SYNC_FINISHED" }
  /** The session dropped mid-sync — a human must re-authenticate; NO automatic retry. */
  | { kind: "SYNC_SESSION_LOST" }
  /** Repeated soft failures crossed a degrade threshold (still alive; operational only). */
  | { kind: "DEGRADE" }
  /** Operator (or unusable auth) intentionally halts scheduling. */
  | { kind: "PAUSE" }
  /** Process/context restart — forces a fresh no-click inspection (never inherits READY). */
  | { kind: "RESTART" }
  /** Explicit shutdown. Terminal. */
  | { kind: "STOP" };

/** The outcome of applying one event: the next state, and whether the event was legal here. */
export interface LocalAgentTransition {
  next: LocalAgentState;
  /** False when `event` is illegal from `state` — then `next === state` (a safe no-op). */
  accepted: boolean;
}

/** States that indicate a human-assisted reconnect is in progress or required. */
const RECONNECT_STATES: ReadonlySet<LocalAgentState> = new Set([
  "PREPARING_RECONNECT",
  "WAITING_FOR_CREDENTIAL_SELECTION",
  "VERIFYING_LOGIN",
  "HUMAN_RECONNECT_REQUIRED",
]);

/**
 * Pure reducer: given the current lifecycle state and a sanitized event, return the
 * next state. An illegal transition is a SAFE NO-OP (`accepted:false`,
 * `next === state`) rather than a throw — a long-lived agent must never crash on an
 * unexpected event. Restart/reconnect/sync invariants are enforced here.
 */
export function reduceLocalAgent(state: LocalAgentState, event: LocalAgentEvent): LocalAgentTransition {
  // `STOP` and `RESTART` dominate every other transition (except from the terminal
  // `STOPPED`): a crash/restart/shutdown can arrive at any moment, and a restart is
  // ALWAYS a potential session break — it can never inherit `READY`.
  if (state !== "STOPPED") {
    if (event.kind === "STOP") return accept("STOPPED");
    if (event.kind === "RESTART") return accept("STARTING");
  }

  switch (state) {
    case "STOPPED":
      // A brand-new lifecycle boots here; nothing else is legal from terminal.
      if (event.kind === "START") return accept("STARTING");
      return reject(state);

    case "STARTING":
      // The only exits are a no-click inspection or an intentional pause.
      if (event.kind === "INSPECT") return accept("INSPECTING_SESSION");
      if (event.kind === "PAUSE") return accept("PAUSED");
      return reject(state);

    case "INSPECTING_SESSION":
      // A verdict is the ONLY way forward. LOGGED_IN → READY; else → reconnect.
      if (event.kind === "SESSION_INSPECTED") {
        return accept(event.verdict === "LOGGED_IN" ? "READY" : "PREPARING_RECONNECT");
      }
      if (event.kind === "PAUSE") return accept("PAUSED");
      return reject(state);

    case "READY":
      // The ONLY state a sync may begin from. Re-inspection is allowed (workday re-check).
      if (event.kind === "SYNC_STARTED") return accept("SYNCING");
      if (event.kind === "INSPECT") return accept("INSPECTING_SESSION");
      if (event.kind === "PAUSE") return accept("PAUSED");
      if (event.kind === "DEGRADE") return accept("DEGRADED");
      return reject(state);

    case "PREPARING_RECONNECT":
      // Normalize/prepare, OR fail closed. NO submit is reachable from here.
      if (event.kind === "RECONNECT_PREPARED") return accept("WAITING_FOR_CREDENTIAL_SELECTION");
      if (event.kind === "RECONNECT_FAILED") return accept("HUMAN_RECONNECT_REQUIRED");
      if (event.kind === "PAUSE") return accept("PAUSED");
      return reject(state);

    case "WAITING_FOR_CREDENTIAL_SELECTION":
      // Human selects saved credentials. A gated single submit is the only advance;
      // a challenge/drift fails closed. (Incomplete population = no event → stay here.)
      if (event.kind === "CREDENTIALS_SUBMITTED") return accept("VERIFYING_LOGIN");
      if (event.kind === "RECONNECT_FAILED") return accept("HUMAN_RECONNECT_REQUIRED");
      if (event.kind === "PAUSE") return accept("PAUSED");
      return reject(state);

    case "VERIFYING_LOGIN":
      // One bounded no-click verification. LOGGED_IN → READY; anything else → human,
      // with NO automatic retry.
      if (event.kind === "LOGIN_VERIFIED") {
        return accept(event.verdict === "LOGGED_IN" ? "READY" : "HUMAN_RECONNECT_REQUIRED");
      }
      if (event.kind === "PAUSE") return accept("PAUSED");
      return reject(state);

    case "HUMAN_RECONNECT_REQUIRED":
      // Held until a human re-authenticates AND a fresh inspection passes.
      if (event.kind === "INSPECT") return accept("INSPECTING_SESSION");
      if (event.kind === "PAUSE") return accept("PAUSED");
      return reject(state);

    case "SYNCING":
      // A single cycle. It always returns to READY to await the next manual tick;
      // the operational axis (not this reducer) records success/partial/failure. No
      // failure here auto-triggers a second cycle.
      if (event.kind === "SYNC_FINISHED") return accept("READY");
      if (event.kind === "DEGRADE") return accept("DEGRADED");
      // A catch-up that discovers the session dropped mid-sync → human reconnect, no retry.
      if (event.kind === "SYNC_SESSION_LOST") return accept("HUMAN_RECONNECT_REQUIRED");
      return reject(state);

    case "PAUSED":
      // Resume only through a fresh inspection.
      if (event.kind === "INSPECT") return accept("INSPECTING_SESSION");
      return reject(state);

    case "DEGRADED":
      // Operational health only — never a capability change. Re-arm via inspection.
      if (event.kind === "INSPECT") return accept("INSPECTING_SESSION");
      if (event.kind === "PAUSE") return accept("PAUSED");
      return reject(state);

    default:
      return assertNever(state);
  }

  function accept(next: LocalAgentState): LocalAgentTransition {
    return { next, accepted: true };
  }
}

function reject(state: LocalAgentState): LocalAgentTransition {
  return { next: state, accepted: false };
}

function assertNever(_x: never): never {
  throw new Error("reduceLocalAgent: unhandled state");
}

// ── Pure policy helpers ──────────────────────────────────────────────────────────────────────────

/** Map a fresh no-click inspection verdict to the state it authorizes. */
export function stateFromInspection(
  verdict: InspectionVerdict,
): Extract<LocalAgentState, "READY" | "PREPARING_RECONNECT"> {
  return verdict === "LOGGED_IN" ? "READY" : "PREPARING_RECONNECT";
}

/** A workday sync may begin ONLY from `READY` — the single gate the tick driver consults. */
export function mayScheduleSync(state: LocalAgentState): boolean {
  return state === "READY";
}

/** True while a human-assisted reconnect is in progress or required. */
export function isReconnectState(state: LocalAgentState): boolean {
  return RECONNECT_STATES.has(state);
}
