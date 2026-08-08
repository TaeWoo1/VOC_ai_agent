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
   * Whether the bounded marker/anchor scan stopped at its cap with candidates left unexamined. When true, an
   * ABSENT marker means "not found in the part we looked at", NOT "absent from the page" — so absence must not
   * be read as evidence. Optional for back-compat with hand-built fixtures; absent ⇒ treated as truncated=false.
   */
  markerScanTruncated?: boolean;
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
  /** The bounded marker/anchor scan stopped at its cap ⇒ an ABSENT marker proves nothing. */
  markerScanTruncated: boolean;
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
    markerScanTruncated: census.markerScanTruncated ?? false,
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

/* ────────────────────────────── recorded REAL evidence (the audit's inputs) ────────────────────────────── */

/**
 * The two real WING captures this module's honesty rests on, recorded as DATA so the comparison is checkable
 * rather than a claim in prose. Sanitized throughout: counts, booleans, enums and opaque signatures only.
 *
 * **`bucketsRetained: false` means NOT TRANSCRIBED, not "not measured".** That distinction, drawn when this
 * constant was written, is what made the next step obvious: numbers that were measured but not written down may
 * still exist somewhere. They did. On 2026-08-08 the issued-page buckets were **recovered from retained session
 * scrollback** — four independent captures, all agreeing — and both sides of the audit are now populated. No
 * live grant was spent. (The recovery is why `bucketsRetained` is now `true` on both records; had the search
 * come up empty, the honest record would have been `false` with the fields left absent, never a guess.)
 */
export interface WingRealEvidence {
  readonly capturedOn: string;
  /**
   * The sanitized record id(s) this evidence came from. Plural because the issued-page row is a UNION of two
   * runs with different approved scopes — see {@link WingRealEvidence.targetMatchCountSource}.
   */
  readonly recordIds: readonly string[];
  readonly surface: "already_issued_page" | "no_key_issuance_form";
  /** How the surface identity is known. The no-key form is operator-attested, not agent-derived. */
  readonly surfaceAttestation: "OPERATOR_CONFIRMED" | "AGENT_DERIVED";
  readonly pageCategory: WingPageCategory;
  readonly credentialAnchorPresent: boolean;
  readonly openApiMarkerPresent: boolean;
  /** Whether the structural count buckets were TRANSCRIBED into this record (not whether they were measured). */
  readonly bucketsRetained: boolean;
  readonly buckets: Readonly<Partial<Pick<WingSignals,
    "formCountBucket" | "editableTextInputCountBucket" | "readonlyFieldCountBucket" |
    "listLikeContainerCountBucket" | "submitAffordancePresent" | "markerScanTruncated">>>;
  /** Per-target fixed-label match counts on this surface. Absent key = target not in that run's approved scope. */
  readonly targetMatchCounts: Readonly<Partial<Record<WingProbeTargetName, number>>>;
  /**
   * Which run each target count came from. Required because a reader auditing one record id must not be misled
   * into looking for counts that a differently-scoped run produced.
   */
  readonly targetMatchCountSource: Readonly<Partial<Record<WingProbeTargetName, string>>>;
  /**
   * Opaque 16-hex structural signature of a target that resolved UNIQUELY (tag + document position + child
   * count). Present only for unique matches — the locate script emits none otherwise. Recorded because a
   * signature that is EQUAL across two surfaces says something a count cannot: the element sits at the same
   * document position with the same child count on both, i.e. the two pages render the same shell.
   */
  readonly targetSignatures: Readonly<Partial<Record<WingProbeTargetName, string>>>;
  /**
   * Which run each SIGNATURE came from — the same provenance discipline as `targetMatchCountSource`, and for a
   * sharper reason: in a UNION record a target's count and its signature can come from DIFFERENT runs, so
   * "this signature belongs to a target that matched once" is only checkable against the run that produced the
   * signature. Without this the pairing is a code comment, which is not evidence.
   */
  readonly targetSignatureSource: Readonly<Partial<Record<WingProbeTargetName, string>>>;
}

