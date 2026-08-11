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

/**
 * A WIDER ladder for counts that are large on a normal page. `CountBucket` saturates at `many` above 3, which is
 * fine for things that are normally absent and useless for things that are normally plentiful: on the live WING
 * open-API surface `editableTextInputCount` and `listLikeContainerCount` were BOTH already `many` before the
 * operator pressed anything, so neither could ever report an increase. A transition detector built only from
 * saturated buckets cannot detect a transition — that is not a tuning problem, it is an arithmetic one.
 */
export type WideCountBucket = "none" | "few" | "some" | "many" | "very_many";

/** `0 · 1–3 · 4–8 · 9–20 · >20`. Chosen so a modal or panel adding a handful of controls moves at least one step. */
export function wideCountBucket(n: number): WideCountBucket {
  if (n <= 0) return "none";
  if (n <= 3) return "few";
  if (n <= 8) return "some";
  if (n <= 20) return "many";
  return "very_many";
}

const COUNT_BUCKET_ORDER: readonly CountBucket[] = ["none", "few", "many"];
const WIDE_BUCKET_ORDER: readonly WideCountBucket[] = ["none", "few", "some", "many", "very_many"];

/** Rank a bucket for ORDER comparisons (did it go up?). Unknown values rank -1 so they never read as an increase. */
export function countBucketRank(b: CountBucket | undefined): number {
  return b === undefined ? -1 : COUNT_BUCKET_ORDER.indexOf(b);
}
export function wideCountBucketRank(b: WideCountBucket | undefined): number {
  return b === undefined ? -1 : WIDE_BUCKET_ORDER.indexOf(b);
}

