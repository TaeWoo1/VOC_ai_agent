/**
 * **Session readiness — the channel-neutral "is this channel's session usable right now?" contract (v1).**
 *
 * SellerOps runs pull-first: the seller checks in about once a day, and the Agent needs to know, per channel,
 * whether the marketplace session is alive before it tries to do any work — and, when it is not, to ask the
 * seller for EXACTLY ONE thing (log in, clear a 2FA/CAPTCHA challenge, pick the right account) rather than a
 * troubleshooting list. That single-decision is the whole point of this contract.
 *
 * ## What it is (and is not)
 *
 * It is a PURE state contract, like `../../review-import-journey/v1`: no I/O, no logging, no browser, no clock,
 * type-checked under `contracts/tsconfig.json` (no DOM, no Node). It carries only sanitized enums — a channel
 * code, a readiness state, why the probe ran, and the one action to offer. It NEVER carries a token, cookie,
 * seller id, account id, URL, or any page text; a probe derives the state from those upstream and drops them
 * before anything reaches here.
 *
 * It decides nothing the runtime obeys and it holds no identity beyond the marketplace channel code (the same
 * sanitized enum that already crosses the Action Window command port). The per-channel classification of raw
 * signals into a state lives in each channel's own OBSERVE-ONLY probe (e.g. the collector's NAVER probe maps
 * its `SessionVerdict`); this contract is the neutral vocabulary they all project into.
 *
 * ## Fail closed, never infer
 *
 * A channel the Agent has not actually observed is `UNOBSERVED_EXTERNAL` — the same discipline the journey
 * kernel uses for the unobserved upper journey. It is NOT "probably ready"; it is "not seen", and it offers no
 * action. Everything ambiguous or unconfirmed resolves toward asking the seller, never toward proceeding.
 */

/**
 * Per-channel session readiness. Exactly one of these holds for a channel at a time.
 *
 * - `READY` — the channel session is usable; the Agent may work, no seller action needed.
 * - `LOGIN_REQUIRED` — a real marketplace login is required (the session is logged out / absent).
 * - `TWO_FACTOR_REQUIRED` — an auth challenge (2FA / OTP / CAPTCHA) is in front of the session; a human must
 *   clear it. SellerOps never solves or bypasses it (CLAUDE.md safety fence).
 * - `ACCOUNT_AMBIGUOUS` — the session is present but which account/store is unresolved (an account chooser or
 *   reconnect interstitial); the seller must pick, and the Agent must never click through it.
 * - `EXPIRED` — the session is NOT confirmed usable and nothing more specific was read (a lapsed session, or an
 *   observed-but-ambiguous page); the fail-closed bucket that resolves to "log in again". It does NOT assert
 *   the session was ever established — only that the Agent may not proceed on it. Distinct from
 *   `UNOBSERVED_EXTERNAL`, which is "not observed at all".
 * - `UNOBSERVED_EXTERNAL` — the Agent has not observed this channel's session at all. NOT inferred as ready.
 */
export type SessionReadinessState =
  | "READY"
  | "LOGIN_REQUIRED"
  | "TWO_FACTOR_REQUIRED"
  | "ACCOUNT_AMBIGUOUS"
  | "EXPIRED"
  | "UNOBSERVED_EXTERNAL";

/**
 * Why a readiness probe ran. Probes are OBSERVE-ONLY at each of these moments — never a background poll that
 * could look like SellerOps "keeping a session warm" on its own.
 *
 * - `AGENT_START` — the Agent came up (the ~once-a-day check-in).
 * - `BEFORE_WORK` — immediately before attempting a unit of channel work.
 * - `SESSION_FAILURE` — a unit of work failed in a way that implicates the session.
 * - `MANUAL_RECHECK` — the seller asked to re-check after they say they fixed it.
 */
export type ReadinessProbeReason = "AGENT_START" | "BEFORE_WORK" | "SESSION_FAILURE" | "MANUAL_RECHECK";

