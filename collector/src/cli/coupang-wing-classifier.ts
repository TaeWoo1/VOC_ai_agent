/**
 * **Coupang WING API-issuance GUIDED-TUTORIAL page classifier** (the Coupang analog of
 * `observe-api-center.ts`). PURE + browser-free: this module launches nothing, imports no Playwright, and is
 * fully unit-testable offline with scripted censuses.
 *
 * Purpose: **guided-tutorial support only.** A generic, no-click instrument that classifies a Coupang WING page
 * into a COARSE category (login / WING home / open-API issuance / credential-shown / unknown) from **structural
 * counts and booleans only**, so the guided-connection wizard can show the seller the next tutorial instruction
 * for where they are. The seller does every real step **manually** in their own dedicated Chrome window — logs
 * in, opens the open-API issuance page, fills 자체개발 / 업체명 / 호출 IP, presses 발급 themselves, and copies the
 * Access Key / Secret Key / 업체코드 into SellerOps's own masked form.
 *
 * **This is NOT automatic API-key issuance or automatic credential linking.** SellerOps never logs in, never
 * clicks/submits, never issues a key, never scrapes or auto-fills a value, and never reads the Access Key /
 * Secret Key / Vendor ID. It only reads a sanitized page CATEGORY / structural state to drive the tutorial.
 *
 * Hard invariants (mirroring `observe-api-center`):
 *  - **No invented selectors.** The in-page sweep uses only generic HTML structure (input types, readonly/
 *    disabled attributes, form/list container counts) plus a value-free fixed-label marker check. The category
 *    rules are HYPOTHESES to be validated live — `LIVE_DOM_CALIBRATION_PENDING` is always reported so the output
 *    is never mistaken for a proven detector.
 *  - **Never reads or emits a value.** The Access Key / Secret Key / 업체코드 (and every field value) are NEVER
 *    read — only the PRESENCE/TYPE/readonly-ness of fields is observed.
 *  - **Never logs a raw URL / HTML / text / screenshot.** A URL is reduced to a host CATEGORY enum; a page is
 *    reduced to counts/booleans/buckets.
 *  - **No click, no submit, no upload, no DB.** Fail-closed to `unknown` whenever signals are ambiguous,
 *    conflicting, or off-target.
 */

/** The single calibration caveat carried by every classifier / branch result. Its presence is the promise that
 * these rules are unvalidated hypotheses until a live WING walk confirms them — never a claim of a proven detector. */
export const LIVE_DOM_CALIBRATION_PENDING = "LIVE_DOM_CALIBRATION_PENDING" as const;

/** Coarse host category, derived from a URL WITHOUT ever logging the raw URL. */
export type WingUrlCategory = "wing_host" | "coupang_auth_host" | "other_host" | "unknown";

/** Coarse page category — the classification goal. `unknown` is the fail-closed default. */
export type WingPageCategory = "login" | "wing_home" | "open_api_issuance" | "credential_shown" | "unknown";

/** Machine-stable reasons a page could not be confidently classified / caveats on the result. */
export type WingBlocker =
  | "LIVE_DOM_CALIBRATION_PENDING" // always present: the rules are unvalidated hypotheses until a live run
  | "OFF_TARGET_HOST" // not the WING/auth host → refuse to classify
  | "AMBIGUOUS_SIGNALS"; // no category signal at all → fail closed to unknown

export type CountBucket = "none" | "few" | "many";

/** Raw structural census returned by the in-page sweep — counts/booleans only, NEVER any value/text/url. */
export interface WingStructuralCensus {
  passwordFieldPresent: boolean;
  submitAffordancePresent: boolean;
  formCount: number;
  /** Editable text-like inputs (NOT password), value never read. */
  editableTextInputCount: number;
  /** readonly/disabled inputs — where issued keys are typically DISPLAYED. Value never read. */
  readonlyFieldCount: number;
  /** table / ul / ol / [role=grid|table] containers with ≥2 children (list-like). */
  listLikeContainerCount: number;
  /**
   * STRUCTURAL open-API-issuance marker: whether the page carries a fixed, live-confirmed open-API issuance
   * label ({@link WING_OPEN_API_MARKER_LABELS}). Value-free: computed IN-PAGE by comparing an element's
   * accessible name against those KNOWN fixed labels and returning only a boolean — never any page text.
   * Optional so a caller need not always supply it; absent ⇒ treated as `false`.
   */
  openApiMarkerPresent?: boolean;
  /**
   * STRUCTURAL already-issued signal: whether the page carries the live-CONFIRMED credential-region anchor
   * ({@link WING_CREDENTIAL_ANCHOR_LABELS}, e.g. the "Access Key" heading) — present when the open-API keys are
   * DISPLAYED (an already-issued account). Value-free (a boolean only; the key VALUE is never read). Optional;
   * absent ⇒ `false`.
   */
  credentialAnchorPresent?: boolean;
}

