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
 * ## The seller's two clicks map to one live race
 *
 * `waitForTargetAction("consent")` runs that race and caches its outcome; `detectDownload` then returns the
 * cached result instead of racing twice. Racing twice would arm a second download listener after the first
 * had already consumed the event, so the second would time out on a run that had actually succeeded.
 */
import type { Page } from "playwright";
import type { ScopeMatch } from "../../naver/export-scope-match";
import { matchExportScope } from "../../naver/export-scope-match";
import {
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
import type { ImportProbeDriver, ImportTarget, RequiredRange } from "./import-driver";

/** Some bundlers inject `__name(...)` into serialized evaluate bodies — a harmless identity shim. */
const NAME_SHIM = "globalThis.__name = globalThis.__name || function (f) { return f; };";

/** Deferred single match for the consent control — see the module note on why it cannot be located early. */
const DEFERRED_CONSENT_SIG = "c0c0c0c0c0c0c0c0";

export interface NaverLiveImportDriverOptions {
  /** Bounded window for the seated seller to act on a highlighted control. */
  observeTimeoutMs?: number;
  guidanceEnabled?: boolean;
  /** Total steps, for the diagnostic overlay badge. Supplied by the run's own step plan. */
  totalSteps?: number;
}

export class NaverLiveImportDriver implements ImportProbeDriver {
  private readonly page: Page;
  private readonly proven: NaverLiveProbeDriver;
  private readonly opts: NaverLiveImportDriverOptions;
  /** Signatures handed out per target, so highlight can re-validate against what locate decided. */
  private readonly sigs = new Map<ImportTarget, string>();
  /** Cached result of the one consent+download race — see the module note. */
  private consentRace: DownloadDetectResult | null = null;
  private stepNumber = 1;
  /** The last scope verdict this driver produced. It is the only component that actually made the read. */
  private lastScopeVerdict: ScopeMatch | null = null;

  constructor(page: Page, proven: NaverLiveProbeDriver, opts: NaverLiveImportDriverOptions = {}) {
    this.page = page;
    this.proven = proven;
    this.opts = opts;
  }

  /** Which step the diagnostic overlay badge should show. Set by the session as the run advances. */
  setStepNumber(stepNumber: number): void {
    this.stepNumber = stepNumber;
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
    const html = await this.page.content();
    const facts: ImportSurfaceFacts = { requiresApply: inferRequiresApply(html), requiresFilters: false };
    // Sanitized: booleans and counts only. Logged because the answer fixes the step plan for the whole
    // run, so an operator reading a transcript needs to see which plan was chosen and why.
    log("aw_import_surface_facts", { ...facts, ...importLocateDiagnostic(html) });
    return facts;
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

    const html = await this.page.content();
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
        ...importLocateDiagnostic(html),
      });
      return { count: decision.count };
    }

    // Bind in-page and cross-check the tag count. Any disagreement between the string decision and what
    // is actually on the page fails closed with no tag left behind — the same anti-divergence rule the
    // proven export locate uses.
    const tagged = await this.tagTarget(target, decision.index);
    if (tagged !== 1) {
      log("aw_import_locate_tag_divergence", { target, tagged });
      return { count: tagged };
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

    await this.page.evaluate(NAME_SHIM);
    await mountOverlay(this.page, {
      stepNumber: this.stepNumber,
      totalSteps: this.opts.totalSteps ?? 8,
      copyKey: `actionWindow.import.${target}`,
      guidanceEnabled: this.opts.guidanceEnabled ?? true,
    });
    return revalidated;
  }

  async armTargetObserve(target: ImportTarget): Promise<void> {
    if (target === "export") {
      // Arms the download listener EARLY as well: a sync export can fire on the click itself.
      await this.proven.armObserve();
      return;
    }
    // Consent needs no arming here — the proven race owns it.
    if (target === "consent") return;

    await this.page.evaluate(NAME_SHIM);
    await armObserver(this.page);
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
    if (target === "export") return this.proven.waitForUserAction();
    return waitForUserAction(this.page, { timeoutMs: this.opts.observeTimeoutMs ?? 15_000 });
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
    await this.proven.cleanup();
  }

  /**
   * Tag exactly one element as the Action Window target, clearing any previous tag first so overlays and
   * observers can never attach to a stale control. Returns how many ended up tagged — the caller fails
   * closed on anything but 1.
   */
  private async tagTarget(target: ImportTarget, index: number): Promise<number> {
    await this.page.evaluate(NAME_SHIM);
    return this.page.evaluate(
      ({ kind, wanted }) => {
        for (const stale of Array.from(document.querySelectorAll("[data-aw-target]"))) {
          stale.removeAttribute("data-aw-target");
        }
        const actionable = (el: Element): boolean => {
          const input = el as HTMLInputElement;
          if (input.disabled || input.readOnly) return false;
          if (input.type === "hidden") return false;
          const style = window.getComputedStyle(el);
          return style.display !== "none" && style.visibility !== "hidden";
        };
        let candidates: Element[];
        if (kind === "apply_range") {
          const words = ["조회", "검색", "적용", "search"];
          candidates = Array.from(document.querySelectorAll("button, a, input[type=button], input[type=submit]"))
            .filter(actionable)
            .filter((el) => {
              const text = `${el.textContent ?? ""} ${(el as HTMLInputElement).value ?? ""}`.toLowerCase();
              return words.some((w) => text.includes(w.toLowerCase()));
            });
        } else {
          candidates = Array.from(
            document.querySelectorAll(
              'input[type="date"], input[class*="date"], input[class*="calendar"], input[class*="picker"]',
            ),
          ).filter(actionable);
          // The date pair must be exactly two here as well; the pure decision already required it, and
          // re-checking in-page is what catches a surface that changed between the two reads.
          if (candidates.length !== 2) return candidates.length;
        }
        const chosen = candidates[wanted];
        if (!chosen) return 0;
        chosen.setAttribute("data-aw-target", "1");
        return document.querySelectorAll("[data-aw-target]").length;
      },
      { kind: target, wanted: index },
    );
  }

  /**
   * Opaque 16-hex signature of the tagged control, derived from STRUCTURE only — tag name, type, and
   * ordinal position. Deliberately not from a class name, an id, or a value: a signature is compared
   * across two reads to detect drift, and one built from content would change when content changed.
   */
  private async readTargetSig(): Promise<string | null> {
    return this.page.evaluate(() => {
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
