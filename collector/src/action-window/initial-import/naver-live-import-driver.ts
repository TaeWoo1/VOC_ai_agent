/**
 * **Live NAVER import driver.** The production {@link ImportProbeDriver} — GATE-LOCKED, headed, seated
 * operator only. It never clicks, types, exports or consents; the seller performs every marketplace action.
 *
 * ## Composition, not reimplementation
 *
 * The export control, the consent checkpoint, download detection, validation and ingest are already
 * implemented and **live-proven** in {@link NaverLiveProbeDriver}. This driver COMPOSES that one rather
 * than re-deriving it. That is the whole design: the only genuinely new live surface here is the two date
 * inputs and the apply control, so that is the only place a live run can teach us something new. A second
 * implementation of the consent race would be a second thing to keep correct, and it would be the half
 * without live evidence behind it.
 *
 * ## Why locating the consent control is deferred, and why that is a fact rather than a shortcut
 *
 * NAVER's consent control **does not exist** until the seller clicks export — it is raised in response.
 * So `locateTarget("consent")` cannot find anything at the moment the engine asks, and answering `count: 0`
 * would fail the run closed on a surface that is behaving correctly. It therefore reports a deferred
 * single match, and the real locate/highlight/await happens inside the composed driver's `detectDownload`,
 * which is the live-proven choreography: seller clicks export → NAVER raises ONE consent dialog → the
 * driver highlights it → the seller clicks it → the download begins automatically.
 *
 * The engine's ordering is unaffected and still correct: consent is asked about only after the export
 * barrier has been observed. What changes is only WHERE the live work happens.
 *
 * ## Frame resolution is SHARED, not re-derived — a live finding
 *
 * The first live run (2026-07-25) failed closed at `TARGET_NOT_FOUND` on the start-date control with
 * `dateInputCount: 0` and `iframePresent: true`. The cause was this driver reading `page.content()` — the
 * TOP document — while the NAVER review surface is frame-hosted. The composed driver already resolves that
 * frame (`resolveSurfaceFrame`, scored with the same shared decisions used downstream) and every proven
 * method works through it, so reaching for the raw page here was the one place this driver stopped
 * composing and started re-deriving. It now uses {@link NaverLiveProbeDriver.surfaceContext} and holds no
 * page handle at all, so the mistake cannot recur — and locate and the scope read-back can never disagree
 * about which document they are reading.
 *
 * ## The seller's two clicks map to one live race
 *
 * `waitForTargetAction("consent")` runs that race and caches its outcome; `detectDownload` then returns the
 * cached result instead of racing twice. Racing twice would arm a second download listener after the first
 * had already consumed the event, so the second would time out on a run that had actually succeeded.
 */
import type { Frame, Page } from "playwright";
import type { RangeControlProbe } from "../../naver/available-range-discovery";
import type { ScopeMatch } from "../../naver/export-scope-match";
import { extractDates, matchExportScope } from "../../naver/export-scope-match";
import {
  dateBoundsProbe,
  importLocateDiagnostic,
  inferRequiresApply,
  locateApplyDecision,
  locateDateDecision,
} from "../../naver/import-locate";
import type { ImportSurfaceFacts } from "../../naver/import-guidance-plan";
import { log } from "../../log";
import type { ArtifactValidateResult, DownloadDetectResult, IngestResult, LocateResult, SurfaceProbeResult } from "../engine";
import { armObserver, waitForUserAction } from "../observer";
import { mountOverlay } from "../overlay";
import type { NaverLiveProbeDriver } from "../naver-live-driver";
import type {
  DiscoveredRange,
  ImportDiscoveryDriver,
  ImportProbeDriver,
  ImportTarget,
  RequiredRange,
} from "./import-driver";

/** Some bundlers inject `__name(...)` into serialized evaluate bodies — a harmless identity shim. */
const NAME_SHIM = "globalThis.__name = globalThis.__name || function (f) { return f; };";

/** Deferred single match for the consent control — see the module note on why it cannot be located early. */
const DEFERRED_CONSENT_SIG = "c0c0c0c0c0c0c0c0";

