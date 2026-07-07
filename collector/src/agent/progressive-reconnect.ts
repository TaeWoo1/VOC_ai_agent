/**
 * **Progressive Reconnect Policy Core** (M-Agent-Auth-Progressive-Reconnect).
 *
 * A PURE, offline policy layer that decides the device-local reconnect ladder. It is the
 * decision core ONLY — it does NOT launch a browser, attach CDP, run the login-mode bootstrap,
 * observe credential population, drive `LocalAgentRuntime`, or render any reconnect UI. Those
 * wirings are a LATER, separate integration milestone (explicitly out of scope here):
 *   normal Chrome launch · CDP attach · login-mode bootstrap · credential-population observation ·
 *   LocalAgentRuntime · user reconnect UI.
 *
 * The ladder it decides:
 *   1. EXISTING_SESSION            — already LOGGED_IN → READY (+ one catch-up)
 *   2. ZERO_TOUCH_AUTOFILL        — bounded document-start mode bootstrap establishes the login
 *                                    form; if BOTH fields populate and every gate passes, ONE gated
 *                                    submit → verify → READY
 *   3. ASSISTED_CREDENTIAL_SELECTION — a field missing (and assisted consent) → NO auto-submit;
 *                                    emit a sanitized human-action request and wait
 *   4. MANUAL_LOGIN               — no consent / challenge / signature drift / verify failure →
 *                                    human reconnect
 *
 * **Makes NO guarantee of unattended login.** The zero-touch path is *optimistic*; the current
 * GMARKET/macOS/Chrome combination is `CONDITIONAL`, never `VERIFIED` (site-side remembered
 * username is only intermittently present).
 *
 * **Pure only** — no I/O, timers, browser, Playwright, scheduler, or upload. Deterministic
 * reducers over sanitized structured inputs; the whole ladder is offline-unit-testable.
 *
 * **Separation invariant (hard):** `AutoReconnectCapability` is device/connection OPERATIONAL
 * metadata ONLY. This module never reads or writes the global marketplace capability-verification
 * axis, the schema-mapping flag, or the dedup-key flag — a working reconnect is NOT a verified
 * capability. **Privacy invariant:** the model + every emitted value + every derived identifier is
 * enums / booleans / one-way hashes only — never a credential value, seller id, cookie, token,
 * URL, DOM text, selector, raw browser version, OS username, or profile path.
 */

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { LoginMode, SanitizedAccountRef, InspectionVerdict, CredentialPopulationObservation } from "./local-agent-state";
import type { LocalAgentState } from "./local-agent-state";

export type { LoginMode, SanitizedAccountRef, InspectionVerdict, CredentialPopulationObservation };

// ── Enums ──────────────────────────────────────────────────────────────────────────────────────

/** How the correct login form is made the INITIAL effective form for a connection's mode. */
export type InitialFormStrategy =
  | "DIRECT"
  | "DOCUMENT_START_BOOTSTRAP";

/**
 * Device/connection OPERATIONAL classification of the automatic (zero-touch) reconnect path.
 * NOT the marketplace capability-verification status — never promotes it.
 */
export type AutoReconnectCapability =
  | "VERIFIED"
  | "CONDITIONAL"
  | "ASSISTED_ONLY"
  | "UNKNOWN";

/** Which rung of the reconnect ladder resolved (or is resolving) the current attempt. */
export type ReconnectPath =
  | "EXISTING_SESSION"
  | "ZERO_TOUCH_AUTOFILL"
  | "ASSISTED_CREDENTIAL_SELECTION"
  | "MANUAL_LOGIN";

/** The sanitized human-action categories the fallbacks surface (enums only — never data). */
export type UserActionCategory =
  | "SELECT_SAVED_CREDENTIAL"
  | "ENTER_MISSING_USERNAME"
  | "COMPLETE_MANUAL_LOGIN"
  | "COMPLETE_ADDITIONAL_AUTHENTICATION";

// ── Per-connection model ─────────────────────────────────────────────────────────────────────────