/**
 * The already-issued page, from FOUR real captures across 2026-08-06/07 — `wingrec_fc4cbafb42c8` and
 * `wingrec_b2e87f42abd1` (08-06, five-target scope), `wingrec_42985b029ddd` (08-07, five-target), and
 * `wingrec_c01e673ebc61` (08-07, approved scope `["delete"]`). All four reported the SAME four structural
 * buckets, and the three five-target runs reported the same per-target counts.
 *
 * The buckets here were **recovered from retained session scrollback on 2026-08-08**, not re-measured live: the
 * probe CLI printed the whole observation at the time and the terminal record survived. They are transcribed
 * verbatim from those four run outputs.
 *
 * `markerScanTruncated` is deliberately ABSENT rather than `false`: that field did not exist in the census on
 * 2026-08-06/07, so no reading of it was taken. Writing `false` would manufacture a measurement — the exact
 * move this record exists to prevent.
 *
 * `fc4cbafb42c8` is cited for its BUCKETS ONLY. It predates the `credentialAnchorPresent` signal by minutes, so
 * it holds no reading for that field and classified the same page as `wing_home` — its category and anchor are
 * artifacts of the code at that moment, not of the page. `pageCategory` / `credentialAnchorPresent` /
 * `openApiMarkerPresent` here come from the three later runs.
 */
export const WING_REAL_EVIDENCE_ISSUED_2026_08_07: WingRealEvidence = Object.freeze({
  capturedOn: "2026-08-07",
  recordIds: Object.freeze([
    "wingrec_fc4cbafb42c8",
    "wingrec_b2e87f42abd1",
    "wingrec_42985b029ddd",
    "wingrec_c01e673ebc61",
  ]),
  surface: "already_issued_page",
  surfaceAttestation: "OPERATOR_CONFIRMED",
  pageCategory: "open_api_issuance",
  credentialAnchorPresent: true,
  openApiMarkerPresent: false,
  bucketsRetained: true,
  buckets: Object.freeze({
    formCountBucket: "few",
    editableTextInputCountBucket: "many",
    readonlyFieldCountBucket: "none",
    listLikeContainerCountBucket: "many",
    submitAffordancePresent: false,
  }),
  targetMatchCounts: Object.freeze({ self_dev: 0, vendor_info: 9, call_ip: 0, issue: 1, credentials: 1, delete: 1 }),
  targetMatchCountSource: Object.freeze({
    self_dev: "wingrec_b2e87f42abd1",
    vendor_info: "wingrec_b2e87f42abd1",
    call_ip: "wingrec_b2e87f42abd1",
    issue: "wingrec_b2e87f42abd1",
    credentials: "wingrec_b2e87f42abd1",
    delete: "wingrec_c01e673ebc61",
  }),
  // The 2026-08-06 runs reported DIFFERENT sigs for the same two targets (`d3f775e8…` / `2b2479a8…`) with no
  // signature-code change in between — so sig16 tracks the page as rendered on the day: a drift detector, not
  // a cross-session identity. Do not treat an unchanged sig across sessions as an invariant.
  targetSignatures: Object.freeze({ issue: "b7ba43a8e788b4a8", credentials: "de6d35788c97ce5b" }),
  targetSignatureSource: Object.freeze({ issue: "wingrec_42985b029ddd", credentials: "wingrec_42985b029ddd" }),
});

/**
 * The REAL post-delete no-key issuance form (2026-08-08, `b5a52371`). The operator confirmed directly that this
 * was the no-key form — which is what turns `credentialAnchorPresent: true` here into a proven false positive
 * rather than a puzzle. It is NOT evidence the deletion failed.
 */
