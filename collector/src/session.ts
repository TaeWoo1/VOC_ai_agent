import type { SessionState } from "./status";

export interface SessionSignals {
  url: string;
  hasLoggedInMarker: boolean;
  hasLoginForm: boolean;
  hasAuthChallenge: boolean;
}

/**
 * Pure decision: given page signals, is the seller-center session usable?
 * Fail-safe by design — an auth challenge or any login indicator (or simple
 * uncertainty) resolves to a stop-and-ask state. The collector must NEVER proceed
 * to export on an ambiguous session.
 */
export function detectSession(s: SessionSignals): SessionState {
  if (s.hasAuthChallenge) return "AUTH_CHALLENGE";
  if (s.hasLoginForm || /\/login|nidlogin|nid\.naver|\bauth\b/i.test(s.url)) return "LOGGED_OUT";
  if (s.hasLoggedInMarker) return "LOGGED_IN";
  return "LOGGED_OUT";
}

// NOTE: these markers are PLACEHOLDERS to be confirmed during the live milestone 1
// run against a real seller-center session. The pure detector + HTML fixtures
// prove the decision logic here; the real selectors are an explicit live-discovery
// output, not something to guess offline.
const AUTH_CHALLENGE_MARKERS = [/captcha/i, /recaptcha/i, /\botp\b/i, /인증번호/, /2단계/, /two[-\s]?factor/i];
const LOGIN_FORM_MARKERS = [/type=["']password["']/i, /name=["']pw["']/i, /nidlogin/i];
const LOGGED_IN_MARKERS = [/data-seller-authenticated/i, /id=["']seller-gnb["']/i, /판매자센터/];

/**
 * Extract signals from a page's HTML + URL without a browser, so the detector can
 * be exercised against saved fixtures in tests. The live layer will populate the
 * same `SessionSignals` shape from a Playwright page instead.
 */
export function signalsFromHtml(html: string, url: string): SessionSignals {
  const anyMatch = (markers: RegExp[]) => markers.some((re) => re.test(html));
  return {
    url,
    hasAuthChallenge: anyMatch(AUTH_CHALLENGE_MARKERS),
    hasLoginForm: anyMatch(LOGIN_FORM_MARKERS),
    hasLoggedInMarker: anyMatch(LOGGED_IN_MARKERS),
  };
}