/**
 * Non-secret per-connection progressive-reconnect metadata. Consents are SEPARATE grants (never
 * bundled). Carries NO credential value, seller id, cookie, token, URL, DOM, or selector.
 */
export interface ProgressiveReconnectConnection {
  account: SanitizedAccountRef;
  loginMode: LoginMode;
  /** One dedicated browser profile PER CONNECTION (not per user); filesystem-safe, PII-free. */
  dedicatedProfileId: string;
  initialFormStrategy: InitialFormStrategy;
  autoReconnectCapability: AutoReconnectCapability;
  /** Separate grant: may attempt the automatic (optimistic zero-touch) reconnect at all. */
  autoReconnectConsent: boolean;
  /** Separate grant: may fire ONE login submit when both fields are populated. */
  autoSubmitConsent: boolean;
  /** Separate grant: may surface the assisted saved-credential-selection requests. */
  assistedReconnectConsent: boolean;
}

/** Map a login mode to its initial-form strategy (ESM_PLUS is DIRECT; GMARKET/AUCTION bootstrap). */
export function initialFormStrategyForMode(loginMode: LoginMode): InitialFormStrategy {
  return loginMode === "ESM_PLUS" ? "DIRECT" : "DOCUMENT_START_BOOTSTRAP";
}

/**
 * Deterministic, connection-scoped dedicated profile id. The connection reference is passed through
 * a one-way hash so NO raw account/seller identifier, path separator, `..`, or arbitrary input ever
 * reaches a filesystem profile name. Output is `esm-agent-<24 hex>` — filesystem-safe, collision-
 * resistant, and non-reversible. (Reuses `node:crypto` `createHash`, an existing project primitive.)
 */
function dedicatedProfileLeafFor(connectionId: string): string {
  const digest = createHash("sha256").update(`local-agent-profile ${connectionId}`).digest("hex").slice(0, 24);
  return `esm-agent-${digest}`;
}

export function dedicatedProfileIdFor(account: SanitizedAccountRef): string {
  const raw = typeof account.connectionId === "string" ? account.connectionId : "";
  return dedicatedProfileLeafFor(raw);
}

/**
 * The SINGLE production resolver from a (`profileBaseDir`, `connectionId`) pair to the connection-owned
 * dedicated ESM profile directory: `${profileBaseDir}/${dedicatedProfileLeafFor(connectionId)}`. It reuses
 * the SAME leaf formula as {@link dedicatedProfileIdFor} (unchanged hash input + `esm-agent-<24 hex>` leaf),
 * so the local-agent reconnect path and the review-capture path resolve to the exact same directory for a
 * given connection — the G0-verified session is reused, never copied. Deterministic on `connectionId` alone
 * (never marketplace, loginMode, capture kind, branch, or cwd); two ids resolve to two directories; the
 * hashed leaf keeps any path separator / `..` / unsafe input out of the filesystem name. The in-tree guard
 * (`resolveProfileDir`) still runs at launch, so this stays a pure path computation.
 */
export function connectionProfileDirFor(profileBaseDir: string, connectionId: string): string {
  return resolve(profileBaseDir, dedicatedProfileLeafFor(connectionId));
}

/**
 * Build a one-way, sanitized environment key from coarse components (e.g. major-version bucket,
 * platform enum, a hashed profile handle). The RAW components (browser version, OS username, path)
 * are hashed away — only the opaque key is retained/compared. Caller passes already-coarse inputs.
 */
export function sanitizedEnvironmentKey(components: readonly string[]): string {
  // Unambiguous encoding: JSON.stringify so ["ab","c"] and ["a","bc"] never collide (a plain
  // separator-join could). Only the opaque hash is retained — raw components are hashed away.
  const digest = createHash("sha256").update("env|" + JSON.stringify(components)).digest("hex").slice(0, 24);
  return `env-${digest}`;
}

/** The sanitized opaque environment-key format (matches `sanitizedEnvironmentKey` output). */
export const ENVIRONMENT_KEY_PATTERN = /^env-[0-9a-f]{24}$/;

// ── Bounded bootstrap policy (self-stopping; no unbounded click loop) ─────────────────────────────