export const WING_REAL_EVIDENCE_NO_KEY_2026_08_08: WingRealEvidence = Object.freeze({
  capturedOn: "2026-08-08",
  recordIds: Object.freeze(["wingrec_b554c86c0f0b"]),
  surface: "no_key_issuance_form",
  surfaceAttestation: "OPERATOR_CONFIRMED",
  pageCategory: "open_api_issuance",
  credentialAnchorPresent: true,
  openApiMarkerPresent: false,
  bucketsRetained: true,
  buckets: Object.freeze({
    formCountBucket: "few",
    editableTextInputCountBucket: "many",
    readonlyFieldCountBucket: "none",
    listLikeContainerCountBucket: "many",
    submitAffordancePresent: false,
    markerScanTruncated: false,
  }),
  targetMatchCounts: Object.freeze({ self_dev: 0, vendor_info: 8, call_ip: 0, issue: 1 }),
  targetMatchCountSource: Object.freeze({
    self_dev: "wingrec_b554c86c0f0b",
    vendor_info: "wingrec_b554c86c0f0b",
    call_ip: "wingrec_b554c86c0f0b",
    issue: "wingrec_b554c86c0f0b",
  }),
  // Byte-identical to the issued page's `issue` signature from the previous day. The 발급 button sits at the
  // same document position with the same child count on BOTH surfaces — one more signal that does not separate
  // them, and concrete support for the shell-dominates hypothesis in `wingIssuedStateFrom`.
  targetSignatures: Object.freeze({ issue: "b7ba43a8e788b4a8" }),
  targetSignatureSource: Object.freeze({ issue: "wingrec_b554c86c0f0b" }),
});

/* ────────────────────────────── issued-state verdict (post-delete evidence) ────────────────────────────── */

/**
 * Whether the account's open-API key appears ISSUED, on the evidence of one sanitized observation.
 *
 * Why this exists. The first live deletion produced `pageCategory: open_api_issuance` both BEFORE and AFTER the
 * operator deleted their key — because the already-issued page classifies that way via the credential anchor,
 * and the post-delete issuance FORM classifies that way via the form marker. Same category, opposite meanings,
 * so the category alone said nothing about the deletion in either direction, and the outcome could only be
 * recorded as operator-attested. This is the derivation that turns the observation into machine-checkable
 * evidence, without reading a single value.
 */
export const WING_ISSUED_STATES = ["issued", "not_issued", "indeterminate"] as const;
export type WingIssuedState = (typeof WING_ISSUED_STATES)[number];

/** Why the verdict came out the way it did — a closed enum, never free text. */
export const WING_ISSUED_STATE_REASONS = [
  /**
   * **RETIRED as a verdict, 2026-08-08 — kept only so old records stay readable.** No code path emits it.
   * The 2026-08-08 real no-key form read `credentialAnchorPresent: true` with the operator confirming no key
   * existed, so the anchor is a proven FALSE POSITIVE for issued-state. See {@link wingIssuedStateFrom}.
   */
  "CREDENTIAL_ANCHOR_PRESENT",
  /**
   * **RETIRED as a verdict, 2026-08-08 — kept only so old records stay readable.** No code path emits it. The
   * form marker was `false` on the real no-key form (the labels are unvalidated), so this could only ever have
   * fired on a page neither real capture produced.
   */
  "FORM_MARKER_WITHOUT_CREDENTIAL_ANCHOR",
  /** Not the open-API surface at all (login / home / off-target) — the question does not apply here. */
  "NOT_OPEN_API_SURFACE",
  /**
   * On the open-API surface, but NO recorded signal separates issued from no-key. This is the honest verdict
   * for every real capture taken so far — see {@link wingIssuedStateFrom} for the evidence table.
   */
  "NO_DISCRIMINATING_SIGNAL",
  /** The bounded marker/anchor scan stopped at its cap — the reading is incomplete, so nothing is claimed. */
  "SCAN_TRUNCATED",
  /** No observation at all (the run never reached ready, or the observe read threw). */
  "NO_OBSERVATION",
] as const;
export type WingIssuedStateReason = (typeof WING_ISSUED_STATE_REASONS)[number];

