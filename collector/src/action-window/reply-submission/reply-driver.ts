/**
 * **Reply-submission probe seam + synthetic driver (ISOLATED, offline).**
 *
 * The side-effecting probes the reply-submission session drives. Deliberately SHORTER than the export
 * `ProbeDriver`: there is no `verify`, no `detectDownload`, no `validateArtifact`, no `ingest` — a
 * reply post produces no artifact and has no read-back oracle. The Runtime locates and highlights the
 * reply composer READ-ONLY, observes the seller's own submit, and stops.
 *
 * INVARIANT (enforced by source-guard tests): no implementation may click submit, press a key, or dispatch an
 * event — the seller submits. Since 2026-08-28 (product-owner decision) ONE thing may be typed: the approved
 * draft, into the one composer the seller opened, through `reply-composer-fill.ts` and nowhere else, and only
 * after the row, the review id and the composer each resolved to exactly one. A driver that cannot fill leaves
 * {@link ReplySubmitProbeDriver.fillComposer} unimplemented and the run reaches the barrier unfilled.
 */
import type { LocateComposerResult, LocateRowResult, SurfaceProbeResult } from "./reply-engine";
import type { ComposerFillResult } from "./reply-composer-fill";

export interface ReplySubmitProbeDriver {
  /** Open/verify the reply surface precondition. */
  prepareSurface(): Promise<SurfaceProbeResult>;
  /**
   * GUIDED only: find the ONE review row matching the target hint, READ-ONLY. `count`/`sig` feed the
   * engine's fail-closed logic. Retains the matched element for {@link highlightRow} (anti-drift).
   */
  locateReviewRow(): Promise<LocateRowResult>;
  /**
   * GUIDED only: spotlight the matched row + its reply control read-only, RE-VALIDATING the unique match
   * first (returns the re-validated `count`/`sig`); the engine fails closed if it drifted. Never clicks.
   */
  highlightRow(): Promise<LocateRowResult>;
  /** GUIDED only: begin observing for the operator's own click that opens the reply control. */
  armRowObserve(): Promise<void>;
  /** GUIDED only: resolve true once the OPERATOR opened the reply control; false on timeout. Observation only. */
  waitForRowOpen(): Promise<boolean>;
  /** Find the single reply composer, READ-ONLY. `count`/`sig` feed the engine's fail-closed logic. */
  locateComposer(): Promise<LocateComposerResult>;
  /** Spotlight the composer (never intercepts input). */
  highlight(): Promise<void>;
  /**
   * OPTIONAL (2026-08-28): set the approved draft into the highlighted composer, gated by
   * `composerFillDecision` — exact row match + exact review-id match + exactly one composer. Any ambiguity ⇒
   * `{filled:false, reason:"AMBIGUOUS"}` and nothing typed; the engine then fails closed as TARGET_AMBIGUOUS.
   * Never submits. Absent ⇒ the run goes to the barrier unfilled, as before.
   */
  fillComposer?(): Promise<ComposerFillResult>;
  /** Begin observing for the seller's own submit action. */
  armObserve(): Promise<void>;
  /** Resolve true once the seller (not the Runtime) submitted; false on timeout. Observation only. */
  waitForSubmit(): Promise<boolean>;
  /** Tear down overlay/observer. Idempotent. */
  cleanup(): Promise<void>;
}

export interface SyntheticReplyOptions {
  surface?: SurfaceProbeResult;
  locate?: LocateComposerResult;
  /** GUIDED: the row locate result. Defaults to a single match. */
  locateRow?: LocateRowResult;
  /** GUIDED: the RE-VALIDATED row result returned by highlightRow (defaults to `locateRow`; differ to simulate drift). */
  revalidateRow?: LocateRowResult;
  /** What `fillComposer` answers. Absent ⇒ the method is not offered (a driver that cannot fill). */
  fill?: ComposerFillResult;
}

/**
 * Deterministic offline driver. No browser, no submit. Surface/locate results are configurable, and
 * the seller's submit is delivered explicitly via {@link completeSubmit} — the driver never submits.
 */
export class SyntheticReplySubmitDriver implements ReplySubmitProbeDriver {
  private readonly surface: SurfaceProbeResult;
  private readonly locateResult: LocateComposerResult;
  private readonly locateRowResult: LocateRowResult;
  private readonly revalidateRowResult: LocateRowResult;
  private readonly fillResult: ComposerFillResult | null;
  /** TEST-facing: how many times a fill was attempted. */
  fills = 0;
  private submitResolve: ((observed: boolean) => void) | null = null;
  private pendingSubmit: boolean | null = null;
  private rowOpenResolve: ((observed: boolean) => void) | null = null;
  private pendingRowOpen: boolean | null = null;

  constructor(opts: SyntheticReplyOptions = {}) {
    this.surface = opts.surface ?? true;
    this.locateResult = opts.locate ?? { count: 1, sig: "a1b2c3d4e5f60718" };
    this.locateRowResult = opts.locateRow ?? { count: 1, sig: "b2c3d4e5f6071829" };
    this.revalidateRowResult = opts.revalidateRow ?? this.locateRowResult;
    this.fillResult = opts.fill ?? null;
    if (this.fillResult) {
      // Offered only when configured, so a driver "that cannot fill" really has no such method.
      this.fillComposer = async () => {
        this.fills += 1;
        return this.fillResult!;
      };
    }
  }

  fillComposer?: () => Promise<ComposerFillResult>;

  prepareSurface(): Promise<SurfaceProbeResult> {
    return Promise.resolve(this.surface);
  }
  locateReviewRow(): Promise<LocateRowResult> {
    return Promise.resolve(this.locateRowResult);
  }
  highlightRow(): Promise<LocateRowResult> {
    return Promise.resolve(this.revalidateRowResult);
  }
  armRowObserve(): Promise<void> {
    return Promise.resolve();
  }
  waitForRowOpen(): Promise<boolean> {
    if (this.pendingRowOpen !== null) {
      const v = this.pendingRowOpen;
      this.pendingRowOpen = null;
      return Promise.resolve(v);
    }
    return new Promise((resolve) => {
      this.rowOpenResolve = resolve;
    });
  }
  locateComposer(): Promise<LocateComposerResult> {
    return Promise.resolve(this.locateResult);
  }
  highlight(): Promise<void> {
    return Promise.resolve();
  }
  armObserve(): Promise<void> {
    return Promise.resolve();
  }
  waitForSubmit(): Promise<boolean> {
    if (this.pendingSubmit !== null) {
      const v = this.pendingSubmit;
      this.pendingSubmit = null;
      return Promise.resolve(v);
    }
    return new Promise((resolve) => {
      this.submitResolve = resolve;
    });
  }
  cleanup(): Promise<void> {
    return Promise.resolve();
  }

  /** TEST-ONLY: report that the operator opened the review's reply control (or did not). */
  completeRowOpen(observed = true): void {
    if (this.rowOpenResolve) {
      const resolve = this.rowOpenResolve;
      this.rowOpenResolve = null;
      resolve(observed);
    } else {
      this.pendingRowOpen = observed;
    }
  }

  /** TEST-ONLY: report that the seller submitted (or did not). Mirrors a real observation. */
  completeSubmit(observed = true): void {
    if (this.submitResolve) {
      const resolve = this.submitResolve;
      this.submitResolve = null;
      resolve(observed);
    } else {
      this.pendingSubmit = observed;
    }
  }
}
