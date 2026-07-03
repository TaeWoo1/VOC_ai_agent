/**
 * **Progressive Reconnect runtime** — the pure orchestration seam that drives the
 * `progressive-reconnect` policy core against a browser port (M-Agent-Auth-Progressive-Reconnect
 * integration).
 *
 * The policy core is a Mealy machine: each event produces a next state + at most one sanitized
 * ACTION (`BEGIN_INSPECTION` / `ESTABLISH_LOGIN_MODE` / `SUBMIT_LOGIN_ONCE` / `REQUEST_CATCH_UP` /
 * `EMIT_USER_ACTION`). This runtime EXECUTES each action against an injected `ProgressiveReconnectBrowser`
 * and feeds the browser's sanitized result back as the next event, looping until the ladder settles
 * (READY / WAITING_FOR_CREDENTIAL_SELECTION / HUMAN_RECONNECT_REQUIRED / STOPPED).
 *
 * **Pure orchestration** — no browser/Playwright/CDP here; the port abstracts all browser I/O, so the
 * whole action↔result mapping is offline-unit-testable with a fake port. The LIVE port (normal Chrome
 * launch + connectOverCDP + bounded document-start bootstrap + credential observation) lives in
 * `progressive-reconnect-chrome.ts` and is exercised only by a later approved live smoke.
 *
 * Scope guard: `REQUEST_CATCH_UP` is RECORDED to a sink, never executed (no export/download/upload,
 * no backend write); `EMIT_USER_ACTION` surfaces a sanitized enum to a sink. No scheduler, no UI,
 * no Device Vault. Every value crossing the port is a sanitized enum / boolean / coarse observation.
 */

import {
  reduceProgressiveReconnect,
  initialProgressiveState,
  type ProgressiveReconnectConnection,
  type ProgressiveReconnectState,
  type ProgressiveEvent,
  type ProgressiveAction,
  type InitialFormStrategy,
  type UserActionCategory,
} from "./progressive-reconnect";
import type { InspectionVerdict, CredentialPopulationObservation, SanitizedAccountRef } from "./local-agent-state";

/**
 * The browser port the runtime drives. Every method returns SANITIZED results only (a coarse
 * verdict / a booleans-only population observation) — never a URL, DOM text, selector, or credential
 * value. The live implementation performs the normal Chrome launch + connectOverCDP + bounded
 * document-start bootstrap; a fake implements the same shape for offline tests.
 */
export interface ProgressiveReconnectBrowser {
  /** No-click session inspection → LOGGED_IN / NOT_LOGGED_IN. */
  inspectSession(): Promise<InspectionVerdict>;
  /**
   * Establish the correct initial login form for the connection's mode (DIRECT, or the bounded
   * self-stopping document-start bootstrap for GMARKET/AUCTION), then observe the form WITHOUT any
   * field click/focus/keyboard → a sanitized population observation.
   */
  establishLoginMode(strategy: InitialFormStrategy): Promise<CredentialPopulationObservation>;
  /** Fire exactly one gated login submit + one no-click verification → LOGGED_IN / NOT_LOGGED_IN. */
  submitLoginOnce(): Promise<InspectionVerdict>;
  /** Close the browser/context. */
  close(): Promise<void>;
}

/** Terminal side-effect sink. Neither is executed here — catch-up is only RECORDED (never run). */
export interface ProgressiveReconnectSink {
  /** Record the one catch-up request emitted on reaching READY. MUST NOT run export/upload/backend. */
  requestCatchUp(account: SanitizedAccountRef): void;
  /** Surface the sanitized human-action request for the (out-of-scope) reconnect UI. */
  emitUserAction(account: SanitizedAccountRef, action: UserActionCategory): void;
}

/**
 * Pure precondition for firing the ONE gated submit. The live port re-evaluates this IMMEDIATELY
 * before clicking submit (re-reading population, challenge, and the live-vs-bound form signature),
 * and fails closed if it does not hold — so a drift/challenge/de-population between observation and
 * approval can never lead to a submit.
 */
export function submitPreconditionMet(o: CredentialPopulationObservation): boolean {
  return o.usernamePopulated === true && o.passwordPopulated === true && o.challengePresent === false && o.formSignatureMatch === true;
}

/** Defensive cap: the policy ladder always settles in a few steps; a runaway loop is a bug. */
const MAX_DRIVE_STEPS = 12;