/**
 * Derive the issued-state verdict from ONE sanitized observation. Pure and value-free.
 *
 * **As of 2026-08-08 this function cannot return `issued` or `not_issued`, and that is the correct behaviour.**
 * It is not a stub and not unfinished: it is fail-closed because no recorded signal separates the two states.
 *
 * The comparative audit of the only two real captures we have
 * ({@link WING_REAL_EVIDENCE_ISSUED_2026_08_07} vs {@link WING_REAL_EVIDENCE_NO_KEY_2026_08_08}):
 *
 * | Signal | real ISSUED page | real NO-KEY form | separates? |
 * |---|---|---|---|
 * | `pageCategory` | `open_api_issuance` | `open_api_issuance` | no |
 * | `credentialAnchorPresent` | `true` | **`true`** | **no — proven false positive** |
 * | `openApiMarkerPresent` | `false` | `false` | no |
 * | `self_dev` / `call_ip` matchCount | 0 / 0 | 0 / 0 | no |
 * | `vendor_info` matchCount | 9 | 8 | no (non-unique on both) |
 * | `issue` matchCount | 1 | 1 | no |
 * | `issue` sig16 | `b7ba43a8…` | **`b7ba43a8…`** | no — byte-identical |
 * | `formCountBucket` | `few` | `few` | no |
 * | `editableTextInputCountBucket` | `many` | `many` | no |
 * | `readonlyFieldCountBucket` | `none` | `none` | no |
 * | `listLikeContainerCountBucket` | `many` | `many` | no |
 * | `submitAffordancePresent` | `false` | `false` | no |
 *
 * **The table is now complete on both sides, and every single row matches.** Until 2026-08-08 the last five
 * rows read "never recorded" on the issued page, and `indeterminate` was a fail-closed default over missing
 * data. The issued-page buckets were then recovered from retained scrollback (four independent captures, all
 * agreeing) — so `NO_DISCRIMINATING_SIGNAL` is now a MEASURED result: the two surfaces are indistinguishable
 * across every sanitized signal this recorder captures. That is a stronger and much less comfortable statement
 * than "we do not know yet", and it is the one the evidence supports.
 *
 * The previous version returned `issued` from `credentialAnchorPresent` alone; the operator confirmed the
 * 2026-08-08 page was a genuine post-delete no-key form, so that verdict was **wrong on real data** — the
 * no-key form carries the fixed text "Access Key" too.
 *
 * **Why they match — the likely mechanism, stated as a hypothesis.** The census counts the WHOLE page. On a
 * WING screen the shell (navigation, search, menus) supplies most forms, inputs and list containers, so the
 * open-API region contributes a small minority of every count and cannot move a coarse bucket. Note in
 * particular `readonlyFieldCountBucket: "none"` on the ISSUED page: the displayed keys are not readonly inputs
 * at all. This is a hypothesis about why the signal is flat, not a finding — and it points at a REGION-SCOPED
 * census as the thing to measure next, rather than at any predicate over these page-global numbers.
 *
 * The equal `issue` signature is *consistent* with that hypothesis and no more. It cannot be strong evidence
 * for it, because the same handful of readings show sig16 changing on the same page between 2026-08-06 and
 * 08-07 — a quantity that unstable across sessions cannot simultaneously carry weight as a cross-session
 * structural identity. What the row does establish is the narrow thing the table is for: one more signal that
 * fails to separate the two surfaces.
 *
 * **`credentialAnchorPresent` is retained as a SURFACE signal.** `classifyWingPage` still uses it to reach
 * `open_api_issuance`, and that use is unaffected: both pages genuinely ARE the open-API surface. What it may
 * no longer do is stand alone as the issued-state verdict.
 *
 * **What could still restore a verdict.** Not the buckets — those are now known to be flat. Two candidates
 * remain, both MEASUREMENTS to take rather than rules to ship:
 *
 *   1. **The `credentials` target on the no-key form.** It matched 1 on the issued page (role `readonly-region`,
 *      under a `tagAncestor: "tr"` locator) and has NEVER been probed on the no-key form — that run's approved
 *      scope was `self_dev,vendor_info,call_ip,issue`. A credential shown in a table ROW is structurally
 *      different from the same words as static form text, so its count/role/signature may differ where the
 *      page-global census does not. This needs no new code: `credentials` is already a probe target, so a
 *      selector-probe run scoped to it would settle it. It is the cheapest untested discriminator we have.
 *   2. **A region-scoped census** — the same counts taken within the open-API region instead of the whole
 *      document. That is new code and a new sanitization review, and it should not be built before (1) is tried.
 *
 * Until one of those produces a real difference, `indeterminate` is the whole truth.
 */
