import { urlCategory } from "./session-check";
import { classifySessionVerdict, type SessionVerdict } from "./session-verdict";

/**
 * Debug-safe session/SPA structural probe — PURE + SANITIZED.
 *
 * This module turns a raw page snapshot (URL + serialized HTML + a couple of
 * live DOM scalars) into a SMALL, FIXED set of booleans / bucketed counts /
 * category enums, plus a coarse five-state `sessionVerdict` (see
 * `session-verdict.ts`) that distinguishes a usable seller-center session from a
 * full account login, a Commerce/account-selection reconnect interstitial, and an
 * auth challenge. It emits all of this WITHOUT ever exposing page text, attribute
 * values, raw URLs, full HTML, or any PII. `candidateLoggedInShellPresent` is a
 * DEBUG-ONLY weak signal (structural shell attribute, no branding text) and is NOT
 * used to decide the verdict.
 *
 * SAFETY CONTRACT: every field of `SanitizedProbeSignals` is a boolean, a small
 * number, or one of a fixed category string. None of them is derived by copying
 * a substring of the input — they are all match/no-match booleans, lengths
 * bucketed to a category, or counts. So `JSON.stringify(extractProbeSignals(x))`
 * can never contain a store name, account, product, review text, id, token, or
 * URL from the input. This is asserted by an offline hostile-fixture test.
 */

export type UrlCategory = "login" | "seller-center" | "other";
export type ReadyStateCategory = "loading" | "interactive" | "complete" | "unknown";
export type HtmlLengthBucket = "empty" | "tiny" | "small" | "medium" | "large" | "huge";
export type ChildCountBucket = "unknown" | "none" | "few" | "some" | "many";
export type ExportCandidateBucket = "none" | "one" | "few" | "many";
export type HydrationWaitResult = "hydrated" | "timeout" | "not-attempted" | "error";

/** Raw, un-sanitized snapshot. The CLI fills this from a live page; tests pass it directly. */
export interface RawProbeInput {
  /** Raw URL — used ONLY to derive a coarse category; never echoed back. */
  url: string;
  /** Serialized DOM HTML — scanned for marker presence/counts; never echoed back. */
  html: string;
  /** `document.readyState` from the live page (omit offline). */
  readyState?: string;
  /** `childElementCount` of the SPA root from the live DOM; omit when no root / offline. */
  appRootChildCount?: number;
  /** Outcome of the post-navigation hydration wait in the live CLI. */
  hydrationWaitResult?: HydrationWaitResult;
}

/** The ONLY shape ever printed/logged by the probe. All fields are non-sensitive. */
export interface SanitizedProbeSignals {
  urlCategory: UrlCategory;
  documentReadyState: ReadyStateCategory;
  htmlLengthBucket: HtmlLengthBucket;
  scriptCount: number;
  appRootPresent: boolean;
  appRootChildCount: ChildCountBucket;
  passwordFieldPresent: boolean;
  captchaOrAuthChallengePresent: boolean;
  loginAffordancePresent: boolean;
  /**
   * DEBUG-ONLY / WEAK. Structural seller-center shell attributes only
   * (`data-seller-authenticated` / `id="seller-gnb"`). It is NOT branding text and is
   * NOT an input to `sessionVerdict` — branding (판매자센터 / 스마트스토어 / 커머스) shows
   * up even on the login page, so a shell signal can never imply logged-in on its own.
   */
  candidateLoggedInShellPresent: boolean;
  candidateMenuOrGnbPresent: boolean;
  candidateLogoutAffordancePresent: boolean;
  /** Account chooser / Commerce reconnect / store-selection affordance (PLACEHOLDER markers). */
  accountReconnectAffordancePresent: boolean;
  reviewRouteLike: boolean;
  exportCandidateCount: ExportCandidateBucket;
  hydrationWaitResult: HydrationWaitResult;
  /** Coarse five-state session judgment (see `session-verdict.ts`). */
  sessionVerdict: SessionVerdict;
}

/** Exact set of keys the probe may emit — used by the offline allow-list test. */
export const SANITIZED_PROBE_KEYS: ReadonlyArray<keyof SanitizedProbeSignals> = [
  "urlCategory",
  "documentReadyState",
  "htmlLengthBucket",
  "scriptCount",
  "appRootPresent",
  "appRootChildCount",
  "passwordFieldPresent",
  "captchaOrAuthChallengePresent",
  "loginAffordancePresent",
  "candidateLoggedInShellPresent",
  "candidateMenuOrGnbPresent",
  "candidateLogoutAffordancePresent",
  "accountReconnectAffordancePresent",
  "reviewRouteLike",
  "exportCandidateCount",
  "hydrationWaitResult",
  "sessionVerdict",
];

