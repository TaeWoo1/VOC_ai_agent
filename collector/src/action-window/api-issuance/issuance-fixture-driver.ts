/**
 * **Scripted issuance driver — TESTS ONLY. No browser, no network, no NAVER.**
 *
 * Exists so the whole guided walk (login park, both branches, every barrier, the recoverable parks, and the
 * fail-closed drift) is pinned offline. Each live rehearsal costs the seller a real login + app-center sitting,
 * so a sequencing bug found offline is free and the same bug found live is not.
 *
 * ⚠ **Never wired into the product path.** A fixture driver reaching production would report a tutorial the
 * seller never walked. Only the (future) live driver is hosted by the CLI.
 *
 * The fixture reads its own CANDIDATE `[data-aw-target]` selectors from the adapter to model how the LIVE
 * driver would find a control — but it only ever COUNTS them and returns an opaque signature; a selector never
 * leaves this module.
 */
import type { ApiCenterStructuralCensus } from "../../cli/observe-api-center";
import { CANDIDATE_TARGET_SELECTORS } from "./api-center-adapter";
import type { ApplicationsRead, IssuanceProbeDriver, IssuanceSurfaceProbe, IssuanceTarget } from "./issuance-driver";
import type { LocateResult } from "../engine";

export interface IssuanceFixtureScript {
  /** The surface probe result. Missing → an app_list page (`ok:true`). A login page parks the run. */
  probe?: IssuanceSurfaceProbe;
  /**
   * The page category the seller LANDS on after opening their existing app (the `open_app` navigation the
   * engine re-probes to verify). Missing → the app detail page (`app_detail`), the happy existing-app landing.
   * Set to a non-detail category (e.g. `unknown`, or `login`) to model a wrong page / expired session.
   */
  openAppLanding?: IssuanceSurfaceProbe;
  /** The applications read. Missing → one entry row (existing). Set `applicationEntryRowCount:0` for empty. */
  applications?: ApplicationsRead;
  /** Per-target locate results. Missing → a single match with a deterministic signature. */
  locate?: Partial<Record<IssuanceTarget, LocateResult>>;
  /** Per-target highlight re-validation. Missing → the same result `locate` gave (no drift). */
  highlight?: Partial<Record<IssuanceTarget, LocateResult>>;
  /** What the seller does at each barrier. Missing → they act. */
  action?: Partial<Record<IssuanceTarget, boolean>>;
}

/** Deterministic 16-hex signature per target — opaque, and stable across a run so drift is detectable. */
function sigFor(target: IssuanceTarget): string {
  let hash = 0x811c9dc5;
  for (const ch of `issuance:${target}`) {
    hash = (hash ^ ch.charCodeAt(0)) * 0x01000193;
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, "0").repeat(2).slice(0, 16);
}

const DEFAULT_APP_LIST_PROBE: IssuanceSurfaceProbe = { ok: true, pageCategory: "app_list" };
const DEFAULT_APP_DETAIL_LANDING: IssuanceSurfaceProbe = { ok: true, pageCategory: "app_detail" };
const EMPTY_CENSUS: ApiCenterStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  formCount: 0,
  editableTextInputCount: 0,
  readonlyFieldCount: 0,
  listLikeContainerCount: 1,
};

export class IssuanceFixtureDriver implements IssuanceProbeDriver {
  private readonly script: IssuanceFixtureScript;
  /** Every call, in order — so a test can assert the runtime never armed a control it should not have. */
  readonly calls: string[] = [];
  private cleanedUp = 0;
  private closeResolve: (() => void) | null = null;
  /** Latches once the seller has "opened" their existing app, so the next probe reports the landing page. */
  private openedApp = false;

  constructor(script: IssuanceFixtureScript = {}) {
    this.script = script;
  }

  async probeSurface(): Promise<IssuanceSurfaceProbe> {
    this.calls.push("probeSurface");
    // After the seller opens their existing app, the surface IS the landing page (app_detail by default) — this
    // is what the engine's VERIFY_OPEN re-probe reads to confirm the detail page before reusing api_group.
    if (this.openedApp) return this.script.openAppLanding ?? DEFAULT_APP_DETAIL_LANDING;
    return this.script.probe ?? DEFAULT_APP_LIST_PROBE;
  }

  async readApplications(): Promise<ApplicationsRead> {
    this.calls.push("readApplications");
    return this.script.applications ?? { census: { ...EMPTY_CENSUS }, applicationEntryRowCount: 1 };
  }

  async locateTarget(target: IssuanceTarget): Promise<LocateResult> {
    // The CANDIDATE selector is CONSULTED (as the live driver would) but never emitted — only counted.
    void CANDIDATE_TARGET_SELECTORS[target];
    this.calls.push(`locate:${target}`);
    return this.script.locate?.[target] ?? { count: 1, sig: sigFor(target) };
  }

  async highlightTarget(target: IssuanceTarget): Promise<LocateResult> {
    this.calls.push(`highlight:${target}`);
    return this.script.highlight?.[target] ?? this.script.locate?.[target] ?? { count: 1, sig: sigFor(target) };
  }

  async clearHighlight(): Promise<void> {
    this.calls.push("clearHighlight");
  }

  async armObserve(target: IssuanceTarget): Promise<void> {
    this.calls.push(`observe:${target}`);
  }

  async observeUserAction(target: IssuanceTarget): Promise<boolean> {
    this.calls.push(`wait:${target}`);
    const acted = this.script.action?.[target] ?? true;
    // `open_app` is observed as a NAVIGATION: once the seller "acts" (opens their app), the surface becomes the
    // landing page, so the engine's next probe (VERIFY_OPEN) sees app_detail rather than the applications list.
    if (target === "open_app" && acted) this.openedApp = true;
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

  /** Test helper: the seller closes the API-center window. Fires the current close watch, once. */
  closeSurface(): void {
    const resolve = this.closeResolve;
    this.closeResolve = null;
    resolve?.();
  }

  /** Test helper: change what the NEXT `probeSurface` reports (e.g. a login page becoming app_list). */
  setProbe(probe: IssuanceSurfaceProbe): void {
    this.script.probe = probe;
  }
}