export function wingIssuedStateFrom(observation: WingObservation | null): {
  state: WingIssuedState;
  reason: WingIssuedStateReason;
} {
  if (!observation) return { state: "indeterminate", reason: "NO_OBSERVATION" };
  const { pageCategory, signals } = observation;
  // Only the open-API surface could ever answer the question. login / wing_home / unknown / off-target cannot —
  // and an off-target host already forces `unknown` upstream, so it is covered by this same branch.
  if (pageCategory !== "open_api_issuance" && pageCategory !== "credential_shown") {
    return { state: "indeterminate", reason: "NOT_OPEN_API_SURFACE" };
  }
  // A truncated scan is an INCOMPLETE reading. Reported separately from "complete but undiscriminating" so the
  // two are never conflated in a record: one may improve with a better read, the other needs new evidence.
  if (signals.markerScanTruncated) return { state: "indeterminate", reason: "SCAN_TRUNCATED" };
  return { state: "indeterminate", reason: "NO_DISCRIMINATING_SIGNAL" };
}

/* ────────────────────────────── corroborated post-delete evidence ────────────────────────────── */

/** Why the corroborated verdict came out the way it did. */
export const WING_DELETION_EVIDENCE_REASONS = [
  /** Two or more INDEPENDENT readings all say `not_issued` — the standard for recording deletion evidence. */
  "STABLE_NOT_ISSUED",
  /** Fewer than two readings: a single reading cannot separate "nothing to show" from "not shown yet". */
  "SINGLE_READING_ONLY",
  /** The readings disagree, or at least one is not `not_issued` — no corroboration. */
  "READINGS_DISAGREE",
] as const;
export type WingDeletionEvidenceReason = (typeof WING_DELETION_EVIDENCE_REASONS)[number];

/**
 * Corroborate a post-delete claim across INDEPENDENT readings. Confirmed only when there are at least two and
 * every one of them says `not_issued`.
 *
 * **Since 2026-08-08 this can never return `confirmedNotIssued: true`, by construction** —
 * {@link wingIssuedStateFrom} no longer emits `not_issued` at all, because no recorded signal distinguishes an
 * issued page from a no-key form. The corroboration RULE is still correct and worth keeping intact: the moment a
 * real discriminator is measured, two agreeing readings remain the standard for recording deletion evidence.
 * What is gone is the input, not the rule. A caller must therefore treat post-delete state as **unavailable**
 * today, not as `false`.
 *
 * This exists because {@link wingIssuedStateFrom} cannot, from one reading, tell an unissued page from a page
 * that has not finished rendering — and the failure direction that matters is the false "deleted". Two readings
 * separated in time collapse a TRANSIENT ambiguity: a hydration race does not survive a second, later look,
 * while a genuinely unissued page reports the same thing every time. It is the same two-capture standard the
 * WING signature calibration already applies, applied to the state claim instead of the signature.
 *
 * **What it does NOT collapse**, stated plainly: a PERSISTENT fault — a credential XHR that fails every time,
 * a credential region moved into an iframe, a renamed anchor label — reproduces identically across readings and
 * yields two agreeing false `not_issued`. Corroboration raises the bar from "one unlucky moment" to "the page
 * consistently looks unissued"; it is not proof the key is gone.
 *
 * It also cannot ENFORCE independence: passing the same observation twice satisfies it. Callers must supply
 * readings from separate runs — this function checks agreement, not provenance.
 *
 * Deliberately NOT a majority vote: one `issued` or one `indeterminate` among the readings withholds the
 * verdict entirely. On an irreversible action, "mostly gone" is not a state worth reporting.
 */
export function wingDeletionEvidenceFrom(readings: readonly (WingObservation | null)[]): {
  confirmedNotIssued: boolean;
  reason: WingDeletionEvidenceReason;
  readingCount: number;
} {
  return corroborationVerdictFor(readings.map((r) => wingIssuedStateFrom(r).state));
}

