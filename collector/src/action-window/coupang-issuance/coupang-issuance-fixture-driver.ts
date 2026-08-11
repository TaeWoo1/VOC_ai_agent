/**
 * **Scripted Coupang WING issuance driver — TESTS ONLY. No browser, no network, no WING.**
 *
 * Exists so the whole guided walk (login park, the reach-open-API transition, every checkpoint, the recoverable
 * parks, the human issue-checkpoint, and the fail-closed drift) is pinned offline. Each live rehearsal costs the
 * seller a real login + WING sitting, so a sequencing bug found offline is free.
 *
 * ⚠ **Never wired into the product path.** A fixture driver reaching production would report a tutorial the
 * seller never walked. Only the (future) live driver is hosted by the CLI.
 *
 * The fixture reads its own CANDIDATE `[data-aw-target]` selectors from the classifier to model how the LIVE
 * driver would find a control — but it only ever COUNTS them and returns an opaque signature; a selector never
 * leaves this module.
 */
import { CANDIDATE_WING_TARGET_SELECTORS } from "../../cli/coupang-wing-classifier";
import type { CoupangIssuanceProbeDriver, CoupangIssuanceTarget, WingSurfaceProbe } from "./coupang-issuance-driver";
import type { LocateResult } from "../engine";

export interface CoupangIssuanceFixtureScript {
  /** The surface probe result. Missing → a wing_home page (`ok:true`). A login page makes the run WAIT. */
  probe?: WingSurfaceProbe;
  /**
   * A SEQUENCE of probe results, one per `probeSurface()` call, with the last one repeating forever.
   *
   * Models what a real run actually sees: a blank tab, then a login page, then the issuance page — the seller
   * moving through WING while the runtime watches. A single static `probe` cannot express that, and an observed
   * wait is precisely a behaviour over successive readings. Takes precedence over `probe` when present.
   */
  probeSequence?: readonly WingSurfaceProbe[];
  /**
   * The page category the seller LANDS on after reaching the open-API issuance page (the `reach_open_api`
   * navigation the engine re-probes to verify). Missing → `open_api_issuance`, the happy landing. Set to a
   * non-issuance category (e.g. `unknown`, `login`) to model a wrong page / expired session.
   */
  reachLanding?: WingSurfaceProbe;
  /** Per-target locate results. Missing → a single match with a deterministic signature. */
  locate?: Partial<Record<CoupangIssuanceTarget, LocateResult>>;
  /** Per-target highlight re-validation. Missing → the same result `locate` gave (no drift). */
  highlight?: Partial<Record<CoupangIssuanceTarget, LocateResult>>;
  /** What the seller does at each barrier. Missing → they act. */
  action?: Partial<Record<CoupangIssuanceTarget, boolean>>;
  /**
   * Model a NAVIGATION RACE: how many times `locateTarget(target)` should THROW before it returns normally. Each
   * throw decrements the count, so `1` reproduces a single post-navigation race that a settle + recheck recovers,
   * and a large value models a PERMANENT fault. Missing → never throws.
   */
  locateThrows?: Partial<Record<CoupangIssuanceTarget, number>>;
  /** Same, for `highlightTarget(target)` — a race that throws AFTER a clean locate. Missing → never throws. */
  highlightThrows?: Partial<Record<CoupangIssuanceTarget, number>>;
}

/** Deterministic 16-hex signature per target — opaque, and stable across a run so drift is detectable. */
function sigFor(target: CoupangIssuanceTarget): string {
  let hash = 0x811c9dc5;
  for (const ch of `coupang-issuance:${target}`) {
    hash = (hash ^ ch.charCodeAt(0)) * 0x01000193;
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, "0").repeat(2).slice(0, 16);
}

const DEFAULT_WING_HOME_PROBE: WingSurfaceProbe = { ok: true, pageCategory: "wing_home" };
const DEFAULT_OPEN_API_LANDING: WingSurfaceProbe = { ok: true, pageCategory: "open_api_issuance" };

export class CoupangIssuanceFixtureDriver implements CoupangIssuanceProbeDriver {
  private readonly script: CoupangIssuanceFixtureScript;
  /** Every call, in order — so a test can assert the runtime never armed a control it should not have. */
  readonly calls: string[] = [];
  /** How many surface probes have been served — the cursor into `probeSequence`. */
  private probeCount = 0;
  /** How many times `settleSurface` was called (the session settles before each guide). */
  settleCount = 0;
  /**
   * For each `locateTarget` call, whether a `settleSurface` had been called since the previous locate — lets a
   * test prove the guide SETTLES the surface before it locates, without changing the `calls` sequence.
   */
  readonly locateSettledFirst: boolean[] = [];
  private settlePending = false;
  private cleanedUp = 0;
  private closeResolve: (() => void) | null = null;
  /** Latches once the seller has "reached" the open-API page, so the next probe reports the landing page. */
  private reachedOpenApi = false;
  private readonly locateThrowsLeft: Partial<Record<CoupangIssuanceTarget, number>>;
  private readonly highlightThrowsLeft: Partial<Record<CoupangIssuanceTarget, number>>;

