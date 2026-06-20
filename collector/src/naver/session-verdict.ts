/**
 * Pure session-verdict classifier (offline, sanitized, zero-import leaf).
 *
 * Maps a small set of coarse, already-sanitized session signals to ONE of five
 * verdicts. It never sees raw HTML / URLs / PII — only booleans derived upstream —
 * so it cannot leak. It distinguishes the cases the old LOGGED_IN / LOGGED_OUT split
 * collapsed (and which `decideState` flattened to a single `SESSION_EXPIRED`): a full
 * NAVER account-login page, a Commerce / account-selection reconnect interstitial, an
 * auth challenge, a usable seller-center session, and the ambiguous remainder.
 *
 * Precedence (operator-specified; RELAXED `LOGGED_IN`):
 *   1. auth challenge          → AUTH_CHALLENGE_REQUIRED  (a human must clear it first)
 *   2. password field present AND NO reconnect affordance → ACCOUNT_LOGIN_REQUIRED
 *      (a real NAVER login form with nothing to continue into). The reconnect guard
 *      matters because the live Commerce reconnect screen (Run-1 finding) shows a
 *      currently-logged-in account-CONTINUATION card ABOVE an alternate login form:
 *      that alternate form sets `passwordFieldPresent`, but the human can continue
 *      WITHOUT re-login, so a bare password rule wrongly masked the reconnect. When
 *      both are present the verdict falls through to rule 3/4 (reconnect wins over the
 *      alternate form, but a genuinely strong seller-center session still wins first).
 *   3. seller-center URL + a STRONG seller-center signal (menu/GNB | logout | export
 *      controls) → LOGGED_IN. An ambient login / account / reconnect *affordance* does
 *      NOT suppress this, because NAVER/Commerce seller-center pages can embed ambient
 *      login/account widgets while the session is perfectly usable.
 *   4. account-chooser / Commerce reconnect / store-selection / account-continuation
 *      affordance present → RECONNECT_REQUIRED (a human click / Commerce login is needed
 *      — NOT a broken profile, NOT a true expiry).
 *   5. otherwise                → UNKNOWN  (ambiguous — never proceed to export).
 *
 * DELIBERATELY NOT AN INPUT: a weak "logged-in shell" / branding signal (스마트스토어센터
 * / 판매자센터 / 커머스 text). That text appears even on the login page, so it can never
 * be sufficient for `LOGGED_IN`; the probe keeps `candidateLoggedInShellPresent` as a
 * DEBUG-ONLY field and this classifier ignores it. `loginAffordancePresent` is likewise
 * not consumed here — a login *link* must not suppress a strong seller-center session.
 */

export type SessionVerdict =
  | "LOGGED_IN"
  | "RECONNECT_REQUIRED"
  | "ACCOUNT_LOGIN_REQUIRED"
  | "AUTH_CHALLENGE_REQUIRED"
  | "UNKNOWN";

/**
 * Coarse inputs for the verdict. Every field is a boolean derived from sanitized probe
 * signals — no raw text, no URL, no PII. `isSellerCenterUrl` is `urlCategory ===
 * "seller-center"`; `exportCandidatesPresent` is `exportCandidateCount !== "none"`.
 */
export interface SessionVerdictInput {
  /** URL resolved to the seller-center / commerce surface category. */
  isSellerCenterUrl: boolean;
  /** A real NAVER account-login password field is present. */
  passwordFieldPresent: boolean;
  /** A CAPTCHA / 2FA / OTP challenge is present. */
  authChallengePresent: boolean;
  /** STRONG: a seller/admin menu or global-nav element. */
  menuOrGnbPresent: boolean;
  /** STRONG: a logout affordance. */
  logoutAffordancePresent: boolean;
  /** STRONG: at least one export control is present. */
  exportCandidatesPresent: boolean;
  /** Account chooser / Commerce reconnect / store-selection affordance. */
  accountReconnectAffordancePresent: boolean;
}

/**
 * Classify a session from coarse signals. Pure and deterministic. See the module
 * doc for the precedence. The password rule is GUARDED by the reconnect affordance:
 * a password field forces ACCOUNT_LOGIN_REQUIRED only when there is no account-
 * continuation / reconnect affordance — otherwise the alternate login form on a
 * Commerce reconnect screen would mask the reconnect (Run-1 finding). When both are
 * present the verdict falls through, so a strong seller-center session (rule 3) still
 * wins, and otherwise the reconnect affordance (rule 4) does.
 */
export function classifySessionVerdict(s: SessionVerdictInput): SessionVerdict {
  if (s.authChallengePresent) return "AUTH_CHALLENGE_REQUIRED";
  if (s.passwordFieldPresent && !s.accountReconnectAffordancePresent) return "ACCOUNT_LOGIN_REQUIRED";

  const strongSellerCenter =
    s.menuOrGnbPresent || s.logoutAffordancePresent || s.exportCandidatesPresent;
  if (s.isSellerCenterUrl && strongSellerCenter) return "LOGGED_IN";

  if (s.accountReconnectAffordancePresent) return "RECONNECT_REQUIRED";
  return "UNKNOWN";
}
