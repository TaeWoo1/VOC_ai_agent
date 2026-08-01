/**
 * The multi-checkpoint calibration SESSION driven over a FAKE Playwright `Page` — no browser, no network, no
 * live NAVER (mirrors `naver-issuance-driver.test.ts`). The fake page records EVERY evaluate script and spies
 * on `click`, so the tests prove directly that:
 *   - no evaluate ever reads a credential value (`.value` / `inputValue` / clipboard / screenshot);
 *   - the session never invokes a marketplace action (the fake's `click` spy stays at 0);
 *   - the five surfaces are walked in one session, the newest tab is read, target resolution follows match
 *     count, credential values are excluded, an abort yields a partial sanitized summary, and the RAW selectors
 *     stay off the sanitized/logged summary (they belong to the gitignored artifact path).
 */
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import {
  buildPageSessionDeps,
  calibrationArtifactRelPath,
  runCalibrationSession,
  type CalibrationCheckpointSignal,
  type CalibrationSessionDeps,
  type RawCapturedShape,
} from "../../../src/cli/calibrate-api-center";
import type { ApiCenterStructuralCensus } from "../../../src/cli/observe-api-center";

const APP_LIST_CENSUS: ApiCenterStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  formCount: 0,
  editableTextInputCount: 0,
  readonlyFieldCount: 0,
  listLikeContainerCount: 1,
};

function shape(o: Partial<RawCapturedShape> = {}): RawCapturedShape {
  return {
    tagName: "button",
    role: "button",
    inputType: undefined,
    isReadOnly: false,
    isCredentialValueElement: false,
    ancestryTags: ["div", "body"],
    siblingIndex: 0,
    siblingCount: 2,
    boundingBox: { x: 0, y: 0, w: 50, h: 20 },
    stableAttributes: [{ name: "id", value: "btnX" }],
    candidateSelector: 'button[id="btnX"]',
    matchCount: 1,
    viewport: { w: 1000, h: 800 },
    ...o,
  };
}

interface FakePageOptions {
  census?: ApiCenterStructuralCensus;
  appEntryCount?: number;
  captures?: (RawCapturedShape | null)[];
  clicks?: boolean[];
}

/** A scripted, browser-free Page: records every evaluate, returns per-stage captures/clicks, spies on `click`. */
class FakePage {
  readonly scripts: string[] = [];
  clickCalls = 0;
  urlValue = "https://apicenter.commerce.naver.com/";
  private readonly census: ApiCenterStructuralCensus;
  private readonly appEntryCount: number;
  private readonly captures: (RawCapturedShape | null)[];
  private readonly clicks: boolean[];
  private ci = 0;
  private ki = 0;

  constructor(o: FakePageOptions = {}) {
    this.census = o.census ?? APP_LIST_CENSUS;
    this.appEntryCount = o.appEntryCount ?? 1;
    this.captures = o.captures ?? [];
    this.clicks = o.clicks ?? [];
  }

  url(): string {
    return this.urlValue;
  }

  async evaluate(fnOrStr: unknown): Promise<unknown> {
    const s = typeof fnOrStr === "string" ? fnOrStr : `[fn] ${String(fnOrStr)}`;
    this.scripts.push(s);
    if (typeof fnOrStr !== "string") return undefined;
    if (s.includes("passwordFieldPresent")) return this.census;
    if (s.includes("cal-appcount")) return this.appEntryCount;
    if (s.includes("cal-read-capture")) return this.captures[this.ci++] ?? null;
    if (s.includes("cal-click-observed")) return this.clicks[this.ki++] ?? false;
    if (s.includes("cal-arm")) return true;
    if (s.includes("cal-reset")) return true;
    return undefined;
  }

  // A spy the session must NEVER call.
  click(): void {
    this.clickCalls += 1;
  }
}

function asPage(fake: FakePage): Page {
  return fake as unknown as Page;
}

function depsFor(page: FakePage, signals: CalibrationCheckpointSignal[]): CalibrationSessionDeps {
  const base = buildPageSessionDeps(() => asPage(page), "api_center_host");
  let si = 0;
  return { ...base, waitForStageSentinel: async () => signals[si++] ?? "timeout" };
}

const ALL_READY: CalibrationCheckpointSignal[] = ["ready", "ready", "ready", "ready", "ready"];

