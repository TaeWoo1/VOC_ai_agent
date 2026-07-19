/**
 * **NAVER API-center GUIDED-TUTORIAL observation harness** (G3-C.2). OFFLINE-SAFE to build/verify:
 * importing this module launches nothing (`main()` runs only when invoked directly), and even then it
 * refuses every live action without the explicit per-run approval flag — like `probe-session` /
 * `discover-export`.
 *
 * Purpose: **guided-tutorial support only.** A generic, no-click instrument that classifies a NAVER
 * API-center page (`apicenter.commerce.naver.com`) into a COARSE category (login / app list / app detail /
 * credential-issuance-like / unknown) from **structural counts and booleans only**, so the guided-connection
 * wizard can show the seller the **next tutorial instruction** for where they are. The seller does every
 * real step **manually** in their own dedicated Chrome window — logs in, opens/creates the Commerce API
 * application, and copies the Client ID / Secret themselves.
 *
 * **This is NOT automatic API-key issuance or automatic credential linking.** SellerOps never logs in,
 * never clicks/submits, never issues or links an application, never scrapes or auto-fills a value, and
 * never reads the Client ID / Secret. It only reads a sanitized page CATEGORY / structural state to drive
 * the tutorial. (Secure Client ID/Secret ENTRY, when the seller chooses to, is a separate manual form in
 * the wizard that posts to the backend Vault — never anything this observer does.)
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
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

/** Opt-in flag: after a login observation, wait for the operator to log in manually, then re-observe. */
export const WAIT_FOR_MANUAL_LOGIN_FLAG = "--wait-for-manual-login";

/** Opt-in flag: after the initial observation, wait for the seller to MANUALLY navigate deeper, then re-observe. */
export const WAIT_FOR_MANUAL_NAVIGATION_FLAG = "--wait-for-manual-navigation";

/** Fixed sentinel filename (one run at a time). Distinct from probe-same-session's. */
export const OBSERVE_SENTINEL_FILENAME = "observe-api-center.ready";

/** Sentinel path next to the collector status file (same `.status/` dir), mirroring `probe-sentinel`. */
export function observeSentinelPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), OBSERVE_SENTINEL_FILENAME);
}

/**
 * Safe transition enum across an optional manual-login wait — describes only the PAGE's login gate, not
 * any SellerOps authentication (the seller logs in manually; the tool authenticates nothing):
 *   • `none` — no wait happened.
 *   • `login_resolved` — was a login page; after the seller's manual login it is no longer a login page.
 *   • `login_persists` — still a login page after the wait.
 */
export type LoginTransition = "none" | "login_resolved" | "login_persists";

export interface ObserveApiCenterResult {
  observation: ApiCenterObservation;
  waited: boolean;
  loginTransition: LoginTransition;
}

export interface ObserveDeps {
  /** Read the CURRENT page as a sanitized census (production: re-navigate + settle + evaluate). */
  readCensus: () => Promise<ApiCenterStructuralCensus>;
  /** Block until the operator signals they logged in manually (production: a sentinel file). */
  waitForManualLogin: () => Promise<void>;
}

/**
 * Orchestrate either a one-shot observation, or — with `waitForLogin` and a `login` first read — a
 * login → operator-manual-login → re-observe cycle. **Pure over injected deps**, so it is fully
 * unit-tested offline with scripted censuses. The tool NEVER logs in, types, clicks, or reads a value:
 * the operator logs in manually inside the opened window and this only re-reads the sanitized census.
 */
export async function observeApiCenter(
  urlCategory: ApiCenterUrlCategory,
  waitForLogin: boolean,
  deps: ObserveDeps,
): Promise<ObserveApiCenterResult> {
  const first = observeFrom(urlCategory, await deps.readCensus());
  if (!waitForLogin || first.pageCategory !== "login") {
    return { observation: first, waited: false, loginTransition: "none" };
  }
  await deps.waitForManualLogin();
  const second = observeFrom(urlCategory, await deps.readCensus());
  return {
    observation: second,
    waited: true,
    loginTransition: second.pageCategory === "login" ? "login_persists" : "login_resolved",
  };
}

/**
 * Safe transition enum across an optional manual-navigation checkpoint — describes only the coarse PAGE
 * CATEGORY change, never a value, path, or direction claim:
 *   • `none` — no wait happened (one-shot).
 *   • `category_changed` — the sanitized page category differs after the seller's manual navigation
 *     (e.g. app_list → app_detail, app_detail → credential_issuance, or → unknown).
 *   • `category_unchanged` — the same page category after the wait (no transition; progress is not faked).
 */
