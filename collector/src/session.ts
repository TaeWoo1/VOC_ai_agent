import type { SessionState } from "./status";

export interface SessionSignals {
  url: string;
  /** URL is a NAVER login domain / login path — a decisive logged-out signal. */
  isLoginUrl: boolean;
  /** URL is a seller-center / commerce surface — where a logged-in shell is expected. */
  isSellerCenterUrl: boolean;
  /** A 2FA / CAPTCHA / OTP challenge is present — decisive AUTH_CHALLENGE. */
  hasAuthChallenge: boolean;
  /** A dedicated login form (password field / NAVER login form) is present. */
  hasLoginForm: boolean;
  /** STRONG logged-in signal: a logout affordance. */
  hasLogoutAffordance: boolean;
  /** STRONG logged-in signal: a seller/admin global-nav element. */
  hasAdminGnb: boolean;
  /** STRONG logged-in signal: an authenticated seller-center shell attribute. */
  hasSellerShell: boolean;
}

/**
 * Pure decision: given page signals, is the seller-center session usable?
 *
 * Precedence (the live milestone-1 probe showed a fully-authenticated admin page
 * was being misread as LOGGED_OUT because an ambient login widget tripped the old
 * login-form-first rule):
 *   1. An auth challenge always wins — a human must act.
 *   2. A genuine NAVER login URL is decisive LOGGED_OUT, regardless of branding.
 *   3. On a seller-center URL, a STRONG logged-in signal (logout affordance,
 *      seller/admin GNB, or an authenticated shell attribute) outranks ambient
 *      login-widget tokens that NAVER embeds even when logged in → LOGGED_IN.
 *   4. A dedicated login form with no strong logged-in signal → LOGGED_OUT.
 *   5. Fail-safe: branding-only pages and unknown shells → LOGGED_OUT. The
 *      collector must NEVER proceed to export on an ambiguous session.
 *
 * Branding text alone (스마트스토어센터 / 판매자센터) is intentionally NOT a strong
 * signal — login and landing pages carry it too.
 */
export function detectSession(s: SessionSignals): SessionState {
  if (s.hasAuthChallenge) return "AUTH_CHALLENGE";
  if (s.isLoginUrl) return "LOGGED_OUT";

  const strongLoggedIn = s.hasLogoutAffordance || s.hasAdminGnb || s.hasSellerShell;
  if (s.isSellerCenterUrl && strongLoggedIn) return "LOGGED_IN";

  if (s.hasLoginForm) return "LOGGED_OUT";
  return "LOGGED_OUT";
}

// NOTE: synthetic markers, confirmed structurally by the live milestone-1 probe
// (a logged-in admin page showed a logout affordance + seller GNB on a
// seller-center URL, while also embedding an ambient login widget). No real NAVER
// DOM, account, store, or PII is encoded here.
const LOGIN_URL_RE = /nid\.naver|nidlogin|\/login(?:[/?#]|$)/i;
const SELLER_CENTER_URL_RE = /sell\.smartstore|sell\.naver|commerce/i;
const AUTH_CHALLENGE_MARKERS = [/captcha/i, /recaptcha/i, /\botp\b/i, /인증번호/, /2단계/, /two[-\s]?factor/i];
// A dedicated login form (not mere branding) — password field or NAVER login form.
const LOGIN_FORM_MARKERS = [/type=["']password["']/i, /name=["']pw["']/i, /id=["']nidlogin["']/i];
// STRONG logged-in signals.
const LOGOUT_MARKERS = [/로그아웃/, /\blogout\b/i];
const ADMIN_GNB_MARKERS = [
  /id=["'][^"']*(?:seller|admin)[-_]?gnb[^"']*["']/i,
  /class=["'][^"']*(?:seller|admin)[-_]?gnb[^"']*["']/i,
];
const SELLER_SHELL_MARKERS = [/data-seller-authenticated/i];

/**
 * Extract signals from a page's HTML + URL without a browser, so the detector can
 * be exercised against saved fixtures in tests. The live layer populates the same
 * `SessionSignals` shape from a Playwright page instead.
 */
export function signalsFromHtml(html: string, url: string): SessionSignals {
  const anyMatch = (markers: RegExp[]) => markers.some((re) => re.test(html));
  return {
    url,
    isLoginUrl: LOGIN_URL_RE.test(url),
    isSellerCenterUrl: SELLER_CENTER_URL_RE.test(url),
    hasAuthChallenge: anyMatch(AUTH_CHALLENGE_MARKERS),
    hasLoginForm: anyMatch(LOGIN_FORM_MARKERS),
    hasLogoutAffordance: anyMatch(LOGOUT_MARKERS),
    hasAdminGnb: anyMatch(ADMIN_GNB_MARKERS),
    hasSellerShell: anyMatch(SELLER_SHELL_MARKERS),
  };
}