/** Raw structural census returned by the in-page sweep — counts/booleans only, NEVER any value/text/url. */
export interface WingStructuralCensus {
  passwordFieldPresent: boolean;
  /**
   * **Reads EXACTLY `button[type='submit'], input[type='submit']` — and nothing else.** The name is broader than
   * the measurement, and that gap cost a live run: the 2026-08-09 reveal built its entire success criterion on
   * this flipping false→true, while WING's component library emits `<button type="button">`. The initial surface
   * reported `false` **while displaying the very `API Key 발급 받기` button the run highlighted**, so the criterion
   * was unreachable on WING markup, not merely unmet.
   *
   * It is NOT widened here: treating every `<button type="button">` as a submit affordance would make "a submit
   * control exists" false wherever any button is. Read it as "a form-submit-typed control exists", never as "the
   * page has an actionable control" — for that, see {@link actionControlCount}.
   *
   * The NAVER API-center census has a field of the SAME NAME with a byte-identical selector
   * (`observe-api-center.ts`), but it is a SEPARATE interface with its own in-page script, so changing this one
   * reaches none of it. An earlier version of this comment said they were shared and used that as the reason not
   * to rename; review corrected it. The real reason to defer is that the fix is a rename on BOTH surfaces, and
   * nobody has measured whether NAVER's controls are `type=submit` either — that surface plausibly carries the
   * same latent defect.
   */
  submitAffordancePresent: boolean;
  /**
   * A PAINTING dialog/modal container: `dialog[open]`, `[role='dialog']`, `[role='alertdialog']`, or
   * `[aria-modal='true']`. Generic HTML/ARIA only — no WING selector, no text. Added for the Stage-2 transition,
   * which the operator reported as a persistent surface the census could not see.
   */
  dialogLikePresent?: boolean;
  /**
   * PAINTING, enabled choice controls: `input[type=radio|checkbox]`, `[role='radio']`, `[role='option']`. A
   * purpose-SELECTION surface is the one shape most likely to add these, and the initial surface plausibly has
   * none — so unlike the saturated buckets, this one has room to rise. Counted, never read.
   */
  choiceControlCount?: number;
  /**
   * PAINTING, enabled interactive controls: `button`, `[role='button']`, `input[type=button|submit|reset]`,
   * `summary`. The most shape-agnostic transition signal available — cards, buttons and radios all add controls.
   * Bucketed with {@link wideCountBucket} rather than `countBucket` precisely because a real page has plenty.
   */
  actionControlCount?: number;
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
  /** See {@link WingStructuralCensus.submitAffordancePresent} — `type='submit'` only; NOT "an actionable control". */
  submitAffordancePresent: boolean;
  /** A painting dialog/modal container is present. Absent on a census taken before this signal existed. */
  dialogLikePresent?: boolean;
  /** Painting, enabled choice controls (radio/checkbox/role=radio/role=option). */
  choiceControlCountBucket?: CountBucket;
  /** Painting, enabled interactive controls, on the WIDE ladder so a busy page still has headroom. */
  actionControlCountBucket?: WideCountBucket;
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
    // The three transition signals are OPTIONAL end to end: a census taken before they existed (every recorded
    // capture up to and including the 2026-08-09 reveal run) has no value for them, and `undefined` must stay
    // distinguishable from a measured `false`/`none`. Defaulting them would manufacture a baseline nobody read,
    // which is the shape of every mistake this file's history is made of.
    ...(census.dialogLikePresent === undefined ? {} : { dialogLikePresent: census.dialogLikePresent }),
    ...(census.choiceControlCount === undefined ? {} : { choiceControlCountBucket: countBucket(census.choiceControlCount) }),
    ...(census.actionControlCount === undefined ? {} : { actionControlCountBucket: wideCountBucket(census.actionControlCount) }),
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

/**
 * The operator action this driver models — deliberately NOT `KEY_CREATION`. The operator presses 발급 once; on
 * the official Coupang flow that opens the 연동 방식 / configuration step, and the key is created only by a later
 * `확인`. Naming the two differently is the entire point: they are separately approvable operations, and this
 * driver can only ever prepare the first.
 */
export const WING_REVEAL_OPERATOR_ACTION = "REVEAL_WING_ISSUANCE_CONFIGURATION" as const;

/**
 * The operation this driver must NEVER prepare, declared as a constant so a guard test can assert no phase spec,
 * no manifest and no driver path in this file reaches it. Key creation is the operator's later `확인` press, and
 * it has no tooling at all yet — by design, until Stage-2 is observed.
 */
export const WING_KEY_CREATION_ACTION = "COMPLETE_WING_KEY_ISSUANCE" as const;

/** The env var carrying the phase THIS RUN declares. */
export const WING_APPROVAL_PHASE_ENV = "SELLEROPS_APPROVAL_PHASE" as const;
/**
 * The env var carrying the phase the DISPLAYED MANIFEST said, written back by that phase's preflight from the
 * manifest JSON — never from the run env it sourced. Two phase variables exist for the same reason the probe
 * scope has two: one variable cannot tell "this run is what the manifest described" from "this shell remembers
 * something from an earlier session".
 */
export const WING_APPROVED_PHASE_ENV = "SELLEROPS_WING_APPROVED_PHASE" as const;

/* ────────────────────────────── the action CLIs' phase binding ────────────────────────────── */

/**
 * **Which PHASE a live WING *action* run is authorized for — two variables, for the reason the probe scope needs
 * two.** Both WING action CLIs pin their phase in CODE and read only `WALKTHROUGH_*` for identity, so before this
 * existed the three identity variables were the ONLY thing standing between a run env and a CLI. They are
 * byte-identical across phases.
 *
 * The escalation that closes here, demonstrated by review against the real exports: bootstrap the REVEAL phase,
 * approve the reveal manifest ("not destructive · not key creation · one 발급 press"), source that run env into
 * the shell as the preflight instructs — then launch `run-coupang-wing-deletion-live.ts` by mistake, stale
 * history, or a wrong paste. The deletion gate returned PREPARED and would have highlighted 삭제 behind an
 * irreversible-deletion checkpoint, under a grant given for a non-destructive run.
 *
 *   - {@link WING_APPROVAL_PHASE_ENV} — the phase THIS RUN declares (written by the phase's bootstrap);
 *   - {@link WING_APPROVED_PHASE_ENV} — the phase the DISPLAYED MANIFEST said (written back by that phase's
 *     preflight, from the manifest JSON — never from the run env it sourced).
 *
 * A CLI requires both to be present and to equal the phase it implements. What this does NOT prove is the same
 * limit the probe scope gate states: a deliberate operator can hand-type either. It closes accidental
 * cross-phase reuse, which is the failure that actually happens.
 */
export const WING_ACTION_PHASE_REFUSALS = [
  "MISSING_RUN_PHASE",
  "MISSING_APPROVED_PHASE",
  "WRONG_RUN_PHASE",
  "PHASE_APPROVAL_MISMATCH",
] as const;
export type WingActionPhaseRefusal = (typeof WING_ACTION_PHASE_REFUSALS)[number];

export type WingActionPhaseResult = { ok: true } | { ok: false; refusal: WingActionPhaseRefusal; reason: string };

/**
 * Pure. `expected` is the phase the calling CLI implements — a compile-time constant at every call site, never
 * env-derived, so the comparison cannot be satisfied by pointing both variables at whatever the caller wants.
 */
export function resolveWingActionPhase(
  env: Record<string, string | undefined>,
  expected: string,
): WingActionPhaseResult {
  const own = (k: string): string | undefined => {
    if (!Object.prototype.hasOwnProperty.call(env, k)) return undefined;
    const v = (env as Record<string, unknown>)[k];
    return typeof v === "string" ? v : undefined;
  };
  // EXACT match, un-trimmed: the bootstraps and preflights use exact `case` allowlists, and a CLI must never be
  // more permissive about its own authorization than the harness that grants it.
  const runPhase = own(WING_APPROVAL_PHASE_ENV);
  const approvedPhase = own(WING_APPROVED_PHASE_ENV);
  if (runPhase === undefined || runPhase.length === 0) {
    return {
      ok: false,
      refusal: "MISSING_RUN_PHASE",
      reason: `${WING_APPROVAL_PHASE_ENV} is not set — a live WING action run never infers its phase from the identity variables alone`,
    };
  }
  if (approvedPhase === undefined || approvedPhase.length === 0) {
    return {
      ok: false,
      refusal: "MISSING_APPROVED_PHASE",
      reason: `${WING_APPROVED_PHASE_ENV} is not set — re-run this phase's preflight so the approved phase is bound to this run`,
    };
  }
  if (runPhase !== expected) {
    return {
      ok: false,
      refusal: "WRONG_RUN_PHASE",
      reason: `this entrypoint implements ${expected}, but the run env authorizes ${runPhase} — the grant does not cover this CLI`,
    };
  }
  if (approvedPhase !== expected) {
    return {
      ok: false,
      refusal: "PHASE_APPROVAL_MISMATCH",
      reason: `the displayed manifest approved ${approvedPhase}, not ${expected} — a run env from another phase is not an approval for this one`,
    };
  }
  return { ok: true };
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
  issue: "[data-aw-target='issue']",
  purpose_option: "[data-aw-target='purpose_option']",
  confirm_purpose: "[data-aw-target='confirm_purpose']",
  terms_consent: "[data-aw-target='terms_consent']",
  issue_final: "[data-aw-target='issue_final']",
  vendor_method: "[data-aw-target='vendor_method']",
  vendor_confirm: "[data-aw-target='vendor_confirm']",
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
/**
 * The names an ordinary selector probe may be pointed at.
 *
 * NOTE (2026-08-10): `self_dev` / `vendor_info` / `call_ip` no longer appear in the guided TUTORIAL — the
 * purpose screen offers no 자체개발, and 업체명 / 호출 IP matched hidden nodes only on every reading of every
 * screen across five granted runs. They stay HERE because this is a different vocabulary: what a read-only
 * probe may be pointed at, not what the tutorial guides. Retiring them from this list would silently make the
 * LABEL_RECON phase unreachable, which is a decision of its own and not a side effect of a tutorial change.
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
  /* Does the node RENDER? Applied ONLY to the three transition signals added in 2026-08-09's repair — the four
     counts above keep their original unfiltered meaning on purpose, because every recorded baseline was measured
     that way and silently changing what they count would invalidate the comparisons they exist for. */
  function paints(node) {
    if (!node || !node.getClientRects) { return false; }
    var cs = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) { return false; }
    if (cs && cs.display === 'contents') { return node.childElementCount > 0; }
    var rects = node.getClientRects();
    if (!rects || rects.length === 0) { return false; }
    var r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    return !!r && r.width > 0 && r.height > 0;
  }
  function enabled(node) { return !(node.disabled === true || (node.getAttribute && node.getAttribute('aria-disabled') === 'true')); }
  function countVisible(sel) {
    var els; try { els = slice(document.querySelectorAll(sel)); } catch (e) { return 0; }
    var n = 0;
    for (var q = 0; q < els.length; q++) { if (paints(els[q]) && enabled(els[q])) { n++; } }
    return n;
  }
  var dialogLikePresent = countVisible("dialog[open], [role='dialog'], [role='alertdialog'], [aria-modal='true']") > 0;
  var choiceControlCount = countVisible("input[type='radio'], input[type='checkbox'], [role='radio'], [role='option']");
  var actionControlCount = countVisible("button, [role='button'], input[type='button'], input[type='submit'], input[type='reset'], summary");
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
    dialogLikePresent: dialogLikePresent,
    choiceControlCount: choiceControlCount,
    actionControlCount: actionControlCount,
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

/* ────────────────────────── Stage-2 choice-control SHAPE census ────────────────────────── */

/**
 * The closed vocabularies the shape census may return. Anything the page presents that is not on these lists is
 * counted as `OTHER` / `other` — never echoed.
 *
 * That is the whole sanitization argument for this measurement. An open vocabulary would let the page choose the
 * strings in our record: a `role="사용목적-자체개발"` would arrive as page text wearing a category's clothes. A
 * closed list can only ever emit words WE wrote, so the output is bounded no matter what the DOM contains.
 */
export const WING_CONTROL_TAGS = ["INPUT", "LABEL", "BUTTON", "SELECT", "OPTION", "LI", "A", "SPAN", "DIV", "OTHER"] as const;
export type WingControlTag = (typeof WING_CONTROL_TAGS)[number];

export const WING_CONTROL_INPUT_TYPES = ["radio", "checkbox", "none", "other"] as const;
export type WingControlInputType = (typeof WING_CONTROL_INPUT_TYPES)[number];

export const WING_CONTROL_ROLES = ["radio", "checkbox", "option", "radiogroup", "listbox", "button", "none", "other"] as const;
export type WingControlRole = (typeof WING_CONTROL_ROLES)[number];

/** One shape bucket: a (tag, inputType, role) triple and how many painting, enabled controls had it. */
export interface WingControlShape {
  readonly tag: WingControlTag;
  readonly inputType: WingControlInputType;
  readonly role: WingControlRole;
  readonly count: number;
}

/**
 * What a Stage-2 choice-control shape reading contains. Integers and closed-vocabulary category names ONLY.
 *
 * Deliberately NOT here, and the reason each is refused: element text or accessible names (that is the recon
 * sweep's job, and it compares against labels WE fixed rather than returning the page's), `id` / `class` /
 * `name` / `data-*` (site-authored strings, and the `issue` calibration already got burned adopting one),
 * `value` / `placeholder` / `checked` (operator data, and `checked` would leak a selection), geometry, and
 * anything screenshot-shaped.
 */
export interface WingChoiceControlCensus {
  /**
   * Painting + enabled choice controls, by the same `paints()`/`enabled()` rules `choiceControlCount` uses —
   * with one difference worth stating: this scan is capped at 4000 elements and `countVisible` is uncapped, so
   * the two diverge above that. {@link scanTruncated} reports when the cap was reached.
   */
  readonly visibleChoiceControlCount: number;
  /**
   * Choice controls that matched the selector but were EXCLUDED — either they do not paint or they are disabled
   * (`disabled` / `aria-disabled`). It is the union, not "hidden" alone; the name is the shorter of the two and
   * this is the accurate reading.
   *
   * Reported because "0 visible" is ambiguous without it: a Stage-2 rendered but off-screen is a different
   * finding from a Stage-2 that is not there, and the `issue` locator's own live failure was exactly that pair
   * being indistinguishable.
   */
  readonly hiddenChoiceControlCount: number;
  /**
   * Shape buckets for the VISIBLE controls, descending by count then by category name (stable ordering).
   * Host-side sanitization caps this at 64 buckets and sets {@link bucketsTruncated} if it had to drop any —
   * silent loss would make a reading look complete when it is not.
   */
  readonly shapes: readonly WingControlShape[];
  /** True when more distinct shapes existed than the record carries. */
  readonly bucketsTruncated: boolean;
  /** Painting group containers: `fieldset`, `[role=radiogroup]`, `[role=listbox]`. Counted, never identified. */
  readonly groupContainerCount: number;
  /** True if the scan hit its cap with candidates unexamined — absence is then not evidence of absence. */
  readonly scanTruncated: boolean;
}

/**
 * **READ-ONLY shape census of Stage-2's choice controls. ES5-plain string, for the same reason as
 * {@link EXTRACT_WING_CENSUS}: tsx/esbuild injects a `__name` helper into serialized functions.**
 *
 * It answers "what KIND of controls are these" — radios? role-option cards? checkboxes? — which is the one thing
 * the reveal run's bucket delta could not say. It does not answer "what do they say"; nothing here reads text.
 */
export const EXTRACT_WING_CHOICE_CONTROL_SHAPES = `(function () {
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var TAGS = ${JSON.stringify(WING_CONTROL_TAGS)};
  var ITYPES = ${JSON.stringify(WING_CONTROL_INPUT_TYPES)};
  var ROLES = ${JSON.stringify(WING_CONTROL_ROLES)};
  var CAP = 4000;
  function paints(node) {
    if (!node || !node.getClientRects) { return false; }
    var cs = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) { return false; }
    if (cs && cs.display === 'contents') { return node.childElementCount > 0; }
    var rects = node.getClientRects();
    if (!rects || rects.length === 0) { return false; }
    var r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    return !!r && r.width > 0 && r.height > 0;
  }
  function enabled(node) { return !(node.disabled === true || (node.getAttribute && node.getAttribute('aria-disabled') === 'true')); }
  /* Closed-vocabulary mapping. An unlisted value becomes the catch-all — the page never picks our strings. */
  function pick(list, v, fallback) { return list.indexOf(v) === -1 ? fallback : v; }
  var els;
  try { els = slice(document.querySelectorAll("input[type='radio'], input[type='checkbox'], [role='radio'], [role='option']")); }
  catch (e) { els = []; }
  var visible = 0, hidden = 0, keys = {}, i, el, tag, itype, role, key;
  for (i = 0; i < els.length && i < CAP; i++) {
    el = els[i];
    if (!paints(el) || !enabled(el)) { hidden++; continue; }
    visible++;
    tag = pick(TAGS, String(el.tagName || '').toUpperCase(), 'OTHER');
    itype = String(el.tagName || '').toUpperCase() === 'INPUT' ? pick(ITYPES, String(el.type || ''), 'other') : 'none';
    role = el.getAttribute && el.getAttribute('role') ? pick(ROLES, String(el.getAttribute('role')), 'other') : 'none';
    key = tag + '|' + itype + '|' + role;
    keys[key] = (keys[key] || 0) + 1;
  }
  var shapes = [], k;
  for (k in keys) { if (Object.prototype.hasOwnProperty.call(keys, k)) {
    var parts = k.split('|');
    shapes.push({ tag: parts[0], inputType: parts[1], role: parts[2], count: keys[k] });
  } }
  shapes.sort(function (a, b) { return b.count - a.count || (a.tag + a.inputType + a.role < b.tag + b.inputType + b.role ? -1 : 1); });
  var groups;
  try { groups = slice(document.querySelectorAll("fieldset, [role='radiogroup'], [role='listbox']")); } catch (e2) { groups = []; }
  var groupContainerCount = 0;
  for (i = 0; i < groups.length; i++) { if (paints(groups[i])) { groupContainerCount++; } }
  return {
    visibleChoiceControlCount: visible,
    hiddenChoiceControlCount: hidden,
    shapes: shapes,
    groupContainerCount: groupContainerCount,
    scanTruncated: els.length > CAP
  };
})()`;

/**
 * Re-validate a shape reading HOST-side against the same closed vocabularies, and coerce every number.
 *
 * The in-page script already maps to the allow-lists, so this is defense in depth — but it is the cheap kind:
 * the value crossing the boundary is whatever `evaluate` returned, and a bug in the script (or a future edit
 * that forgets `pick`) would otherwise put an arbitrary page-authored string straight into a sanitized record.
 * Re-checking here means the record's vocabulary is guaranteed by code the page cannot influence at all.
 *
 * **`null` for an unusable reading**, like the containment and association sanitizers. This function used to
 * coerce `null`/`undefined`/a string/an array into a complete census reading `visibleChoiceControlCount: 0` —
 * a page that could not be read reported, with the same shape and confidence as a measurement, that Stage-2 has
 * no choice controls. Only a THROW produced a fault; a silent nothing produced a finding. That is the defect
 * this workstream keeps re-committing, and it was recorded on the previous unit as the next unit's first fix.
 *
 * Note what is deliberately NOT null: a well-formed object with junk fields. Those are the field-level coercions
 * this function exists for, and they are unchanged. The null branch is only for "the evaluation returned
 * something that is not a reading at all".
 */
export function sanitizeChoiceControlCensus(raw: unknown): WingChoiceControlCensus | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const inList = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
    typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;
  const rawShapes = Array.isArray(r.shapes) ? r.shapes : [];
  const MAX_BUCKETS = 64;
  const shapes: WingControlShape[] = rawShapes.slice(0, MAX_BUCKETS).map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return Object.freeze({
      tag: inList(WING_CONTROL_TAGS, o.tag, "OTHER"),
      inputType: inList(WING_CONTROL_INPUT_TYPES, o.inputType, "other"),
      role: inList(WING_CONTROL_ROLES, o.role, "other"),
      count: nat(o.count),
    });
  });
  return Object.freeze({
    visibleChoiceControlCount: nat(r.visibleChoiceControlCount),
    hiddenChoiceControlCount: nat(r.hiddenChoiceControlCount),
    shapes: Object.freeze(shapes),
    bucketsTruncated: rawShapes.length > MAX_BUCKETS,
    groupContainerCount: nat(r.groupContainerCount),
    scanTruncated: r.scanTruncated === true,
  });
}