/**
 * The single action to offer the seller for a state — the "exactly one thing" guarantee. It is advisory copy
 * intent, not a command the runtime executes: SellerOps never performs any of these itself.
 *
 * - `NONE` — nothing to ask (READY, or an unobserved channel we will not speak for).
 * - `LOG_IN` — the seller logs in on the marketplace (covers LOGIN_REQUIRED and EXPIRED).
 * - `COMPLETE_AUTH_CHALLENGE` — the seller clears the 2FA/OTP/CAPTCHA themselves.
 * - `SELECT_ACCOUNT` — the seller picks/reconnects the correct account or store.
 */
export type ReadinessAction = "NONE" | "LOG_IN" | "COMPLETE_AUTH_CHALLENGE" | "SELECT_ACCOUNT";

/**
 * A sanitized readiness record — a channel code plus enums only. This is the whole shape that crosses a
 * projection port; there is deliberately nowhere in it to put a token, cookie, id, URL, or page text.
 */
export interface SessionReadinessObservation {
  /** The marketplace channel code (a sanitized enum, e.g. "naver"); never a seller or account id. */
  readonly channelCode: string;
  /**
   * An OPTIONAL sanitized, opaque per-account slot that distinguishes two accounts on the SAME channel (e.g.
   * two NAVER stores), so their readiness is never silently collapsed. It is a caller-chosen slot label — NOT
   * the marketplace seller/account id, NOT an email, NOT PII. Omitted for the single-account case, where the
   * channel is the whole key.
   */
  readonly accountKey?: string;
  readonly state: SessionReadinessState;
  /** Why the probe ran that produced this state. */
  readonly reason: ReadinessProbeReason;
  /** The one action to offer for `state` — always the canonical mapping (`singleActionForReadiness`). */
  readonly action: ReadinessAction;
}

/** The one and only state from which the Agent may proceed to work without asking the seller for anything. */
export function isReadyToWork(state: SessionReadinessState): boolean {
  return state === "READY";
}

/**
 * The single seller action a state calls for — total and deterministic, so every non-ready state offers the
 * seller exactly one thing and never a menu. `EXPIRED` folds onto `LOG_IN` (a lapsed session is cleared by
 * logging in again); `UNOBSERVED_EXTERNAL` offers nothing because the Agent has no observation to act on.
 */
export function singleActionForReadiness(state: SessionReadinessState): ReadinessAction {
  switch (state) {
    case "READY":
      return "NONE";
    case "LOGIN_REQUIRED":
    case "EXPIRED":
      return "LOG_IN";
    case "TWO_FACTOR_REQUIRED":
      return "COMPLETE_AUTH_CHALLENGE";
    case "ACCOUNT_AMBIGUOUS":
      return "SELECT_ACCOUNT";
    case "UNOBSERVED_EXTERNAL":
      return "NONE";
    default: {
      // Exhaustiveness: a new state that isn't mapped is a compile error, not a silent fall-through to NONE.
      const _exhaustive: never = state;
      void _exhaustive;
      return "NONE";
    }
  }
}

/**
 * Build a sanitized observation for a channel, attaching the canonical single action for the state. This is
 * the one constructor a probe uses, so the action can never drift from `singleActionForReadiness`.
 */
export function readinessObservation(
  channelCode: string,
  state: SessionReadinessState,
  reason: ReadinessProbeReason,
  accountKey?: string,
): SessionReadinessObservation {
  const base = { channelCode, state, reason, action: singleActionForReadiness(state) };
  // Only carry the slot when a caller actually distinguishes accounts, so the single-account observation stays
  // exactly channel + enums (no `accountKey: undefined` noise).
  return accountKey === undefined ? base : { ...base, accountKey };
}

/**
 * The readiness of a channel that has not been observed — a first-class "not seen", never a guessed READY.
 * Callers default to this for any channel they hold no observation for.
 */
export function unobservedReadiness(
  channelCode: string,
  reason: ReadinessProbeReason = "AGENT_START",
  accountKey?: string,
): SessionReadinessObservation {
  return readinessObservation(channelCode, "UNOBSERVED_EXTERNAL", reason, accountKey);
}
