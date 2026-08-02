/**
 * The READ-ONLY Phase-B selector probe orchestrator, driven offline over fake seams (no browser, no NAVER).
 * It locks that the walk (a) visits exactly the screens that carry a highlight target, (b) measures each
 * target's calibrated fixed-label matchCount + `canHighlight` read-only, (c) counts calibrated uniqueness
 * honestly (open_app is uncalibrated and never counts), (d) recovers on abort/timeout, and (e) emits ONLY
 * value-free integers/booleans/enums — never a selector, label, value, or URL.
 */
import { describe, it, expect } from "vitest";
import type { ApiCenterPageCategory } from "../../src/cli/observe-api-center";
import {
  issuanceProbeScreens,
  targetsForScreen,
  runSelectorProbeSession,
  type SelectorProbeDeps,
  type SelectorProbeSignal,
} from "../../src/cli/probe-issuance-selectors";
import type { IssuanceHighlightTarget } from "../../src/action-window/api-issuance-calibration/issuance-highlight-selectors";

/** Calibrated live-confirmed targets resolve uniquely; open_app's structural anchor defaults to non-unique here. */
const DEFAULT_MATCHES: Record<IssuanceHighlightTarget, { matchCount: number; canHighlight: boolean }> = {
  create_app: { matchCount: 1, canHighlight: true },
  open_app: { matchCount: 4, canHighlight: false }, // structural anchor non-unique (e.g. a too-broad row selector)
  api_group: { matchCount: 1, canHighlight: true },
  credentials: { matchCount: 1, canHighlight: true },
};

interface FakeOptions {
  matches?: Partial<Record<IssuanceHighlightTarget, { matchCount: number; canHighlight: boolean }>>;
  signal?: (screen: string) => SelectorProbeSignal;
  pageCategory?: ApiCenterPageCategory;
}

function fakeDeps(o: FakeOptions = {}): { deps: SelectorProbeDeps; probed: IssuanceHighlightTarget[]; announced: string[] } {
  const probed: IssuanceHighlightTarget[] = [];
  const announced: string[] = [];
  const matches = { ...DEFAULT_MATCHES, ...(o.matches ?? {}) };
  const deps: SelectorProbeDeps = {
    probeSurface: async () => ({ pageCategory: o.pageCategory ?? "app_list" }),
    probeTarget: async (target) => {
      probed.push(target);
      return matches[target];
    },
    waitForScreenSentinel: async (screen) => (o.signal ? o.signal(screen) : "ready"),
    announceScreen: (screen) => announced.push(screen),
  };
  return { deps, probed, announced };
}

describe("issuance selector probe — screen selection", () => {
  it("walks exactly the screens that carry a highlight target (app_list, api_group, credentials — never app_detail)", () => {
    expect(issuanceProbeScreens()).toEqual(["app_list", "api_group", "credentials"]);
    expect(targetsForScreen("app_list")).toEqual(["create_app", "open_app"]);
    expect(targetsForScreen("api_group")).toEqual(["api_group"]);
    expect(targetsForScreen("credentials")).toEqual(["credentials"]);
    expect(targetsForScreen("app_detail")).toEqual([]);
  });
});

describe("issuance selector probe — read-only walk", () => {
  it("measures every target on every screen and tallies calibrated uniqueness honestly", async () => {
    const { deps, probed } = fakeDeps();
    const result = await runSelectorProbeSession(deps);

    expect(result.aborted).toBe(false);
    expect(result.screensProbed).toBe(3);
    expect(result.screens.map((s) => s.screen)).toEqual(["app_list", "api_group", "credentials"]);
    // Every highlight target was measured (open_app included, honestly reported uncalibrated).
    expect(probed).toEqual(["create_app", "open_app", "api_group", "credentials"]);

    const appList = result.screens[0]!;
    expect(appList.targets).toEqual([
      { target: "create_app", status: "live_confirmed", matchCount: 1, canHighlight: true },
      { target: "open_app", status: "structural_candidate", matchCount: 4, canHighlight: false },
    ]);
    // Only the 3 calibrated targets count toward calibrated uniqueness; open_app is tallied separately as a
    // structural candidate (probed here, but non-unique so not a promotion candidate this run).
    expect(result.uniqueCalibrated).toBe(3);
    expect(result.nonUniqueCalibrated).toBe(0);
    expect(result.structuralCandidatesProbed).toBe(1);
    expect(result.structuralCandidatesUnique).toBe(0);
  });

  it("tallies a structural candidate that resolved UNIQUELY as a promotion candidate", async () => {
    const { deps } = fakeDeps({ matches: { open_app: { matchCount: 1, canHighlight: true } } });
    const result = await runSelectorProbeSession(deps);
    expect(result.structuralCandidatesProbed).toBe(1);
    expect(result.structuralCandidatesUnique).toBe(1); // open_app's app-entry-row anchor resolved to exactly one
    expect(result.uniqueCalibrated).toBe(3); // still only the 3 fixed-label targets count as calibrated
  });

  it("flags a calibrated target that drifted to a non-unique match (nonUniqueCalibrated)", async () => {
    const { deps } = fakeDeps({ matches: { api_group: { matchCount: 2, canHighlight: false } } });
    const result = await runSelectorProbeSession(deps);
    expect(result.uniqueCalibrated).toBe(2); // create_app + credentials
    expect(result.nonUniqueCalibrated).toBe(1); // api_group drifted
  });

  it("stops on abort and returns the partial result gathered so far", async () => {
    const { deps } = fakeDeps({ signal: (s) => (s === "api_group" ? "abort" : "ready") });
    const result = await runSelectorProbeSession(deps);
    expect(result.aborted).toBe(true);
    expect(result.screensProbed).toBe(1); // only app_list completed
    expect(result.screens.map((s) => s.screen)).toEqual(["app_list"]);
  });

  it("stops on timeout without marking the run aborted", async () => {
    const { deps } = fakeDeps({ signal: (s) => (s === "app_list" ? "ready" : "timeout") });
    const result = await runSelectorProbeSession(deps);
    expect(result.aborted).toBe(false);
    expect(result.screensProbed).toBe(1);
  });

  it("emits ONLY value-free integers/booleans/enums — no selector, label, value, or URL", async () => {
    const { deps } = fakeDeps();
    const result = await runSelectorProbeSession(deps);
    const wire = JSON.stringify(result);
    // No fixed NAVER labels, no CSS/selector fragments, no host.
    for (const leak of ["애플리케이션", "API 그룹", "aria-label", "querySelectorAll", "[role=", "apicenter", "data-aw-target"]) {
      expect(wire, `leaked ${leak}`).not.toContain(leak);
    }
  });
});
