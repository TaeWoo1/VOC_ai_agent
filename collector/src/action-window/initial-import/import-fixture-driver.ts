/**
 * **Scripted import driver — TESTS ONLY. No browser, no network, no NAVER.**
 *
 * Exists so the whole choreography (six barriers, the gate, all three gate answers, the downstream chain,
 * and every fail-closed branch) is pinned offline. That matters more here than usual: each live rehearsal
 * costs the seller a real export window, so a sequencing bug found offline is free and the same bug found
 * live is not.
 *
 * ⚠ **Never wired into the product path.** `cli/local-agent.ts` hosts the LIVE driver; a fixture driver
 * reaching production would report imports that never happened. `import-dispatch.test.ts` asserts the
 * production wiring does not reference this module.
 */
import type { ScopeMatch } from "../../naver/export-scope-match";
import type { ImportSurfaceFacts } from "../../naver/import-guidance-plan";
import type { ArtifactValidateResult, DownloadDetectResult, IngestResult, LocateResult, SurfaceProbeResult } from "../engine";
import type { ImportProbeDriver, ImportTarget, RequiredRange } from "./import-driver";

export interface ImportFixtureScript {
  surface?: boolean | SurfaceProbeResult;
  facts?: ImportSurfaceFacts;
  /** Per-target locate results. Missing → a single match with a deterministic signature. */
  locate?: Partial<Record<ImportTarget, LocateResult>>;
  /** Per-target highlight re-validation. Missing → the same result `locate` gave (no drift). */
  highlight?: Partial<Record<ImportTarget, LocateResult>>;
  /** What the seller does at each barrier. Missing → they act. */
  action?: Partial<Record<ImportTarget, boolean>>;
  scope?: ScopeMatch;
  download?: DownloadDetectResult;
  validate?: ArtifactValidateResult;
  ingest?: IngestResult;
}

/** Deterministic 16-hex signature per target — opaque, and stable across a run so drift is detectable. */
function sigFor(target: ImportTarget): string {
  let hash = 0x811c9dc5;
  for (const ch of `import:${target}`) {
    hash = (hash ^ ch.charCodeAt(0)) * 0x01000193;
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, "0").repeat(2).slice(0, 16);
}

export class ImportFixtureDriver implements ImportProbeDriver {
  private readonly script: ImportFixtureScript;
  /** Every call, in order — so a test can assert the runtime never armed a control it should not have. */
  readonly calls: string[] = [];
  private cleanedUp = 0;

  constructor(script: ImportFixtureScript = {}) {
    this.script = script;
  }

  async prepareSurface(): Promise<boolean | SurfaceProbeResult> {
    this.calls.push("prepareSurface");
    return this.script.surface ?? true;
  }

  async readSurfaceFacts(): Promise<ImportSurfaceFacts> {
    this.calls.push("readSurfaceFacts");
    return this.script.facts ?? { requiresApply: false, requiresFilters: false };
  }

  async locateTarget(target: ImportTarget): Promise<LocateResult> {
    this.calls.push(`locate:${target}`);
    return this.script.locate?.[target] ?? { count: 1, sig: sigFor(target) };
  }

  async highlightTarget(target: ImportTarget): Promise<LocateResult> {
    this.calls.push(`highlight:${target}`);
    return (
      this.script.highlight?.[target] ??
      this.script.locate?.[target] ?? { count: 1, sig: sigFor(target) }
    );
  }

  async armTargetObserve(target: ImportTarget): Promise<void> {
    this.calls.push(`observe:${target}`);
  }

  async waitForTargetAction(target: ImportTarget): Promise<boolean> {
    this.calls.push(`wait:${target}`);
    return this.script.action?.[target] ?? true;
  }

  async readSelectedScope(required: RequiredRange): Promise<ScopeMatch> {
    // The required window is recorded, never the values read off the screen — the fixture mirrors the live
    // driver's rule that raw selected dates do not leave the read.
    this.calls.push(`scope:${required.start}..${required.end}`);
    return this.script.scope ?? "MATCH";
  }

  async detectDownload(): Promise<DownloadDetectResult> {
    this.calls.push("detectDownload");
    return this.script.download ?? { detected: true, artifactRef: "a1b2c3d4e5f60718" };
  }

  async validateArtifact(artifactRef: string): Promise<ArtifactValidateResult> {
    this.calls.push(`validate:${artifactRef}`);
    return this.script.validate ?? { valid: true };
  }

  async ingest(artifactRef: string): Promise<IngestResult> {
    this.calls.push(`ingest:${artifactRef}`);
    return this.script.ingest ?? { ok: true, processed: 42 };
  }

  async cleanup(): Promise<void> {
    this.cleanedUp += 1;
    this.calls.push("cleanup");
  }

  cleanupCount(): number {
    return this.cleanedUp;
  }
}