export type BootstrapStopCondition =
  | "DESIRED_MODE_ACTIVE_AND_FORM_STABLE"
  | "CHALLENGE_PRESENT"
  | "NAVIGATION_LEFT_LOGIN_SURFACE"
  | "ATTEMPT_BUDGET_EXHAUSTED";

export interface BootstrapPlan {
  requiresBootstrap: boolean;
  maxAttempts: number;
  selfStopping: boolean;
  stopConditions: readonly BootstrapStopCondition[];
}

const BOOTSTRAP_MAX_ATTEMPTS = 25;

export function boundedBootstrapPlan(strategy: InitialFormStrategy): BootstrapPlan {
  if (strategy === "DIRECT") {
    return { requiresBootstrap: false, maxAttempts: 0, selfStopping: true, stopConditions: [] };
  }
  return {
    requiresBootstrap: true,
    maxAttempts: BOOTSTRAP_MAX_ATTEMPTS,
    selfStopping: true,
    stopConditions: [
      "DESIRED_MODE_ACTIVE_AND_FORM_STABLE",
      "CHALLENGE_PRESENT",
      "NAVIGATION_LEFT_LOGIN_SURFACE",
      "ATTEMPT_BUDGET_EXHAUSTED",
    ],
  };
}

// ── Progressive reconnect reducer ────────────────────────────────────────────────────────────────

/**
 * Reducer state. `phase` reuses the merged `LocalAgentState`. `attemptConsumed` enforces
 * at-most-one automatic attempt per reconnect incident; `submitEmitted` guards a double-submit.
 */
export interface ProgressiveReconnectState {
  phase: LocalAgentState;
  path: ReconnectPath | null;
  attemptConsumed: boolean;
  submitEmitted: boolean;
  pendingUserAction: UserActionCategory | null;
}

export type ProgressiveEvent =
  | { kind: "START" }
  | { kind: "RESTART" }
  | { kind: "STOP" }
  | { kind: "SESSION_INSPECTED"; verdict: InspectionVerdict }
  | { kind: "FORM_OBSERVED"; observation: CredentialPopulationObservation }
  | { kind: "SUBMIT_VERIFIED"; verdict: InspectionVerdict }
  | { kind: "SESSION_LOST" }
  | { kind: "HUMAN_COMPLETED"; action: UserActionCategory };

export type ProgressiveAction =
  | { kind: "BEGIN_INSPECTION" }
  | { kind: "ESTABLISH_LOGIN_MODE"; strategy: InitialFormStrategy }
  | { kind: "SUBMIT_LOGIN_ONCE" }
  | { kind: "REQUEST_CATCH_UP" }
  | { kind: "EMIT_USER_ACTION"; action: UserActionCategory };

export interface ProgressiveTransition {
  next: ProgressiveReconnectState;
  actions: ProgressiveAction[];
  /** False when the event was illegal from `phase` — then `next === state` (a safe no-op). */
  accepted: boolean;
}

export const initialProgressiveState: ProgressiveReconnectState = {
  phase: "STOPPED",
  path: null,
  attemptConsumed: false,
  submitEmitted: false,
  pendingUserAction: null,
};

/** Phases that mean a reconnect incident is already active (mid-flow). */
const MID_RECONNECT_PHASES: ReadonlySet<LocalAgentState> = new Set<LocalAgentState>([
  "INSPECTING_SESSION",
  "PREPARING_RECONNECT",
  "WAITING_FOR_CREDENTIAL_SELECTION",
  "VERIFYING_LOGIN",
  "HUMAN_RECONNECT_REQUIRED",
]);

/** True while a reconnect incident is open (used for START/RESTART idempotency + SESSION_LOST scope). */
export function isReconnectIncidentActive(state: ProgressiveReconnectState): boolean {
  return MID_RECONNECT_PHASES.has(state.phase);
}

/**
 * Pure progressive-reconnect reducer. Illegal transitions are SAFE NO-OPS (`accepted:false`).
 * Hardened: at-most-one automatic attempt per incident; incident-scoped SESSION_LOST (duplicates are
 * no-ops); START/RESTART is idempotent while an incident is active; every consent-disabled path is
 * explicit; no auto-retry after a failed attempt; no double-submit.
 */
