/**
 * **Coupang WING issuance-form REVEAL driver (`REVEAL_WING_ISSUANCE_CONFIGURATION`).**
 *
 * One WING-resident Action Window step: highlight the live-calibrated `발급` control on the real no-key open-API
 * surface, rest at an explicit operator checkpoint, and — after the operator presses it themselves — take ONE
 * sanitized observation of whatever surface appeared. Then stop.
 *
 * **Why this exists as its own driver.** The shipped guided runtime models 발급 as the press that CREATES the
 * key: `COUPANG_TARGET_BARRIER_STAGE.issue = "checkpoint_before_issue"`, ordered AFTER `self_dev` / `vendor_info`
 * / `call_ip` and immediately BEFORE `guiding_copy_keys` ("copy the Access Key"). Live evidence contradicts that
 * model — on the real no-key surface the three form fields matched **0 / never-unique for every candidate
 * spelling**, while `issue` and `credentials` each matched 1. The fields are not on that page. So if an operator
 * pressed 발급 under the guided runtime, it would advance from a barrier nobody crossed to telling the seller to
 * copy keys that do not exist: fail-open on the one step where the marketplace state actually changes.
 *
 * Rebuilding the guided plan around a screen no one has observed would replace that wrong model with a guessed
 * one. This driver instead does the smallest thing that yields real evidence, on the audited
 * `CoupangWingDeletionDriver` shape (classify → highlight → rest → operator acts → observe → clear), leaving the
 * 7-step guided plan and every FE stage identifier untouched.
 *
 * **The action is NOT declared as key creation.** {@link WING_REVEAL_OPERATOR_ACTION} is
 * `REVEAL_WING_ISSUANCE_CONFIGURATION`: the press is expected to open a configuration step. That expectation is
 * NOT live-confirmed (see `WING_ISSUE_CALIBRATION_EVIDENCE.pressOutcome = "UNCONFIRMED"`), so the driver treats
 * it as a hypothesis and fails closed on anything it does not recognize — it never reports success for an
 * outcome it cannot identify, and it never auto-advances.
 *
 * **What it structurally cannot do:** click/tap/type/submit anything (source-guarded), select 자체개발, fill
 * 업체명/URL/IP, press the final 확인, issue a key, read any field value, or advance past the single observation.
 *
 * **The honest non-claim, and it is load-bearing.** This driver CANNOT certify that no key was created.
 * `wingIssuedStateFrom` returns `indeterminate / NO_DISCRIMINATING_SIGNAL` because every sanitized signal is
 * identical between a real issued page and a real no-key form — including `credentialAnchorPresent: true` and the
 * `credentials` target matching 1 on both. So {@link WingRevealOutcome} deliberately has no
 * `NO_KEY_CREATED` member, and {@link WingRevealResult.keyCreationRuledOut} is always `false`. Only the operator
 * looking at the screen can say what happened; the driver reports the sanitized delta and stops.
 */
import type { Page } from "playwright";
import { log } from "../log";
import { advancePanelMounted, mountOverlay, unmountOverlay } from "./overlay";
import {
  EXTRACT_WING_CENSUS,
  WING_KEY_CREATION_ACTION,
  WING_REVEAL_OPERATOR_ACTION,
  classifyWingUrlCategory,
  observeFrom,
  wingIssuedStateFrom,
  type WingIssuedStateReason,
  type WingObservation,
  type WingStructuralCensus,
} from "../cli/coupang-wing-classifier";
import { buildFixedLabelLocateScript } from "./api-issuance-calibration/visual-recon-inpage";
import { WING_HIGHLIGHT_LABELS, WING_ISSUE_SELECTOR_CALIBRATED } from "./coupang-wing-issuance-driver";
import type { LocateResult } from "./engine";


// Re-exported from the pure leaf where they are DEFINED: the approval gate must be able to name these actions
// without importing a Playwright driver, and the driver must not be the only place they exist.
export { WING_KEY_CREATION_ACTION, WING_REVEAL_OPERATOR_ACTION };

/** The ordered walk phase — enforces "checkpoint before the operator-action step" (a value-free state guard). */
export type WingRevealPhase = "init" | "classified" | "highlighted" | "observed";