/* ────────────────────── Stage-2 choice-control LABEL-ASSOCIATION census ────────────────────── */

/**
 * How a control's accessible name was DERIVED. Closed vocabulary, in the precedence order the script applies —
 * which is the ARIA accessible-name order restricted to the sources a native radio realistically uses.
 *
 * **This is a documented SUBSET of the accname algorithm, not the algorithm.** It does not implement
 * `aria-labelledby` recursion, `aria-owns`, CSS `::before`/`::after` content, or the `<legend>` fallback. Saying
 * so matters: a record that called this "the accessible name" would be claiming conformance it does not have,
 * which is the same shape as `role: "button"` — a property named after a standard, asserted from an instrument
 * that never computed it. What the record may say is *this* derivation, named as such.
 */
export const WING_NAME_SOURCES = ["ARIA_LABELLEDBY", "ARIA_LABEL", "LABEL_FOR", "LABEL_ANCESTOR", "TITLE", "NONE"] as const;
export type WingNameSource = (typeof WING_NAME_SOURCES)[number];

/**
 * A coarse bucket for the derived name's LENGTH. Never the name.
 *
 * Emitted because `NONE` and "a name none of our candidates match" are very different findings, and without a
 * magnitude the second is unactionable: a `short` name is a label like 자체개발, a `long` one is a sentence, and
 * knowing which tells the next unit whether to look for an option word or a description. Four buckets over a
 * character count is the same coarseness the sanitized layer already uses for counts and ratings.
 */