export type NavigationTransition = "none" | "category_changed" | "category_unchanged";

export interface ManualNavigationResult {
  observation: ApiCenterObservation;
  /** The coarse category BEFORE the manual navigation (sanitized enum). */
  fromPageCategory: ApiCenterPageCategory;
  waited: boolean;
  navigationTransition: NavigationTransition;
}

export interface ManualNavigationDeps {
  /** Read the entry page as a sanitized census (production: navigate to url + settle + evaluate). */
  readCensus: () => Promise<ApiCenterStructuralCensus>;
  /** Re-read the CURRENT page WITHOUT navigating (production: settle + evaluate; the seller moved, not us). */
  reReadCurrentCensus: () => Promise<ApiCenterStructuralCensus>;
  /** Block until the seller signals they navigated manually (production: a sentinel file). */
  waitForManualNavigation: () => Promise<void>;
}

/**
 * Orchestrate a manual-navigation checkpoint for guided-tutorial calibration: observe the entry page, then
 * — with the flag — wait while the SELLER manually navigates deeper in their own window, and re-observe the
 * CURRENT page ONCE. **Pure over injected deps** (fully unit-tested offline with scripted censuses). The
 * tool NEVER navigates, clicks, types, submits, or reads a value: it only re-reads a sanitized census of
 * wherever the seller went. Unlike the login wait, the re-read does NOT re-navigate to the entry URL — the
 * seller's deeper page (app_detail / credential-issuance) must be preserved, not reset to the entry list.
 */
export async function observeApiCenterManualNavigation(
  urlCategory: ApiCenterUrlCategory,
  waitForNavigation: boolean,
  deps: ManualNavigationDeps,
): Promise<ManualNavigationResult> {
  const first = observeFrom(urlCategory, await deps.readCensus());
  if (!waitForNavigation) {
    return { observation: first, fromPageCategory: first.pageCategory, waited: false, navigationTransition: "none" };
  }
  await deps.waitForManualNavigation();
  const second = observeFrom(urlCategory, await deps.reReadCurrentCensus());
  return {
    observation: second,
    fromPageCategory: first.pageCategory,
    waited: true,
    navigationTransition: second.pageCategory === first.pageCategory ? "category_unchanged" : "category_changed",
  };
}

/**
 * The in-page structural sweep, as a **string** IIFE evaluated in the browser (generic HTML only — no
 * NAVER selectors, no value reads). It MUST be a string, not a passed function: tsx/esbuild instruments
 * named/module functions with a `__name` helper that does not exist in the page context, so a serialized
 * function throws `ReferenceError: __name is not defined`. A string literal is never instrumented, so it
 * runs cleanly. It returns counts/booleans only — it never reads any field VALUE (incl. Client ID/Secret),
 * text, or URL. Kept ES5-plain (no arrow/`Set`) so it is robust across page runtimes. Shape matches
 * {@link ApiCenterStructuralCensus}.
 */
export const EXTRACT_API_CENTER_CENSUS = `(function () {
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var inputs = slice(document.querySelectorAll('input'));
  var editableTypes = ['text', 'email', 'tel', 'number', 'url', 'search', ''];
  var isEditable = function (i) { return editableTypes.indexOf(i.type) !== -1 && !i.readOnly && !i.disabled; };
  var containers = slice(document.querySelectorAll("table, ul, ol, [role='grid'], [role='table']"));
  var editableTextInputCount = 0, readonlyFieldCount = 0, listLikeContainerCount = 0, i;
  for (i = 0; i < inputs.length; i++) {
    if (isEditable(inputs[i])) editableTextInputCount++;
    if (inputs[i].readOnly || inputs[i].disabled) readonlyFieldCount++;
  }
  for (i = 0; i < containers.length; i++) {
    if (containers[i].childElementCount >= 2) listLikeContainerCount++;
  }
  return {
    passwordFieldPresent: document.querySelector("input[type='password']") != null,
    submitAffordancePresent: document.querySelector("button[type='submit'], input[type='submit']") != null,
    formCount: document.querySelectorAll('form').length,
    editableTextInputCount: editableTextInputCount,
    readonlyFieldCount: readonlyFieldCount,
    listLikeContainerCount: listLikeContainerCount
  };
})()`;

export type UrlScreenReason = "ok" | "invalid" | "placeholder" | "off_target";

