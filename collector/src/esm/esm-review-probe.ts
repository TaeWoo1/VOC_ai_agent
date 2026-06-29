import { classifySessionVerdict, type SessionVerdict } from "../naver/session-verdict";

/**
 * ESM+ REVIEW no-click structural probe — PURE + SANITIZED (model-C discovery).
 *
 * This is the Gate-2 read-only classifier for the ESM+ (Gmarket / Auction) review
 * seller-center export surface. It turns a raw page snapshot (URL + serialized HTML
 * + a few live DOM scalars) into a SMALL, FIXED set of booleans / bucketed counts /
 * category enums, plus the channel-generic five-state `sessionVerdict`. It NEVER
 * clicks, downloads, or captures — and it never emits page text, attribute values,
 * raw URLs, full HTML, or any PII.
 *
 * REUSE, not shared DOM knowledge: the verdict CLASSIFIER (`classifySessionVerdict`)
 * is channel-generic — it consumes booleans only — so ESM reuses it as a safety
 * template. Everything ESM-SPECIFIC here (URL shape, session/export markers,
 * sync/async layout) is an unverified PLACEHOLDER — `NEEDS_DISCOVERY` — seeded from
 * the Gate-1 manual observation (review surface at an esmplus host + a
 * `/Home/v2/manage-feedback`-like route, with an 엑셀/다운로드-like export control) and
 * corrected ONLY from observed, sanitized findings (collector/CLAUDE.md §6) — never
 * guess-tuned, never promoted to CONFIRMED from this probe.
 *
 * SAFETY CONTRACT (identical to the NAVER probes): every field of
 * `SanitizedEsmReviewProbeSignals` is a boolean, a small bucketed number, a fixed
 * category enum, or an array of fixed category enums. No field is derived by copying
 * a substring of the input. So `JSON.stringify(extractEsmReviewProbeSignals(x))` can
 * never contain a store name, account, product name, review text, id, token, label,
 * selector, or raw URL from the input. Asserted by an offline hostile-fixture test.
 */

export type EsmUrlCategory = "login" | "seller-center" | "other";
export type CountBucket = "none" | "one" | "few" | "some" | "many";
/** Same buckets, plus "unknown" for live-only scalars not supplied offline. */
export type OptionalCountBucket = "unknown" | CountBucket;
/**
 * COARSE, non-authoritative export-layout hint. NOT a confirmed classification — the
 * sync-vs-async question is exactly what later gates resolve. `NEEDS_DISCOVERY`.
 */
export type EsmExportLayoutHint = "SYNC_LIKELY" | "ASYNC_LIKELY" | "UNRECOGNIZED";

/** Raw, un-sanitized snapshot. The CLI fills this from a live page; tests pass it directly. */
export interface RawEsmReviewProbeInput {
  /** Raw URL — used ONLY to derive a coarse category / route booleans; never echoed back. */
  url: string;
  /** Serialized DOM HTML — scanned for marker presence/counts; never echoed back. */
  html: string;
  /** Live-only: raw URLs of every frame (from `page.frames()`), reduced to categories. */
  frameUrls?: string[];
  /** Live-only: number of DOM elements that host an open shadow root. */
  shadowRootHostCount?: number;
  /** Live-only: count of keyword-matched interactive export candidates (total). */
  exportCandidateTotal?: number;
  /** Live-only: how many of those candidates are visible (rendered, non-collapsed). */
  exportCandidateVisible?: number;
  /** Live-only: how many of those candidates are enabled (not disabled/aria-disabled). */
  exportCandidateEnabled?: number;
}

