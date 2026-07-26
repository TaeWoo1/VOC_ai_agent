/**
 * **Session-readiness probe + projector — OBSERVE-ONLY, FE-free.**
 *
 * The Agent runs pull-first: about once a day, and before it does any channel work, it needs to know whether a
 * channel's marketplace session is usable — and, when it is not, to offer the seller EXACTLY ONE action. This
 * module is the collector's half of the channel-neutral `session-readiness` contract:
 *
 *  - `naverVerdictToReadiness` maps the collector's existing NAVER `SessionVerdict` (built by the pure
 *    `session-verdict` classifier from sanitized page signals) into the neutral `SessionReadinessState`. It is
 *    the ONLY channel-specific piece here; the contract and the projector are channel-neutral.
 *
 *  - `SessionReadinessProbe` classifies sanitized signals and PROJECTS the resulting readiness through a
 *    `JourneyProjectionPort` — the same observe-only port the journey shadow already rides. It reads a probe's
 *    already-derived booleans; it never opens a browser, clicks, types, submits, or auto-logs-in, and it does
 *    not solve a 2FA/CAPTCHA. A channel it did not observe projects `UNOBSERVED_EXTERNAL`, never a guessed
 *    `READY`.
 *
 *  - `SessionReadinessProjector` is a headless `JourneyProjectionPort`: it records the latest readiness per
 *    channel off the shared stream (ignoring every non-readiness signal) and answers "what is this channel's
 *    readiness, and the one action to offer?" with no React and no mounted component. The existing
 *    `JourneyShadow`, fed the same readiness observation, drops it (see `journey-projection`), so the journey
 *    stays at divergence 0.
 *
 * Sanitized throughout: the only things that cross are a channel-code enum, readiness/reason/action enums, and
 * an OPTIONAL opaque per-account slot (never a real seller/account id, email, or PII) — never a token, cookie,
 * URL, or page text. This module imports no FE, no React, no browser, and no network; a source guard pins that.
 *
 * ## Not yet driven by the live agent loop (deliberate boundary)
 *
 * This slice provides the classify-and-project SEAM and its four probe reasons; it does NOT yet call the probe
 * from the live agent runtime at those four moments (`local-agent` invokes nothing here). Wiring the invocation
 * runs against a real marketplace session, so it is a separately-approved follow-up — the reasons are the
 * vocabulary that wiring will use, not a claim that it is already connected. `probeNaver` reads the same
 * sanitized `SessionVerdictInput` the live session probe already derives, so the seam is real, not a toy.
 */
import { log } from "../../log";
import { classifySessionVerdict, type SessionVerdict, type SessionVerdictInput } from "../../naver/session-verdict";
import {
  readinessObservation,
  singleActionForReadiness,
  unobservedReadiness,
  type ReadinessAction,
  type ReadinessProbeReason,
  type SessionReadinessObservation,
  type SessionReadinessState,
} from "../../../../contracts/session-readiness/v1/index";
import type { JourneyObservation } from "./journey-projection";
import type { JourneyProjectionPort } from "./journey-ports";

/** The channel this collector build drives. Kept explicit so the neutral projector is never NAVER-shaped. */
export const NAVER_CHANNEL_CODE = "naver";

/**
 * Map a NAVER `SessionVerdict` to the neutral readiness state. Pure and total.
 *
 * The verdict taxonomy already draws the exact distinctions readiness needs, so this is a faithful rename, not
 * a re-decision:
 *
 *   LOGGED_IN               → READY                (session usable; the Agent may work)
 *   ACCOUNT_LOGIN_REQUIRED  → LOGIN_REQUIRED       (a real NAVER account login form)
 *   AUTH_CHALLENGE_REQUIRED → TWO_FACTOR_REQUIRED  (2FA / OTP / CAPTCHA — a human clears it)
 *   RECONNECT_REQUIRED      → ACCOUNT_AMBIGUOUS    (Commerce reconnect / account-store selection)
 *   UNKNOWN                 → EXPIRED              (not confirmed usable — treat as needing a fresh login)
 *
 * `UNKNOWN → EXPIRED` matches the existing halt mapping (`session-halt`: UNKNOWN → SESSION_EXPIRED): an
 * ambiguous, unconfirmed session fails closed toward asking the seller, never toward proceeding.
 */
export function naverVerdictToReadiness(verdict: SessionVerdict): SessionReadinessState {
  switch (verdict) {
    case "LOGGED_IN":
      return "READY";
    case "ACCOUNT_LOGIN_REQUIRED":
      return "LOGIN_REQUIRED";
    case "AUTH_CHALLENGE_REQUIRED":
      return "TWO_FACTOR_REQUIRED";
    case "RECONNECT_REQUIRED":
      return "ACCOUNT_AMBIGUOUS";
    case "UNKNOWN":
      return "EXPIRED";
    default: {
      // Exhaustiveness: a new verdict that isn't mapped is a compile error. An unknown value (only reachable
      // via an `any`-typed caller) fails closed to EXPIRED — never to READY.
      const _exhaustive: never = verdict;
      void _exhaustive;
      return "EXPIRED";
    }
  }
}