export const WING_NAME_LENGTH_BUCKETS = ["none", "short", "medium", "long"] as const;
export type WingNameLengthBucket = (typeof WING_NAME_LENGTH_BUCKETS)[number];

/** One VISIBLE choice control's association reading. Integers, booleans, closed categories — no page string. */
export interface WingChoiceAssociation {
  /** Document-order ordinal among the visible choice controls. Ours, not the page's. */
  readonly index: number;
  readonly nameSource: WingNameSource;
  readonly nameLengthBucket: WingNameLengthBucket;
  /** Index into the caller's OWN candidate list whose text equals the derived name, else -1. */
  readonly exactCandidateIndex: number;
  /**
   * Index of the first caller candidate CONTAINED in the derived name, else -1. This is the per-control half of
   * the whole-text hypothesis: `exact -1` with `contains 0` says the label is there, wrapped in more text.
   */
  readonly containsCandidateIndex: number;
  /** Whether the control carries an `id` at all — the precondition for a `label[for]` association existing. */
  readonly hasIdAttr: boolean;
  /** How many `label[for=<this id>]` elements exist. >1 is a real (and reportable) page defect. */
  readonly labelForCount: number;
  /**
   * 1 when the control is inside a `<label>` (implicit association), else 0. **0-or-1 by construction** —
   * `closest()` returns the nearest ancestor, so nested `<label>` wrappers still report 1. It cannot express
   * "labelled twice"; only {@link labelForCount} can.
   */
  readonly ancestorLabelCount: number;
  readonly ariaLabelledbyRefCount: number;
  /** How many of those references resolved to an element. A shortfall is a broken association, and it is common. */
  readonly ariaLabelledbyResolvedCount: number;
  /**
   * Ordinal of the radio-name group this control belongs to, assigned by first appearance; -1 when the control
   * carries no `name`.
   *
   * **This is the measurement the Stage-2 recon could not make.** HTML groups radios by their shared `name`, and
   * the shape census deliberately never reads that attribute — so "no painting fieldset/radiogroup/listbox" was
   * recorded, and a code comment over-claimed it as "the radios are ungrouped". An ordinal answers the real
   * question (are these two one group or two?) while emitting no site-authored string: the `name` VALUE is read
   * in-page to bucket by, and only its bucket number ever leaves.
   */
  readonly groupIndex: number;
}