/** The ONLY shape ever printed/logged by the ESM review probe. All fields are non-sensitive. */
export interface SanitizedEsmReviewProbeSignals {
  urlCategory: EsmUrlCategory;
  /** True iff the URL/HTML looks like a review-management surface (NEEDS_DISCOVERY markers). */
  reviewRouteLike: boolean;
  /** True iff the URL looks like the Gate-1 `/Home/v2/manage-feedback`-like route (shape only). */
  manageFeedbackRouteLike: boolean;
  // Session signals (booleans; feed the channel-generic verdict).
  passwordFieldPresent: boolean;
  authChallengePresent: boolean;
  menuOrGnbPresent: boolean;
  logoutAffordancePresent: boolean;
  accountReconnectAffordancePresent: boolean;
  // Structural context (HTML-derived counts, bucketed).
  iframeCount: CountBucket;
  buttonCount: CountBucket;
  anchorCount: CountBucket;
  roleButtonCount: CountBucket;
  disabledControlCount: CountBucket;
  downloadAttributeCount: CountBucket;
  dateInputCount: CountBucket;
  tableGridListCount: CountBucket;
  // Export-intent keyword categories (presence only; never the matched text).
  excelLike: boolean;
  downloadLike: boolean;
  exportLike: boolean;
  csvOrXlsxLike: boolean;
  /** True iff an async download-center / job affordance is present (wins over sync). */
  asyncMarkerPresent: boolean;
  // Live-only signals (degrade to empty / "unknown" offline).
  frameUrlCategories: EsmUrlCategory[];
  shadowRootHostCount: OptionalCountBucket;
  exportCandidateCount: OptionalCountBucket;
  visibleExportCandidateCount: OptionalCountBucket;
  enabledExportCandidateCount: OptionalCountBucket;
  /** True iff at least one export candidate is BOTH visible and enabled (live-only). */
  hasActionableExportCandidate: boolean;
  /** Coarse, NON-authoritative sync/async hint — NEEDS_DISCOVERY (see type doc). */
  exportLayoutHint: EsmExportLayoutHint;
  /** Channel-generic five-state session judgment (see `naver/session-verdict.ts`). */
  sessionVerdict: SessionVerdict;
}

/** Exact set of keys the probe may emit — used by the offline allow-list test. */
export const SANITIZED_ESM_REVIEW_PROBE_KEYS: ReadonlyArray<keyof SanitizedEsmReviewProbeSignals> = [
  "urlCategory",
  "reviewRouteLike",
  "manageFeedbackRouteLike",
  "passwordFieldPresent",
  "authChallengePresent",
  "menuOrGnbPresent",
  "logoutAffordancePresent",
  "accountReconnectAffordancePresent",
  "iframeCount",
  "buttonCount",
  "anchorCount",
  "roleButtonCount",
  "disabledControlCount",
  "downloadAttributeCount",
  "dateInputCount",
  "tableGridListCount",
  "excelLike",
  "downloadLike",
  "exportLike",
  "csvOrXlsxLike",
  "asyncMarkerPresent",
  "frameUrlCategories",
  "shadowRootHostCount",
  "exportCandidateCount",
  "visibleExportCandidateCount",
  "enabledExportCandidateCount",
  "hasActionableExportCandidate",
  "exportLayoutHint",
  "sessionVerdict",
];

// ESM URL shape markers — coarse categories only; the raw URL is never echoed.
const ESM_LOGIN_URL_RE = /\/login|signin|sign-in|nidlogin|\bsso\b|\bauth\b/i;
const ESM_SELLER_HOST_RE = /esmplus|esm\.plus|gmarket|auction/i;
const MANAGE_FEEDBACK_RE = /manage-?feedback/i;

