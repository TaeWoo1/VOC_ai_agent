/**
 * **A marketplace tab that does not exist until the seller asks for it.**
 *
 * ## Why the seller center stopped opening at boot
 *
 * The import agent used to launch its browser straight onto the NAVER review surface. The reasoning was that a
 * seated operator has to log in there before any run can happen, so deferring would only move the wait
 * (2026-07-25). Watching someone use it says otherwise (product-owner observation, 2026-07-26): a marketplace
 * window that appears before the seller has asked for anything is a window they have to deal with — read, move,
 * or ignore — during the part of onboarding where they are still in SellerOps deciding things.
 *
 * The browser itself still opens at boot, on SellerOps, in the same profile: one window, one session, one account
 * to get right (see `cli/local-agent.ts`). What this module defers is the SELLER CENTER tab — opened when they ask
 * to be connected, or at the latest by the first run that needs it. The operator still logs in themselves, in that
 * tab, and a run still fails closed on `LOGIN_REQUIRED` until they have.
 *
 * ## What opens it, and what deliberately does not
 *
 * Anything that needs the page opens it. Four things do NOT, and that is the whole care in this module:
 *
 *  - `cleanup()` — there is nothing to clean up. A run that failed before the surface existed must not open a
 *    marketplace tab on its way out; that would be an interruption caused entirely by our own error handling.
 *  - `clearTargetHighlight()` — nothing is highlighted.
 *  - `renderGuidance(null)` — a panel that was never mounted needs no removing.
 *  - `takeGuidanceIntent()` — a panel that does not exist has not been pressed. Answering `null` is not a guess;
 *    it is the only true answer.
 *
 * That matters because a session's panel poll and its pack render start as soon as the frontend's copy arrives,
 * which races the first `prepareSurface`. Without those four exemptions, a teardown or an idle poll could be the
 * thing that puts a marketplace window in front of the seller.
 *
 * Pure of Playwright: opening is an injected thunk, so this module has no browser import and its behaviour —
 * including "open exactly once, even under concurrent calls" — is unit-testable offline.
 */
import { log } from "../../log";
import type { ScopeEvidenceWire } from "../scope-evidence";
import type { ScopeMatch } from "../../naver/export-scope-match";
import type { ImportSurfaceFacts } from "../../naver/import-guidance-plan";
import type { GuidancePanelState } from "../guidance-panel";
import type {
  ArtifactValidateResult,
  DownloadDetectResult,
  IngestResult,
  LocateResult,
  SurfaceProbeResult,
} from "../engine";
import type { ImportProbeDriver, ImportTarget, RequiredRange } from "./import-driver";
import { ReliabilityFailure } from "./reliability-failure";
import { recordStage } from "./reliability-instrumentation";

export interface LazyImportDriverDeps {
  /**
   * Open the marketplace surface and build the real driver.
   *
   * Called AT MOST ONCE per lifetime. A rejection is not cached: an open that failed because, say, the page would
   * not load should be retryable on the seller's next attempt rather than poisoning the agent.
   */
  open: () => Promise<ImportProbeDriver>;
}

export class LazyImportDriver implements ImportProbeDriver {
  private readonly deps: LazyImportDriverDeps;
  /** The in-flight or settled launch. Held so concurrent first calls share ONE browser, not one each. */
  private opening: Promise<ImportProbeDriver> | null = null;
  private opened: ImportProbeDriver | null = null;

  constructor(deps: LazyImportDriverDeps) {
    this.deps = deps;
  }

  /** Whether the surface has been brought up — a sanitized boolean, for the boot's teardown and for tests. */
  isOpen(): boolean {
    return this.opened !== null;
  }

  /**
   * **Guided Acquisition Reliability — forget the closed surface so the next run re-opens it.**
   *
   * The seller closed the marketplace window. The boot's close handler calls this so the cached driver — now
   * bound to a dead page — is dropped; the next `prepareSurface` (a re-check re-runs PREPARE) goes back through
   * `deps.open()` and brings a fresh window up in the SAME persistent profile, so the session survives. Safe to
   * call more than once and before anything opened.
   */
  markClosed(): void {
    this.opened = null;
    this.opening = null;
  }

  /**
   * Resolve when the currently-open surface closes. Only meaningful once opened — before that there is no window
   * to close, so it never resolves. Delegated to the underlying driver, which owns the real page.
   */
  async whenSurfaceClosed(): Promise<void> {
    if (!this.opened) return new Promise<void>(() => {});
    return this.opened.whenSurfaceClosed?.() ?? new Promise<void>(() => {});
  }

