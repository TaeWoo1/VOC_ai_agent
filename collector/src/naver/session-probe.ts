import { urlCategory } from "./session-check";

/**
 * Debug-safe session/SPA structural probe — PURE + SANITIZED.
 *
 * This module turns a raw page snapshot (URL + serialized HTML + a couple of
 * live DOM scalars) into a SMALL, FIXED set of booleans / bucketed counts /
 * category enums. It is used during the approved live milestone-1 run to figure
 * out why a logged-in NAVER SmartStore Center page is being read as LOGGED_OUT
 * (placeholder session markers and/or SPA-hydration timing) WITHOUT ever
 * emitting page text, attribute values, raw URLs, full HTML, or any PII.
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
  candidateLoggedInShellPresent: boolean;
  candidateMenuOrGnbPresent: boolean;
  candidateLogoutAffordancePresent: boolean;
  reviewRouteLike: boolean;
  exportCandidateCount: ExportCandidateBucket;
  hydrationWaitResult: HydrationWaitResult;
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
  "reviewRouteLike",
  "exportCandidateCount",
  "hydrationWaitResult",
];

// Candidate markers — PLACEHOLDERS confirmed/corrected via this probe. They drive
// only booleans/counts; the matched text is never returned.
const PASSWORD_MARKERS = [/type=["']password["']/i, /name=["']pw["']/i];
const AUTH_CHALLENGE_MARKERS = [/captcha/i, /recaptcha/i, /\botp\b/i, /인증번호/, /2단계/, /two[-\s]?factor/i];
const LOGIN_AFFORDANCE_MARKERS = [/nidlogin/i, /\blogin\b/i, /로그인/, /type=["']password["']/i];
const LOGGED_IN_SHELL_MARKERS = [
  /data-seller-authenticated/i,
  /id=["']seller-gnb["']/i,
  /판매자센터/,
  /스마트스토어\s*센터/,
  /커머스/,
];
const MENU_GNB_MARKERS = [/\b[lg]nb\b/i, /id=["'][^"']*(gnb|lnb|nav|sidebar|aside)[^"']*["']/i, /<nav\b/i];
const LOGOUT_MARKERS = [/로그아웃/, /\blogout\b/i];
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
  return {
    urlCategory: urlCategory(url),
    documentReadyState: readyStateCategory(input.readyState),
    htmlLengthBucket: htmlLengthBucket(html.length),
    scriptCount: (html.match(/<script\b/gi) ?? []).length,
    appRootPresent: anyMatch(APP_ROOT_MARKERS, html),
    appRootChildCount: childCountBucket(input.appRootChildCount),
    passwordFieldPresent: anyMatch(PASSWORD_MARKERS, html),
    captchaOrAuthChallengePresent: anyMatch(AUTH_CHALLENGE_MARKERS, html),
    loginAffordancePresent: anyMatch(LOGIN_AFFORDANCE_MARKERS, html),
    candidateLoggedInShellPresent: anyMatch(LOGGED_IN_SHELL_MARKERS, html),
    candidateMenuOrGnbPresent: anyMatch(MENU_GNB_MARKERS, html),
    candidateLogoutAffordancePresent: anyMatch(LOGOUT_MARKERS, html),
    reviewRouteLike: /review/i.test(url) || /#\/review/i.test(url) || /리뷰|review/i.test(html),
    exportCandidateCount: exportCandidateBucket(html),
    hydrationWaitResult: input.hydrationWaitResult ?? "not-attempted",
  };
}