// Session markers — ESM PLACEHOLDERS (NEEDS_DISCOVERY). Generic enough to seed Gate 2;
// correct from observed sanitized findings only. The matched text is never returned.
const PASSWORD_MARKERS = [/type=["']password["']/i, /name=["']pw(d)?["']/i, /name=["']password["']/i];
const AUTH_CHALLENGE_MARKERS = [/captcha/i, /recaptcha/i, /\botp\b/i, /인증번호/, /2단계/, /2차\s*인증/, /two[-\s]?factor/i];
const MENU_GNB_MARKERS = [/\b[lg]nb\b/i, /id=["'][^"']*(gnb|lnb|nav|sidebar|aside)[^"']*["']/i, /<nav\b/i];
const LOGOUT_MARKERS = [/로그아웃/, /\blogout\b/i, /\bsign[-\s]?out\b/i];
// Account / store-selection interstitial PLACEHOLDERS. Deliberately specific phrases
// (not bare 계정/스토어), and unconfirmed for ESM — RECONNECT_REQUIRED only fires if one
// of these is actually observed live.
const ACCOUNT_RECONNECT_MARKERS = [
  /다른\s*계정/,
  /계정\s*선택/,
  /스토어\s*선택/,
  /판매자\s*선택/,
  /account[-\s]?(chooser|select(or|ion)?|picker)/i,
  /reconnect/i,
];

// Export-intent keyword categories — presence only; the matched text is never returned.
const EXCEL_MARKERS = [/엑셀/, /excel/i, /\bxls\b/i];
const DOWNLOAD_MARKERS = [/다운로드/, /download/i, /내려받기/];
const EXPORT_MARKERS = [/내보내기/, /export/i, /추출/];
const CSV_XLSX_MARKERS = [/\.csv\b/i, /\bcsv\b/i, /\.xlsx?\b/i, /\bxlsx\b/i];
const REVIEW_MARKERS = [/리뷰/, /review/i, /구매후기|상품평|구매평|평점|후기/];
// Async download-center / job affordance PLACEHOLDERS (NEEDS_DISCOVERY).
const ASYNC_JOB_MARKERS = [/다운로드\s*센터/, /download\s*center/i, /다운로드\s*요청/, /export[-\s]?(queue|job|center)/i, /요청\s*내역/, /대기열/];

// Counted structural markers (global flags so `.match` returns every occurrence).
const IFRAME_RE = /<iframe\b/gi;
const BUTTON_RE = /<button\b/gi;
const ANCHOR_RE = /<a\b/gi;
const ROLE_BUTTON_RE = /role=["']button["']/gi;
const DISABLED_RE = /\sdisabled(?=[\s=>/])/gi;
const DOWNLOAD_ATTR_RE = /\sdownload(?=[\s=>/])/gi;
const DATE_INPUT_RE = /type=["']date["']|date[-_]?picker|calendar|달력|날짜\s*선택|기간/gi;
const TABLE_GRID_LIST_RE = /<table\b|role=["'](?:grid|table|row|list)["']|<ul\b|<ol\b/gi;

const anyMatch = (markers: RegExp[], text: string): boolean => markers.some((re) => re.test(text));
const countMatches = (re: RegExp, html: string): number => (html.match(re) ?? []).length;

function bucket(n: number): CountBucket {
  if (n <= 0) return "none";
  if (n === 1) return "one";
  if (n <= 5) return "few";
  if (n <= 20) return "some";
  return "many";
}

function optionalBucket(n?: number): OptionalCountBucket {
  if (n === undefined || n < 0) return "unknown";
  return bucket(n);
}

/** A bucket that actually indicates ≥1 (excludes "none" and the live-only "unknown"). */
function isPositiveBucket(b: OptionalCountBucket): boolean {
  return b !== "none" && b !== "unknown";
}

/** Coarse ESM URL category — login route wins, then a seller host, else other. */
export function esmUrlCategory(url: string): EsmUrlCategory {
  if (ESM_LOGIN_URL_RE.test(url)) return "login";
  if (ESM_SELLER_HOST_RE.test(url)) return "seller-center";
  return "other";
}

/** Categorize live frame URLs, dedupe, and sort — order-independent, sanitized. */
function frameCategories(frameUrls?: string[]): EsmUrlCategory[] {
  if (!frameUrls || frameUrls.length === 0) return [];
  const cats = new Set<EsmUrlCategory>();
  for (const u of frameUrls) cats.add(esmUrlCategory(u));
  return [...cats].sort();
}

/**
 * Pure: raw ESM review-surface snapshot → sanitized signals. No field copies input
 * text; see the SAFETY CONTRACT above. Deterministic and browser-free, so it is fully
 * offline-unit-tested (including a hostile PII fixture). Live-only inputs degrade to
 * empty / "unknown" when not supplied, so the same function runs identically offline.
 */
export function extractEsmReviewProbeSignals(input: RawEsmReviewProbeInput): SanitizedEsmReviewProbeSignals {
  const { url } = input;
  // Strip HTML comments before scanning: they are never rendered affordances, and
  // marker words inside a comment would otherwise inflate the keyword booleans/counts.
  const html = input.html.replace(/<!--[\s\S]*?-->/g, " ");

  const category = esmUrlCategory(url);
  const passwordFieldPresent = anyMatch(PASSWORD_MARKERS, html);
  const authChallengePresent = anyMatch(AUTH_CHALLENGE_MARKERS, html);
  const menuOrGnbPresent = anyMatch(MENU_GNB_MARKERS, html);
  const logoutAffordancePresent = anyMatch(LOGOUT_MARKERS, html);
  const accountReconnectAffordancePresent = anyMatch(ACCOUNT_RECONNECT_MARKERS, html);

  const excelLike = anyMatch(EXCEL_MARKERS, html);
  const downloadLike = anyMatch(DOWNLOAD_MARKERS, html);
  const exportLike = anyMatch(EXPORT_MARKERS, html);
  const csvOrXlsxLike = anyMatch(CSV_XLSX_MARKERS, html);
  const asyncMarkerPresent = anyMatch(ASYNC_JOB_MARKERS, html);

  const visibleExportCandidateCount = optionalBucket(input.exportCandidateVisible);
  const enabledExportCandidateCount = optionalBucket(input.exportCandidateEnabled);
  const hasActionableExportCandidate =
    isPositiveBucket(visibleExportCandidateCount) && isPositiveBucket(enabledExportCandidateCount);

  // Export controls present → at least one export candidate is present (the verdict's
  // STRONG export signal, mirroring NAVER's `exportCandidatesPresent`).
  const exportKeywordPresent = excelLike || downloadLike || exportLike || csvOrXlsxLike;

  // COARSE, NON-authoritative hint: async wins over sync; otherwise an export keyword
  // suggests a sync download. UNRECOGNIZED when neither is seen. NEEDS_DISCOVERY.
  const exportLayoutHint: EsmExportLayoutHint = asyncMarkerPresent
    ? "ASYNC_LIKELY"
    : exportKeywordPresent
      ? "SYNC_LIKELY"
      : "UNRECOGNIZED";

  const sessionVerdict = classifySessionVerdict({
    isSellerCenterUrl: category === "seller-center",
    passwordFieldPresent,
    authChallengePresent,
    menuOrGnbPresent,
    logoutAffordancePresent,
    exportCandidatesPresent: exportKeywordPresent,
    accountReconnectAffordancePresent,
  });

  return {
    urlCategory: category,
    reviewRouteLike: MANAGE_FEEDBACK_RE.test(url) || /review|리뷰/i.test(url) || anyMatch(REVIEW_MARKERS, html),
    manageFeedbackRouteLike: MANAGE_FEEDBACK_RE.test(url),
    passwordFieldPresent,
    authChallengePresent,
    menuOrGnbPresent,
    logoutAffordancePresent,
    accountReconnectAffordancePresent,
    iframeCount: bucket(countMatches(IFRAME_RE, html)),
    buttonCount: bucket(countMatches(BUTTON_RE, html)),
    anchorCount: bucket(countMatches(ANCHOR_RE, html)),
    roleButtonCount: bucket(countMatches(ROLE_BUTTON_RE, html)),
    disabledControlCount: bucket(countMatches(DISABLED_RE, html)),
    downloadAttributeCount: bucket(countMatches(DOWNLOAD_ATTR_RE, html)),
    dateInputCount: bucket(countMatches(DATE_INPUT_RE, html)),
    tableGridListCount: bucket(countMatches(TABLE_GRID_LIST_RE, html)),
    excelLike,
    downloadLike,
    exportLike,
    csvOrXlsxLike,
    asyncMarkerPresent,
    frameUrlCategories: frameCategories(input.frameUrls),
    shadowRootHostCount: optionalBucket(input.shadowRootHostCount),
    exportCandidateCount: optionalBucket(input.exportCandidateTotal),
    visibleExportCandidateCount,
    enabledExportCandidateCount,
    hasActionableExportCandidate,
    exportLayoutHint,
    sessionVerdict,
  };
}