export interface NaverLiveImportDriverOptions {
  /** Bounded window for the seated seller to act on a highlighted control. */
  observeTimeoutMs?: number;
  /**
   * Bounded window to let the date controls render before a locate is decided.
   *
   * The proven driver already polls for the review grid (`settleSurface`) because this surface renders
   * client-side after navigation. The date controls are on the same surface and get the same treatment: a
   * single-shot read can legitimately see nothing on a page that is still hydrating, and calling that
   * TARGET_NOT_FOUND blames the surface for our timing.
   */
  dateSettleTimeoutMs?: number;
  /** Poll cadence for that settle. */
  dateSettleIntervalMs?: number;
  /**
   * Bounded window for the seller to actually pick a date. Longer than a click barrier by default: choosing
   * from a calendar widget takes longer than pressing a button, and a short window would report "they did
   * not act" about someone mid-interaction.
   */
  dateObserveTimeoutMs?: number;
  guidanceEnabled?: boolean;
  /** Total steps, for the diagnostic overlay badge. Supplied by the run's own step plan. */
  totalSteps?: number;
  /**
   * Report an established historical range to the SellerOps backend, which creates the plan over it.
   *
   * Injected, and absent by default: a driver with no way to report must not silently succeed, and a default
   * implementation would inevitably be a stub that made a discovery run look like it had created a plan.
   * Only the approval-gated import boot supplies it, bound to the same account credentials the ingest uses.
   */
  reportRange?: (range: DiscoveredRange, evidence: "MACHINE_DISCOVERED" | "OPERATOR_CONFIRMED") => Promise<boolean>;
}

export class NaverLiveImportDriver implements ImportProbeDriver, ImportDiscoveryDriver {
  private readonly proven: NaverLiveProbeDriver;
  private readonly opts: NaverLiveImportDriverOptions;
  /** Signatures handed out per target, so highlight can re-validate against what locate decided. */
  private readonly sigs = new Map<ImportTarget, string>();
  /** Cached result of the one consent+download race — see the module note. */
  private consentRace: DownloadDetectResult | null = null;
  private stepNumber = 1;
  private badgeTotalSteps: number | null = null;
  /** The last scope verdict this driver produced. It is the only component that actually made the read. */
  private lastScopeVerdict: ScopeMatch | null = null;

  /**
   * Takes NO `Page`. That is deliberate and is the structural half of the frame fix: with no page handle
   * there is no way to read the top document by accident, so the failure that produced
   * `dateInputCount: 0` on a frame-hosted surface cannot recur by someone reaching for the convenient
   * object. The only context available is the composed driver's resolved one.
   */
  constructor(proven: NaverLiveProbeDriver, opts: NaverLiveImportDriverOptions = {}) {
    this.proven = proven;
    this.opts = opts;
  }

  /**
   * The context every surface read and annotation goes through — the composed driver's resolved frame, or
   * the top document before resolution. There is no page handle to reach instead — see the constructor.
   */
  private ctx(): Page | Frame {
    return this.proven.surfaceContext();
  }

  /** Which step the diagnostic overlay badge should show. Set by the session as the run advances. */
  setStepNumber(stepNumber: number): void {
    this.stepNumber = stepNumber;
  }

  /**
   * The denominator of that badge, per run.
   *
   * One driver instance serves every run this agent hosts, and the two run kinds have different lengths — a
   * five-step discovery showing `1/8` on the seated operator's own screen while the frontend says "5단계 중 1"
   * is a contradiction they have to resolve mid-run. Dev-only diagnostic; it changes nothing that is clicked.
   */
  setBadgeTotalSteps(totalSteps: number | null): void {
    this.badgeTotalSteps = totalSteps;
  }

  /** Delegated — the readiness settle and its fail-closed causes are already live-proven. */
  prepareSurface(): Promise<boolean | SurfaceProbeResult> {
    return this.proven.prepareSurface();
  }

  /**
   * Whether this surface needs a separate apply press. Read once, before any step is published.
   *
   * `requiresFilters` is `false` by product decision: V1 imports the date range only, so no filter beyond
   * it is part of the plan. Reporting `true` would add a step the tutorial has no target for.
   */
  async readSurfaceFacts(): Promise<ImportSurfaceFacts> {
    // Settle first: the facts fix the step plan for the whole run, so deciding them off a half-hydrated
    // page would pick the wrong plan and there is no second chance to change it.
    const html = await this.settleDateControls();
    const facts: ImportSurfaceFacts = { requiresApply: inferRequiresApply(html), requiresFilters: false };
    // Sanitized: booleans and counts only. Logged because the answer fixes the step plan for the whole
    // run, so an operator reading a transcript needs to see which plan was chosen and why.
    // `frameResolved` is the distinction that made the first live failure diagnosable at all: a zero count
    // in the right frame and a zero count because we never left the top document look identical otherwise.
    log("aw_import_surface_facts", {
      ...facts,
      frameResolved: this.proven.surfaceFrameResolved(),
      childFrames: this.proven.childFrameCount(),
      ...importLocateDiagnostic(html),
    });
    return facts;
  }