/**
 * Classifies sanitized session signals into a readiness state and projects it through an observe-only port.
 * It drives nothing: it reads booleans a probe already derived, and never touches a live page.
 */
export class SessionReadinessProbe {
  /**
   * @param accountKey an OPTIONAL sanitized, opaque per-account slot. Supply it when one channel carries more
   *   than one account (two NAVER stores) so their readiness never collapses into one; omit it for the
   *   single-account case. It must NOT be a real seller/account id, an email, or any PII.
   */
  constructor(
    private readonly port: JourneyProjectionPort,
    private readonly channelCode: string = NAVER_CHANNEL_CODE,
    private readonly accountKey?: string,
  ) {}

  /**
   * Observe one NAVER session reading: classify the sanitized signals, map to readiness, project it, and
   * return the state. OBSERVE-ONLY — no click, type, submit, navigation, or 2FA/CAPTCHA handling.
   */
  probeNaver(signals: SessionVerdictInput, reason: ReadinessProbeReason): SessionReadinessState {
    const state = naverVerdictToReadiness(classifySessionVerdict(signals));
    this.project(state, reason);
    return state;
  }

  /**
   * Record a channel the Agent did NOT observe: projects `UNOBSERVED_EXTERNAL`, never inferred as ready. Used
   * when a probe moment passes with no reading for a channel (fail closed, ask the seller if work needs it).
   */
  probeUnobserved(reason: ReadinessProbeReason): void {
    this.project("UNOBSERVED_EXTERNAL", reason);
  }

  /**
   * Project an already-derived readiness state (not raw signals) under a given probe reason.
   *
   * Used when another part of the runtime has ALREADY classified a coarse, sanitized session reading and the
   * caller only needs to record the resulting state — notably the import run's `prepareSurface` result, which
   * the live NAVER driver derives from the same session-verdict machinery `probeNaver` would run. It is the
   * same sanitized projection + log as {@link probeNaver}; it just skips a re-classification that would only
   * repeat work already done. Still OBSERVE-ONLY: it records a reading, it never drives a page.
   */
  observeState(state: SessionReadinessState, reason: ReadinessProbeReason): void {
    this.project(state, reason);
  }

  private project(state: SessionReadinessState, reason: ReadinessProbeReason): void {
    // Sanitized: a channel-code enum and three enums. The account slot is deliberately NOT logged (even though
    // it is opaque) to keep the log surface minimal; the log keys also avoid the logger's forbidden substrings,
    // so nothing here is dropped or leaked.
    log("readiness_probe", { channelCode: this.channelCode, readiness: state, reason });
    void this.port.observe(
      this.accountKey === undefined
        ? { kind: "session_readiness", channelCode: this.channelCode, state, reason }
        : { kind: "session_readiness", channelCode: this.channelCode, accountKey: this.accountKey, state, reason },
    );
  }
}

/**
 * A headless `JourneyProjectionPort` that records the latest readiness per channel. It ignores every signal
 * that is not a readiness reading, so it can sit on the same observe-only stream as the journey shadow. No FE,
 * no mounted component — the readiness is available to a headless caller through the same port pattern.
 */
export class SessionReadinessProjector implements JourneyProjectionPort {
  private readonly latest = new Map<string, SessionReadinessObservation>();

  /**
   * The map key is (channel, account slot), so two accounts on the SAME channel never collapse into one
   * readiness. A NUL joins them — it cannot occur inside a channel code or an opaque slot — and an absent slot
   * is the single-account channel's own key.
   */
  private static key(channelCode: string, accountKey?: string): string {
    return `${channelCode}\u0000${accountKey ?? ""}`;
  }

  observe(obs: JourneyObservation): void {
    if (obs.kind !== "session_readiness") return;
    this.latest.set(
      SessionReadinessProjector.key(obs.channelCode, obs.accountKey),
      readinessObservation(obs.channelCode, obs.state, obs.reason, obs.accountKey),
    );
  }

  /**
   * The latest readiness for a channel (and account slot), or a first-class `UNOBSERVED_EXTERNAL` when none was
   * observed. The default is a "not seen", never a guessed READY.
   */
  current(
    channelCode: string,
    accountKey?: string,
    reason: ReadinessProbeReason = "AGENT_START",
  ): SessionReadinessObservation {
    return (
      this.latest.get(SessionReadinessProjector.key(channelCode, accountKey)) ??
      unobservedReadiness(channelCode, reason, accountKey)
    );
  }

  /** The single action to offer the seller for a channel/account right now — the "exactly one thing" guarantee. */
  singleAction(channelCode: string, accountKey?: string): ReadinessAction {
    return singleActionForReadiness(this.current(channelCode, accountKey).state);
  }

  /** Every (channel, account) observed so far, as sanitized observations. Order is insertion order. */
  snapshot(): readonly SessionReadinessObservation[] {
    return [...this.latest.values()];
  }
}