describe("runCalibrationSession — the five-surface happy path (app exists)", () => {
  it("walks all five stages in one session, resolving safe controls and excluding the credential value", async () => {
    const page = new FakePage({
      appEntryCount: 1, // existing app → app_list & app_detail calibrate open_app
      captures: [
        shape({ candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] }),
        shape({ tagName: "a", role: "link", candidateSelector: 'a[id="appRow"]', stableAttributes: [{ name: "id", value: "appRow" }] }),
        shape({ candidateSelector: 'button[id="addGroup"]', stableAttributes: [{ name: "id", value: "addGroup" }] }),
        shape({ tagName: "input", inputType: "password", isCredentialValueElement: true, candidateSelector: "", stableAttributes: [], matchCount: 0 }),
        shape({ tagName: "a", role: "link", candidateSelector: 'a[id="backToSellerops"]', stableAttributes: [{ name: "id", value: "backToSellerops" }] }),
      ],
    });
    const result = await runCalibrationSession(depsFor(page, ALL_READY));

    expect(result.aborted).toBe(false);
    expect(result.stagesCompleted).toBe(5);
    expect(result.summary.pages).toHaveLength(5);
    expect(result.summary.targets).toHaveLength(5);

    // open_app (list) + open_app (detail) + api_group + return = 4 resolved; credentials excluded.
    expect(result.summary.resolvedCount).toBe(4);
    const byKind = Object.fromEntries(result.summary.targets.map((t) => [t.targetKind + ":" + t.resolution, t]));
    expect(byKind["open_app:resolved"]).toBeTruthy();
    expect(byKind["api_group:resolved"]).toBeTruthy();
    expect(byKind["credentials:excluded_credential_value"]).toBeTruthy();
    expect(byKind["return:resolved"]).toBeTruthy();

    // Raw entries exist ONLY for the four safe resolved controls — never for the credential value.
    expect(result.rawEntries).toHaveLength(4);
    expect(result.rawEntries.some((e) => e.targetKind === "credentials")).toBe(false);

    // AUTOMATIC ACTION = 0: the session never invoked the page's click.
    expect(page.clickCalls).toBe(0);
  });

  it("the sanitized/logged summary carries NO raw selector; the raw artifact lives at the gitignored path", async () => {
    const page = new FakePage({
      appEntryCount: 1,
      captures: [shape({ candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] })],
    });
    const result = await runCalibrationSession(depsFor(page, ["ready", "abort"]));

    const loggedSummary = JSON.stringify(result.summary);
    expect(loggedSummary).not.toContain("openApp"); // the raw selector token never enters the sanitized summary
    // …but it IS retained in the raw artifact entry (destined for the gitignored sink).
    expect(result.rawEntries[0]?.selector).toBe('button[id="openApp"]');
    expect(calibrationArtifactRelPath("cal_abc123")).toBe(".calibration/api-center-cal_abc123.json");
  });
});

describe("runCalibrationSession — empty-app branch (create instead of open)", () => {
  it("calibrates create_app on the list and leaves app_detail unresolved (nothing to open)", async () => {
    const page = new FakePage({
      appEntryCount: 0, // no app → app_list = create_app; app_detail = null (unforced)
      captures: [
        shape({ candidateSelector: 'button[id="createApp"]', stableAttributes: [{ name: "id", value: "createApp" }] }),
        shape({ candidateSelector: 'a[id="appRow"]', stableAttributes: [{ name: "id", value: "appRow" }] }), // read but dropped (no target kind)
        shape({ candidateSelector: 'button[id="addGroup"]', stableAttributes: [{ name: "id", value: "addGroup" }] }),
        shape({ tagName: "input", isReadOnly: true, isCredentialValueElement: true, candidateSelector: "", stableAttributes: [], matchCount: 0 }),
        shape({ candidateSelector: 'a[id="back"]', stableAttributes: [{ name: "id", value: "back" }] }),
      ],
    });
    const result = await runCalibrationSession(depsFor(page, ALL_READY));

    const kinds = result.summary.targets.map((t) => t.targetKind);
    expect(kinds).toContain("create_app");
    // app_detail produced NO target (unresolved, not forced) → only 4 targets even though 5 stages ran.
    expect(result.stagesCompleted).toBe(5);
    expect(result.summary.targets).toHaveLength(4);
    expect(kinds.filter((k) => k === "open_app")).toHaveLength(0);
  });
});

