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
import type { ScopeEvidenceWire } from "../scope-evidence";
import type { ScopeMatch } from "../../naver/export-scope-match";
import type { ImportSurfaceFacts } from "../../naver/import-guidance-plan";
import type { GuidancePanelState } from "../guidance-panel";
import type { ArtifactValidateResult, DownloadDetectResult, IngestResult, LocateResult, SurfaceProbeResult } from "../engine";
import type { ImportProbeDriver, ImportTarget, RequiredRange } from "./import-driver";
import { ReliabilityFailure } from "./reliability-failure";
import type { ReliabilityBlockerCode } from "./import-engine";

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

  /**
   * Which date controls already hold the required value. Missing → none do, which is the ordinary case and
   * the one every pre-existing test was written against.
   */
  prefilled?: Partial<Record<ImportTarget, boolean>>;

  /**
   * **Guided Acquisition Reliability hooks.**
   *
   * `prepareFail` — a per-call sequence of reliability codes `prepareSurface` throws (indexed by how many times
   * it has been called). A `null` at an index means "succeed that call", so `[ "SURFACE_SETTLE_TIMEOUT", null ]`
   * models a run that stalls once and recovers on the re-check. `highlightFail` — throw a reliability failure
   * the FIRST time a given target is highlighted, then succeed (so a re-check past an overlay failure proceeds).
   */
  prepareFail?: (ReliabilityBlockerCode | null)[];
  highlightFail?: Partial<Record<ImportTarget, ReliabilityBlockerCode>>;
  /** When set, `prepareSurface` never resolves nor rejects — models the surface that just never comes up, the
   * case the session's PREPARE watchdog is the last backstop for. */
  prepareHang?: boolean;
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
  /**
   * Panel renders, newest last. Kept OUT of {@link calls} on purpose: a panel render is not choreography, and
   * mixing it in would rewrite the call sequence every existing test asserts on.
   */
  readonly guidanceRenders: (GuidancePanelState | null)[] = [];
  private cleanedUp = 0;
  private pendingIntent: string | null = null;
  /** How many times `prepareSurface` has run — indexes `prepareFail` and counts re-opens. */
  private prepareCount = 0;
  /** Targets already highlighted once, so `highlightFail` fires only on the first attempt then recovers. */
  private readonly highlighted = new Set<ImportTarget>();
  /** The current window's close resolver; a fresh one is minted per `whenSurfaceClosed` call (per re-open). */
  private closeResolve: (() => void) | null = null;

  constructor(script: ImportFixtureScript = {}) {
    this.script = script;
  }

  async prepareSurface(): Promise<boolean | SurfaceProbeResult> {
    this.calls.push("prepareSurface");
    const index = this.prepareCount;
    this.prepareCount += 1;
    if (this.script.prepareHang) return new Promise<never>(() => {});
    const fail = this.script.prepareFail?.[index] ?? null;
    if (fail) throw new ReliabilityFailure(fail);
    return this.script.surface ?? true;
  }

  /** How many times the surface was prepared — a re-open (after a close/park + re-check) increments it. */
  prepareCalls(): number {
    return this.prepareCount;
  }

  /** Resolve when the current window closes — the session parks on SURFACE_CLOSED. Re-armed per re-open. */
  whenSurfaceClosed(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.closeResolve = resolve;
    });
  }

  /** Test helper: the seller closes the marketplace window. Fires the current close watch, once. */
  closeSurface(): void {
    const resolve = this.closeResolve;
    this.closeResolve = null;
    resolve?.();
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
    const fail = this.script.highlightFail?.[target];
    if (fail && !this.highlighted.has(target)) {
      // Fire once per target, then let a re-check past the overlay failure proceed.
      this.highlighted.add(target);
      throw new ReliabilityFailure(fail);
    }
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

  /** The scope evidence the session handed to the most recent ingest, or null before any ingest. */
  lastIngestEvidence: ScopeEvidenceWire | null = null;

  async ingest(artifactRef: string, scopeEvidence: ScopeEvidenceWire): Promise<IngestResult> {
    // Record what the SESSION passed in (from the engine's single record) — the fixture never derives its own.
    this.lastIngestEvidence = scopeEvidence;
    this.calls.push(`ingest:${artifactRef}`);
    return this.script.ingest ?? { ok: true, processed: 42 };
  }

  async clearTargetHighlight(): Promise<void> {
    this.calls.push("clearHighlight");
  }

  async isTargetPrefilled(target: ImportTarget, required: RequiredRange): Promise<boolean> {
    // The required window is recorded, never a value read off a control — the same rule as `readSelectedScope`.
    this.calls.push(`prefilled:${target}:${required.start}..${required.end}`);
    return this.script.prefilled?.[target] ?? false;
  }

  async renderGuidance(state: GuidancePanelState | null): Promise<void> {
    this.guidanceRenders.push(state);
  }

  async takeGuidanceIntent(): Promise<string | null> {
    const intent = this.pendingIntent;
    this.pendingIntent = null;
    return intent;
  }

  /** Test helper: the seller presses a button on the in-page panel. Consumed once, like the real flag. */
  pressPanel(command: string): void {
    this.pendingIntent = command;
  }

  /** The most recent panel state, or null when nothing has been rendered. */
  lastGuidance(): GuidancePanelState | null {
    return this.guidanceRenders.length === 0 ? null : (this.guidanceRenders[this.guidanceRenders.length - 1] ?? null);
  }

  async cleanup(): Promise<void> {
    this.cleanedUp += 1;
    this.calls.push("cleanup");
  }

  cleanupCount(): number {
    return this.cleanedUp;
  }
}