export function reduceProgressiveReconnect(
  state: ProgressiveReconnectState,
  event: ProgressiveEvent,
  conn: ProgressiveReconnectConnection,
): ProgressiveTransition {
  // STOP always dominates.
  if (event.kind === "STOP") {
    return accept({ phase: "STOPPED", path: null, attemptConsumed: false, submitEmitted: false, pendingUserAction: null }, []);
  }

  // START / RESTART: a fresh boot ONLY from STOPPED or READY. While a reconnect incident is already
  // active, a redundant START/RESTART must NOT duplicate actions or reset the submit/attempt guards.
  if (event.kind === "START" || event.kind === "RESTART") {
    if (isReconnectIncidentActive(state)) return reject(state);
    return accept(
      { phase: "INSPECTING_SESSION", path: null, attemptConsumed: false, submitEmitted: false, pendingUserAction: null },
      [{ kind: "BEGIN_INSPECTION" }],
    );
  }

  switch (state.phase) {
    case "INSPECTING_SESSION":
      if (event.kind === "SESSION_INSPECTED") {
        if (event.verdict === "LOGGED_IN") {
          // Rung 1: existing session → READY + exactly one catch-up. Recovery closes the incident.
          return accept({ ...state, phase: "READY", path: "EXISTING_SESSION", pendingUserAction: null }, [{ kind: "REQUEST_CATCH_UP" }]);
        }
        // Logged out.
        if (!conn.autoReconnectConsent) {
          // No automatic path at all → human reconnect (manual login), zero submit.
          return toManual(state, "COMPLETE_MANUAL_LOGIN");
        }
        if (state.attemptConsumed) {
          // The one automatic attempt for this incident is already spent → assisted (or manual).
          return conn.assistedReconnectConsent ? toAssisted(state, "SELECT_SAVED_CREDENTIAL") : toManual(state, "COMPLETE_MANUAL_LOGIN");
        }
        // Consent + unused attempt → establish the login mode (bounded bootstrap for GMARKET/AUCTION).
        return accept(
          { ...state, phase: "PREPARING_RECONNECT", path: null, attemptConsumed: true, submitEmitted: false, pendingUserAction: null },
          [{ kind: "ESTABLISH_LOGIN_MODE", strategy: conn.initialFormStrategy }],
        );
      }
      return reject(state);

    case "PREPARING_RECONNECT":
      if (event.kind === "FORM_OBSERVED") {
        const o = event.observation;
        // Rung 4 short-circuits: a challenge or a form-signature drift is never auto-handled.
        if (o.challengePresent) return toManual(state, "COMPLETE_ADDITIONAL_AUTHENTICATION");
        if (!o.formSignatureMatch) return toManual(state, "COMPLETE_MANUAL_LOGIN");

        if (o.usernamePopulated && o.passwordPopulated) {
          // Rung 2: both fields present → ONE gated submit, only with autoSubmitConsent (double-submit guarded).
          if (conn.autoSubmitConsent && !state.submitEmitted) {
            return accept(
              { ...state, phase: "VERIFYING_LOGIN", path: "ZERO_TOUCH_AUTOFILL", submitEmitted: true, pendingUserAction: null },
              [{ kind: "SUBMIT_LOGIN_ONCE" }],
            );
          }
          // Populated but NO auto-submit consent → no credential is MISSING, so this is not an assisted
          // credential-selection wait: the human must complete/submit → MANUAL_LOGIN (zero automatic submit).
          return toManual(state, "COMPLETE_MANUAL_LOGIN");
        }

        // Rung 3: a field is missing → NO auto-submit.
        if (!conn.assistedReconnectConsent) {
          // Assisted disabled → fall back to manual login.
          return toManual(state, "COMPLETE_MANUAL_LOGIN");
        }
        const action: UserActionCategory =
          !o.usernamePopulated && !o.passwordPopulated ? "SELECT_SAVED_CREDENTIAL"
          : !o.usernamePopulated ? "ENTER_MISSING_USERNAME"
          : "SELECT_SAVED_CREDENTIAL"; // password missing → saved credential fills it
        return toAssisted(state, action);
      }
      return reject(state);

    case "VERIFYING_LOGIN":
      if (event.kind === "SUBMIT_VERIFIED") {
        if (event.verdict === "LOGGED_IN") {
          return accept({ ...state, phase: "READY", path: state.path ?? "ZERO_TOUCH_AUTOFILL", pendingUserAction: null }, [{ kind: "REQUEST_CATCH_UP" }]);
        }
        // Failed verification → human reconnect, NO automatic retry.
        return toManual(state, "COMPLETE_MANUAL_LOGIN");
      }
      // A duplicate FORM_OBSERVED (or anything else) here is a no-op → cannot double-submit.
      return reject(state);

    case "WAITING_FOR_CREDENTIAL_SELECTION":
    case "HUMAN_RECONNECT_REQUIRED":
      if (event.kind === "HUMAN_COMPLETED") {
        // Human did the action → exactly ONE fresh no-click inspection. The automatic login path is
        // NOT repeated (attemptConsumed stays), so a still-logged-out inspection falls to assisted/manual.
        return accept({ ...state, phase: "INSPECTING_SESSION", path: null, pendingUserAction: null }, [{ kind: "BEGIN_INSPECTION" }]);
      }
      return reject(state);

    case "READY":
      if (event.kind === "SESSION_LOST") {
        // Only a READY→SESSION_LOST opens ONE new incident (reset the one-attempt budget). A duplicate
        // SESSION_LOST while mid-incident lands in the default reject below → safe no-op.
        return accept({ ...state, phase: "INSPECTING_SESSION", path: null, attemptConsumed: false, submitEmitted: false, pendingUserAction: null }, [{ kind: "BEGIN_INSPECTION" }]);
      }
      return reject(state);

    default:
      return reject(state);
  }

  function toAssisted(s: ProgressiveReconnectState, action: UserActionCategory): ProgressiveTransition {
    return accept({ ...s, phase: "WAITING_FOR_CREDENTIAL_SELECTION", path: "ASSISTED_CREDENTIAL_SELECTION", pendingUserAction: action }, [{ kind: "EMIT_USER_ACTION", action }]);
  }
  function toManual(s: ProgressiveReconnectState, action: UserActionCategory): ProgressiveTransition {
    return accept({ ...s, phase: "HUMAN_RECONNECT_REQUIRED", path: "MANUAL_LOGIN", pendingUserAction: action }, [{ kind: "EMIT_USER_ACTION", action }]);
  }
  function accept(next: ProgressiveReconnectState, actions: ProgressiveAction[]): ProgressiveTransition {
    return { next, actions, accepted: true };
  }
  function reject(s: ProgressiveReconnectState): ProgressiveTransition {
    return { next: s, actions: [], accepted: false };
  }
}