/** The document-level association reading plus one row per visible choice control. */
export interface WingChoiceAssociationCensus {
  readonly visibleChoiceControlCount: number;
  /**
   * Controls that matched the selector but were EXCLUDED — either they do not paint or they are disabled. It is
   * the UNION, not "hidden" alone, exactly as on the shape census: the name is the shorter of the two and this
   * is the accurate reading. A painting-but-disabled radio is counted here, so this number must not be read as
   * "not on screen".
   */
  readonly hiddenChoiceControlCount: number;
  readonly rows: readonly WingChoiceAssociation[];
  /** True when more visible controls existed than the record carries — never a silently short list. */
  readonly rowsTruncated: boolean;
  /** Distinct `name` groups among the visible controls. */
  readonly nameGroupCount: number;
  readonly largestNameGroupSize: number;
  /** Visible controls with no `name` attribute — genuinely ungrouped, now measured rather than assumed. */
  readonly ungroupedCount: number;
  /**
   * True when the scan hit its element cap with controls unexamined. Reported for the same reason the shape
   * census reports it: a census over a prefix of the document is not a census of the document.
   */
  readonly scanTruncated: boolean;
  /** How many caller candidates the comparison ran against. A record cannot claim coverage it did not have. */
  readonly candidatesCompared: number;
}

/** Host-side row cap. A page cannot make this record grow without the truncation flag saying so. */
const MAX_ASSOCIATION_ROWS = 32;

/**
 * **READ-ONLY label-association census over Stage-2's choice controls.** ES5-plain string, same reason as
 * {@link EXTRACT_WING_CHOICE_CONTROL_SHAPES}.
 *
 * The shape census answered "what KIND of controls are these" (native radios). This answers "is each one
 * actually LABELLED, how, and does the label match anything we already believe" — without returning a single
 * page-authored character. Every string in the output vocabulary is one we wrote; the only page-derived values
 * are integers, booleans, a length bucket, and indices into the caller's own candidate list.
 *
 * **Not measured, deliberately:** `checked`. The shape census refuses it as a leaked selection, and this run's
 * whole premise is that no purpose has been selected — an instrument that could report one is an instrument that
 * could report the operator's choice.
 */
export function buildWingChoiceAssociationScript(candidates: readonly string[]): string {
  return `(function () {
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var CANDS = ${JSON.stringify(candidates)};
  var SOURCES = ${JSON.stringify(WING_NAME_SOURCES)};
  var CAP = 4000;
  function norm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function paints(node) {
    if (!node || !node.getClientRects) { return false; }
    var cs = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) { return false; }
    if (cs && cs.display === 'contents') { return node.childElementCount > 0; }
    var rects = node.getClientRects();
    if (!rects || rects.length === 0) { return false; }
    var r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    return !!r && r.width > 0 && r.height > 0;
  }
  function enabled(node) { return !(node.disabled === true || (node.getAttribute && node.getAttribute('aria-disabled') === 'true')); }
  function attr(el, k) { return el.getAttribute ? el.getAttribute(k) : null; }
  function bucket(n) { if (n === 0) { return 'none'; } if (n <= 8) { return 'short'; } if (n <= 24) { return 'medium'; } return 'long'; }
  /* Escape an id for a CSS attribute selector. Ids are read to FIND the label element and are never returned. */
  function forLabels(id) {
    if (!id) { return []; }
    try { return slice(document.querySelectorAll('label[for="' + String(id).replace(/["\\\\]/g, '\\\\$&') + '"]')); }
    catch (e) { return []; }
  }
  var els;
  try { els = slice(document.querySelectorAll("input[type='radio'], input[type='checkbox'], [role='radio'], [role='option']")); }
  catch (e0) { els = []; }
  var rows = [], visible = 0, hidden = 0, groups = [], ungrouped = 0, i, j;
  for (i = 0; i < els.length && i < CAP; i++) {
    var el = els[i];
    if (!paints(el) || !enabled(el)) { hidden++; continue; }
    visible++;
    /* ── derive the name, in ARIA precedence order (documented SUBSET — no labelledby recursion) ── */
    var name = '', source = 'NONE', refCount = 0, resolved = 0;
    var lb = attr(el, 'aria-labelledby');
    if (lb && norm(lb).length) {
      var ids = norm(lb).split(' '), parts = [];
      refCount = ids.length;
      for (j = 0; j < ids.length; j++) {
        var ref = null; try { ref = document.getElementById(ids[j]); } catch (e1) { ref = null; }
        if (ref) { resolved++; parts.push(norm(ref.textContent || '')); }
      }
      var joined = norm(parts.join(' '));
      if (joined.length) { name = joined; source = 'ARIA_LABELLEDBY'; }
    }
    if (!name.length) {
      var al = attr(el, 'aria-label');
      if (al && norm(al).length) { name = norm(al); source = 'ARIA_LABEL'; }
    }
    var id = attr(el, 'id');
    var fors = forLabels(id);
    if (!name.length && fors.length > 0) {
      var t = norm(fors[0].textContent || '');
      if (t.length) { name = t; source = 'LABEL_FOR'; }
    }
    var anc = el.closest ? el.closest('label') : null;
    if (!name.length && anc) {
      var at = norm(anc.textContent || '');
      if (at.length) { name = at; source = 'LABEL_ANCESTOR'; }
    }
    if (!name.length) {
      var ti = attr(el, 'title');
      if (ti && norm(ti).length) { name = norm(ti); source = 'TITLE'; }
    }
    if (SOURCES.indexOf(source) === -1) { source = 'NONE'; }
    /* ── compare against the CALLER's own fixed candidates; only an INDEX ever leaves ── */
    var exactIdx = -1, containsIdx = -1;
    for (j = 0; j < CANDS.length; j++) {
      var want = norm(CANDS[j]);
      if (!want.length) { continue; }
      if (exactIdx === -1 && name === want) { exactIdx = j; }
      if (containsIdx === -1 && name.indexOf(want) !== -1) { containsIdx = j; }
    }
    /* ── radio grouping by the shared \`name\` attribute: bucketed in-page, only the ORDINAL is returned ── */
    var gname = attr(el, 'name'), gidx = -1;
    if (gname !== null && String(gname).length > 0) {
      gidx = groups.indexOf(String(gname));
      if (gidx === -1) { groups.push(String(gname)); gidx = groups.length - 1; }
    } else { ungrouped++; }
    rows.push({
      index: visible - 1,
      nameSource: source,
      nameLengthBucket: bucket(name.length),
      exactCandidateIndex: exactIdx,
      containsCandidateIndex: containsIdx,
      hasIdAttr: !!(id && String(id).length > 0),
      labelForCount: fors.length,
      ancestorLabelCount: anc ? 1 : 0,
      ariaLabelledbyRefCount: refCount,
      ariaLabelledbyResolvedCount: resolved,
      groupIndex: gidx
    });
  }
  var sizes = {}, largest = 0, k;
  for (i = 0; i < rows.length; i++) { if (rows[i].groupIndex >= 0) { k = rows[i].groupIndex; sizes[k] = (sizes[k] || 0) + 1; if (sizes[k] > largest) { largest = sizes[k]; } } }
  return {
    visibleChoiceControlCount: visible,
    hiddenChoiceControlCount: hidden,
    rows: rows,
    nameGroupCount: groups.length,
    largestNameGroupSize: largest,
    ungroupedCount: ungrouped,
    scanTruncated: els.length > CAP,
    candidatesCompared: CANDS.length
  };
})()`;
}