/** Placeholder-ish markers — caught WITHOUT logging the value (only a boolean leaves). */
function looksLikePlaceholder(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("<") ||
    u.includes(">") ||
    u.includes("example.") ||
    u.includes("your-") ||
    u.includes("your_") ||
    u.includes("placeholder") ||
    u.includes("changeme") ||
    u.includes("todo") ||
    u.includes("xxxx") ||
    !url.includes("://") // a bare token like NAVER_API_CENTER_URL is not a URL
  );
}

/**
 * Pre-launch screen for the operator-provided URL (fail-closed BEFORE Chrome launches). Rejects
 * placeholder-like values, unparseable URLs, and any host that is not the NAVER API-center or auth host —
 * so G3-C.2 can never navigate to a seller-center/off-target page. Reads the URL; emits only a reason
 * enum + host category (never the raw URL).
 */
export function screenApiCenterUrl(url: string): { ok: boolean; reason: UrlScreenReason; urlCategory: ApiCenterUrlCategory } {
  const urlCategory = classifyUrlCategory(url);
  if (looksLikePlaceholder(url)) return { ok: false, reason: "placeholder", urlCategory };
  if (urlCategory === "unknown") return { ok: false, reason: "invalid", urlCategory };
  if (urlCategory !== "api_center_host" && urlCategory !== "naver_auth_host") {
    return { ok: false, reason: "off_target", urlCategory };
  }
  return { ok: true, reason: "ok", urlCategory };
}

const HYDRATION_TIMEOUT_MS = 15_000;

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER API-center GUIDED-TUTORIAL observation — explicit per-run approval required.");
  console.error(" Tutorial support only: the SELLER logs in, opens/creates the API application, and copies");
  console.error(" the Client ID/Secret MANUALLY. This tool never logs in, issues, links, clicks, submits,");
  console.error(" autofills, or reads any value (incl. Client ID/Secret) — it only reads a SANITIZED page");
  console.error(" category/structure to show the next tutorial step. No URL/HTML/text/screenshot is saved.");
  console.error(line);
}

const LOGIN_WAIT_TIMEOUT_MS = 5 * 60_000; // generous: manual login + 2FA
const SENTINEL_POLL_MS = 1_000;

