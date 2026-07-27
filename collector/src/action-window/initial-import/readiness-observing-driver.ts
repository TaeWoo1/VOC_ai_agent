/**
 * **A transparent `ImportProbeDriver` decorator that records the session readiness a run observes — and changes
 * nothing the run sees.**
 *
 * The four session-readiness probe moments all need one thing the port alone exposes: what the run's own
 * `prepareSurface` read. Rather than thread a readiness call through the session/engine (which would risk the
 * equivalence the existing NAVER path is verified to have), this wraps the driver and observes that ONE method.
 *
 * Every method delegates verbatim to the inner driver, and `prepareSurface` returns the inner result UNCHANGED —
 * the observation is a side effect taken after the delegate resolves, wrapped so it can never throw into a run
 * (an observability record must not be able to fail a real import). With no `onSurfaceReading` behaviour this is
 * a byte-for-byte pass-through, which is what keeps the guided-import runtime identical with the coordinator
 * wired in.
 *
 * It also forwards the optional `setBadgeTotalSteps` dev-badge capability the dispatch layer duck-types on the
 * driver, so wrapping a driver that has it does not silently drop it.
 */
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

export class ReadinessObservingImportDriver implements ImportProbeDriver {
  constructor(
    private readonly inner: ImportProbeDriver,
    /** Called with each `prepareSurface` reading, AFTER it resolves. Its return value is ignored. */
    private readonly onSurfaceReading: (res: boolean | SurfaceProbeResult) => void,
  ) {}

  async prepareSurface(): Promise<boolean | SurfaceProbeResult> {
    const res = await this.inner.prepareSurface();
    // Observe-only, and defensively so: the run's readiness record must never be the thing that fails a run.
    try {
      this.onSurfaceReading(res);
    } catch {
      /* an observation failure is not a run failure */
    }
    return res;
  }

  readSurfaceFacts(): Promise<ImportSurfaceFacts> {
    return this.inner.readSurfaceFacts();
  }

  locateTarget(target: ImportTarget): Promise<LocateResult> {
    return this.inner.locateTarget(target);
  }

  highlightTarget(target: ImportTarget): Promise<LocateResult> {
    return this.inner.highlightTarget(target);
  }

  clearTargetHighlight(): Promise<void> {
    return this.inner.clearTargetHighlight();
  }

  isTargetPrefilled(target: ImportTarget, required: RequiredRange): Promise<boolean> {
    return this.inner.isTargetPrefilled(target, required);
  }

  renderGuidance(state: GuidancePanelState | null): Promise<void> {
    return this.inner.renderGuidance(state);
  }

  takeGuidanceIntent(): Promise<string | null> {
    return this.inner.takeGuidanceIntent();
  }

  armTargetObserve(target: ImportTarget): Promise<void> {
    return this.inner.armTargetObserve(target);
  }

  waitForTargetAction(target: ImportTarget): Promise<boolean> {
    return this.inner.waitForTargetAction(target);
  }

  readSelectedScope(required: RequiredRange): Promise<ScopeMatch> {
    return this.inner.readSelectedScope(required);
  }

  detectDownload(): Promise<DownloadDetectResult> {
    return this.inner.detectDownload();
  }

  validateArtifact(artifactRef: string): Promise<ArtifactValidateResult> {
    return this.inner.validateArtifact(artifactRef);
  }

  ingest(artifactRef: string, scopeEvidence: ScopeEvidenceWire): Promise<IngestResult> {
    return this.inner.ingest(artifactRef, scopeEvidence);
  }

  cleanup(): Promise<void> {
    return this.inner.cleanup();
  }

  /** Forward the optional dev-only badge capability the dispatch layer duck-types, so it is never dropped. */
  setBadgeTotalSteps(totalSteps: number | null): void {
    (this.inner as { setBadgeTotalSteps?: (n: number | null) => void }).setBadgeTotalSteps?.(totalSteps);
  }
}