// ── Capability interpretation (operational only; evidence-gated) ─────────────────────────────────

/**
 * Evidence for one device/connection's zero-touch reconnect outcomes. Counts + a set of sanitized
 * (one-way) environment keys — NEVER raw browser versions, OS usernames, profile paths, or PII.
 */
export interface ZeroTouchOutcomeRecord {
  attemptCount: number;
  /** Terminal outcomes are MUTUALLY EXCLUSIVE: success + failure + challengeOrDeviceAuth === attempt. */
  successCount: number;
  failureCount: number;
  /** Observations terminated by a challenge / device-auth prompt (a distinct outcome, NOT a subset of failures). */
  challengeOrDeviceAuthCount: number;
  /** Exactly one sanitized environment key per observation (opaque; only distinctness is inspected). */
  environmentKeys: readonly string[];
}

/** Minimum clean all-success attempts, all in one environment, required for VERIFIED. */
export const MIN_VERIFIED_ATTEMPTS = 5;

/**
 * Interpret an evidence record into an operational `AutoReconnectCapability`. Device/connection
 * metadata ONLY — never influences marketplace capability/schema/dedup verification.
 *
 * Evidence invariants (all required for a well-formed record; else NEVER VERIFIED):
 *  - every count is a non-negative integer
 *  - successCount ≤ attemptCount
 *  - success + failure + challengeOrDeviceAuth === attempt (mutually-exclusive terminal outcomes)
 *  - environmentKeys.length === attemptCount, each matching the sanitized opaque format
 *
 * Policy:
 *  - no valid observations (attemptCount not a positive integer) → UNKNOWN
 *  - any invariant violated → CONDITIONAL (never VERIFIED; the malformed evidence is downgraded)
 *  - any mixed success/failure → CONDITIONAL
 *  - all-failure (or blocked-only) with evidence → ASSISTED_ONLY
 *  - VERIFIED **only** with ≥ MIN_VERIFIED_ATTEMPTS attempts, ALL successful, NO challenge/device-auth,
 *    and ALL observations from a single environment key; otherwise → CONDITIONAL. A single success can
 *    never be VERIFIED.
 */
