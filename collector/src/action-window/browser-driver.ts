/**
 * **Browser probe driver (R2, RUN_INTEGRATION only).** The real-Chrome implementation of
 * `ProbeDriver`, factored out of R1's `harness.ts` so `ActionWindowSession` can drive either a real
 * synthetic page or the offline `SyntheticProbeDriver` through one interface.
 *
 * INVARIANT: no target-click path. `waitForUserAction` may receive a TEST-ONLY `simulateUserAction`
 * (which clicks from TEST code) exactly as R1's harness did; in headed/production use it is undefined
 * and the driver only observes.
 */
import { randomUUID } from "node:crypto";
import type { Download, Page } from "playwright";
import { artifactRefFor } from "./artifact";
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
   * Downstream behavior against the fixture page. By default every downstream probe returns a
   * SYNTHETIC deterministic result. `realDetection` switches `detectDownload()` to REAL read-only
   * observation of the browser's download event (armed alongside the click observer, raced against
   * `timeoutMs`): the download is observed, reported as a nonce-seeded opaque ref (no filename/
   * path/URL influences the ref), and immediately DISCARDED — never saved, read, or ingested.
   * Artifact validation/ingestion stay synthetic in this slice.
   */
  downstream?: {
    detect?: DownloadDetectResult;
    validate?: ArtifactValidateResult;
    ingest?: IngestResult;
    realDetection?: { timeoutMs?: number };
  };
}

export class BrowserProbeDriver implements ProbeDriver {
  private readonly page: Page;
  private readonly opts: BrowserProbeOptions;
  /** Armed BEFORE the user acts (a download can fire the instant they click); resolved lazily. */
  private pendingDownload: Promise<Download | null> | null = null;

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
    if (this.opts.downstream?.realDetection && !this.pendingDownload) {
      // Listen from the moment the user may act — a later subscription could miss a fast download.
      // timeout: 0 disables Playwright's own timeout; detectDownload() races the deadline instead.
      this.pendingDownload = this.page.waitForEvent("download", { timeout: 0 }).catch(() => null);
    }
    return armObserver(this.page);
  }

  async waitForUserAction(): Promise<boolean> {
    if (this.opts.simulateUserAction) await this.opts.simulateUserAction(this.page); // TEST-ONLY click
    return waitForUserAction(this.page, { timeoutMs: this.opts.observeTimeoutMs ?? 15_000 });
  }

  verify(expectedSig: string): Promise<VerifyResult> {
    return verifyTransition(this.page, { expectedSig });
  }

  /* Downstream (synthetic by default; real read-only detection via downstream.realDetection). */
  async detectDownload(): Promise<DownloadDetectResult> {
    const real = this.opts.downstream?.realDetection;
    if (!real) {
      return this.opts.downstream?.detect ?? { detected: true, artifactRef: SYNTHETIC_ARTIFACT_REF };
    }
    const timeoutMs = real.timeoutMs ?? 5_000;
    const armed = this.pendingDownload ?? this.page.waitForEvent("download", { timeout: timeoutMs }).catch(() => null);
    let timer: NodeJS.Timeout | undefined;
    const download = await Promise.race([
      armed,
      new Promise<null>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(null), timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!download) return { detected: false };
    // Observed and DISCARDED. The ref is seeded from a detection-local NONCE only — no filename,
    // path, or URL from the download object ever influences the emitted ref or leaves this scope —
    // and cancel() drops the file: nothing is saved, read, or ingested in this slice.
    const artifactRef = artifactRefFor(["aw-browser-download", randomUUID()]);
    await download.cancel().catch(() => {});
    this.pendingDownload = null;
    return { detected: true, artifactRef };
  }
  validateArtifact(_artifactRef: string): Promise<ArtifactValidateResult> {
    return Promise.resolve(this.opts.downstream?.validate ?? { valid: true });
  }
  ingest(_artifactRef: string): Promise<IngestResult> {
    return Promise.resolve(this.opts.downstream?.ingest ?? { ok: true, processed: 1 });
  }

  async cleanup(): Promise<void> {
    this.pendingDownload = null; // the armed listener promise carries its own catch; just drop it
    await unmountOverlay(this.page).catch(() => {});
    await disarmObserver(this.page).catch(() => {});
  }
}