describe("runCalibrationSession — match count decides resolution per surface", () => {
  it("0 → unresolved_none, ≥2 → unresolved_multiple, 1 → resolved", async () => {
    const page = new FakePage({
      appEntryCount: 1,
      captures: [
        shape({ matchCount: 0, candidateSelector: 'button[id="none"]', stableAttributes: [{ name: "id", value: "none" }] }),
        shape({ matchCount: 3, candidateSelector: 'a[id="many"]', stableAttributes: [{ name: "id", value: "many" }] }),
        shape({ matchCount: 1, candidateSelector: 'button[id="one"]', stableAttributes: [{ name: "id", value: "one" }] }),
        shape({ isCredentialValueElement: true, inputType: "password", candidateSelector: "", stableAttributes: [], matchCount: 0 }),
        shape({ matchCount: 1, candidateSelector: 'a[id="ret"]', stableAttributes: [{ name: "id", value: "ret" }] }),
      ],
    });
    const result = await runCalibrationSession(depsFor(page, ALL_READY));
    // targets are pushed in stage order: app_list, app_detail, api_group, credentials, return_path.
    const t = result.summary.targets;
    expect(t[0]).toMatchObject({ targetKind: "open_app", resolution: "unresolved_none" }); // matchCount 0
    expect(t[1]).toMatchObject({ targetKind: "open_app", resolution: "unresolved_multiple" }); // matchCount 3
    expect(t[2]).toMatchObject({ targetKind: "api_group", resolution: "resolved" }); // matchCount 1
    expect(t[3]).toMatchObject({ targetKind: "credentials", resolution: "excluded_credential_value" });
    expect(t[4]).toMatchObject({ targetKind: "return", resolution: "resolved" });
  });
});

describe("runCalibrationSession — credential value read = 0 and automatic action = 0", () => {
  it("never reads a value and never clicks, across every evaluate script (string or function form)", async () => {
    const page = new FakePage({
      appEntryCount: 1,
      captures: [
        shape(),
        shape(),
        shape(),
        shape({ tagName: "input", inputType: "password", isCredentialValueElement: true, candidateSelector: "", stableAttributes: [], matchCount: 0 }),
        shape(),
      ],
    });
    await runCalibrationSession(depsFor(page, ALL_READY));

    for (const s of page.scripts) {
      for (const tok of [".value", "inputValue", "clipboard", "readText(", ".screenshot(", ".textContent", ".innerHTML", ".outerHTML"]) {
        expect(s, `leaked ${tok}`).not.toContain(tok);
      }
    }
    expect(page.clickCalls).toBe(0);
  });
});

describe("runCalibrationSession — operator click observation", () => {
  it("counts the operator's own observed navigation clicks (sanitized count only)", async () => {
    const page = new FakePage({
      appEntryCount: 1,
      captures: [shape(), shape(), shape(), shape(), shape()],
      clicks: [true, false, true, false, false],
    });
    const result = await runCalibrationSession(depsFor(page, ALL_READY));
    expect(result.clicksObserved).toBe(2);
    expect(page.clickCalls).toBe(0); // observed, never generated
  });
});

describe("runCalibrationSession — newest-tab retention (window kept open once)", () => {
  it("reads the NEWEST tab when a context is injected; a stale tab is never read", async () => {
    const stale = new FakePage({ captures: [shape()] });
    const fresh = new FakePage({
      appEntryCount: 1,
      captures: [shape(), shape(), shape(), shape(), shape()],
    });
    const pages = [asPage(stale), asPage(fresh)];
    const base = buildPageSessionDeps(() => pages[pages.length - 1] as Page, "api_center_host");
    let si = 0;
    const deps: CalibrationSessionDeps = { ...base, waitForStageSentinel: async () => ALL_READY[si++] ?? "timeout" };

    const result = await runCalibrationSession(deps);
    expect(result.stagesCompleted).toBe(5);
    expect(fresh.scripts.length).toBeGreaterThan(0);
    expect(stale.scripts.length).toBe(0); // the stale tab was never read
  });
});

describe("runCalibrationSession — abort yields cleanup + a partial sanitized summary", () => {
  it("stops on an abort signal, keeping only the surfaces walked so far", async () => {
    const page = new FakePage({
      appEntryCount: 1,
      captures: [
        shape({ candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] }),
        shape({ candidateSelector: 'a[id="appRow"]', stableAttributes: [{ name: "id", value: "appRow" }] }),
      ],
    });
    const result = await runCalibrationSession(depsFor(page, ["ready", "ready", "abort"]));

    expect(result.aborted).toBe(true);
    expect(result.stagesCompleted).toBe(2);
    expect(result.summary.pages).toHaveLength(2);
    expect(result.summary.targets).toHaveLength(2);
    expect(page.clickCalls).toBe(0);
  });

  it("a timeout also stops the walk without marking it an explicit abort", async () => {
    const page = new FakePage({ appEntryCount: 1, captures: [shape()] });
    const result = await runCalibrationSession(depsFor(page, ["ready", "timeout"]));
    expect(result.aborted).toBe(false);
    expect(result.stagesCompleted).toBe(1);
  });
});