/** One guided step: highlight 발급 + rest at the checkpoint. */
export const WING_REVEAL_TOTAL_STEPS = 1 as const;

/**
 * The WING-resident checkpoint copy. Phrased as an EXPECTATION, not a promise: we have not seen what the press
 * produces, and the operator should not be told we have. It also states plainly that key creation is not part of
 * this step, so the operator does not continue on to 확인 believing SellerOps is guiding them there.
 */
export const WING_REVEAL_CHECKPOINT_LABEL =
  // 1. WHICH button, said unambiguously. The panel is a fixed bottom-centre box, physically detached from the
  //    highlight ring, so "이 버튼" had no referent where it is read.
  "강조 표시된 '발급' 버튼을 직접 눌러 주세요. " +
  // 2. The expectation, never a promise. 연동 방식 설정 화면 rather than "다음 API 발급 설정 화면", which could be
  //    read as "the screen that completes issuance" — it reuses the very word on the button.
  "누르면 연동 방식 설정 화면이 열릴 것으로 예상되지만 확인된 사실은 아닙니다. " +
  // 3. The IMPERATIVE. Review's most important UX finding: every sentence used to describe what SellerOps would
  //    do, and none told the seller what to do. After the press they face a form that invites completion
  //    (자체개발 → 업체명 → URL → IP → 확인) with the panel already torn down — the natural continuation creates a
  //    key. This is the sentence that stops that, and it must not be softened.
  "화면이 열리면 그대로 두고 더 진행하지 마세요. '확인'(최종 발급)은 절대 누르지 마세요. " +
  // 4. The honest limit, in Korean, on the surface the seller actually reads — it had existed only in English in
  //    the terminal, which the person who can see the screen never looks at.
  "SellerOps는 화면 종류만 한 번 확인하고 멈추며, 키가 실제로 만들어졌는지 여부는 판단할 수 없습니다. 화면은 판매자만 확인할 수 있습니다. " +
  // 5. The window closes when you signal — so read the screen BEFORE signalling, not after.
  "신호를 보내면 이 창은 닫히므로 먼저 화면을 확인해 주세요.";

/**
 * What the post-press observation found. Closed enum; every member except the first is a STOP.
 *
 * There is no `NO_KEY_CREATED` member and there never can be one from this driver — see the module docstring.
 */
export const WING_REVEAL_OUTCOMES = [
  /** Still on the open-API surface, and a submit affordance appeared where there was none — consistent with a
   *  configuration form having opened. The expected outcome, and still only *consistent with*, not proof. */
  "CONFIGURATION_SURFACE_SUSPECTED",
  /** No observable sanitized change. The press may have done nothing, or nothing the census can see. */
  "SURFACE_UNCHANGED",
  /** Something changed, but not the shape a configuration step was expected to produce. STOP and report. */
  "SURFACE_CHANGED_UNRECOGNIZED",
  /**
   * The surface became `credential_shown` — the keys-displayed category. This does NOT prove a key was created
   * (nothing can: `NO_DISCRIMINATING_SIGNAL`), but it is the strongest signal available that the press may have
   * done more than reveal a form, so it gets its own outcome and STOPS rather than being folded into either
   * "expected" or a generic off-surface result.
   */
  "CREDENTIAL_SURFACE_APPEARED",
  /** No longer the open-API surface (login / home / off-target). STOP. */
  "OFF_OPEN_API_SURFACE",
  /**
   * The checkpoint overlay could not be verified GONE, so the post-press census would have read SellerOps' own
   * injected DOM as WING structure. The reading is not trustworthy and no outcome is claimed from it.
   */
  "OVERLAY_NOT_CLEARED",
  /** The observation itself could not be taken (the read threw, or the checkpoint was never reached). */
  "NOT_OBSERVED",
] as const;
export type WingRevealOutcome = (typeof WING_REVEAL_OUTCOMES)[number];