  constructor(script: CoupangIssuanceFixtureScript = {}) {
    this.script = script;
    this.locateThrowsLeft = { ...(script.locateThrows ?? {}) };
    this.highlightThrowsLeft = { ...(script.highlightThrows ?? {}) };
  }

  /** Best-effort settle (a no-op offline) — records that the guide settled the surface before it located. */
  async settleSurface(): Promise<void> {
    this.settleCount += 1;
    this.settlePending = true;
  }

  async probeSurface(): Promise<WingSurfaceProbe> {
    this.calls.push("probeSurface");
    // After the seller reaches the open-API page, the surface IS the landing page (open_api_issuance by default)
    // — this is what the engine's VERIFY_REACH re-probe reads to confirm the page before guiding 자체개발.
    if (this.reachedOpenApi) return this.script.reachLanding ?? DEFAULT_OPEN_API_LANDING;
    const seq = this.script.probeSequence;
    if (seq && seq.length > 0) {
      const at = Math.min(this.probeCount, seq.length - 1);
      this.probeCount += 1;
      return seq[at] as WingSurfaceProbe;
    }
    return this.script.probe ?? DEFAULT_WING_HOME_PROBE;
  }
  // No `probeSurfaceSettled` override: the session falls back to `probeSurface` here (interface method optional).

  async locateTarget(target: CoupangIssuanceTarget): Promise<LocateResult> {
    // The CANDIDATE selector is CONSULTED (as the live driver would) but never emitted — only counted.
    void CANDIDATE_WING_TARGET_SELECTORS[target];
    this.locateSettledFirst.push(this.settlePending);
    this.settlePending = false;
    this.calls.push(`locate:${target}`);
    const throwsLeft = this.locateThrowsLeft[target] ?? 0;
    if (throwsLeft > 0) {
      this.locateThrowsLeft[target] = throwsLeft - 1;
      // Model the execution context being destroyed by a navigation mid-read (name "Error", no value leaked).
      throw new Error("execution context was destroyed");
    }
    return this.script.locate?.[target] ?? { count: 1, sig: sigFor(target) };
  }

  async highlightTarget(target: CoupangIssuanceTarget): Promise<LocateResult> {
    this.calls.push(`highlight:${target}`);
    const throwsLeft = this.highlightThrowsLeft[target] ?? 0;
    if (throwsLeft > 0) {
      this.highlightThrowsLeft[target] = throwsLeft - 1;
      throw new Error("execution context was destroyed");
    }
    return this.script.highlight?.[target] ?? this.script.locate?.[target] ?? { count: 1, sig: sigFor(target) };
  }

  async clearHighlight(): Promise<void> {
    this.calls.push("clearHighlight");
  }

  async armObserve(target: CoupangIssuanceTarget): Promise<void> {
    this.calls.push(`observe:${target}`);
  }

  async observeUserAction(target: CoupangIssuanceTarget): Promise<boolean> {
    this.calls.push(`wait:${target}`);
    const acted = this.script.action?.[target] ?? true;
    // `reach_open_api` is observed as a NAVIGATION: once the seller "acts" (reaches the open-API page), the
    // surface becomes the landing page, so the engine's next probe (VERIFY_REACH) sees open_api_issuance.
    if (target === "reach_open_api" && acted) this.reachedOpenApi = true;
    return acted;
  }

  async cleanup(): Promise<void> {
    this.cleanedUp += 1;
    this.calls.push("cleanup");
  }

  cleanupCount(): number {
    return this.cleanedUp;
  }

  /** Resolve when the current window closes — the session parks on page_mismatch. */
  whenSurfaceClosed(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.closeResolve = resolve;
    });
  }

  /** Test helper: the seller closes the WING window. Fires the current close watch, once. */
  closeSurface(): void {
    const resolve = this.closeResolve;
    this.closeResolve = null;
    resolve?.();
  }

  /** Test helper: change what the NEXT `probeSurface` reports (e.g. a login page becoming wing_home). */
  setProbe(probe: WingSurfaceProbe): void {
    this.script.probe = probe;
  }

  /**
   * Test helper: model the seller (not) having acted on a checkpoint yet — i.e. whether the WING-resident advance
   * button for `target` has been pressed. Flipping it to `true` mid-run lets a test hold the run at a checkpoint
   * (e.g. the 발급 human checkpoint) and then release it, exactly as the seller pressing the on-page button would.
   */
  setAction(target: CoupangIssuanceTarget, acted: boolean): void {
    this.script.action = { ...(this.script.action ?? {}), [target]: acted };
  }
}
