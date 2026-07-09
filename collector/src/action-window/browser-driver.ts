/**
 * **Browser probe driver (R2, RUN_INTEGRATION only).** The real-Chrome implementation of
 * `ProbeDriver`, factored out of R1's `harness.ts` so `ActionWindowSession` can drive either a real
 * synthetic page or the offline `SyntheticProbeDriver` through one interface.
 *
 * INVARIANT: no target-click path. `waitForUserAction` may receive a TEST-ONLY `simulateUserAction`
 * (which clicks from TEST code) exactly as R1's harness did; in headed/production use it is undefined
 * and the driver only observes.
 */
import type { Page } from "playwright";
import type { ArtifactValidateResult, DownloadDetectResult, IngestResult, LocateResult, VerifyResult } from "./engine";
import { SYNTHETIC_ARTIFACT_REF, type ProbeDriver } from "./session";
import { STEP_PLAN, TOTAL_STEPS } from "./stages";
import { fixtureHtml, type FixtureMode } from "./fixture";
import { locateTarget, surfaceIsValid } from "./locator";
import { mountOverlay, unmountOverlay } from "./overlay";
import { armObserver, disarmObserver, waitForUserAction } from "./observer";
import { verifyTransition } from "./verifier";

export interface BrowserProbeOptions {
  mode: FixtureMode;
  guidanceEnabled?: boolean;
  /** TEST-ONLY: performs the real click on the target. Undefined in headed/production use. */
  simulateUserAction?: (page: Page) => Promise<void>;
  observeTimeoutMs?: number;
  /**
   * SYNTHETIC downstream results for the fixture page (which produces no real download). Real
   * read-only download detection / artifact validation / ingestion arrive with the channel-adapter
   * slice; overriding these lets fixtures exercise the downstream fail-closed paths.
   */
  downstream?: {
    detect?: DownloadDetectResult;
    validate?: ArtifactValidateResult;
    ingest?: IngestResult;
  };
}

export class BrowserProbeDriver implements ProbeDriver {
  private readonly page: Page;
  private readonly opts: BrowserProbeOptions;

  constructor(page: Page, opts: BrowserProbeOptions) {
    this.page = page;
    this.opts = opts;
  }

  async prepareSurface(): Promise<boolean> {
    await this.page.setContent(fixtureHtml(this.opts.mode));
    // Identity shim for bundlers that inject `__name(...)` into serialized evaluate bodies (see harness.ts).
    await this.page.evaluate("globalThis.__name = globalThis.__name || function (f) { return f; };");
    return surfaceIsValid(this.page);
  }

  locate(): Promise<LocateResult> {
    return locateTarget(this.page);
  }

  async highlight(): Promise<void> {
    const humanStep = STEP_PLAN[1]!;
    await mountOverlay(this.page, {
      stepNumber: humanStep.stepNumber,
      totalSteps: TOTAL_STEPS,
      copyKey: humanStep.copyKey,
      guidanceEnabled: this.opts.guidanceEnabled ?? true,
    });
  }

  armObserve(): Promise<void> {
    return armObserver(this.page);
  }

  async waitForUserAction(): Promise<boolean> {
    if (this.opts.simulateUserAction) await this.opts.simulateUserAction(this.page); // TEST-ONLY click
    return waitForUserAction(this.page, { timeoutMs: this.opts.observeTimeoutMs ?? 15_000 });
  }

  verify(expectedSig: string): Promise<VerifyResult> {
    return verifyTransition(this.page, { expectedSig });
  }

  /* Synthetic downstream (fixture pages fire no real download; see BrowserProbeOptions.downstream). */
  detectDownload(): Promise<DownloadDetectResult> {
    return Promise.resolve(this.opts.downstream?.detect ?? { detected: true, artifactRef: SYNTHETIC_ARTIFACT_REF });
  }
  validateArtifact(_artifactRef: string): Promise<ArtifactValidateResult> {
    return Promise.resolve(this.opts.downstream?.validate ?? { valid: true });
  }
  ingest(_artifactRef: string): Promise<IngestResult> {
    return Promise.resolve(this.opts.downstream?.ingest ?? { ok: true, processed: 1 });
  }

  async cleanup(): Promise<void> {
    await unmountOverlay(this.page).catch(() => {});
    await disarmObserver(this.page).catch(() => {});
  }
}
