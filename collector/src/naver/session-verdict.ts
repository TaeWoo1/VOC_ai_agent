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
 *   2. password field present  → ACCOUNT_LOGIN_REQUIRED   (a real NAVER login form)
 *   3. seller-center URL + a STRONG seller-center signal (menu/GNB | logout | export
 *      controls) → LOGGED_IN. An ambient login / account / reconnect *affordance* does
 *      NOT suppress this — only a real password field does (caught earlier by rule 2),
 *      because NAVER/Commerce seller-center pages can embed ambient login widgets while
 *      the session is perfectly usable.
 *   4. account-chooser / Commerce reconnect / store-selection affordance present →
 *      RECONNECT_REQUIRED (a human click / Commerce login is needed — NOT a broken
 *      profile, NOT a true expiry).
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
 * doc for the precedence; rules 2/1 are caught by the early returns, so by rule 3
 * `passwordFieldPresent`/`authChallengePresent` are already known false.
 */
export function classifySessionVerdict(s: SessionVerdictInput): SessionVerdict {
  if (s.authChallengePresent) return "AUTH_CHALLENGE_REQUIRED";
  if (s.passwordFieldPresent) return "ACCOUNT_LOGIN_REQUIRED";

  const strongSellerCenter =
    s.menuOrGnbPresent || s.logoutAffordancePresent || s.exportCandidatesPresent;
  if (s.isSellerCenterUrl && strongSellerCenter) return "LOGGED_IN";

  if (s.accountReconnectAffordancePresent) return "RECONNECT_REQUIRED";
  return "UNKNOWN";
}