/**
 * FIXED open-API issuance-page marker labels (the issuance-FORM section heading). Matching is EXACT
 * accessible-name (value-free): only a boolean leaves the page. LIVE_DOM_CALIBRATION_PENDING — these were NOT
 * matched on the observed already-issued page (its real heading text is sanitized-out, so they are not retuned
 * speculatively). A false match just fails closed downstream (the fixed-label locate finds nothing and parks),
 * never a wrong classification that acts.
 */
export const WING_OPEN_API_MARKER_LABELS = ["오픈API 키 발급", "오픈API 개발"] as const;

/**
 * LIVE-CONFIRMED credential-region anchor label(s). The 2026-08-06 observe-only recorder run resolved the
 * "Access Key" credential region UNIQUELY (matchCount=1) on the real already-issued open-API page, so an exact
 * accessible-name match on this label is a grounded signal that the page IS the open-API page in the
 * issued/credential-shown (already-issued) state. Value-free: only a boolean leaves the page — never the key.
 */
export const WING_CREDENTIAL_ANCHOR_LABELS = ["Access Key"] as const;

/** Sanitized signals the classifier consumes: the url category + bucketized census. */
export interface WingSignals {
  urlCategory: WingUrlCategory;
  passwordFieldPresent: boolean;
  submitAffordancePresent: boolean;
  formCountBucket: CountBucket;
  editableTextInputCountBucket: CountBucket;
  readonlyFieldCountBucket: CountBucket;
  listLikeContainerCountBucket: CountBucket;
  openApiMarkerPresent: boolean;
  /** Live-CONFIRMED credential-region anchor present ⇒ the open-API page in the issued/already-issued state. */
  credentialAnchorPresent: boolean;
}

export interface WingObservation {
  urlCategory: WingUrlCategory;
  pageCategory: WingPageCategory;
  signals: WingSignals;
  blockers: WingBlocker[];
}

/** ≤0 → none, ≤3 → few, else many. Deterministic, content-free. */
export function countBucket(n: number): CountBucket {
  if (n <= 0) return "none";
  if (n <= 3) return "few";
  return "many";
}

/**
 * Reduce a URL to a coarse host category. Reads ONLY the hostname; the raw URL is never returned or logged.
 * Matches the WING host (+ the Coupang auth hosts); everything else is `other_host`, and an unparseable input
 * fails closed to `unknown`.
 */
export function classifyWingUrlCategory(url: string): WingUrlCategory {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
  if (host === "wing.coupang.com") return "wing_host";
  if (host === "xauth.coupang.com" || host === "login.coupang.com") return "coupang_auth_host";
  return "other_host";
}

/**
 * Resolve the url category from an explicit input: either a pre-classified `category` (so a caller can avoid
 * handing over the URL at all) or a `url` (reduced to a category, never logged). Fail-closed to `unknown`.
 */
export function resolveWingUrlCategory(input: { url?: string; category?: WingUrlCategory }): WingUrlCategory {
  if (input.category) return input.category;
  if (input.url) return classifyWingUrlCategory(input.url);
  return "unknown";
}

/** Bucketize a raw census into sanitized signals. */
export function toWingSignals(urlCategory: WingUrlCategory, census: WingStructuralCensus): WingSignals {
  return {
    urlCategory,
    passwordFieldPresent: census.passwordFieldPresent,
    submitAffordancePresent: census.submitAffordancePresent,
    formCountBucket: countBucket(census.formCount),
    editableTextInputCountBucket: countBucket(census.editableTextInputCount),
    readonlyFieldCountBucket: countBucket(census.readonlyFieldCount),
    listLikeContainerCountBucket: countBucket(census.listLikeContainerCount),
    openApiMarkerPresent: census.openApiMarkerPresent ?? false,
    credentialAnchorPresent: census.credentialAnchorPresent ?? false,
  };
}

