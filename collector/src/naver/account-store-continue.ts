import type { BrowserContext, Page } from "playwright";
import { log } from "../log";
import { collectSelectionSurface, type CollectedSelection } from "./account-store-collect";
import type {
  ContinuationDecisionKind,
  ExpectedContinueCard,
  ExpectedIdentity,
  ResolverSurface,
  SanitizedContinuationCard,
  SanitizedContinueControl,
} from "./account-store-resolver";
import { planExportAction, type ExportActionPlan, type ExportLayout } from "./export-classify";
import type { CountBucket } from "./export-probe";
import { checkLiveSessionVerdict, sessionVerdictFromContent, urlCategory } from "./session-check";
import type { SessionVerdict } from "./session-verdict";

/**
 * GUARDED CONTINUE boundary — performs EXACTLY ONE click, and only when the no-click state
 * proves it is safe (Milestone G, PR3). It mirrors `review-export.ts`'s `strictSingleCandidate`
 * discipline (one selector, count must be 1, no fallback, no retry) and the
 * `capture-export-same-session` gate-then-act shape (the pure gate is the single chokepoint).
 *
 * The ONLY surface it ever acts on is the single-account Commerce `reconnect-continue` screen
 * for an already-logged-in human, where the displayed account's continuation-card fingerprint
 * matches the operator's expected fingerprint AND exactly one control matches the validated
 * safe-continue rule. Everything else halts WITHOUT clicking. It NEVER automates NAVER-ID
 * login, never bypasses 2FA/CAPTCHA/security re-check, never triggers an export, never
 * downloads/uploads, never mutates a DB, and writes NO status record.
 *
 * The one click is located via an INDEX-ONLY stamp the pure core's safe rule proved
 * (`data-sellerops-cand="<safeIndex>"`, set by `collectSelectionSurface({ stampForClick })` on
 * the top document only). All output is sanitized (enums / buckets / booleans) — never a raw
 * store/account name, id, URL, query, HTML, cookie, storage value, or token.
 */

const CONTINUE_CLICK_TIMEOUT_MS = 8_000;
// The Commerce reconnect→Seller-Center transition is an SPA/router navigation that can take
// ~1s+; a single immediate post-click read sees the stale reconnect DOM. Poll within a bounded
// window and stop EARLY on the first success signal (live-confirmed: idx 1 advanced ~1s later).
const POST_CLICK_POLL_TIMEOUT_MS = 20_000;
const POST_CLICK_POLL_INTERVAL_MS = 1_000;
// After the poll advances via a SOFT signal (e.g. urlCategory→seller-center) while verdict/surface
// are still hydrating, a brief bounded read-only confirmation prefers a content-confirmed state
// (LOGGED_IN / review-ready / actionable). A few ticks only — NOT another long loop.
const POST_CLICK_CONFIRM_MAX_CHECKS = 4;
/** Index-only locator attribute stamped by `collectSelectionSurface({ stampForClick })`. */
const CAND_INDEX_ATTR = "data-sellerops-cand";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Same bucket thresholds as `export-probe.ts` (kept local so this stays a leaf). */
function bucket(n: number): CountBucket {
  if (n <= 0) return "none";
  if (n === 1) return "one";
  if (n <= 5) return "few";
  if (n <= 20) return "some";
  return "many";
}

/**
 * Pure decision of the gate that returns CONTINUE_ALLOWED — every "never click" rule lives
 * here. `ALREADY_READY` (already logged in) and `CONTINUE_ALLOWED` are the only non-HALT
 * kinds, and only `CONTINUE_ALLOWED` carries a `clickCandidateIndex`.
 */
export type ContinueGateKind =
  | "CONTINUE_ALLOWED"
  | "ALREADY_READY"
  | "HALT_LOGIN_REQUIRED"
  | "HALT_AUTH_CHALLENGE"
  | "HALT_UNKNOWN_VERDICT"
  | "HALT_FINGERPRINT_UNCONFIGURED"
  | "HALT_SURFACE"
  | "HALT_FINGERPRINT_MISMATCH"
  | "HALT_NO_SAFE_CONTROL"
  | "HALT_MULTIPLE_SAFE_CONTROLS"
  | "HALT_NEGATIVE_MARKER"
  | "HALT_NOT_READY";