// Candidate markers — PLACEHOLDERS confirmed/corrected via this probe. They drive
// only booleans/counts; the matched text is never returned.
const PASSWORD_MARKERS = [/type=["']password["']/i, /name=["']pw["']/i];
const AUTH_CHALLENGE_MARKERS = [/captcha/i, /recaptcha/i, /\botp\b/i, /인증번호/, /2단계/, /two[-\s]?factor/i];
const LOGIN_AFFORDANCE_MARKERS = [/nidlogin/i, /\blogin\b/i, /로그인/, /type=["']password["']/i];
// DEBUG-ONLY / WEAK: structural shell ATTRIBUTES only. Branding text
// (판매자센터 / 스마트스토어 센터 / 커머스) is intentionally excluded — it appears on the
// login page too, so it must not count as logged-in evidence. Not an input to the verdict.
const LOGGED_IN_SHELL_MARKERS = [/data-seller-authenticated/i, /id=["']seller-gnb["']/i];
const MENU_GNB_MARKERS = [/\b[lg]nb\b/i, /id=["'][^"']*(gnb|lnb|nav|sidebar|aside)[^"']*["']/i, /<nav\b/i];
const LOGOUT_MARKERS = [/로그아웃/, /\blogout\b/i];
// Account chooser / Commerce reconnect / store-selection interstitial. PLACEHOLDER markers —
// deliberately specific phrases (not bare 계정/account/스토어/커머스, which appear elsewhere),
// to be confirmed/corrected from a later sanitized live probe of the real interstitial.
const ACCOUNT_RECONNECT_MARKERS = [
  /다른\s*계정/,
  /계정\s*선택/,
  /이\s*계정으로\s*계속/,
  /스토어\s*선택/,
  /판매자\s*선택/,
  /커머스\s*(아이디|id)\s*로그인/i,
  /account[-\s]?(chooser|select(or|ion)?|picker)/i,
  /reconnect/i,
];
const APP_ROOT_MARKERS = [/\bid=["'](app|root|__next)["']/i, /data-reactroot/i, /ng-version=/i];
// Counted (not just matched) to bucket how many export controls a page exposes.
const EXPORT_CANDIDATE_MARKERS = [
  /엑셀\s*다운로드/g,
  /excel\s*download/gi,
  /data-export=/gi,
  /다운로드\s*센터/g,
  /export[-\s]?(queue|job|center)/gi,
];

const anyMatch = (markers: RegExp[], html: string): boolean => markers.some((re) => re.test(html));

function readyStateCategory(readyState?: string): ReadyStateCategory {
  if (readyState === "loading" || readyState === "interactive" || readyState === "complete") return readyState;
  return "unknown";
}

function htmlLengthBucket(len: number): HtmlLengthBucket {
  if (len <= 0) return "empty";
  if (len < 1_000) return "tiny";
  if (len < 10_000) return "small";
  if (len < 100_000) return "medium";
  if (len < 1_000_000) return "large";
  return "huge";
}

function childCountBucket(n?: number): ChildCountBucket {
  if (n === undefined || n < 0) return "unknown";
  if (n === 0) return "none";
  if (n <= 5) return "few";
  if (n <= 50) return "some";
  return "many";
}

function exportCandidateBucket(html: string): ExportCandidateBucket {
  let count = 0;
  for (const re of EXPORT_CANDIDATE_MARKERS) count += (html.match(re) ?? []).length;
  if (count === 0) return "none";
  if (count === 1) return "one";
  if (count <= 5) return "few";
  return "many";
}

/**
 * Pure: raw snapshot → sanitized signals. No field copies input text; see the
 * SAFETY CONTRACT above. Deterministic and browser-free, so it is fully
 * offline-unit-tested (including a hostile PII fixture).
 */
export function extractProbeSignals(input: RawProbeInput): SanitizedProbeSignals {
  const { url, html } = input;
  const category = urlCategory(url);
  const passwordFieldPresent = anyMatch(PASSWORD_MARKERS, html);
  const captchaOrAuthChallengePresent = anyMatch(AUTH_CHALLENGE_MARKERS, html);
  const candidateMenuOrGnbPresent = anyMatch(MENU_GNB_MARKERS, html);
  const candidateLogoutAffordancePresent = anyMatch(LOGOUT_MARKERS, html);
  const accountReconnectAffordancePresent = anyMatch(ACCOUNT_RECONNECT_MARKERS, html);
  const exportCandidateCount = exportCandidateBucket(html);

  // Verdict consumes only strong/decisive signals — never the weak shell/branding or the
  // login-affordance link (see `session-verdict.ts`).
  const sessionVerdict = classifySessionVerdict({
    isSellerCenterUrl: category === "seller-center",
    passwordFieldPresent,
    authChallengePresent: captchaOrAuthChallengePresent,
    menuOrGnbPresent: candidateMenuOrGnbPresent,
    logoutAffordancePresent: candidateLogoutAffordancePresent,
    exportCandidatesPresent: exportCandidateCount !== "none",
    accountReconnectAffordancePresent,
  });

  return {
    urlCategory: category,
    documentReadyState: readyStateCategory(input.readyState),
    htmlLengthBucket: htmlLengthBucket(html.length),
    scriptCount: (html.match(/<script\b/gi) ?? []).length,
    appRootPresent: anyMatch(APP_ROOT_MARKERS, html),
    appRootChildCount: childCountBucket(input.appRootChildCount),
    passwordFieldPresent,
    captchaOrAuthChallengePresent,
    loginAffordancePresent: anyMatch(LOGIN_AFFORDANCE_MARKERS, html),
    candidateLoggedInShellPresent: anyMatch(LOGGED_IN_SHELL_MARKERS, html),
    candidateMenuOrGnbPresent,
    candidateLogoutAffordancePresent,
    accountReconnectAffordancePresent,
    reviewRouteLike: /review/i.test(url) || /#\/review/i.test(url) || /리뷰|review/i.test(html),
    exportCandidateCount,
    hydrationWaitResult: input.hydrationWaitResult ?? "not-attempted",
    sessionVerdict,
  };
}