async function settle(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: HYDRATION_TIMEOUT_MS });
  } catch {
    /* timeout is fine — the classifier fails closed on thin signals */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Best-effort remove (clear stale at startup, and at cleanup). */
function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

/** Poll for the sentinel up to the timeout (counter-based; no wall-clock read). */
async function waitForSentinel(path: string): Promise<boolean> {
  const maxTicks = Math.ceil(LOGIN_WAIT_TIMEOUT_MS / SENTINEL_POLL_MS);
  for (let i = 0; i < maxTicks; i++) {
    if (existsSync(path)) return true;
    await sleep(SENTINEL_POLL_MS);
  }
  return existsSync(path);
}

/** Safe operator instructions for the manual-login wait — no raw URL/content, only the local file path. */
function printLoginWaitInstructions(sentinelPath: string): void {
  console.error("");
  console.error("Tutorial step: the API-center page looks like a LOGIN page (dedicated profile not signed in).");
  console.error("Log in MANUALLY inside the opened dedicated Chrome window — YOU do the login (and, later,");
  console.error("open/create the API application and copy the Client ID/Secret). The tool will NOT type,");
  console.error("click, submit, autofill, or read your ID / password / Client ID / Secret. When you have");
  console.error("logged in and are on the API-center page, signal readiness by creating this file — the tool");
  console.error("then RE-READS only the sanitized page category to advance the tutorial:");
  console.error(`  ${sentinelPath}`);
  console.error('  (e.g. `touch "' + sentinelPath + '"`; in Claude Code, just say "ready").');
  console.error("Polling…");
}

/** Safe operator instructions for the manual-navigation checkpoint — no raw URL/content, only the local file path. */
function printManualNavigationInstructions(sentinelPath: string): void {
  console.error("");
  console.error("Tutorial checkpoint: manually navigate to the NEXT API-center page, then signal readiness.");
  console.error("Inside the opened dedicated Chrome window — in the SAME window/tab — YOU navigate to the next");
  console.error("tutorial step (e.g. open one API application to see its detail, or open its issued-keys page).");
  console.error("The tool will NOT click, type, submit, open, issue, link, copy, autofill, or read any value");
  console.error("(incl. Client ID/Secret). After you signal readiness it RE-READS only the sanitized page");
  console.error("category ONCE to advance the tutorial. When you are on the next page, create this file:");
  console.error(`  ${sentinelPath}`);
  console.error('  (e.g. `touch "' + sentinelPath + '"`; in Claude Code, just say "ready").');
  console.error("Polling…");
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
  // Fail closed BEFORE launching Chrome: reject placeholders, unparseable URLs, and off-target hosts
  // (e.g. a seller-center review page) — so the browser only ever opens the API-center / auth host.
  const screen = screenApiCenterUrl(url);
  if (!screen.ok) {
    console.error(
      `Refusing to launch: NAVER_API_CENTER_URL failed screening (reason=${screen.reason}). It must be the ` +
        "NAVER API-center or auth host and not a placeholder. No browser launched.",
    );
    process.exit(2);
    return;
  }
  const urlCategory = screen.urlCategory;
  const cfg = loadConfig();
  const waitForLogin = args.includes(WAIT_FOR_MANUAL_LOGIN_FLAG);
  const waitForNavigation = args.includes(WAIT_FOR_MANUAL_NAVIGATION_FLAG);
  const sentinelPath = observeSentinelPathFor(cfg.statusFile);
  mkdirSync(dirname(sentinelPath), { recursive: true });
  removeSentinel(sentinelPath); // clear any stale sentinel BEFORE the run

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  // Evaluate a STRING (not a passed function) so tsx/esbuild's __name helper is never referenced in the
  // page context. Cast to get the typed census back from the string-form evaluate.
  const evalPage = page as unknown as { evaluate<R>(script: string): Promise<R> };
  const readCensus = async (): Promise<ApiCenterStructuralCensus> => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await settle(page);
    return evalPage.evaluate<ApiCenterStructuralCensus>(EXTRACT_API_CENTER_CENSUS);
  };
  // Re-read the CURRENT page WITHOUT navigating — the manual-navigation checkpoint observes wherever the
  // seller manually moved (app_list → app_detail → issued-keys), so re-navigating to the entry URL would
  // undo their navigation. Still no click/type/submit; only a sanitized structural re-read.
  const reReadCurrentCensus = async (): Promise<ApiCenterStructuralCensus> => {
    await settle(page);
    return evalPage.evaluate<ApiCenterStructuralCensus>(EXTRACT_API_CENTER_CENSUS);
  };
  const waitForManualLogin = async (): Promise<void> => {
    removeSentinel(sentinelPath);
    printLoginWaitInstructions(sentinelPath);
    const appeared = await waitForSentinel(sentinelPath);
    if (!appeared) console.error("Manual-login wait timed out — re-observing the current page as-is.");
  };
  const waitForManualNavigation = async (): Promise<void> => {
    removeSentinel(sentinelPath);
    printManualNavigationInstructions(sentinelPath);
    const appeared = await waitForSentinel(sentinelPath);
    if (!appeared) console.error("Manual-navigation wait timed out — re-observing the current page as-is.");
  };

  try {
    if (waitForNavigation) {
      // Manual-navigation checkpoint: observe entry, wait for the seller's manual navigation, re-read the
      // CURRENT page once (never re-navigates). Takes precedence if both wait flags are passed.
      const result = await observeApiCenterManualNavigation(urlCategory, true, {
        readCensus,
        reReadCurrentCensus,
        waitForManualNavigation,
      });
      console.log(
        JSON.stringify(
          {
            ...result.observation,
            fromPageCategory: result.fromPageCategory,
            waited: result.waited,
            navigationTransition: result.navigationTransition,
          },
          null,
          2,
        ),
      );
      log("apiCenter.observe.done", {
        urlCategory: result.observation.urlCategory,
        pageCategory: result.observation.pageCategory,
        fromPageCategory: result.fromPageCategory,
        waited: result.waited,
        navigationTransition: result.navigationTransition,
        blockerCount: result.observation.blockers.length,
      });
    } else {
      const result = await observeApiCenter(urlCategory, waitForLogin, { readCensus, waitForManualLogin });
      console.log(
        JSON.stringify(
          { ...result.observation, waited: result.waited, loginTransition: result.loginTransition },
          null,
          2,
        ),
      );
      log("apiCenter.observe.done", {
        urlCategory: result.observation.urlCategory,
        pageCategory: result.observation.pageCategory,
        waited: result.waited,
        loginTransition: result.loginTransition,
        blockerCount: result.observation.blockers.length,
      });
    }
  } finally {
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

// Run the live path only when invoked directly (never on import — keeps offline build/test inert).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
