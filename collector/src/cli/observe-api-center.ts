/**
 * **Read-only NAVER API-center observation harness** (G3-C.2). OFFLINE-SAFE to build/verify: importing
 * this module launches nothing (`main()` runs only when invoked directly), and even then it refuses every
 * live action without the explicit per-run approval flag — exactly like `probe-session` / `discover-export`.
 *
 * Purpose: a generic, no-click instrument that classifies a NAVER API-center page
 * (`apicenter.commerce.naver.com`) into a COARSE category (login / app list / app detail /
 * credential-issuance-like / unknown) from **structural counts and booleans only**, so a future live
 * G3-C.2 walk (under a fresh single-use G6) can calibrate the guided-connection readiness detection
 * WITHOUT ever clicking, submitting, or reading any value.
 *
 * Hard invariants (see also `docs/action-window-runtime/g3c-live-walk-preflight.md`):
 *  - **No invented selectors.** The in-page sweep uses only generic HTML structure (input types,
 *    readonly/disabled attributes, form/list container counts). The category rules are HYPOTHESES to be
 *    validated live — `LIVE_DOM_CALIBRATION_PENDING` is always reported so the output is never mistaken
 *    for a proven detector.
 *  - **Never reads or emits a value.** The Client ID / Client Secret (and every other field value) are
 *    NEVER read — only the PRESENCE/TYPE/readonly-ness of fields is observed.
 *  - **Never logs a raw URL / HTML / text / screenshot.** The URL is reduced to a host CATEGORY enum; the
 *    page is reduced to counts/booleans/buckets. Nothing is persisted.
 *  - **No click, no submit, no upload, no DB.** Fail-closed to `unknown` whenever signals are ambiguous,
 *    conflicting, or off-target.
 */
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import { pathToFileURL } from "node:url";

/** Coarse host category, derived from a URL WITHOUT ever logging the raw URL. */
export type ApiCenterUrlCategory = "api_center_host" | "naver_auth_host" | "other_host" | "unknown";

/** Coarse page category — the classification goal. `unknown` is the fail-closed default. */
export type ApiCenterPageCategory =
  | "login"
  | "app_list"
  | "app_detail"
  | "credential_issuance"
  | "unknown";

/** Machine-stable reasons a page could not be confidently classified / caveats on the result. */
export type ApiCenterBlocker =
  | "LIVE_DOM_CALIBRATION_PENDING" // always present: the rules are unvalidated hypotheses until a live run
  | "OFF_TARGET_HOST" // not the API-center/auth host → refuse to classify
  | "AMBIGUOUS_SIGNALS"; // no category signal at all → fail closed to unknown

export type CountBucket = "none" | "few" | "many";

/** Raw structural census returned by the in-page sweep — counts/booleans only, NEVER any value/text/url. */
export interface ApiCenterStructuralCensus {
  passwordFieldPresent: boolean;
  submitAffordancePresent: boolean;
  formCount: number;
  /** Editable text-like inputs (NOT password), value never read. */
  editableTextInputCount: number;
  /** readonly/disabled inputs — where issued values are typically DISPLAYED. Value never read. */
  readonlyFieldCount: number;
  /** table / ul / ol / [role=grid|table] containers with ≥2 children (list-like). */
  listLikeContainerCount: number;
}

/** Sanitized signals the classifier consumes: the url category + bucketized census. */
export interface ApiCenterSignals {
  urlCategory: ApiCenterUrlCategory;
  passwordFieldPresent: boolean;
  submitAffordancePresent: boolean;
  formCountBucket: CountBucket;
  editableTextInputCountBucket: CountBucket;
  readonlyFieldCountBucket: CountBucket;
  listLikeContainerCountBucket: CountBucket;
}

export interface ApiCenterObservation {
  urlCategory: ApiCenterUrlCategory;
  pageCategory: ApiCenterPageCategory;
  signals: ApiCenterSignals;
  blockers: ApiCenterBlocker[];
}

/** ≤0 → none, ≤3 → few, else many. Deterministic, content-free. */
export function countBucket(n: number): CountBucket {
  if (n <= 0) return "none";
  if (n <= 3) return "few";
  return "many";
}

/**
 * Reduce a URL to a coarse host category. Reads ONLY the hostname; the raw URL is never returned or
 * logged. Matches the single named target host (+ the canonical NAVER login host); everything else is
 * `other_host`, and an unparseable input fails closed to `unknown`.
 */
export function classifyUrlCategory(url: string): ApiCenterUrlCategory {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
  if (host === "apicenter.commerce.naver.com") return "api_center_host";
  if (host === "nid.naver.com" || host.endsWith(".nid.naver.com")) return "naver_auth_host";
  return "other_host";
}

/**
 * Resolve the url category from an explicit input: either a pre-classified `category` (so a caller can
 * avoid handing over the URL at all) or a `url` (reduced to a category, never logged). Fail-closed to
 * `unknown` when neither is usable.
 */
export function resolveUrlCategory(input: { url?: string; category?: ApiCenterUrlCategory }): ApiCenterUrlCategory {
  if (input.category) return input.category;
  if (input.url) return classifyUrlCategory(input.url);
  return "unknown";
}

/** Bucketize a raw census into sanitized signals. */
export function toSignals(urlCategory: ApiCenterUrlCategory, census: ApiCenterStructuralCensus): ApiCenterSignals {
  return {
    urlCategory,
    passwordFieldPresent: census.passwordFieldPresent,
    submitAffordancePresent: census.submitAffordancePresent,
    formCountBucket: countBucket(census.formCount),
    editableTextInputCountBucket: countBucket(census.editableTextInputCount),
    readonlyFieldCountBucket: countBucket(census.readonlyFieldCount),
    listLikeContainerCountBucket: countBucket(census.listLikeContainerCount),
  };
}