/**
 * Re-validate an association reading HOST-side, exactly as {@link sanitizeChoiceControlCensus} does and for the
 * same reason: the in-page script maps to the closed vocabularies, and this guarantees the record's vocabulary
 * with code the page cannot influence at all.
 *
 * `candidateCount` is the caller's own list length. Both candidate indices are clamped into `[-1, count)`, so a
 * script bug (or a future edit that forgets the `-1` sentinel) can never make the record point at a candidate
 * that does not exist — a dangling index reads as a confident identification of nothing.
 */
export function sanitizeChoiceAssociationCensus(
  raw: unknown,
  candidates: readonly string[],
): WingChoiceAssociationCensus | null {
  // `null` for an unusable reading, for the same reason the containment sanitizer returns one: a page that
  // returned nothing must not become a complete census reporting zero controls. Only a THROW used to produce a
  // fault; a silent nothing produced a finding.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const cands = candidates.length;
  const idx = (v: unknown): number => {
    const n = typeof v === "number" && Number.isSafeInteger(v) ? v : -1;
    return n >= 0 && n < cands ? n : -1;
  };
  const inList = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
    typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;
  const rawRows = Array.isArray(r.rows) ? r.rows : [];
  const rows: WingChoiceAssociation[] = rawRows.slice(0, MAX_ASSOCIATION_ROWS).map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>;
    return Object.freeze({
      // The ordinal is OURS: re-derived from position so the page cannot renumber the rows it is described by.
      index: i,
      nameSource: inList(WING_NAME_SOURCES, o.nameSource, "NONE"),
      nameLengthBucket: inList(WING_NAME_LENGTH_BUCKETS, o.nameLengthBucket, "none"),
      exactCandidateIndex: idx(o.exactCandidateIndex),
      containsCandidateIndex: idx(o.containsCandidateIndex),
      hasIdAttr: o.hasIdAttr === true,
      labelForCount: nat(o.labelForCount),
      ancestorLabelCount: nat(o.ancestorLabelCount),
      ariaLabelledbyRefCount: nat(o.ariaLabelledbyRefCount),
      ariaLabelledbyResolvedCount: nat(o.ariaLabelledbyResolvedCount),
      groupIndex: typeof o.groupIndex === "number" && Number.isSafeInteger(o.groupIndex) && o.groupIndex >= 0 ? o.groupIndex : -1,
    });
  });
  return Object.freeze({
    visibleChoiceControlCount: nat(r.visibleChoiceControlCount),
    hiddenChoiceControlCount: nat(r.hiddenChoiceControlCount),
    rows: Object.freeze(rows),
    rowsTruncated: rawRows.length > MAX_ASSOCIATION_ROWS,
    nameGroupCount: nat(r.nameGroupCount),
    largestNameGroupSize: nat(r.largestNameGroupSize),
    ungroupedCount: nat(r.ungroupedCount),
    scanTruncated: r.scanTruncated === true,
    // The candidates actually COMPARED — blanks are skipped in-page (an empty string matches every name), so
    // counting them here would claim coverage the comparison did not have.
    candidatesCompared: candidates.filter((c) => c.trim().length > 0).length,
  });
}

/* ────────────────────── CONSENT-BLOCK recon: which checkbox belongs to which consent ────────────────────── */

/**
 * How a checkbox was tied to a consent sentence — or why it was not. Closed, and the failure values are the
 * point: this instrument exists because the 2026-08-10 terms reading found NO accessible association at all,
 * and the tempting next move is to pair box `i` with consent `i` by document order and call it measured.
 */