export interface WingRevealResult {
  outcome: WingRevealOutcome;
  /** The sanitized observation taken BEFORE the operator pressed 발급 (the baseline). */
  before: WingObservation | null;
  /** The sanitized observation taken AFTER. Null when the read failed. */
  after: WingObservation | null;
  /**
   * Which sanitized signals differed, as field NAMES only — never the values, which are already in the two
   * observations above. A reader can see what moved without the record repeating itself.
   */
  changedSignals: readonly string[];
  /**
   * ALWAYS `false`. The classifier cannot distinguish an issued account from a no-key one on any sanitized
   * signal, so this driver is structurally unable to certify that no key was created. Present as a field rather
   * than omitted so a record cannot be read as an implicit "nothing was issued".
   */
  keyCreationRuledOut: false;
  /** Why `keyCreationRuledOut` is false — the classifier's own closed reason, not prose. */
  keyCreationReason: WingIssuedStateReason;
  /** True once the checkpoint overlay was verified GONE, before the post-action observation was taken. */
  overlayClearedBeforeObservation: boolean;
}

export interface WingRevealContextLike {
  pages(): Page[];
  on?(event: string, fn: () => void): void;
}

export interface CoupangWingRevealDriverOptions {
  context?: WingRevealContextLike;
  /** Defaults to the code-level {@link WING_ISSUE_SELECTOR_CALIBRATED}; injectable so a test can withdraw it. */
  calibrated?: boolean;
  guidanceEnabled?: boolean;
  locatorSettleMs?: number;
  verifyPollMs?: number;
  mountOverlayFn?: typeof mountOverlay;
  checkpointPaintedFn?: typeof advancePanelMounted;
}

const DEFAULT_LOCATOR_SETTLE_MS = 400;
const DEFAULT_VERIFY_POLL_MS = 500;
const VERIFY_MAX_POLLS = 12;
const SETTLE_TIMEOUT_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Remove the read-only `data-aw-target` annotation this driver sets when it locates 발급.
 *
 * Review caught its absence: `clearHighlight` unmounted the overlay and left the attribute on the seller's live
 * marketplace DOM, while the module docstring claimed both were removed. Every other WING driver (deletion,
 * renewal, guided issuance) evaluates this. Beyond the false claim it matters because `mountOverlay` finds its
 * ring by `document.querySelector("[data-aw-target]")` and early-returns when there is none — so a stale tag
 * would let a LATER mount report as painted against an element this step never located.
 */
const IN_PAGE_CLEAR_TAG = `(function () {
  var slice = Function.prototype.call.bind(Array.prototype.slice);
  var tagged = slice(document.querySelectorAll('[data-aw-target]'));
  for (var i = 0; i < tagged.length; i++) { tagged[i].removeAttribute('data-aw-target'); }
  return tagged.length;
})()`;

/**
 * The ONE surface this walk may run on.
 *
 * `credential_shown` is deliberately excluded, and review is why: it had been accepted as "still the open-API
 * surface", so a post-press transition INTO the keys-displayed category — the single category that most suggests
 * a key was created — came back as `CONFIGURATION_SURFACE_SUSPECTED`, the expected benign outcome. That is the
 * worst possible input to round up.
 */
function isRevealSurface(observation: WingObservation): boolean {
  return observation.pageCategory === "open_api_issuance";
}

/**
 * Which sanitized signal fields differ between two observations. Names only — comparing by key means a signal
 * added to the census later is compared automatically rather than silently ignored by a hand-written list.
 */
export function changedSignalNames(before: WingObservation | null, after: WingObservation | null): string[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before.signals), ...Object.keys(after.signals)]);
  const out: string[] = [];
  for (const k of [...keys].sort()) {
    const a = (before.signals as unknown as Record<string, unknown>)[k];
    const b = (after.signals as unknown as Record<string, unknown>)[k];
    if (a !== b) out.push(k);
  }
  // `pageCategory` is not a signal but is the coarsest thing that can move, so it is reported alongside them.
  if (before.pageCategory !== after.pageCategory) out.push("pageCategory");
  return out;
}