  /**
   * Open the seller center NOW, because the seller just asked to be connected.
   *
   * The product owner stated the journey as a sequence: open SellerOps, request the connection, and then the
   * seller center appears (2026-07-26). This is that middle arrow. It is a warm-up, not a run — nothing is
   * started, nothing is probed, and a run still needs a server-authorized ticket.
   *
   * Idempotent and never throws: it is called from the bridge's pairing and socket-accept paths, and a tab that
   * failed to open must not be able to refuse a pairing. A failure here simply leaves the surface closed, and the
   * first run that needs it will try again and report a real blocker if it still cannot.
   */
  async warmUp(): Promise<void> {
    await this.surface().then(
      () => undefined,
      () => undefined,
    );
  }

  /**
   * The real driver, launching it if this is the first thing that needed it.
   *
   * Serialized through one promise: the panel poll, the pack render and the first `prepareSurface` can all arrive
   * at once, and each awaiting its own launch would open several browsers on the seller's machine.
   */
  private surface(): Promise<ImportProbeDriver> {
    if (this.opened) return Promise.resolve(this.opened);
    if (this.opening) return this.opening;
    log("aw_import_surface_opening", {});
    this.opening = this.deps
      .open()
      .then((driver) => {
        this.opened = driver;
        return driver;
      })
      .finally(() => {
        // Cleared either way. On success `opened` answers from now on; on failure the next attempt may try again
        // rather than inherit a rejected promise for the rest of the sitting.
        this.opening = null;
      });
    return this.opening;
  }

  /* ── needs the page ─────────────────────────────────────────────────────── */

  async prepareSurface(): Promise<boolean | SurfaceProbeResult> {
    // Opening the marketplace window is the first place a guided run can fail. Before this, an open that
    // threw propagated raw and the run died silently; now it is an explicit, recoverable SURFACE_OPEN_FAILED —
    // a re-check re-runs PREPARE and tries the open again. A throw from the driver's OWN prepareSurface (a
    // settle timeout, say) is already a ReliabilityFailure and passes through untouched.
    let driver: ImportProbeDriver;
    try {
      driver = await this.surface();
    } catch {
      throw new ReliabilityFailure("SURFACE_OPEN_FAILED");
    }
    recordStage("SURFACE_OPEN");
    return driver.prepareSurface();
  }

  async readSurfaceFacts(): Promise<ImportSurfaceFacts> {
    return (await this.surface()).readSurfaceFacts();
  }

  async locateTarget(target: ImportTarget): Promise<LocateResult> {
    return (await this.surface()).locateTarget(target);
  }

  async highlightTarget(target: ImportTarget): Promise<LocateResult> {
    return (await this.surface()).highlightTarget(target);
  }

  async isTargetPrefilled(target: ImportTarget, required: RequiredRange): Promise<boolean> {
    return (await this.surface()).isTargetPrefilled(target, required);
  }

  async armTargetObserve(target: ImportTarget): Promise<void> {
    return (await this.surface()).armTargetObserve(target);
  }

  async waitForTargetAction(target: ImportTarget): Promise<boolean> {
    return (await this.surface()).waitForTargetAction(target);
  }

  async readSelectedScope(required: RequiredRange): Promise<ScopeMatch> {
    return (await this.surface()).readSelectedScope(required);
  }

  async detectDownload(): Promise<DownloadDetectResult> {
    return (await this.surface()).detectDownload();
  }

  async validateArtifact(artifactRef: string): Promise<ArtifactValidateResult> {
    return (await this.surface()).validateArtifact(artifactRef);
  }

  async ingest(artifactRef: string, scopeEvidence: ScopeEvidenceWire): Promise<IngestResult> {
    return (await this.surface()).ingest(artifactRef, scopeEvidence);
  }

  /**
   * Drawing the panel needs the page — but REMOVING it does not.
   *
   * A run that is showing the seller something has already opened the surface, or is about to; a run taking its
   * panel down may never have had one, and launching a browser to remove a panel that was never mounted would be
   * the clearest possible case of an interruption caused by nothing.
   */
  async renderGuidance(state: GuidancePanelState | null): Promise<void> {
    if (state === null && !this.opened) return;
    return (await this.surface()).renderGuidance(state);
  }

  /* ── must never open it ─────────────────────────────────────────────────── */

  /** A panel that does not exist has not been pressed. `null` is the true answer, not a guess. */
  async takeGuidanceIntent(): Promise<string | null> {
    if (!this.opened) return null;
    return this.opened.takeGuidanceIntent();
  }

  /** Nothing is highlighted on a surface that was never brought up. */
  async clearTargetHighlight(): Promise<void> {
    if (!this.opened) return;
    return this.opened.clearTargetHighlight();
  }

  /**
   * Nothing to clean up, and nothing to open in order to find that out.
   *
   * This is the exemption that matters most: `cleanup` runs on every fail-closed path, including ones that
   * happen before the surface exists at all.
   */
  async cleanup(): Promise<void> {
    if (!this.opened) return;
    return this.opened.cleanup();
  }
}