export function interpretAutoReconnectCapability(record: ZeroTouchOutcomeRecord): AutoReconnectCapability {
  const { attemptCount, successCount, failureCount, challengeOrDeviceAuthCount, environmentKeys } = record;
  // Gross validity: no valid, interpretable observations at all.
  if (!isNonNegativeInteger(attemptCount) || attemptCount === 0) return "UNKNOWN";
  // Any invariant violation ⇒ never VERIFIED; downgrade the (present-but-malformed) evidence.
  if (!evidenceIsConsistent(record)) return "CONDITIONAL";

  if (successCount > 0 && failureCount > 0) return "CONDITIONAL";
  if (successCount === 0 && (failureCount > 0 || challengeOrDeviceAuthCount > 0)) return "ASSISTED_ONLY";

  // Remaining: successCount > 0 && failureCount === 0. Gate VERIFIED strictly.
  const distinctEnvironments = new Set(environmentKeys).size;
  const cleanAllSuccess =
    successCount === attemptCount && failureCount === 0 && challengeOrDeviceAuthCount === 0;
  if (cleanAllSuccess && attemptCount >= MIN_VERIFIED_ATTEMPTS && distinctEnvironments === 1) {
    return "VERIFIED";
  }
  return "CONDITIONAL";
}

function isNonNegativeInteger(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/**
 * Evidence consistency invariants. Outcome counts are MUTUALLY EXCLUSIVE terminal categories, so a
 * well-formed record has success + failure + challengeOrDeviceAuth exactly equal to attemptCount, one
 * sanitized environment key per observation, and no negative/fractional counts.
 */
function evidenceIsConsistent(r: ZeroTouchOutcomeRecord): boolean {
  const counts = [r.attemptCount, r.successCount, r.failureCount, r.challengeOrDeviceAuthCount];
  if (!counts.every(isNonNegativeInteger)) return false;
  if (r.successCount > r.attemptCount) return false;
  if (r.successCount + r.failureCount + r.challengeOrDeviceAuthCount !== r.attemptCount) return false;
  if (r.environmentKeys.length !== r.attemptCount) return false;
  if (!r.environmentKeys.every((k) => ENVIRONMENT_KEY_PATTERN.test(k))) return false;
  return true;
}

// ── Per-connection manager (in-memory; pure; enforces isolation) ─────────────────────────────────

/**
 * In-memory manager keying progressive-reconnect state by connection id, so each connection's ladder
 * is fully isolated: dispatching to one connection never touches another's state or profile.
 */
export class ProgressiveReconnectManager {
  private readonly byConnection = new Map<string, ProgressiveReconnectState>();

  getState(connectionId: string): ProgressiveReconnectState {
    return this.byConnection.get(connectionId) ?? initialProgressiveState;
  }

  dispatch(conn: ProgressiveReconnectConnection, event: ProgressiveEvent): ProgressiveTransition {
    const current = this.getState(conn.account.connectionId);
    const t = reduceProgressiveReconnect(current, event, conn);
    this.byConnection.set(conn.account.connectionId, t.next);
    return t;
  }
}