export const WING_CONSENT_BLOCK_VERDICTS = [
  "NEAREST_BLOCK_HOLDS_EXACTLY_ONE_CONSENT",
  "NEAREST_BLOCK_HOLDS_SEVERAL_CONSENTS",
  "NO_ANCESTOR_HOLDS_A_CONSENT_WITHIN_BOUND",
] as const;
export type WingConsentBlockVerdict = (typeof WING_CONSENT_BLOCK_VERDICTS)[number];

/** One VISIBLE checkbox's structural relationship to the consent sentences. Integers and categories only. */
export interface WingConsentBlockRow {
  /** Document-order ordinal among visible checkboxes. Ours, not the page's. */
  readonly index: number;
  readonly verdict: WingConsentBlockVerdict;
  /** Index into the caller's OWN consent list, or -1. Never a page string. */
  readonly consentIndex: number;
  /** How many ancestors up the matching block was, or -1. A bound on how loose the association is. */
  readonly ancestorDepth: number;
  /**
   * How many VISIBLE checkboxes that same block contains. **1 is the only value that makes the pairing a fact**
   * — a block holding both boxes contains both consents too, and identifies neither.
   */
  readonly blockVisibleCheckboxCount: number;
}

export interface WingConsentBlockCensus {
  readonly visibleCheckboxCount: number;
  readonly rows: readonly WingConsentBlockRow[];
  readonly rowsTruncated: boolean;
  /** Consents claimed by exactly one checkbox's nearest block. Equals the consent count ⇒ a clean 1:1 map. */
  readonly consentsMatchedExactlyOnce: number;
  readonly consentsCompared: number;
  readonly scanTruncated: boolean;
  readonly depthBound: number;
}

const MAX_CONSENT_ROWS = 16;
const CONSENT_ANCESTOR_DEPTH = 8;

/**
 * **Build the read-only consent-block probe.** Walks UP from each visible checkbox looking for the nearest
 * ancestor whose text contains exactly one caller-supplied consent sentence.
 *
 * Up rather than down, and nearest rather than any, because the question is "which consent is THIS box's" and
 * every checkbox has the whole page as an ancestor. A block that holds both consents answers nothing, and the
 * script says so (`NEAREST_BLOCK_HOLDS_SEVERAL_CONSENTS`) instead of picking the first.
 *
 * Reads no `checked`, sets nothing, clicks nothing. Every value returned is an integer, a boolean, or a name
 * from the closed vocabulary above; the consent strings go IN and only indices come back.
 */
export function buildWingConsentBlockScript(consents: readonly string[]): string {
  const encoded = JSON.stringify(consents.map((c) => String(c)));
  return `(function () {
  var CONSENTS = ${encoded};
  var MAX_ROWS = ${MAX_CONSENT_ROWS}, DEPTH = ${CONSENT_ANCESTOR_DEPTH}, SCAN_CAP = 4000;
  function slice(n) { return Array.prototype.slice.call(n); }
  function norm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').replace(/^ | $/g, ''); }
  function paints(el) {
    try {
      var cs = window.getComputedStyle(el);
      if (!cs || cs.display === 'none' || cs.visibility === 'hidden') { return false; }
      if (el.getClientRects && el.getClientRects().length === 0) { return false; }
      var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      return !!r && r.width > 0 && r.height > 0;
    } catch (e) { return false; }
  }
  var all;
  try { all = slice(document.querySelectorAll("input[type='checkbox']")); } catch (e2) { all = []; }
  var scanTruncated = all.length > SCAN_CAP;
  if (scanTruncated) { all = all.slice(0, SCAN_CAP); }
  var boxes = [], i, j, d;
  for (i = 0; i < all.length; i++) { if (paints(all[i])) { boxes.push(all[i]); } }
  var rows = [], claims = [];
  for (j = 0; j < CONSENTS.length; j++) { claims.push(0); }
  var capped = boxes.slice(0, MAX_ROWS);
  for (i = 0; i < capped.length; i++) {
    var node = capped[i], depth = -1, hit = -1, several = false;
    for (d = 1; d <= DEPTH; d++) {
      node = node && node.parentElement;
      if (!node) { break; }
      var text = norm(node.textContent || '');
      var found = [];
      for (j = 0; j < CONSENTS.length; j++) {
        var want = norm(CONSENTS[j]);
        if (want.length > 0 && text.indexOf(want) !== -1) { found.push(j); }
      }
      if (found.length > 0) { depth = d; hit = found[0]; several = found.length > 1; break; }
    }
    var blockBoxes = 0;
    if (depth > -1) {
      var container = capped[i];
      for (d = 0; d < depth; d++) { container = container.parentElement; }
      var inner;
      try { inner = slice(container.querySelectorAll("input[type='checkbox']")); } catch (e3) { inner = []; }
      for (d = 0; d < inner.length; d++) { if (paints(inner[d])) { blockBoxes++; } }
    }
    var verdict = depth === -1
      ? 'NO_ANCESTOR_HOLDS_A_CONSENT_WITHIN_BOUND'
      : several ? 'NEAREST_BLOCK_HOLDS_SEVERAL_CONSENTS' : 'NEAREST_BLOCK_HOLDS_EXACTLY_ONE_CONSENT';
    if (verdict === 'NEAREST_BLOCK_HOLDS_EXACTLY_ONE_CONSENT' && blockBoxes === 1) { claims[hit] = claims[hit] + 1; }
    rows.push({
      index: i,
      verdict: verdict,
      consentIndex: several ? -1 : hit,
      ancestorDepth: depth,
      blockVisibleCheckboxCount: blockBoxes
    });
  }
  var once = 0;
  for (j = 0; j < claims.length; j++) { if (claims[j] === 1) { once++; } }
  return {
    visibleCheckboxCount: boxes.length,
    rows: rows,
    rowsTruncated: boxes.length > MAX_ROWS,
    consentsMatchedExactlyOnce: once,
    consentsCompared: CONSENTS.length,
    scanTruncated: scanTruncated,
    depthBound: DEPTH
  };
})()`;
}

/**
 * Re-validate a consent-block reading HOST-side. `null` for an unusable reading — never a census reporting zero
 * checkboxes, which is the coercion the other three sanitizers each had to have removed.
 */