  /**
   * Bounded, read-only poll until the two date controls are present, or the window expires.
   *
   * Returns the last HTML read either way — a timeout is not an error here, it is the honest last
   * observation, and the caller fails closed on it with the diagnostic attached. No click, no navigation.
   */
  private async settleDateControls(): Promise<string> {
    const timeoutMs = this.opts.dateSettleTimeoutMs ?? 8_000;
    const intervalMs = this.opts.dateSettleIntervalMs ?? 500;
    const deadline = Date.now() + timeoutMs;
    let html = await this.ctx().content();
    let polls = 0;
    while (importLocateDiagnostic(html).dateInputCount !== 2 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
      polls += 1;
      html = await this.ctx().content();
    }
    if (polls > 0) {
      // Sanitized: how many polls it took, never what was on the page. Worth logging because "resolved on
      // the first read" and "resolved after six seconds" are different facts about this surface.
      log("aw_import_date_settle", { polls, resolved: importLocateDiagnostic(html).dateInputCount === 2 });
    }
    return html;
  }

  async locateTarget(target: ImportTarget): Promise<LocateResult> {
    if (target === "export") {
      const decision = await this.proven.locate();
      if (decision.count === 1 && decision.sig) this.sigs.set("export", decision.sig);
      return decision;
    }
    if (target === "consent") {
      // Deferred, not found — the control does not exist yet. See the module note.
      this.sigs.set("consent", DEFERRED_CONSENT_SIG);
      return { count: 1, sig: DEFERRED_CONSENT_SIG };
    }

    const html = target === "apply_range" ? await this.ctx().content() : await this.settleDateControls();
    const decision =
      target === "apply_range"
        ? locateApplyDecision(html)
        : locateDateDecision(html, target === "start_date" ? "start" : "end");

    if (decision.count !== 1 || decision.index === undefined) {
      // Fail closed with SANITIZED structure only, and say which questions would resolve it. Nothing here
      // is a selector, a class name, a value, or page text.
      log("aw_import_locate_unresolved", {
        target,
        count: decision.count,
        frameResolved: this.proven.surfaceFrameResolved(),
        childFrames: this.proven.childFrameCount(),
        ...importLocateDiagnostic(html),
      });
      return { count: decision.count };
    }

    // Bind in-page and cross-check the tag count. Any disagreement between the string decision and what
    // is actually on the page fails closed with no tag left behind — the same anti-divergence rule the
    // proven export locate uses.
    const diagnostic = importLocateDiagnostic(html);
    const expectedTotal = target === "apply_range" ? diagnostic.applyCandidateCount : diagnostic.dateInputTotal;
    const tagged = await this.tagTarget(target, decision.index, expectedTotal);
    if (tagged !== 1) {
      // -1 means the in-page count disagreed with the pure one: real drift between two reads of a live
      // page, not a filter mismatch. Reported distinctly so it is not confused with "found nothing".
      log("aw_import_locate_tag_divergence", { target, tagged, expectedTotal, drift: tagged === -1 });
      return { count: tagged === -1 ? 0 : tagged };
    }
    const sig = await this.readTargetSig();
    if (!sig) return { count: 0 };
    this.sigs.set(target, sig);
    return { count: 1, sig };
  }