/**
 * Classify the page category from sanitized signals. Purely structural; fail-closed.
 *
 * Documented PRECEDENCE (each branch is reached only when the stronger ones do not fire). These are HYPOTHESES
 * to be calibrated by a live WING walk (always reported via `LIVE_DOM_CALIBRATION_PENDING`), never proven:
 *  1. **login** — a password field present (the strongest single signal).
 *  2. **open_api_issuance** — a fixed open-API marker label present ({@link WING_OPEN_API_MARKER_LABELS}). The
 *     issuance form is where the seller enters 자체개발 / 업체명 / 호출 IP and presses 발급. The specific form
 *     marker WINS over a generic read-only field: an issuance page that pre-fills 업체코드 read-only or carries a
 *     disabled submit control must still be recognized as the issuance page (else the guided reach would
 *     dead-end on `page_mismatch`). So a read-only field only means `credential_shown` when the form marker is
 *     absent — an issued-keys view no longer showing the form.
 *  3. **credential_shown** — read-only fields displayed with NO open-API form marker (issued Access/Secret keys
 *     shown on a page that is no longer the entry form).
 *  4. **wing_home** — a list-like container present, and no login/marker/credential signal. Only the plain WING
 *     dashboard/menu lands here.
 *  5. otherwise → **unknown** (fail-closed, `AMBIGUOUS_SIGNALS`).
 *
 * `unknown` also when the host is off-target (`OFF_TARGET_HOST`).
 */
export function classifyWingPage(signals: WingSignals): { pageCategory: WingPageCategory; blockers: WingBlocker[] } {
  const blockers: WingBlocker[] = ["LIVE_DOM_CALIBRATION_PENDING"];

  if (signals.urlCategory !== "wing_host" && signals.urlCategory !== "coupang_auth_host") {
    blockers.push("OFF_TARGET_HOST");
    return { pageCategory: "unknown", blockers };
  }

  if (signals.passwordFieldPresent) return { pageCategory: "login", blockers };
  // The issuance-form marker OR the live-CONFIRMED credential-region anchor identifies the open-API page — the
  // latter is what the 2026-08-06 live run proved present (matchCount=1) on the already-issued page, whose form
  // marker was absent. Either beats the generic read-only-field heuristic, so the guided reach recognizes the
  // already-issued open-API page instead of dead-ending on `wing_home`.
  if (signals.openApiMarkerPresent || signals.credentialAnchorPresent) return { pageCategory: "open_api_issuance", blockers };
  if (signals.readonlyFieldCountBucket !== "none") return { pageCategory: "credential_shown", blockers };
  if (signals.listLikeContainerCountBucket !== "none") return { pageCategory: "wing_home", blockers };

  blockers.push("AMBIGUOUS_SIGNALS");
  return { pageCategory: "unknown", blockers };
}

/** Combine into the full sanitized observation. */
export function observeFrom(urlCategory: WingUrlCategory, census: WingStructuralCensus): WingObservation {
  const signals = toWingSignals(urlCategory, census);
  const { pageCategory, blockers } = classifyWingPage(signals);
  return { urlCategory, pageCategory, signals, blockers };
}

/* ────────────────────────────── issuance-runtime seam (branch + candidate markers) ────────────────────────────── */

/** What the issuance engine should do after a WING surface probe. */
export type WingProbeBranch = "login" | "wing_home" | "open_api" | "page_mismatch";

/**
 * **CANDIDATE / LIVE_DOM_CALIBRATION_PENDING.** Decide the next issuance stage from a probed page category.
 *
 *  - `login` → the run parks on `waiting_login` (the seller logs in themselves);
 *  - `wing_home` → the seller must reach the open-API issuance page (the reach_open_api transition-observe);
 *  - `open_api_issuance` → the seller is already on the issuance page — step 1 is done, guide 자체개발;
 *  - anything else (`credential_shown`, `unknown`, off-target) → fail-closed `page_mismatch` (never a guess).
 */
export function branchAfterWingProbe(pageCategory: WingPageCategory): {
  branch: WingProbeBranch;
  calibration: typeof LIVE_DOM_CALIBRATION_PENDING;
} {
  const branch: WingProbeBranch =
    pageCategory === "login"
      ? "login"
      : pageCategory === "wing_home"
        ? "wing_home"
        : pageCategory === "open_api_issuance"
          ? "open_api"
          : "page_mismatch";
  return { branch, calibration: LIVE_DOM_CALIBRATION_PENDING };
}