export function sanitizeConsentBlockCensus(raw: unknown, consents: readonly string[]): WingConsentBlockCensus | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const count = consents.filter((c) => c.trim().length > 0).length;
  const idx = (v: unknown): number => {
    const n = typeof v === "number" && Number.isSafeInteger(v) ? v : -1;
    return n >= 0 && n < count ? n : -1;
  };
  const rawRows = Array.isArray(r.rows) ? r.rows : [];
  const rows: WingConsentBlockRow[] = rawRows.slice(0, MAX_CONSENT_ROWS).map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const verdict: WingConsentBlockVerdict =
      typeof o.verdict === "string" && (WING_CONSENT_BLOCK_VERDICTS as readonly string[]).includes(o.verdict)
        ? (o.verdict as WingConsentBlockVerdict)
        : "NO_ANCESTOR_HOLDS_A_CONSENT_WITHIN_BOUND";
    // Re-derived from position, like the association census: an index the page chose is an index we did not.
    const depth = typeof o.ancestorDepth === "number" && Number.isSafeInteger(o.ancestorDepth) && o.ancestorDepth >= 1 && o.ancestorDepth <= CONSENT_ANCESTOR_DEPTH ? o.ancestorDepth : -1;
    return Object.freeze({
      index: i,
      verdict,
      // Only the ONE clean verdict may carry a consent index. The other two mean "we could not say which".
      consentIndex: verdict === "NEAREST_BLOCK_HOLDS_EXACTLY_ONE_CONSENT" ? idx(o.consentIndex) : -1,
      ancestorDepth: verdict === "NO_ANCESTOR_HOLDS_A_CONSENT_WITHIN_BOUND" ? -1 : depth,
      blockVisibleCheckboxCount: nat(o.blockVisibleCheckboxCount),
    });
  });
  const once = nat(r.consentsMatchedExactlyOnce);
  return Object.freeze({
    visibleCheckboxCount: nat(r.visibleCheckboxCount),
    rows: Object.freeze(rows),
    rowsTruncated: rawRows.length > MAX_CONSENT_ROWS || r.rowsTruncated === true,
    // Clamped: a script bug must not be able to claim more clean pairings than there are consents.
    consentsMatchedExactlyOnce: Math.min(once, count),
    consentsCompared: count,
    scanTruncated: r.scanTruncated === true,
    depthBound: CONSENT_ANCESTOR_DEPTH,
  });
}

/**
 * **Are ALL of the seller's consents ticked?** One boolean, and nothing else.
 *
 * This is the only place in the codebase that looks at a consent checkbox's `checked`, and it exists so the
 * guided walk can move on when the seller has finished consenting instead of asking them to press "다음" to
 * report what the page already shows. The product principle it serves changed deliberately on 2026-08-10; the
 * one it does NOT change is that **SellerOps never ticks a box, never reads the terms, and never decides
 * anything on the seller's behalf.** Observing that a human consented is not consenting for them.
 *
 * **The individual states never cross the boundary.** The conjunction is computed IN THE PAGE, so what returns
 * is a single aggregate boolean — not two booleans, not a count, not a per-row verdict. A caller cannot learn
 * which box the seller ticked first, or that they ticked one and not the other, because that information is
 * never serialized out. Callers must use it only to decide advancement: never store, transmit, or log it.
 *
 * Pairing is the MEASURED structural one (`buildWingConsentBlockScript`): a consent's box is the single visible
 * checkbox inside the nearest ancestor holding exactly that one consent sentence. Fail-closed — if any consent
 * does not resolve to exactly one such box, the answer is `false` ("not proven complete"), never `true`.
 */
export function buildWingConsentCompleteScript(consents: readonly string[]): string {
  const encoded = JSON.stringify(consents.map((c) => String(c)));
  return `(function () {
  var CONSENTS = ${encoded};
  var MAX_ROWS = ${MAX_CONSENT_ROWS}, DEPTH = ${CONSENT_ANCESTOR_DEPTH}, SCAN_CAP = 4000;
  function slice(n) { return Array.prototype.slice.call(n); }
  function norm(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').replace(/^ | $/g, ''); }
  function paints(el) {
    try {
      var cs = window.getComputedStyle(el);
      if (!cs || cs.display === 'none' || cs.visibility === 'hidden') { return false; }
      if (el.getClientRects && el.getClientRects().length === 0) { return false; }
      var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      return !!r && r.width > 0 && r.height > 0;
    } catch (e) { return false; }
  }
  if (CONSENTS.length === 0) { return false; }
  var all;
  try { all = slice(document.querySelectorAll("input[type='checkbox']")); } catch (e2) { return false; }
  if (all.length > SCAN_CAP) { all = all.slice(0, SCAN_CAP); }
  var boxes = [], i, j, d;
  for (i = 0; i < all.length; i++) { if (paints(all[i])) { boxes.push(all[i]); } }
  var capped = boxes.slice(0, MAX_ROWS);
  /* Per consent: the count of uniquely-paired visible boxes, and how many of those are ticked. */
  var paired = [], ticked = [];
  for (j = 0; j < CONSENTS.length; j++) { paired.push(0); ticked.push(0); }
  for (i = 0; i < capped.length; i++) {
    var node = capped[i], depth = -1, hit = -1, several = false;
    for (d = 1; d <= DEPTH; d++) {
      node = node && node.parentElement;
      if (!node) { break; }
      var text = norm(node.textContent || '');
      var found = [];
      for (j = 0; j < CONSENTS.length; j++) {
        var want = norm(CONSENTS[j]);
        if (want.length > 0 && text.indexOf(want) !== -1) { found.push(j); }
      }
      if (found.length > 0) { depth = d; hit = found[0]; several = found.length > 1; break; }
    }
    if (depth === -1 || several) { continue; }
    var container = capped[i];
    for (d = 0; d < depth; d++) { container = container.parentElement; }
    var inner;
    try { inner = slice(container.querySelectorAll("input[type='checkbox']")); } catch (e3) { inner = []; }
    var blockBoxes = 0;
    for (d = 0; d < inner.length; d++) { if (paints(inner[d])) { blockBoxes++; } }
    if (blockBoxes !== 1) { continue; }
    paired[hit] = paired[hit] + 1;
    if (capped[i].checked === true) { ticked[hit] = ticked[hit] + 1; }
  }
  /* Fail closed: EVERY consent must have resolved to exactly one box, and that box must be ticked. */
  for (j = 0; j < CONSENTS.length; j++) {
    if (paired[j] !== 1 || ticked[j] !== 1) { return false; }
  }
  return true;
})()`;
}