/**
 * Drives one connection's progressive-reconnect ladder against a browser port. Holds the policy
 * state; each public entry dispatches an event and runs the action→result loop to a settled state.
 */
export class ProgressiveReconnectRuntime {
  private state: ProgressiveReconnectState = initialProgressiveState;

  constructor(
    private readonly connection: ProgressiveReconnectConnection,
    private readonly browser: ProgressiveReconnectBrowser,
    private readonly sink: ProgressiveReconnectSink,
  ) {}

  getState(): ProgressiveReconnectState {
    return this.state;
  }

  /** Boot: inspect existing session and run the ladder to a settled state. */
  start(): Promise<ProgressiveReconnectState> {
    return this.drive({ kind: "START" });
  }
  /** Process/context restart (idempotent while a reconnect incident is already active). */
  restart(): Promise<ProgressiveReconnectState> {
    return this.drive({ kind: "RESTART" });
  }
  /** A live session dropped → permits one new automatic attempt. */
  sessionLost(): Promise<ProgressiveReconnectState> {
    return this.drive({ kind: "SESSION_LOST" });
  }
  /** The human finished a fallback action → exactly one fresh inspection (no auto re-login). */
  humanCompleted(action: UserActionCategory): Promise<ProgressiveReconnectState> {
    return this.drive({ kind: "HUMAN_COMPLETED", action });
  }
  /** Explicit shutdown of the policy lifecycle (does not itself close the browser). */
  stop(): Promise<ProgressiveReconnectState> {
    return this.drive({ kind: "STOP" });
  }
  /** Close the underlying browser/context. */
  close(): Promise<void> {
    return this.browser.close();
  }

  private async drive(event: ProgressiveEvent): Promise<ProgressiveReconnectState> {
    let next: ProgressiveEvent | null = event;
    let steps = 0;
    while (next !== null) {
      if (steps++ > MAX_DRIVE_STEPS) {
        throw new Error("ProgressiveReconnectRuntime: drive loop exceeded step cap (policy did not settle)");
      }
      const transition = reduceProgressiveReconnect(this.state, next, this.connection);
      this.state = transition.next;
      next = await this.execute(transition.actions);
    }
    return this.state;
  }

  /**
   * Execute the (at-most-one) emitted action against the browser/sink and return the follow-up event,
   * or null when the ladder has settled (READY after catch-up, or waiting for the human).
   */
  private async execute(actions: ProgressiveAction[]): Promise<ProgressiveEvent | null> {
    const action = actions[0];
    if (action === undefined) return null; // reject / no-op → settled
    switch (action.kind) {
      case "BEGIN_INSPECTION": {
        const verdict = await this.browser.inspectSession();
        return { kind: "SESSION_INSPECTED", verdict };
      }
      case "ESTABLISH_LOGIN_MODE": {
        const observation = await this.browser.establishLoginMode(action.strategy);
        return { kind: "FORM_OBSERVED", observation };
      }
      case "SUBMIT_LOGIN_ONCE": {
        const verdict = await this.browser.submitLoginOnce();
        return { kind: "SUBMIT_VERIFIED", verdict };
      }
      case "REQUEST_CATCH_UP":
        // Recorded ONLY — never executes export/download/upload/backend in this slice.
        this.sink.requestCatchUp(this.connection.account);
        return null;
      case "EMIT_USER_ACTION":
        // Settle at WAITING_FOR_CREDENTIAL_SELECTION / HUMAN_RECONNECT_REQUIRED. The runtime NEVER
        // closes the browser on settle — the same live page stays open so the human can act in it,
        // and a later `humanCompleted()` re-inspects that same page. Only `close()`/`stop()` (caller-
        // driven) tear down the browser.
        this.sink.emitUserAction(this.connection.account, action.action);
        return null;
      default:
        return null;
    }
  }
}

/** A simple in-memory sink (records catch-up requests + user-action requests). No execution. */
export class RecordingProgressiveSink implements ProgressiveReconnectSink {
  readonly catchUpRequests: SanitizedAccountRef[] = [];
  readonly userActions: Array<{ account: SanitizedAccountRef; action: UserActionCategory }> = [];
  requestCatchUp(account: SanitizedAccountRef): void {
    this.catchUpRequests.push(account);
  }
  emitUserAction(account: SanitizedAccountRef, action: UserActionCategory): void {
    this.userActions.push({ account, action });
  }
}