  /**
   * Annotate read-only and RE-VALIDATE. The overlay is `pointer-events: none`, so it can never intercept
   * the seller's click — the same property the proven export overlay relies on.
   */
  async highlightTarget(target: ImportTarget): Promise<LocateResult> {
    if (target === "export") {
      await this.proven.highlight();
      const sig = this.sigs.get("export");
      return sig ? { count: 1, sig } : { count: 0 };
    }
    if (target === "consent") {
      // The proven continuation machinery highlights the real control when it appears.
      return { count: 1, sig: DEFERRED_CONSENT_SIG };
    }

    // Re-locate from scratch: if the unique match moved between locate and highlight, the surface drifted
    // and the engine must fail closed rather than annotate the wrong control.
    const revalidated = await this.locateTarget(target);
    if (revalidated.count !== 1) return revalidated;

    await this.ctx().evaluate(NAME_SHIM);
    await mountOverlay(this.ctx(), {
      stepNumber: this.stepNumber,
      totalSteps: this.badgeTotalSteps ?? this.opts.totalSteps ?? 8,
      copyKey: `actionWindow.import.${target}`,
      guidanceEnabled: this.opts.guidanceEnabled ?? true,
    });
    return revalidated;
  }

  /**
   * Observe that a DATE was actually set — not that the field was touched.
   *
   * The shared `armObserver` binds `click`, which is right for a button and wrong for a date field: clicking
   * a calendar-backed input opens the picker, and the seller may then close it without choosing anything.
   * Treating that click as "step done" would advance the run on an unset date and hand a wrong window to the
   * scope gate. So this watches the input's VALUE property instead, which is both the honest signal and the
   * same thing the gate will later verify — the two converge rather than disagree.
   *
   * The value is compared IN-PAGE against a baseline captured here; only a boolean ever crosses back. Angular
   * writes the value programmatically when the picker closes and may fire no input event at all, so a bounded
   * poll backs up the listeners.
   */
  private async armDateObserve(): Promise<void> {
    await this.ctx().evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const el = document.querySelector("[data-aw-target]") as HTMLInputElement | null;
      const prior = w["__aw_import_date_poll__"];
      if (typeof prior === "number") clearInterval(prior);
      w["__aw_import_date_changed__"] = false;
      if (!el) return;
      // Baseline stays in the page. A date the seller has on screen is theirs; it never crosses to the agent.
      const baseline = el.value ?? "";
      const check = (): void => {
        const now = el.value ?? "";
        if (now.trim() !== "" && now !== baseline) w["__aw_import_date_changed__"] = true;
      };
      for (const ev of ["change", "input", "blur"]) el.addEventListener(ev, check);
      w["__aw_import_date_poll__"] = setInterval(check, 250) as unknown as number;
    });
  }

  private async waitForDateSet(timeoutMs: number): Promise<boolean> {
    try {
      await this.ctx().waitForFunction(
        () => (window as unknown as Record<string, unknown>)["__aw_import_date_changed__"] === true,
        undefined,
        { timeout: timeoutMs, polling: 250 },
      );
      return true;
    } catch {
      return false;
    }
  }

  async armTargetObserve(target: ImportTarget): Promise<void> {
    if (target === "start_date" || target === "end_date") {
      await this.armDateObserve();
      return;
    }
    if (target === "export") {
      // Arms the download listener EARLY as well: a sync export can fire on the click itself.
      await this.proven.armObserve();
      return;
    }
    // Consent needs no arming here — the proven race owns it.
    if (target === "consent") return;

    await this.ctx().evaluate(NAME_SHIM);
    await armObserver(this.ctx());
  }

  /**
   * Wait for the SELLER's own action. Never clicks, never simulates.
   *
   * For `consent` this runs the one live-proven consent+download race and caches its outcome; a
   * non-detection is reported as "the seller did not act", which the engine turns into a barrier that
   * simply never advanced rather than a failure it cannot explain.
   */
  async waitForTargetAction(target: ImportTarget): Promise<boolean> {
    if (target === "consent") {
      this.consentRace = await this.proven.detectDownload();
      return this.consentRace.detected;
    }
    if (target === "start_date" || target === "end_date") {
      // A generous window: the seller is picking a date from a calendar, which is slower than a click.
      return this.waitForDateSet(this.opts.dateObserveTimeoutMs ?? 120_000);
    }
    if (target === "export") return this.proven.waitForUserAction();
    return waitForUserAction(this.ctx(), { timeoutMs: this.opts.observeTimeoutMs ?? 15_000 });
  }

  /**
   * Compare what is selected against the required window, in-process.
   *
   * The raw values come from the proven `readExportScope` and are consumed HERE — only the three-value
   * verdict leaves this method. That is what keeps the existing OPERATOR-LOCAL rule intact: the values are
   * never logged, never persisted, never transported.
   */
  async readSelectedScope(required: RequiredRange): Promise<ScopeMatch> {
    const readback = await this.proven.readExportScope();
    const verdict = matchExportScope(readback.rangeValues, { start: required.start, end: required.end });
    // The verdict and how many dates were parseable — never a date value, and never the required window.
    log("aw_import_scope_verdict", {
      match: verdict.match,
      datesParsed: verdict.datesParsed,
      spanDiffers: verdict.spanDiffers,
    });
    this.lastScopeVerdict = verdict.match;
    return verdict.match;
  }

  /* ── range discovery (the run that precedes the plan) ─────────────────────── */

  /**
   * What the date controls DECLARE as reachable — `min`/`max`, read off the same inputs a segment run drives.
   *
   * **`noticeTexts` is deliberately empty, and that is a decision rather than an omission.** The pure verdict
   * can also read a per-query span cap out of range-area notices (`조회 기간은 최대 3개월`), but nothing
   * downstream consumes one: the backend segments a plan by calendar month unconditionally, so a cap changes
   * no behaviour. Reading arbitrary page text off a live seller surface — where review bodies and customer
   * names live — to compute a value nobody uses is exposure with no purpose. If a cap ever becomes
   * load-bearing, `readSpanCapMonths` is already written and tested; what is missing then is a BOUNDED,
   * notice-scoped read, not this one.
   */
  async readRangeControls(): Promise<RangeControlProbe> {
    const html = await this.settleDateControls();
    const bounds = dateBoundsProbe(html);
    // Sanitized: how many bounds were declared, never their values. This is the fact that decides whether the
    // seller is asked to pick the dates themselves, so an operator reading a transcript needs to see it.
    log("aw_import_discovery_bounds", {
      minAttrs: bounds.minAttrs.length,
      maxAttrs: bounds.maxAttrs.length,
      frameResolved: this.proven.surfaceFrameResolved(),
      dateInputCount: importLocateDiagnostic(html).dateInputCount,
    });
    return { ...bounds, noticeTexts: [] };
  }

  /**
   * The dates the seller selected, read back through the SAME path the segment gate uses.
   *
   * Reusing `readExportScope` is what keeps discovery and the later per-segment verification from disagreeing
   * about what is selected on this surface — a disagreement would show up as a segment blocked on a window
   * discovery had just reported as reachable.
   *
   * Fewer than two readable dates returns null. It is not an error and must not be turned into one: the
   * engine's obligation on null is to fail the run rather than report a range, and a thrown error would be
   * indistinguishable from a driver fault.
   */
  async readSelectedRange(): Promise<DiscoveredRange | null> {
    const readback = await this.proven.readExportScope();
    const dates = extractDates(readback.rangeValues);
    // COUNT only. The values are this run's product and go to the server; they are never logged.
    log("aw_import_discovery_selected", { datesParsed: dates.length });
    if (dates.length < 2) return null;
    const start = dates[0]!;
    const end = dates[dates.length - 1]!;
    return start <= end ? { start, end } : null;
  }

  /**
   * Hand the established range to the injected reporter. No reporter ⇒ false, never a silent success:
   * a discovery run that could not create a plan must fail, or the seller is returned to a card that offers
   * to continue an import that does not exist.
   */
  async reportDiscoveredRange(
    range: DiscoveredRange,
    evidence: "MACHINE_DISCOVERED" | "OPERATOR_CONFIRMED",
  ): Promise<boolean> {
    const report = this.opts.reportRange;
    if (!report) {
      log("aw_import_discovery_no_reporter", { reported: false });
      return false;
    }
    const ok = await report(range, evidence).catch(() => false);
    // The evidence enum and the outcome — never the dates.
    log("aw_import_discovery_reported", { ok, evidence });
    return ok;
  }

  /**
   * How this run's scope was established, for the ingest capability.
   *
   * Derived from the driver's OWN read rather than passed in, because the driver is the only component that
   * actually performed it. The mapping is the same one `gateOnScope` applies: a machine match is the only
   * thing that may be recorded as a machine check, and everything else — including a read that never
   * happened — records the seller's confirmation instead. Defaulting the other way would relabel an
   * operator attestation as machine-verified, which is the one thing this flow must never do.
   */
  scopeEvidence(): "MACHINE_MATCHED" | "OPERATOR_CONFIRMED" {
    return this.lastScopeVerdict === "MATCH" ? "MACHINE_MATCHED" : "OPERATOR_CONFIRMED";
  }

  /**
   * The download the consent race already found. Racing again would arm a second listener after the first
   * consumed the event, so a successful run would report a timeout.
   */
  async detectDownload(): Promise<DownloadDetectResult> {
    if (this.consentRace) return this.consentRace;
    // Reachable only if the engine ever asks without a consent barrier having run. Fail closed rather than
    // start a second race whose result could contradict the first.
    log("aw_import_download_without_consent_race", { detected: false });
    return { detected: false };
  }

  validateArtifact(artifactRef: string): Promise<ArtifactValidateResult> {
    return this.proven.validateArtifact(artifactRef);
  }

  ingest(artifactRef: string): Promise<IngestResult> {
    return this.proven.ingest(artifactRef);
  }

  async cleanup(): Promise<void> {
    this.consentRace = null;
    this.sigs.clear();
    // Stop the value poll, or it keeps running in the page after the run ends.
    await this.ctx()
      .evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const handle = w["__aw_import_date_poll__"];
        if (typeof handle === "number") clearInterval(handle);
        w["__aw_import_date_poll__"] = undefined;
      })
      .catch(() => {});
    await this.proven.cleanup();
  }

  /**
   * Tag exactly one element as the Action Window target, clearing any previous tag first so overlays and
   * observers can never attach to a stale control. Returns how many ended up tagged — the caller fails
   * closed on anything but 1.
   */
  private async tagTarget(target: ImportTarget, index: number, expectedTotal: number): Promise<number> {
    await this.ctx().evaluate(NAME_SHIM);
    return this.ctx().evaluate(
      ({ kind, wanted, total }) => {
        for (const stale of Array.from(document.querySelectorAll("[data-aw-target]"))) {
          stale.removeAttribute("data-aw-target");
        }
        // NO actionability re-check in here. The pure decision already made that judgement, and a second
        // implementation of it in-page is how this driver failed three times: `readonly` was corrected in
        // the pure module and left in place here, so the two disagreed and the tag count came back 0.
        // In-page work is now selection only, and the count assertion below is what detects real drift.
        const candidates =
          kind === "apply_range"
            ? Array.from(document.querySelectorAll("button, a, input[type=button], input[type=submit]")).filter((el) => {
                const text = `${el.textContent ?? ""} ${(el as HTMLInputElement).value ?? ""}`.toLowerCase();
                return ["조회", "검색", "적용", "search"].some((w) => text.includes(w.toLowerCase()));
              })
            : Array.from(
                document.querySelectorAll(
                  'input[type="date"], input[class*="date"], input[class*="calendar"], input[class*="picker"]',
                ),
              );
        // The pure decision counted `total` of these a moment ago. A different number now means the DOM
        // moved between the two reads — that is drift, and it fails closed with no tag left behind.
        if (candidates.length !== total) return -1;
        const chosen = candidates[wanted];
        if (!chosen) return 0;
        chosen.setAttribute("data-aw-target", "1");
        return document.querySelectorAll("[data-aw-target]").length;
      },
      { kind: target, wanted: index, total: expectedTotal },
    );
  }

  /**
   * Opaque 16-hex signature of the tagged control, derived from STRUCTURE only — tag name, type, and
   * ordinal position. Deliberately not from a class name, an id, or a value: a signature is compared
   * across two reads to detect drift, and one built from content would change when content changed.
   */
  private async readTargetSig(): Promise<string | null> {
    return this.ctx().evaluate(() => {
      const el = document.querySelector("[data-aw-target]");
      if (!el) return null;
      const siblings = el.parentElement ? Array.from(el.parentElement.children) : [el];
      const shape = `${el.tagName}:${(el as HTMLInputElement).type ?? ""}:${siblings.indexOf(el)}:${siblings.length}`;
      let hash = 0x811c9dc5;
      for (let i = 0; i < shape.length; i++) {
        hash = (hash ^ shape.charCodeAt(i)) * 0x01000193;
        hash >>>= 0;
      }
      return hash.toString(16).padStart(8, "0").repeat(2).slice(0, 16);
    });
  }
}