/**
 * Classify the post-press surface. Pure and exported so the decision is testable without a browser.
 *
 * The expected shape is deliberately NARROW: still on the open-API surface, and `submitAffordancePresent` moved
 * from false to true. That is the only delta the current census can plausibly show for "a form with a 확인 button
 * appeared" — the initial surface reported `submitAffordancePresent: false` on every capture, while editable
 * inputs and list containers were already `many` and cannot rise. If the real Stage-2 does not flip it, the
 * honest result is `SURFACE_CHANGED_UNRECOGNIZED` (or `SURFACE_UNCHANGED`), which is a STOP and is itself the
 * evidence the next unit needs. Widening this predicate to make a live run "pass" would be exactly the
 * speculative retuning `collector/CLAUDE.md` §6 forbids.
 */
export function classifyRevealOutcome(
  before: WingObservation | null,
  after: WingObservation | null,
  /** False when the overlay could not be verified gone — the reading is then untrustworthy, whatever it says. */
  overlayCleared = true,
): WingRevealOutcome {
  if (!before || !after) return "NOT_OBSERVED";
  // Ordered BEFORE every other branch: an untrusted reading must not be interpreted at all, and a
  // keys-displayed surface must not be reachable by any path that could call it expected.
  if (!overlayCleared) return "OVERLAY_NOT_CLEARED";
  if (after.pageCategory === "credential_shown") return "CREDENTIAL_SURFACE_APPEARED";
  if (!isRevealSurface(after)) return "OFF_OPEN_API_SURFACE";
  const changed = changedSignalNames(before, after);
  if (changed.length === 0) return "SURFACE_UNCHANGED";
  const submitAppeared = !before.signals.submitAffordancePresent && after.signals.submitAffordancePresent;
  return submitAppeared ? "CONFIGURATION_SURFACE_SUSPECTED" : "SURFACE_CHANGED_UNRECOGNIZED";
}

/**
 * The reveal walk. Mirrors the deletion driver's audited shape and adds nothing to the page beyond the read-only
 * `data-aw-target` annotation and the guidance overlay — both removed before the post-action observation.
 */
export class CoupangWingRevealDriver {
  private readonly page: Page;
  private readonly opts: CoupangWingRevealDriverOptions;
  private phase: WingRevealPhase = "init";
  private before: WingObservation | null = null;
  private checkpointPaintFailed = false;

  constructor(page: Page, opts: CoupangWingRevealDriverOptions = {}) {
    this.page = page;
    this.opts = opts;
  }

  private activePage(): Page {
    const pages = this.opts.context?.pages() ?? [];
    return pages.length > 0 ? pages[pages.length - 1]! : this.page;
  }

  private evalStr<R>(page: Page, script: string): Promise<R> {
    return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
  }