/** Reduce a raw structural census (+ a resolved url category) to the sanitized page category. */
export function wingPageCategoryFromCensus(
  urlCategory: WingUrlCategory,
  census: WingStructuralCensus,
): { pageCategory: WingPageCategory; signals: WingSignals } {
  const signals = toWingSignals(urlCategory, census);
  const { pageCategory } = classifyWingPage(signals);
  return { pageCategory, signals };
}

/**
 * **CANDIDATE / synthetic fixture markers ONLY.** The `[data-aw-target]` selector the synthetic fixture driver
 * uses to find its markers. The LIVE driver does NOT use these (it resolves fixed WING labels) — they are DATA
 * counted only by the fixture driver, NEVER emitted on the wire (the wire carries an opaque 16-hex signature).
 */
export const CANDIDATE_WING_TARGET_SELECTORS = {
  reach_open_api: "[data-aw-target='reach_open_api']",
  self_dev: "[data-aw-target='self_dev']",
  vendor_info: "[data-aw-target='vendor_info']",
  call_ip: "[data-aw-target='call_ip']",
  issue: "[data-aw-target='issue']",
  credentials: "[data-aw-target='credentials']",
  return: "[data-aw-target='return']",
} as const;

/* ────────────────────────────── URL screening (live entry, fail-closed BEFORE launch) ────────────────────────────── */

export type WingUrlScreenReason = "ok" | "invalid" | "placeholder" | "off_target";

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
    !url.includes("://")
  );
}

/**
 * Pre-launch screen for the operator-provided URL (fail-closed BEFORE Chrome launches). Rejects placeholder-like
 * values, unparseable URLs, and any host that is not the Coupang WING or auth host. Reads the URL; emits only a
 * reason enum + host category (never the raw URL).
 */
/** The public Coupang WING root. Not a secret — the default the recorder / guided run opens when the
 *  operator gives no URL. A specific page can still be passed explicitly (see {@link resolveWingUrl}). */
export const WING_DEFAULT_URL = "https://wing.coupang.com/";

/**
 * Resolve which WING URL to open WITHOUT treating the public host as a secret: an explicit `--url <u>` or a
 * bare `http(s)://…` positional arg wins; then `COUPANG_WING_URL` for operators who still prefer env; else the
 * public WING root {@link WING_DEFAULT_URL}. The caller still {@link screenWingUrl}-validates the host, so an
 * off-target host fails closed BEFORE any browser launch. Only the resulting host-category is ever logged —
 * the raw URL is never printed.
 */
export function resolveWingUrl(argv: readonly string[], env: Record<string, string | undefined>): string {
  const flagIdx = argv.indexOf("--url");
  const flagVal = flagIdx >= 0 ? argv[flagIdx + 1] : undefined;
  if (flagVal && flagVal.trim()) return flagVal.trim();
  const positional = argv.find((a) => /^https?:\/\//i.test(a));
  if (positional) return positional;
  const fromEnv = env.COUPANG_WING_URL;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return WING_DEFAULT_URL;
}

export function screenWingUrl(url: string): { ok: boolean; reason: WingUrlScreenReason; urlCategory: WingUrlCategory } {
  const urlCategory = classifyWingUrlCategory(url);
  if (looksLikePlaceholder(url)) return { ok: false, reason: "placeholder", urlCategory };
  if (urlCategory === "unknown") return { ok: false, reason: "invalid", urlCategory };
  if (urlCategory !== "wing_host" && urlCategory !== "coupang_auth_host") {
    return { ok: false, reason: "off_target", urlCategory };
  }
  return { ok: true, reason: "ok", urlCategory };
}

/* ────────────────────────────── WING selector-probe target scope ────────────────────────────── */

/**
 * The canonical WING selector-probe target names, in fixed order. The single source of truth the approval gate
 * validates a per-run probe SCOPE against (kept in this pure zero-import leaf so the gate need not import the
 * heavy recorder). A drift guard test ties this to the recorder's `WING_RECORD_TARGETS` so the two never diverge.
 * `delete` is the 삭제 control on the already-issued page — probeable read-only alongside `issue` / `credentials`.
 */
export const WING_PROBE_TARGET_NAMES = ["self_dev", "vendor_info", "call_ip", "issue", "credentials", "delete"] as const;
export type WingProbeTargetName = (typeof WING_PROBE_TARGET_NAMES)[number];

export type WingProbeScopeResult = { ok: true; targets: WingProbeTargetName[] } | { ok: false; reason: string };

/**
 * Resolve a per-run WING selector-probe SCOPE from a comma-separated request, fail-closed. A scoped probe lets one
 * calibration run measure only the targets it needs (e.g. `delete` alone, for the delete-selector calibration) —
 * strictly NARROWER than the full fixed set, never wider. Absent/empty ⇒ the full fixed set. Any unknown token
 * fails closed. The result is in canonical order + de-duplicated, so the manifest and the recorder agree exactly.
 */
export function resolveWingProbeScope(raw: string | undefined | null): WingProbeScopeResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: true, targets: [...WING_PROBE_TARGET_NAMES] };
  const requested = trimmed.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (requested.length === 0) return { ok: true, targets: [...WING_PROBE_TARGET_NAMES] };
  const known = WING_PROBE_TARGET_NAMES as readonly string[];
  const unknown = requested.filter((s) => !known.includes(s));
  if (unknown.length > 0) return { ok: false, reason: `unknown WING probe target(s): ${unknown.join(", ")}` };
  const targets = WING_PROBE_TARGET_NAMES.filter((t) => requested.includes(t));
  return { ok: true, targets };
}

