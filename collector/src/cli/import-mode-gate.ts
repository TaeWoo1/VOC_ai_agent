/**
 * **Pure gate for the approval-only import CLI mode.** No I/O, no Playwright, so the decision that opens a
 * live browser is unit-testable offline — which is the point: the gate must be provably closed by default,
 * and "we tested it by running it" is not available for a gate whose failure mode is launching Chrome.
 *
 * ## What this gate is protecting
 *
 * The import mode launches a real browser at startup (product-owner decision, 2026-07-25) because a seated
 * operator has to log into NAVER in it before any run can happen. That makes the mode fundamentally
 * different from every other Local Agent path, so it needs a gate that is:
 *
 *  - **doubly explicit** — the import flag alone is not enough; the same
 *    `--i-understand-this-opens-live-naver` approval every other live CLI requires must be present too. One
 *    flag could be left in a shell history or a script; two, one of which names the consequence, cannot be
 *    passed by accident.
 *  - **impossible on the normal and scheduled paths** — production refuses outright, and so does any
 *    non-interactive/scheduled invocation. A scheduled live browser would be exactly the standing
 *    authorization the per-run approval rule exists to forbid.
 *  - **exclusive** — carrying more than one carrier flag is REFUSED rather than resolved by precedence. An
 *    agent hosts one carrier, and silently picking a winner is how an operator ends up in a mode they did
 *    not intend while believing they are in another.
 */

/** The mode flag. Named for what it does, so it reads correctly in a shell history. */
export const ACTION_WINDOW_IMPORT_FLAG = "--action-window-initial-review-import";

/** The live approval flag every live-NAVER CLI in this package already requires. */
export const IMPORT_LIVE_APPROVAL_FLAG = "--i-understand-this-opens-live-naver";

/**
 * Flags that select a DIFFERENT carrier. Present alongside the import flag ⇒ refuse.
 *
 * Every carrier flag the agent knows, not just the three that existed when this gate was written: the
 * Self-Pilot Runtime v1 audit found the four later carriers missing, so an import command line that also
 * named `--action-window-coupang-issuance-live` passed this gate and the live walk was dropped without a
 * word — the exact silent-winner failure the gate's own docblock forbids.
 */
export const OTHER_CARRIER_FLAGS: readonly string[] = [
  "--dev-action-window-reply",
  "--dev-action-window-synthetic",
  "--dev-action-window-naver-fixture",
  "--dev-action-window-issuance",
  "--dev-action-window-coupang-issuance",
  "--dev-action-window-review-locate",
  "--action-window-coupang-issuance-live",
];

/**
 * Env markers that mean "nobody is sitting here". A live browser needs a seated human — they log in, they
 * click every marketplace control — so an unattended invocation must not reach one.
 */
export const NON_INTERACTIVE_ENV_KEYS: readonly string[] = ["CI", "SELLEROPS_SCHEDULED", "SELLEROPS_HEADLESS_AGENT"];

export type ImportModeDecision =
  | { host: true }
  | { host: false; reason: ImportModeRefusal };

export type ImportModeRefusal =
  /** The mode was not asked for at all — the ordinary case, and not an error. */
  | "NOT_REQUESTED"
  /** The mode flag is present but the live approval is not. */
  | "APPROVAL_MISSING"
  /** Refused because this is a production build. */
  | "PRODUCTION"
  /** Refused because nothing indicates a seated operator. */
  | "NON_INTERACTIVE"
  /** Refused because another carrier was also selected. */
  | "CARRIER_CONFLICT";

/**
 * Decide whether this invocation may host the import carrier — and therefore launch a browser.
 *
 * Fails closed on every axis. Note the order: the conflict and environment checks run even when the
 * approval is missing, so an operator adding the approval flag to a conflicting command line gets the real
 * reason rather than being led one flag at a time toward a mode they cannot have.
 */
export function resolveImportMode(args: readonly string[], env: NodeJS.ProcessEnv): ImportModeDecision {
  if (!args.includes(ACTION_WINDOW_IMPORT_FLAG)) return { host: false, reason: "NOT_REQUESTED" };
  if (env.NODE_ENV === "production") return { host: false, reason: "PRODUCTION" };
  for (const key of NON_INTERACTIVE_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== "" && value !== "0" && value !== "false") {
      return { host: false, reason: "NON_INTERACTIVE" };
    }
  }
  if (OTHER_CARRIER_FLAGS.some((flag) => args.includes(flag))) {
    return { host: false, reason: "CARRIER_CONFLICT" };
  }
  if (!args.includes(IMPORT_LIVE_APPROVAL_FLAG)) return { host: false, reason: "APPROVAL_MISSING" };
  return { host: true };
}

/**
 * Operator-facing explanation for a refusal. Returned for every reason except `NOT_REQUESTED`, which is the
 * ordinary case and should print nothing — an agent starting normally is not a failure to announce.
 */
export function importModeRefusalMessage(reason: ImportModeRefusal): string | null {
  switch (reason) {
    case "NOT_REQUESTED":
      return null;
    case "APPROVAL_MISSING":
      return `${ACTION_WINDOW_IMPORT_FLAG} opens a LIVE NAVER browser at startup. Add ${IMPORT_LIVE_APPROVAL_FLAG} to confirm you intend that, and only with a fresh per-run approval naming channel / account / date / operator.`;
    case "PRODUCTION":
      return `${ACTION_WINDOW_IMPORT_FLAG} is refused in production. A live browser requires a seated operator and a per-run approval; a production agent has neither.`;
    case "NON_INTERACTIVE":
      return `${ACTION_WINDOW_IMPORT_FLAG} is refused on a scheduled or non-interactive host. A scheduled live browser would be a standing authorization, which the per-run approval rule forbids.`;
    case "CARRIER_CONFLICT":
      return `${ACTION_WINDOW_IMPORT_FLAG} cannot be combined with another Action Window carrier flag. An agent hosts exactly one carrier; pass only the one you mean.`;
  }
}