export interface ContinueGate {
  kind: ContinueGateKind;
  /** Set ONLY for `CONTINUE_ALLOWED` — the proven single safe candidate index. */
  clickCandidateIndex?: number;
  /** Content-free, operator-facing explanation. */
  detail: string;
}

/** The sanitized slice of a `CollectedSelection` the pure gate needs (no raw values). */
export interface ContinueGateInput {
  surface: ResolverSurface;
  continuationCard: SanitizedContinuationCard;
  continueControls: SanitizedContinueControl[];
}

/** The boundary's outcome — the gate kinds (minus CONTINUE_ALLOWED) plus the action results. */
export type ContinueOutcome =
  | Exclude<ContinueGateKind, "CONTINUE_ALLOWED">
  | "CONTINUED"
  | "HALT_SELECTOR_NOT_UNIQUE";

export type UrlCategory = "login" | "seller-center" | "other";

/** One bounded-poll observation of the post-click page (all sanitized). */
export interface PostClickObservation {
  verdict: SessionVerdict;
  surface: ResolverSurface;
  urlCategory: UrlCategory;
  exportActionable: boolean;
}

/**
 * Pure: has the post-click page reached a success/terminal-advance state? Any one signal is
 * enough — the SPA exposes them at slightly different moments. `surface === "review-ready"` is
 * itself derived from `verdict === "LOGGED_IN"`, but it is listed for clarity. Used as the
 * EARLY-STOP predicate for the bounded post-click poll; if none ever holds within the window we
 * conclude non-advance (still on reconnect/login). It NEVER triggers a click or any action.
 */
export function postClickAdvanced(obs: PostClickObservation): boolean {
  return (
    obs.verdict === "LOGGED_IN" ||
    obs.urlCategory === "seller-center" ||
    obs.surface === "review-ready" ||
    obs.exportActionable
  );
}

/**
 * One post-click read. `observed` carries a clean sanitized observation; `pending_navigation`
 * means the read landed while the SPA/router was mid-navigation (a TRANSIENT state, not a
 * failure) — it carries NO data and NO raw error text. The poll treats pending as "not advanced,
 * keep polling".
 */
export type PostClickReadKind = "observed" | "pending_navigation";
export interface PostClickRead {
  kind: PostClickReadKind;
  obs?: PostClickObservation;
  collected?: CollectedSelection;
  exportPlan?: ExportActionPlan;
}

export interface PollPostClickOptions {
  maxChecks: number;
  intervalMs: number;
  /** Injectable for tests; defaults to a real timer. */
  sleepFn?: (ms: number) => Promise<void>;
}

export interface PollPostClickResult {
  advanced: boolean;
  checks: number;
  /** The last CLEAN observed read, or the last (pending) read if none ever observed. */
  read: PostClickRead;
  everObserved: boolean;
}

/**
 * Pure/injectable bounded poll. Calls `observeFn` up to `maxChecks` times; a thrown error or a
 * `pending_navigation` read is treated as a transient non-advance (keep polling) — it NEVER
 * throws. Stops EARLY the first time an `observed` read satisfies `postClickAdvanced`; otherwise
 * runs to the bound and reports non-advance. Never clicks — it only observes. Browser-free, so
 * the success/transient/timeout behavior is fully unit-testable via a fake `observeFn`.
 */
export async function pollPostClickUntilAdvanced(
  observeFn: () => Promise<PostClickRead>,
  options: PollPostClickOptions,
): Promise<PollPostClickResult> {
  const doSleep = options.sleepFn ?? sleep;
  const maxChecks = Math.max(1, options.maxChecks);
  let lastObserved: PostClickRead | undefined;
  let lastRead: PostClickRead = { kind: "pending_navigation" };
  let advanced = false;
  let checks = 0;
  for (let i = 0; i < maxChecks; i += 1) {
    checks = i + 1;
    let read: PostClickRead;
    try {
      read = await observeFn();
    } catch {
      // A read that throws mid-navigation is transient — never fatal, never raw error text.
      read = { kind: "pending_navigation" };
    }
    lastRead = read;
    if (read.kind === "observed") {
      lastObserved = read;
      if (read.obs && postClickAdvanced(read.obs)) {
        advanced = true;
        break;
      }
    }
    if (i < maxChecks - 1) await doSleep(options.intervalMs);
  }
  return { advanced, checks, read: lastObserved ?? lastRead, everObserved: lastObserved !== undefined };
}