  private async settle(page: Page): Promise<void> {
    const p = page as unknown as { waitForLoadState?: (s: string, o?: { timeout?: number }) => Promise<void> };
    if (typeof p.waitForLoadState !== "function") return;
    try {
      await p.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS });
    } catch {
      /* a timeout is fine — the classifier fails closed on thin signals */
    }
  }

  isCalibrated(): boolean {
    return this.opts.calibrated ?? WING_ISSUE_SELECTOR_CALIBRATED;
  }

  currentPhase(): WingRevealPhase {
    return this.phase;
  }

  checkpointPaintDidFail(): boolean {
    return this.checkpointPaintFailed;
  }

  /** READ-ONLY sanitized observation of the CURRENT surface. No value, no URL, no DOM. */
  async observeSurface(): Promise<WingObservation> {
    const page = this.activePage();
    await this.settle(page);
    const census = await this.evalStr<WingStructuralCensus>(page, EXTRACT_WING_CENSUS);
    return observeFrom(classifyWingUrlCategory(page.url()), census);
  }

  /**
   * Classify the surface the walk starts on and RECORD it as the baseline. Refuses anything that is not the
   * open-API surface: without a baseline there is nothing to compare the post-press observation against, so the
   * outcome could only ever be unrecognized.
   */
  async classifyInitialSurface(): Promise<{ ok: boolean; observation: WingObservation }> {
    const observation = await this.observeSurface();
    const ok = isRevealSurface(observation);
    if (ok) {
      this.before = observation;
      this.phase = "classified";
    }
    log("aw_coupang_reveal_classify", { ok, pageCategory: observation.pageCategory });
    return { ok, observation };
  }

  /** READ-ONLY match count for the 발급 control — never tags, highlights, clicks, or reads a value. */
  async probeIssueMatch(): Promise<{ matchCount: number; canHighlight: boolean; sig?: string }> {
    const res = await this.resolveIssue(false);
    const matchCount = typeof res?.count === "number" && res.count >= 0 ? res.count : 0;
    const canHighlight = matchCount === 1;
    return canHighlight && res.sig ? { matchCount, canHighlight, sig: res.sig } : { matchCount, canHighlight };
  }

  private async resolveIssue(tag: boolean): Promise<LocateResult> {
    const spec = WING_HIGHLIGHT_LABELS.issue;
    const script = buildFixedLabelLocateScript({
      candidateQuery: spec.candidateQuery,
      exactText: spec.exactText,
      tag,
      ...(spec.tagAncestor ? { tagAncestor: spec.tagAncestor } : {}),
    });
    const res = await this.evalStr<LocateResult>(this.activePage(), script);
    // `hiddenCount` survives BOTH exits. On the failure exit it is the whole diagnosis: `count: 0, hiddenCount: 1`
    // says the label matched an element that does not paint — which is what the live 발급 surface actually returns
    // once the visibility filter is in place, and is indistinguishable from `count: 0` alone without it.
    const hidden = typeof res?.hiddenCount === "number" ? { hiddenCount: res.hiddenCount } : {};
    if (res.count !== 1 || !res.sig) return { count: res.count, ...hidden };
    return { count: 1, sig: res.sig, ...hidden, ...(res.tag ? { tag: res.tag } : {}) };
  }

  /**
   * Highlight 발급 and mount the expectation checkpoint, then REST. Fails closed: refuses unless the `issue`
   * selector is calibrated (defense-in-depth over the manifest gate) AND the initial surface was classified
   * first. A non-unique match stays un-highlighted. It never presses 발급 — the operator does.
   */
  async highlightIssueCheckpoint(): Promise<LocateResult> {
    if (!this.isCalibrated()) {
      throw new Error(
        "refusing to highlight the 발급 control: the issue selector is not calibrated (WING_ISSUE_SELECTOR_CALIBRATED is false)",
      );
    }
    if (this.phase !== "classified") {
      throw new Error("classify the initial open-API surface before highlighting the 발급 control");
    }
    const res = await this.resolveIssue(true);
    if (res.count !== 1 || !res.sig) {
      // Say WHY, in counts. A bare refusal sent the last live attempt into a source read to find out whether the
      // label matched nothing or matched something unrenderable; both are `count: 0` on the wire.
      log("aw_coupang_reveal_issue_not_unique", { matchCount: res.count, hiddenCount: res.hiddenCount ?? 0 });
      return { count: res.count, ...(typeof res.hiddenCount === "number" ? { hiddenCount: res.hiddenCount } : {}) };
    }
    await sleep(this.opts.locatorSettleMs ?? DEFAULT_LOCATOR_SETTLE_MS);
    const page = this.activePage();
    await (this.opts.mountOverlayFn ?? mountOverlay)(page, {
      stepNumber: 1,
      totalSteps: WING_REVEAL_TOTAL_STEPS,
      copyKey: "actionWindow.coupangReveal.checkpoint",
      label: WING_REVEAL_CHECKPOINT_LABEL,
      guidanceEnabled: this.opts.guidanceEnabled ?? true,
      // REQUIRED, not cosmetic — the same lesson as the deletion checkpoint: this copy is ~120 characters of
      // Korean and would run off the viewport in the spotlight ring's single-line badge. The operator is about
      // to take a real action on the marketplace; the sentence saying key creation is NOT part of it has to be
      // legible. No advance button: this walk advances on the operator's sentinel, so the panel adds no
      // interactive element to the marketplace page.
      residentPanel: true,
    });
    // VERIFY the panel painted. `mountOverlay` returns silently when the tagged element is gone (an SPA
    // re-render during the settle, or `activePage()` now resolving to a tab the tag never reached), so awaiting
    // it proves nothing — and the phase it sets is the only precondition the operator-action step checks.
    if (!(await (this.opts.checkpointPaintedFn ?? advancePanelMounted)(page))) {
      this.checkpointPaintFailed = true;
      log("aw_coupang_reveal_checkpoint_unmounted", { highlighted: false });
      return { count: 0 };
    }
    this.phase = "highlighted";
    log("aw_coupang_reveal_highlight", { highlighted: true });
    return { count: 1, sig: res.sig };
  }

  /**
   * The OPERATOR-ACTION step, after the operator has pressed 발급 themselves.
   *
   * Order matters and is enforced: the overlay is cleared FIRST, and only then is the post-action surface
   * observed. Observing through our own overlay would census our own injected panel — SellerOps' guidance
   * counted as WING structure, which would corrupt the one delta this run exists to measure (and could invent a
   * `submitAffordancePresent` that is ours, not WING's).
   *
   * Enforces CHECKPOINT-FIRST: throws unless {@link highlightIssueCheckpoint} reached `highlighted`, so the walk
   * can never reach the operator-action step without having shown the expectation copy.
   */
  async observeRevealOutcome(): Promise<WingRevealResult> {
    if (this.phase !== "highlighted") {
      throw new Error("checkpoint required: highlight 발급 + present the expectation copy before the operator-action step");
    }
    const overlayClearedBeforeObservation = await this.clearHighlight();
    const pollMs = this.opts.verifyPollMs ?? DEFAULT_VERIFY_POLL_MS;
    let after: WingObservation | null = null;
    for (let i = 0; i < VERIFY_MAX_POLLS; i++) {
      try {
        after = await this.observeSurface();
      } catch {
        after = null;
      }
      // Stop as soon as the surface differs from the baseline; otherwise keep polling for a slow SPA render and
      // report SURFACE_UNCHANGED if it never moves.
      if (after && changedSignalNames(this.before, after).length > 0) break;
      if (pollMs > 0 && i < VERIFY_MAX_POLLS - 1) await sleep(pollMs);
    }
    // F9: a failed clear invalidates the reading rather than being recorded beside it. The panel's own elements
    // are counted by the census's candidate scan, so an observation taken through it is not a reading of WING.
    const outcome = classifyRevealOutcome(this.before, after, overlayClearedBeforeObservation);
    // The classifier's own reason for why issuance cannot be ruled out, taken from the AFTER observation so the
    // record carries the reason for the surface actually being reported on.
    const keyCreationReason = wingIssuedStateFrom(after).reason;
    this.phase = "observed";
    const result: WingRevealResult = {
      outcome,
      before: this.before,
      after,
      changedSignals: changedSignalNames(this.before, after),
      keyCreationRuledOut: false,
      keyCreationReason,
      overlayClearedBeforeObservation,
    };
    log("aw_coupang_reveal_outcome", {
      outcome,
      changedSignalCount: result.changedSignals.length,
      overlayCleared: overlayClearedBeforeObservation,
      keyCreationReason,
    });
    return result;
  }

  /**
   * Remove the ring + resident panel and REPORT whether the panel is gone — verified by asking the page, not
   * assumed. A failed clear must never throw into the outcome path, but it must also never be reported as a
   * success: an unreadable page reports NOT cleared.
   */
  async clearHighlight(): Promise<boolean> {
    const page = this.activePage();
    await unmountOverlay(page).catch(() => undefined);
    await this.evalStr(page, IN_PAGE_CLEAR_TAG).catch(() => undefined);
    // Verified, not assumed. An unreadable page cannot confirm the clear, so it reports NOT cleared.
    const panelUp = await (this.opts.checkpointPaintedFn ?? advancePanelMounted)(page).catch(() => true);
    return !panelUp;
  }

  /**
   * Tear down, and REPORT whether the page is actually clean.
   *
   * Returns `clearHighlight`'s verdict rather than discarding it. Review found the discard was load-bearing in
   * the wrong direction: `clearHighlight` catches every failure it can hit (`unmountOverlay`, the tag clear, the
   * panel probe), so `cleanup()` can never reject — and the CLI's "a failed clear is reported, not swallowed"
   * guarantee was wired to a rejection that the production driver is structurally incapable of producing. The
   * boolean is the only signal that the panel is still on the seller's live WING DOM.
   */
  async cleanup(): Promise<boolean> {
    return this.clearHighlight();
  }
}