/** Whether `targets` is a valid, NON-EMPTY, canonical-ordered subset of the fixed WING probe target set. */
export function isCanonicalWingProbeSubset(targets: readonly string[]): boolean {
  if (targets.length === 0) return false;
  const canonical = WING_PROBE_TARGET_NAMES.filter((t) => (targets as readonly string[]).includes(t));
  return canonical.length === targets.length && canonical.every((t, i) => t === targets[i]);
}

/**
 * The in-page structural sweep, as a **string** IIFE evaluated in the browser (generic HTML only — no WING
 * selectors, no value reads). It MUST be a string, not a passed function: tsx/esbuild instruments named/module
 * functions with a `__name` helper that does not exist in the page context, so a serialized function throws.
 * Returns counts/booleans only — it never reads any field VALUE (incl. Access/Secret keys), text, or URL. Kept
 * ES5-plain so it is robust across page runtimes. Shape matches {@link WingStructuralCensus}.
 */
export const EXTRACT_WING_CENSUS = `(function () {
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
  /* STRUCTURAL open-API-issuance marker (value-free OUTPUT: a single boolean). Compares an element's accessible
     name against the KNOWN fixed labels ONLY — the matched text is never returned. Bounded scan. */
  var MARKERS = ${JSON.stringify(WING_OPEN_API_MARKER_LABELS)};
  var CRED = ${JSON.stringify(WING_CREDENTIAL_ANCHOR_LABELS)};
  function nrm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function accNm(el) {
    var al = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (al && nrm(al).length) { return nrm(al); }
    return nrm(el.textContent || '');
  }
  var markerCands = slice(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading'],dt,dd,label,legend,strong,b,span,div,p,th"));
  var openApiMarkerPresent = false, credentialAnchorPresent = false, mi, mm, nm;
  for (mi = 0; mi < markerCands.length && mi < 6000 && (!openApiMarkerPresent || !credentialAnchorPresent); mi++) {
    nm = accNm(markerCands[mi]);
    if (!openApiMarkerPresent) { for (mm = 0; mm < MARKERS.length; mm++) { if (nm === MARKERS[mm]) { openApiMarkerPresent = true; break; } } }
    if (!credentialAnchorPresent) { for (mm = 0; mm < CRED.length; mm++) { if (nm === CRED[mm]) { credentialAnchorPresent = true; break; } } }
  }
  return {
    passwordFieldPresent: document.querySelector("input[type='password']") != null,
    submitAffordancePresent: document.querySelector("button[type='submit'], input[type='submit']") != null,
    formCount: document.querySelectorAll('form').length,
    editableTextInputCount: editableTextInputCount,
    readonlyFieldCount: readonlyFieldCount,
    listLikeContainerCount: listLikeContainerCount,
    openApiMarkerPresent: openApiMarkerPresent,
    credentialAnchorPresent: credentialAnchorPresent
  };
})()`;