/**
 * Pure: is this a CONTENT-confirmed advance (verdict/markers, not just the URL)? `urlCategory ===
 * "seller-center"` alone advances the poll but can be observed before the Seller-Center SPA has
 * hydrated, leaving verdict/surface UNKNOWN; this distinguishes that soft state from a settled one.
 */
export function isContentConfirmed(obs: PostClickObservation): boolean {
  return obs.verdict === "LOGGED_IN" || obs.surface === "review-ready" || obs.exportActionable;
}

export interface ConfirmPostClickOptions {
  maxChecks: number;
  intervalMs: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface ConfirmPostClickResult {
  /** The chosen read: a later content-confirmed read if one appeared, else the original advance. */
  read: PostClickRead;
  /** True iff a content-confirmed read was adopted (an upgrade — never a downgrade). */
  upgraded: boolean;
  checks: number;
}

/**
 * Pure/injectable bounded CONFIRMATION. Runs only AFTER the poll already advanced. If the advancing
 * read is already content-confirmed it returns immediately (no extra reads, no downgrade). Otherwise
 * it waits a tick and re-observes up to `maxChecks` times, ADOPTING the first content-confirmed read
 * (an upgrade) and otherwise KEEPING the original advance (never downgrades to a worse/unknown read).
 * A thrown/`pending_navigation` read is transient — skipped, never fatal. READ-ONLY: never clicks.
 */
export async function confirmAdvancedPostClickState(
  current: PostClickRead,
  observeFn: () => Promise<PostClickRead>,
  options: ConfirmPostClickOptions,
): Promise<ConfirmPostClickResult> {
  if (current.kind === "observed" && current.obs && isContentConfirmed(current.obs)) {
    return { read: current, upgraded: false, checks: 0 };
  }
  const doSleep = options.sleepFn ?? sleep;
  const maxChecks = Math.max(1, options.maxChecks);
  let checks = 0;
  for (let i = 0; i < maxChecks; i += 1) {
    checks = i + 1;
    await doSleep(options.intervalMs); // give the SPA time to hydrate before re-reading
    let read: PostClickRead;
    try {
      read = await observeFn();
    } catch {
      read = { kind: "pending_navigation" };
    }
    if (read.kind === "observed" && read.obs && isContentConfirmed(read.obs)) {
      return { read, upgraded: true, checks };
    }
  }
  return { read: current, upgraded: false, checks };
}

export interface ContinuePostClick {
  verdict: SessionVerdict;
  surface: ResolverSurface;
  urlCategory: UrlCategory;
  /** True iff a success signal was observed within the bounded poll window (no re-click). */
  advanced: boolean;
  /** Sanitized read status: a clean read vs. a poll that only ever saw mid-navigation reads. */
  postClickReadStatus: PostClickReadKind;
  continuationDecision: ContinuationDecisionKind;
  exportLayout: ExportLayout;
  exportActionable: boolean;
  exportTriggerSelectorCount: CountBucket;
  /** Did the click advance to a logged-in session with an actionable export control? */
  reachedExportSurface: boolean;
}

export interface ContinueResult {
  outcome: ContinueOutcome;
  clicked: boolean;
  preClickVerdict: SessionVerdict;
  /** The sanitized no-click read the gate decided on (signals / shapes / continuation / controls). */
  preClick: CollectedSelection;
  safeContinueControlCountBucket: CountBucket;
  /** Present ONLY when a click happened — the sanitized post-click state. */
  postClick?: ContinuePostClick;
  detail: string;
}

/**
 * Pure: would the click have advanced to a usable export surface? Reported as a fact, never a
 * success claim — a continue is not a capture.
 */
export function deriveReachedExportSurface(verdict: SessionVerdict, plan: ExportActionPlan): boolean {
  return verdict === "LOGGED_IN" && plan.hasActionableExportCandidate;
}

/**
 * Pure: the single chokepoint. Returns `CONTINUE_ALLOWED` (with the proven index) only when
 * EVERY guard holds; otherwise a content-free halt kind. No browser, fully unit-testable.
 */
export function decideContinueGate(
  input: ContinueGateInput,
  preClickVerdict: SessionVerdict,
  fingerprintConfigured: boolean,
): ContinueGate {
  // 1) Verdict gate — login/2FA/unknown never proceed; LOGGED_IN means nothing to continue.
  switch (preClickVerdict) {
    case "LOGGED_IN":
      return { kind: "ALREADY_READY", detail: "session already logged in — no continuation needed" };
    case "ACCOUNT_LOGIN_REQUIRED":
      return { kind: "HALT_LOGIN_REQUIRED", detail: "true NAVER-ID login required — stop and ask the user" };
    case "AUTH_CHALLENGE_REQUIRED":
      return { kind: "HALT_AUTH_CHALLENGE", detail: "2FA / security challenge — stop and ask the user" };
    case "RECONNECT_REQUIRED":
      break;
    case "UNKNOWN":
      return { kind: "HALT_UNKNOWN_VERDICT", detail: "session verdict unknown — refuse to click" };
  }

  // 2) The expected continuation-card fingerprint must be configured — without it a continue
  //    is never allowed (the pure continuation decision can never reach READY_TO_CONTINUE).
  if (!fingerprintConfigured) {
    return {
      kind: "HALT_FINGERPRINT_UNCONFIGURED",
      detail: "NAVER_EXPECTED_CONTINUE_CARD_FINGERPRINT not set — refuse to click",
    };
  }

  // 3) Must be the single-account reconnect-continue surface.
  if (input.surface !== "reconnect-continue") {
    return { kind: "HALT_SURFACE", detail: "not the reconnect-continue surface — refuse to click" };
  }

  // 4) The displayed account must match the expected continue-card fingerprint.
  if (!input.continuationCard.expectedMatch) {
    return {
      kind: "HALT_FINGERPRINT_MISMATCH",
      detail: "displayed account does not match the expected continue-card fingerprint — refuse to click",
    };
  }

  // 5) Exactly one control must match the validated safe-continue rule (0 or ≥2 → halt).
  const safe = input.continueControls.filter((c) => c.matchesSafeContinueHypothesis);
  if (safe.length === 0) {
    return { kind: "HALT_NO_SAFE_CONTROL", detail: "no control matches the safe-continue rule — refuse to click" };
  }
  if (safe.length > 1) {
    return {
      kind: "HALT_MULTIPLE_SAFE_CONTROLS",
      detail: "more than one control matches the safe-continue rule — ambiguous, refuse to click",
    };
  }
  const only = safe[0]!;

  // 6) Belt-and-suspenders: the single safe control must carry NO alternate/switch/logout
  //    marker (already implied by the safe rule, asserted explicitly).
  if (
    only.hasDifferentAccountMarker ||
    only.hasOtherLoginMarker ||
    only.hasSwitchAccountMarker ||
    only.hasLogoutMarker
  ) {
    return { kind: "HALT_NEGATIVE_MARKER", detail: "the matched control carries a negative marker — refuse to click" };
  }

  // 7) The independent pure continuation decision must also say READY_TO_CONTINUE.
  if (input.continuationCard.decisionKind !== "READY_TO_CONTINUE") {
    return { kind: "HALT_NOT_READY", detail: "continuation decision is not READY_TO_CONTINUE — refuse to click" };
  }

  return {
    kind: "CONTINUE_ALLOWED",
    clickCandidateIndex: only.candidateIndex,
    detail: "exactly one safe continue control on a fingerprint-matched READY_TO_CONTINUE card",
  };
}

/**
 * One sanitized post-click observation, RESILIENT to mid-navigation reads. READ-ONLY — no click,
 * no navigation. If `page.content()` / `collectSelectionSurface` / export classification throws
 * because the SPA/router is navigating ("page is changing content"), it returns a
 * `pending_navigation` read (NO data, NO raw error text) instead of throwing, so the poll keeps
 * going. A clean read returns `observed` with the sanitized pieces the report + early-stop
 * predicate need.
 */
async function observePostClick(
  page: Page,
  ctx: BrowserContext,
  expected: ExpectedIdentity,
  salt: string,
  expectedContinueCard: ExpectedContinueCard,
): Promise<PostClickRead> {
  try {
    const url = page.url();
    const html = await page.content();
    const verdict = sessionVerdictFromContent(html, url);
    const exportPlan = planExportAction(html);
    const collected = await collectSelectionSurface(page, ctx, expected, salt, expectedContinueCard);
    const obs: PostClickObservation = {
      verdict,
      surface: collected.signals.surface,
      urlCategory: urlCategory(url),
      exportActionable: exportPlan.hasActionableExportCandidate,
    };
    return { kind: "observed", obs, collected, exportPlan };
  } catch {
    // Transient: the read landed while the page was navigating. Never raw error text, never
    // fatal — the bounded poll treats this as a non-advance and tries again next tick.
    return { kind: "pending_navigation" };
  }
}

/**
 * Live: read + classify the human-left surface (stamping the index-only locator attribute),
 * run the pure gate, and on `CONTINUE_ALLOWED` perform EXACTLY ONE guarded click — the proven
 * single safe control, asserted to resolve to exactly one element. No fallback, no retry, no
 * second candidate. After the click it re-verifies the verdict and classifies export
 * reachability WITHOUT triggering the export. Every non-allowed gate kind returns WITHOUT
 * clicking. Writes no status, captures/downloads/uploads nothing.
 */
export async function continueAtCardOnce(
  page: Page,
  ctx: BrowserContext,
  expected: ExpectedIdentity,
  salt: string,
  expectedContinueCard: ExpectedContinueCard,
): Promise<ContinueResult> {
  const fingerprintConfigured = expectedContinueCard.expectedCardFingerprint !== undefined;

  // 1) Authoritative pre-click verdict (login/2FA/unknown halt here, never click).
  const preClickVerdict = await checkLiveSessionVerdict(page);

  // 2) Read + classify AS THE HUMAN LEFT IT, stamping the top-document clickable candidates so
  //    a proven safe index maps to exactly one locator.
  const preClick = await collectSelectionSurface(page, ctx, expected, salt, expectedContinueCard, {
    stampForClick: true,
  });
  const safeBucket = bucket(
    preClick.continueControls.filter((c) => c.matchesSafeContinueHypothesis).length,
  );

  // 3) Pure gate — the single decision on whether a click may happen at all.
  const gateInput: ContinueGateInput = {
    surface: preClick.signals.surface,
    continuationCard: preClick.continuationCard,
    continueControls: preClick.continueControls,
  };
  const gate = decideContinueGate(gateInput, preClickVerdict, fingerprintConfigured);
  if (gate.kind !== "CONTINUE_ALLOWED") {
    log("continue.account-store.halt", {
      outcome: gate.kind,
      surface: preClick.signals.surface,
      preClickVerdict,
      continuationDecision: preClick.continuationCard.decisionKind,
    });
    return {
      outcome: gate.kind,
      clicked: false,
      preClickVerdict,
      preClick,
      safeContinueControlCountBucket: safeBucket,
      detail: gate.detail,
    };
  }

  // 4) Build EXACTLY ONE selector from the proven index; refuse unless it resolves to one node
  //    (mirrors `runExport`'s strict-single-candidate guard).
  const selector = `[${CAND_INDEX_ATTR}="${gate.clickCandidateIndex}"]`;
  const locator = page.locator(selector);
  const matchCount = await locator.count();
  if (matchCount !== 1) {
    log("continue.account-store.halt", {
      outcome: "HALT_SELECTOR_NOT_UNIQUE",
      surface: preClick.signals.surface,
    });
    return {
      outcome: "HALT_SELECTOR_NOT_UNIQUE",
      clicked: false,
      preClickVerdict,
      preClick,
      safeContinueControlCountBucket: safeBucket,
      detail: "the proven safe control did not resolve to exactly one element — refuse to click",
    };
  }

  // 5) The ONE guarded click — no fallback, no retry, no second candidate.
  await locator.click({ timeout: CONTINUE_CLICK_TIMEOUT_MS });

  // 6) Post-click: RESILIENT BOUNDED POLL. The reconnect→Seller-Center transition is an
  //    SPA/router navigation that can take ~1s+, and a read landing mid-navigation throws — that
  //    is TRANSIENT, not fatal. The poll catches it as `pending_navigation` and keeps going,
  //    stopping EARLY on the first success signal; non-advance only if the window elapses. NO
  //    re-click, NO export click, NO download/upload/status — every tick is read-only.
  const maxChecks = Math.max(1, Math.ceil(POST_CLICK_POLL_TIMEOUT_MS / POST_CLICK_POLL_INTERVAL_MS));
  const poll = await pollPostClickUntilAdvanced(
    () => observePostClick(page, ctx, expected, salt, expectedContinueCard),
    { maxChecks, intervalMs: POST_CLICK_POLL_INTERVAL_MS },
  );
  const advanced = poll.advanced;

  // Content-confirmation: if we advanced only via a SOFT signal (e.g. urlCategory→seller-center)
  // while verdict/surface are still hydrating, do a brief bounded read-only confirmation that
  // prefers a content-confirmed state (LOGGED_IN / review-ready / actionable). It NEVER re-clicks,
  // NEVER downgrades, and is bounded; transient navigation is handled exactly like the main poll.
  let finalRead = poll.read;
  let confirmUpgraded = false;
  let confirmChecks = 0;
  if (advanced && finalRead.kind === "observed" && finalRead.obs && !isContentConfirmed(finalRead.obs)) {
    const confirm = await confirmAdvancedPostClickState(
      finalRead,
      () => observePostClick(page, ctx, expected, salt, expectedContinueCard),
      { maxChecks: POST_CLICK_CONFIRM_MAX_CHECKS, intervalMs: POST_CLICK_POLL_INTERVAL_MS },
    );
    finalRead = confirm.read;
    confirmUpgraded = confirm.upgraded;
    confirmChecks = confirm.checks;
  }

  let postClick: ContinuePostClick;
  if (finalRead.kind === "observed" && finalRead.obs && finalRead.exportPlan && finalRead.collected) {
    const obs = finalRead.obs;
    const exportPlan = finalRead.exportPlan;
    postClick = {
      verdict: obs.verdict,
      surface: obs.surface,
      urlCategory: obs.urlCategory,
      advanced,
      postClickReadStatus: "observed",
      continuationDecision: finalRead.collected.continuationCard.decisionKind,
      exportLayout: exportPlan.layout,
      exportActionable: exportPlan.hasActionableExportCandidate,
      exportTriggerSelectorCount: exportPlan.triggerSelectorCount,
      reachedExportSurface: deriveReachedExportSurface(obs.verdict, exportPlan),
    };
  } else {
    // The window elapsed while the page kept navigating — never a clean read. Sanitized
    // unknown/pending state (no raw error text); advanced is necessarily false here.
    postClick = {
      verdict: "UNKNOWN",
      surface: "unknown",
      urlCategory: "other",
      advanced: false,
      postClickReadStatus: "pending_navigation",
      continuationDecision: "UNSUPPORTED_SURFACE",
      exportLayout: "LAYOUT_UNRECOGNIZED",
      exportActionable: false,
      exportTriggerSelectorCount: "none",
      reachedExportSurface: false,
    };
  }

  log("continue.account-store.clicked", {
    preClickVerdict,
    postClickVerdict: postClick.verdict,
    postClickSurface: postClick.surface,
    postClickUrlCategory: postClick.urlCategory,
    postClickReadStatus: postClick.postClickReadStatus,
    advanced,
    checks: poll.checks,
    confirmUpgraded,
    confirmChecks,
    exportLayout: postClick.exportLayout,
    reachedExportSurface: postClick.reachedExportSurface,
  });
  return {
    outcome: "CONTINUED",
    clicked: true,
    preClickVerdict,
    preClick,
    safeContinueControlCountBucket: safeBucket,
    postClick,
    detail: advanced
      ? "performed exactly one guarded continue click; post-click advanced to a logged-in/review surface within the poll window (no export/capture/upload/status)"
      : poll.everObserved
        ? "performed exactly one guarded continue click; post-click did not advance within the poll window — no retry (no export/capture/upload/status)"
        : "performed exactly one guarded continue click; page kept navigating with no clean read in the poll window (transient) — no retry (no export/capture/upload/status)",
  };
}