/**
 * Classify the page category from sanitized signals. Purely structural; fail-closed.
 *
 * Documented PRECEDENCE (each branch is reached only when the stronger ones do not fire — mirroring
 * `classifySessionVerdict`'s precedence approach, so overlapping signals resolve deterministically rather
 * than guessing). These are HYPOTHESES to be calibrated by a live G3-C.2 run (always reported via
 * `LIVE_DOM_CALIBRATION_PENDING`), never a proven detector:
 *  1. **login** — a password field present (the strongest single signal; a login page also has an
 *     editable id input, so login must win over `app_detail`).
 *  2. **app_list** — a list-like container present.
 *  3. **credential_issuance** — read-only fields displayed (issued values shown), no list.
 *  4. **app_detail** — editable inputs present, no read-only display, no list.
 *  5. otherwise → **unknown** (fail-closed, `AMBIGUOUS_SIGNALS`).
 *
 * `unknown` also when the host is off-target (`OFF_TARGET_HOST`) — the harness refuses to classify a page
 * that is not the API-center/auth host at all.
 */
export function classifyApiCenterPage(signals: ApiCenterSignals): { pageCategory: ApiCenterPageCategory; blockers: ApiCenterBlocker[] } {
  const blockers: ApiCenterBlocker[] = ["LIVE_DOM_CALIBRATION_PENDING"];

  if (signals.urlCategory !== "api_center_host" && signals.urlCategory !== "naver_auth_host") {
    blockers.push("OFF_TARGET_HOST");
    return { pageCategory: "unknown", blockers };
  }

  if (signals.passwordFieldPresent) return { pageCategory: "login", blockers };
  if (signals.listLikeContainerCountBucket !== "none") return { pageCategory: "app_list", blockers };
  if (signals.readonlyFieldCountBucket !== "none") return { pageCategory: "credential_issuance", blockers };
  if (signals.editableTextInputCountBucket !== "none") return { pageCategory: "app_detail", blockers };

  blockers.push("AMBIGUOUS_SIGNALS");
  return { pageCategory: "unknown", blockers };
}

/** Combine into the full sanitized observation. */
export function observeFrom(urlCategory: ApiCenterUrlCategory, census: ApiCenterStructuralCensus): ApiCenterObservation {
  const signals = toSignals(urlCategory, census);
  const { pageCategory, blockers } = classifyApiCenterPage(signals);
  return { urlCategory, pageCategory, signals, blockers };
}

/**
 * The in-page structural sweep (generic HTML only — no NAVER selectors, no value reads). Passed to
 * `page.evaluate` during a live run; not executed offline. Returns counts/booleans only.
 */
export function apiCenterCensusInPage(): ApiCenterStructuralCensus {
  const all = (sel: string) => Array.from(document.querySelectorAll(sel));
  const editableTypes = new Set(["text", "email", "tel", "number", "url", "search", ""]);
  const inputs = all("input") as HTMLInputElement[];
  const editableTextInputCount = inputs.filter(
    (i) => editableTypes.has(i.type) && !i.readOnly && !i.disabled,
  ).length;
  const readonlyFieldCount = inputs.filter((i) => i.readOnly || i.disabled).length;
  const listLikeContainerCount = all("table, ul, ol, [role='grid'], [role='table']").filter(
    (el) => el.childElementCount >= 2,
  ).length;
  return {
    passwordFieldPresent: document.querySelector("input[type='password']") != null,
    submitAffordancePresent: document.querySelector("button[type='submit'], input[type='submit']") != null,
    formCount: all("form").length,
    editableTextInputCount,
    readonlyFieldCount,
    listLikeContainerCount,
  };
}

const HYDRATION_TIMEOUT_MS = 15_000;

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER API-center observation — requires explicit per-run operator approval.");
  console.error(" Reads the page for SANITIZED structural signals only. No URL/HTML/text/screenshots");
  console.error(" are saved; no value (incl. Client ID/Secret) is read; nothing is clicked or uploaded.");
  console.error(line);
}

async function settle(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: HYDRATION_TIMEOUT_MS });
  } catch {
    /* timeout is fine — the classifier fails closed on thin signals */
  }
}

/**
 * Live entry (gated). NOT run during offline build/verify. Reads the operator-owned
 * `NAVER_API_CENTER_URL` (never logged), navigates read-only, runs the generic sweep, prints the
 * sanitized observation, and always closes the context.
 */
async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasLiveRunApproval(args)) {
    console.error(approvalRequiredMessage());
    process.exit(3);
    return;
  }
  const url = process.env.NAVER_API_CENTER_URL;
  if (!url) {
    console.error("Set NAVER_API_CENTER_URL (operator-owned; never logged) to the API-center page first.");
    process.exit(2);
    return;
  }
  const urlCategory = classifyUrlCategory(url);
  const cfg = loadConfig();
  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await settle(page);
    const census = await page.evaluate(apiCenterCensusInPage);
    const observation = observeFrom(urlCategory, census);
    console.log(JSON.stringify(observation, null, 2));
    log("apiCenter.observe.done", {
      urlCategory: observation.urlCategory,
      pageCategory: observation.pageCategory,
      blockerCount: observation.blockers.length,
    });
  } finally {
    await ctx.close();
  }
}

// Run the live path only when invoked directly (never on import — keeps offline build/test inert).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
