/**
 * **Scripted Coupang WING renewal driver — TESTS ONLY. No browser, no network, no WING.**
 *
 * Exists so the whole guided renewal walk (login park, the reach-open-API transition, the `유효기간` checkpoint,
 * the `재발급` human checkpoint, the copy-keys checkpoint, the return, the recoverable parks, and the fail-closed
 * drift) is pinned offline. ⚠ **Never wired into the product path.**
 *
 * It also models the ALLOWLISTED `유효기간` reader seam: {@link readValidityDate} routes a scripted RAW token
 * through the SAME pure {@link sanitizeValidityDate} the live driver uses, so a test can prove a clean date
 * sanitizes to ISO, a garbled/missing one to `null`, and a KEY-shaped token can NEVER emerge as a "date".
 */
import type { CoupangRenewalProbeDriver, CoupangRenewalTarget, WingSurfaceProbe } from "./coupang-renewal-driver";
import { sanitizeValidityDate } from "./wing-validity-reader";
import type { LocateResult } from "../engine";

/**
 * CANDIDATE / synthetic fixture markers ONLY. The `[data-aw-target]` selectors this fixture consults to model how
 * the LIVE driver would find a control — it only ever COUNTS them and returns an opaque signature; a selector
 * never leaves this module. (The live driver resolves fixed WING labels instead.)
 */
const CANDIDATE_WING_RENEWAL_TARGET_SELECTORS: Readonly<Record<CoupangRenewalTarget, string>> = {
  reach_open_api: "[data-aw-target='reach_open_api']",
  check_expiry: "[data-aw-target='check_expiry']",
  reissue: "[data-aw-target='reissue']",
  credentials: "[data-aw-target='credentials']",
  return: "[data-aw-target='return']",
};

export interface CoupangRenewalFixtureScript {
  /** The surface probe result. Missing → a wing_home page (`ok:true`). A login page parks the run. */
  probe?: WingSurfaceProbe;
  /** The page category the seller LANDS on after reaching the open-API page. Missing → `open_api_issuance`. */
  reachLanding?: WingSurfaceProbe;
  /** Per-target locate results. Missing → a single match with a deterministic signature. */
  locate?: Partial<Record<CoupangRenewalTarget, LocateResult>>;
  /** Per-target highlight re-validation. Missing → the same result `locate` gave (no drift). */
  highlight?: Partial<Record<CoupangRenewalTarget, LocateResult>>;
  /** What the seller does at each barrier. Missing → they act. */
  action?: Partial<Record<CoupangRenewalTarget, boolean>>;
  /** Model a navigation RACE: how many times `locateTarget(target)` should THROW before returning. */
  locateThrows?: Partial<Record<CoupangRenewalTarget, number>>;
  /** Same, for `highlightTarget(target)`. */
  highlightThrows?: Partial<Record<CoupangRenewalTarget, number>>;
  /**
   * The RAW `유효기간` token the (fixture) allowlisted reader would extract in-page. Fed through
   * {@link sanitizeValidityDate}. `undefined` → a clean synthetic date; set to a garbled / key-shaped string to
   * model an unreadable date (→ `null`). The property may itself be `null` to model "no 유효기간 anchor found".
   */
  validityRaw?: string | null;
}

/** Deterministic 16-hex signature per target — opaque, stable across a run so drift is detectable. */
function sigFor(target: CoupangRenewalTarget): string {
  let hash = 0x811c9dc5;
  for (const ch of `coupang-renewal:${target}`) {
    hash = (hash ^ ch.charCodeAt(0)) * 0x01000193;
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, "0").repeat(2).slice(0, 16);
}

const DEFAULT_WING_HOME_PROBE: WingSurfaceProbe = { ok: true, pageCategory: "wing_home" };
const DEFAULT_OPEN_API_LANDING: WingSurfaceProbe = { ok: true, pageCategory: "open_api_issuance" };
/** A clean synthetic `유효기간` value in WING's rendered form. */
const DEFAULT_VALIDITY_RAW = "2027. 03. 15";

export class CoupangRenewalFixtureDriver implements CoupangRenewalProbeDriver {
  private readonly script: CoupangRenewalFixtureScript;
  readonly calls: string[] = [];
  settleCount = 0;
  readonly locateSettledFirst: boolean[] = [];
  private settlePending = false;
  private cleanedUp = 0;
  private closeResolve: (() => void) | null = null;
  private reachedOpenApi = false;
  private readonly locateThrowsLeft: Partial<Record<CoupangRenewalTarget, number>>;
  private readonly highlightThrowsLeft: Partial<Record<CoupangRenewalTarget, number>>;

  constructor(script: CoupangRenewalFixtureScript = {}) {
    this.script = script;
    this.locateThrowsLeft = { ...(script.locateThrows ?? {}) };
    this.highlightThrowsLeft = { ...(script.highlightThrows ?? {}) };
  }

  async settleSurface(): Promise<void> {
    this.settleCount += 1;
    this.settlePending = true;
  }

  async probeSurface(): Promise<WingSurfaceProbe> {
    this.calls.push("probeSurface");
    if (this.reachedOpenApi) return this.script.reachLanding ?? DEFAULT_OPEN_API_LANDING;
    return this.script.probe ?? DEFAULT_WING_HOME_PROBE;
  }

  async locateTarget(target: CoupangRenewalTarget): Promise<LocateResult> {
    // The CANDIDATE selector is CONSULTED (as the live driver would) but never emitted — only counted.
    void CANDIDATE_WING_RENEWAL_TARGET_SELECTORS[target];
    this.locateSettledFirst.push(this.settlePending);
    this.settlePending = false;
    this.calls.push(`locate:${target}`);
    const throwsLeft = this.locateThrowsLeft[target] ?? 0;
    if (throwsLeft > 0) {
      this.locateThrowsLeft[target] = throwsLeft - 1;
      throw new Error("execution context was destroyed");
    }
    return this.script.locate?.[target] ?? { count: 1, sig: sigFor(target) };
  }

  async highlightTarget(target: CoupangRenewalTarget): Promise<LocateResult> {
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

  async armObserve(target: CoupangRenewalTarget): Promise<void> {
    this.calls.push(`observe:${target}`);
  }

  async observeUserAction(target: CoupangRenewalTarget): Promise<boolean> {
    this.calls.push(`wait:${target}`);
    const acted = this.script.action?.[target] ?? true;
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

  /**
   * The ALLOWLISTED reader seam. Routes the scripted RAW token through the SAME pure sanitizer the live driver
   * uses — so it returns a sanitized ISO date or `null`, NEVER a key value. `script.validityRaw === null` models
   * "no 유효기간 anchor found"; `undefined` uses a clean synthetic date.
   */
  async readValidityDate(): Promise<string | null> {
    this.calls.push("readValidityDate");
    const raw = "validityRaw" in this.script ? this.script.validityRaw : DEFAULT_VALIDITY_RAW;
    return sanitizeValidityDate(raw);
  }

  whenSurfaceClosed(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.closeResolve = resolve;
    });
  }

  closeSurface(): void {
    const resolve = this.closeResolve;
    this.closeResolve = null;
    resolve?.();
  }

  setProbe(probe: WingSurfaceProbe): void {
    this.script.probe = probe;
  }
}
