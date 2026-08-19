/**
 * The READ-ONLY Phase-B selector probe orchestrator, driven offline over fake seams (no browser, no NAVER).
 * It locks that the walk (a) visits exactly the screens that carry a highlight target, (b) measures each
 * highlighted control's calibrated fixed-label matchCount + `canHighlight` read-only, (c) counts calibrated
 * uniqueness honestly, (d) recovers on abort/timeout, and (e) emits ONLY value-free integers/booleans/enums —
 * never a selector, label, value, or URL. (`open_app` is navigation guidance, not a highlighted control, so it
 * is never probed here.)
 */
import { describe, it, expect } from "vitest";
import type { ApiCenterPageCategory } from "../../src/cli/observe-api-center";
import {
  issuanceProbeScreens,
  targetsForScreen,
  runSelectorProbeSession,
  type SelectorProbeDeps,
  type SelectorProbeSignal,
} from "../../instruments/calibration/probe-issuance-selectors";
import type { IssuanceHighlightTarget } from "../../src/action-window/api-issuance-calibration/issuance-highlight-selectors";

/** Every calibrated highlight target resolves uniquely by default. */
const DEFAULT_MATCHES: Record<IssuanceHighlightTarget, { matchCount: number; canHighlight: boolean }> = {
  create_app: { matchCount: 1, canHighlight: true },
  api_group: { matchCount: 1, canHighlight: true },
  application_id: { matchCount: 1, canHighlight: true },
  application_secret: { matchCount: 1, canHighlight: true },
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
    // app_list now carries only create_app — open_app is navigation guidance, not a highlighted control.
    expect(targetsForScreen("app_list")).toEqual(["create_app"]);
    expect(targetsForScreen("api_group")).toEqual(["api_group"]);
    expect(targetsForScreen("credentials")).toEqual(["application_id", "application_secret"]);
    expect(targetsForScreen("app_detail")).toEqual([]);
  });
});

describe("issuance selector probe — read-only walk", () => {
  it("measures every highlighted control on every screen and tallies calibrated uniqueness honestly", async () => {
    const { deps, probed } = fakeDeps();
    const result = await runSelectorProbeSession(deps);

    expect(result.aborted).toBe(false);
    expect(result.screensProbed).toBe(3);
    expect(result.screens.map((s) => s.screen)).toEqual(["app_list", "api_group", "credentials"]);
    // Every highlighted control was measured — open_app is not among them (it is navigation guidance).
    expect(probed).toEqual(["create_app", "api_group", "application_id", "application_secret"]);

    const appList = result.screens[0]!;
    expect(appList.targets).toEqual([
      { target: "create_app", status: "live_confirmed", matchCount: 1, canHighlight: true },
    ]);
    expect(result.uniqueCalibrated).toBe(4);
    expect(result.nonUniqueCalibrated).toBe(0);
  });

  it("flags a calibrated target that drifted to a non-unique match (nonUniqueCalibrated)", async () => {
    const { deps } = fakeDeps({ matches: { api_group: { matchCount: 2, canHighlight: false } } });
    const result = await runSelectorProbeSession(deps);
    expect(result.uniqueCalibrated).toBe(3); // create_app + application_id + application_secret
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