/**
 * The corroboration RULE itself, over already-derived states. Split out from {@link wingDeletionEvidenceFrom}
 * for one reason: since `wingIssuedStateFrom` can no longer emit `not_issued`, the rule's `confirmedNotIssued`
 * branch is unreachable through the public entrypoint — review confirmed that hardcoding `allNotIssued = false`
 * passed the entire suite. A rule nothing can execute is a rule a refactor can delete silently.
 *
 * Exported so the rule is tested directly and stays correct for the day a real discriminator restores the
 * input. Callers doing evidence work should use {@link wingDeletionEvidenceFrom}, not this.
 */
export function corroborationVerdictFor(states: readonly WingIssuedState[]): {
  confirmedNotIssued: boolean;
  reason: WingDeletionEvidenceReason;
  readingCount: number;
} {
  if (states.length < 2) {
    return { confirmedNotIssued: false, reason: "SINGLE_READING_ONLY", readingCount: states.length };
  }
  const allNotIssued = states.every((s) => s === "not_issued");
  return {
    confirmedNotIssued: allNotIssued,
    reason: allNotIssued ? "STABLE_NOT_ISSUED" : "READINGS_DISAGREE",
    readingCount: states.length,
  };
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

/**
 * The env var carrying the scope the OPERATOR APPROVED — written by the preflight from the prepared manifest,
 * independently of the scope the run requests. Two separate variables is the point: a single one cannot detect
 * a run that measures something other than what was displayed.
 */
export const WING_APPROVED_TARGETS_ENV = "SELLEROPS_WING_APPROVED_TARGETS" as const;
/** The env var carrying the scope THIS RUN requests. */
export const WING_RUN_TARGETS_ENV = "SELLEROPS_WING_PROBE_TARGETS" as const;

/** Closed set of reasons a LIVE probe run is refused before it can measure anything. */
export const WING_PROBE_SCOPE_REFUSALS = [
  "MISSING_RUN_SCOPE",
  "EMPTY_RUN_SCOPE",
  "UNKNOWN_RUN_TARGET",
  "MISSING_APPROVED_SCOPE",
  "EMPTY_APPROVED_SCOPE",
  "UNKNOWN_APPROVED_TARGET",
  "SCOPE_APPROVAL_MISMATCH",
] as const;
export type WingProbeScopeRefusal = (typeof WING_PROBE_SCOPE_REFUSALS)[number];

export type GatedWingProbeScopeResult =
  | { ok: true; targets: WingProbeTargetName[] }
  | { ok: false; refusal: WingProbeScopeRefusal; reason: string };

/** Parse a comma list into canonical order, WITHOUT the "empty means everything" default. */
function parseCanonicalTargets(raw: string): { ok: true; targets: WingProbeTargetName[] } | { ok: false; unknown: string[] } {
  const requested = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const known = WING_PROBE_TARGET_NAMES as readonly string[];
  const unknown = requested.filter((s) => !known.includes(s));
  if (unknown.length > 0) return { ok: false, unknown };
  return { ok: true, targets: WING_PROBE_TARGET_NAMES.filter((t) => requested.includes(t)) };
}

/**
 * The LIVE probe's scope gate — deliberately stricter than {@link resolveWingProbeScope}, which the approval
 * MANIFEST uses and where an absent request legitimately means "the full fixed set".
 *
 * On a live run that default is the wrong way round: an unset variable would silently WIDEN the run past what
 * the operator approved, and every way of losing the scope (a forgotten export, a hand-typed command, a
 * dropped run env) widens rather than narrows. So a live run requires BOTH scopes to be explicit, non-empty,
 * canonical, and EQUAL:
 *
 *   - {@link WING_RUN_TARGETS_ENV} — what this run will measure;
 *   - {@link WING_APPROVED_TARGETS_ENV} — what the displayed manifest said, bound by the preflight.
 *
 * What this does and does not prove: a run whose scope was DROPPED, forgotten, or never bound is refused, and
 * so is one that disagrees with the approval binding. It does NOT prove the operator used the preflight — a
 * hand-typed pair of equal values passes, because neither variable is bound to the `approvalId`/`runId`. The
 * gate closes accidental widening, not a deliberate operator. Pure: no I/O, no clock, no process state.
 */
export function resolveGatedWingProbeScope(env: Record<string, string | undefined>): GatedWingProbeScopeResult {
  // OWN properties only, and strings only: an inherited key must not satisfy the gate, and a non-string must
  // refuse rather than throw on `.trim()`.
  const own = (k: string): string | undefined => {
    if (!Object.prototype.hasOwnProperty.call(env, k)) return undefined;
    const v = (env as Record<string, unknown>)[k];
    return typeof v === "string" ? v : undefined;
  };
  const rawRun = own(WING_RUN_TARGETS_ENV);
  const rawApproved = own(WING_APPROVED_TARGETS_ENV);

  if (rawRun === undefined) {
    return {
      ok: false,
      refusal: "MISSING_RUN_SCOPE",
      reason: `${WING_RUN_TARGETS_ENV} is not set — a live probe never defaults to every target; set the approved scope explicitly`,
    };
  }
  if (rawRun.trim().length === 0) {
    return { ok: false, refusal: "EMPTY_RUN_SCOPE", reason: `${WING_RUN_TARGETS_ENV} is empty — an empty scope is not "all targets" on a live run` };
  }
  if (rawApproved === undefined) {
    return {
      ok: false,
      refusal: "MISSING_APPROVED_SCOPE",
      reason: `${WING_APPROVED_TARGETS_ENV} is not set — run the preflight so the approved scope is bound to this run`,
    };
  }
  if (rawApproved.trim().length === 0) {
    return { ok: false, refusal: "EMPTY_APPROVED_SCOPE", reason: `${WING_APPROVED_TARGETS_ENV} is empty — re-run the preflight to bind a real approved scope` };
  }

  // The unrecognized TOKENS are never echoed — they come from an env value the operator may have mistyped a
  // credential, seller id, or path into, and this reason reaches stderr. A count is enough to act on.
  const run = parseCanonicalTargets(rawRun);
  if (!run.ok) {
    return { ok: false, refusal: "UNKNOWN_RUN_TARGET", reason: `${WING_RUN_TARGETS_ENV} names ${run.unknown.length} unrecognized target(s)` };
  }
  if (run.targets.length === 0) {
    return { ok: false, refusal: "EMPTY_RUN_SCOPE", reason: `${WING_RUN_TARGETS_ENV} names no target` };
  }

  const approved = parseCanonicalTargets(rawApproved);
  if (!approved.ok) {
    return {
      ok: false,
      refusal: "UNKNOWN_APPROVED_TARGET",
      reason: `${WING_APPROVED_TARGETS_ENV} names ${approved.unknown.length} unrecognized target(s)`,
    };
  }
  if (approved.targets.length === 0) {
    return { ok: false, refusal: "EMPTY_APPROVED_SCOPE", reason: `${WING_APPROVED_TARGETS_ENV} names no target` };
  }

  // Both are canonical-ordered and de-duplicated here, so this compares SETS, not typing order.
  const same = run.targets.length === approved.targets.length && run.targets.every((t, i) => t === approved.targets[i]);
  if (!same) {
    return {
      ok: false,
      refusal: "SCOPE_APPROVAL_MISMATCH",
      reason: `this run would measure [${run.targets.join(",")}] but the approved scope is [${approved.targets.join(",")}]`,
    };
  }
  return { ok: true, targets: run.targets };
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
  var MARKER_SCAN_CAP = 6000;
  var openApiMarkerPresent = false, credentialAnchorPresent = false, mi, mm, nm;
  for (mi = 0; mi < markerCands.length && mi < MARKER_SCAN_CAP && (!openApiMarkerPresent || !credentialAnchorPresent); mi++) {
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
    credentialAnchorPresent: credentialAnchorPresent,
    /* The scan is BOUNDED. If it stopped at the cap with candidates still unexamined, an ABSENT marker is
       "not found in the part we looked at" — not "not on the page". Callers that treat absence as evidence
       must know the difference. (Stopping early because BOTH were found is not truncation.) */
    markerScanTruncated: mi >= MARKER_SCAN_CAP && markerCands.length > MARKER_SCAN_CAP && !(openApiMarkerPresent && credentialAnchorPresent)
  };
})()`;
