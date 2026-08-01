/**
 * The multi-checkpoint calibration SESSION driven over a FAKE Playwright `Page` — no browser, no network, no
 * live NAVER (mirrors `naver-issuance-driver.test.ts`). The fake page records EVERY evaluate script, MODELS a
 * fresh document destroying the in-page capture listeners on navigate/reload/new-tab, and spies on every
 * mutating page method, so the tests prove directly that:
 *   - the session RE-ARMS capture on the newest page after a navigation/reload/new-tab, so a post-navigation
 *     hotkey capture SUCCEEDS — the exact regression that captured ZERO targets live (listeners armed once at
 *     stage start, then destroyed by the operator's navigation);
 *   - a live document is never DOUBLE-armed (`IS_CAPTURE_ARMED` gates the re-arm);
 *   - a REQUIRED stage does NOT advance on a capture-less ready (`CAPTURE_REQUIRED`), and an OPTIONAL stage
 *     advances only on an explicit skip;
 *   - no evaluate ever reads a credential value (`.value` / `inputValue` / clipboard / screenshot);
 *   - the session never invokes a marketplace action (the click/type/fill/press spies stay at 0);
 *   - the four surfaces are walked in one session, the newest tab is read, target resolution follows match
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
import type { CalibrationTargetKind } from "../../../src/action-window/api-issuance-calibration/calibration";
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

const CREDENTIAL_VALUE_SHAPE = shape({
  tagName: "input",
  inputType: "password",
  isCredentialValueElement: true,
  candidateSelector: "",
  stableAttributes: [],
  matchCount: 0,
});

interface FakePageOptions {
  census?: ApiCenterStructuralCensus;
  appEntryCount?: number;
  clickObs?: boolean[];
}

/**
 * A scripted, browser-free Page that MODELS the JS realm the capture listeners live in. `navigate()` /
 * `reload()` / `openNewTab()` mimic a FRESH document: the listeners (`armed`) and the captured element are
 * gone. `hotkey()` only records a capture when the document is currently armed — exactly the live behaviour
 * (no listener ⇒ the Ctrl+Shift+K keydown is never seen). Records every evaluate; spies on every mutating call.
 */
class FakePage {
  readonly scripts: string[] = [];
  clickCalls = 0;
  typeCalls = 0;
  fillCalls = 0;
  pressCalls = 0;
  armed = false;
  armCalls = 0;
  targetKindsSet: string[] = [];
  captureRequiredToasts = 0;
  urlValue = "https://apicenter.commerce.naver.com/";
  private captureVar: RawCapturedShape | null = null;
  private readonly census: ApiCenterStructuralCensus;
  private readonly appEntryCount: number;
  private readonly clickObs: boolean[];
  private ki = 0;

  constructor(o: FakePageOptions = {}) {
    this.census = o.census ?? APP_LIST_CENSUS;
    this.appEntryCount = o.appEntryCount ?? 1;
    this.clickObs = o.clickObs ?? [];
  }

  url(): string {
    return this.urlValue;
  }

  /** Model a fresh document: the JS realm (and its capture listeners + captured element) is replaced. */
  private freshDocument(): void {
    this.armed = false;
    this.captureVar = null;
  }
  navigate(): void {
    this.freshDocument();
  }
  reload(): void {
    this.freshDocument();
  }

  /** The operator hovers + presses the hotkey. Captures ONLY when the document is currently armed. */
  hotkey(captured: RawCapturedShape): void {
    if (this.armed) this.captureVar = captured;
  }

  async evaluate(fnOrStr: unknown): Promise<unknown> {
    const s = typeof fnOrStr === "string" ? fnOrStr : `[fn] ${String(fnOrStr)}`;
    this.scripts.push(s);
    if (typeof fnOrStr !== "string") return undefined;
    if (s.includes("passwordFieldPresent")) return this.census;
    if (s.includes("cal-appcount")) return this.appEntryCount;
    if (s.includes("cal-is-armed")) return this.armed;
    if (s.includes("cal-arm")) {
      this.armed = true;
      this.armCalls += 1;
      return true;
    }
    if (s.includes("cal-set-kind")) {
      const m = /"([a-z_]+)"/.exec(s);
      if (m && m[1]) this.targetKindsSet.push(m[1]);
      return true;
    }
    if (s.includes("cal-read-capture")) return this.captureVar;
    if (s.includes("cal-click-observed")) return this.clickObs[this.ki++] ?? false;
    if (s.includes("cal-reset")) {
      // A RESET clears the captured element but NOT the listeners (only a fresh document destroys those).
      this.captureVar = null;
      return true;
    }
    if (s.includes("cal-capture-required-toast")) {
      this.captureRequiredToasts += 1;
      return true;
    }
    return undefined;
  }

  // Spies the session must NEVER call.
  click(): void {
    this.clickCalls += 1;
  }
  type(): void {
    this.typeCalls += 1;
  }
  fill(): void {
    this.fillCalls += 1;
  }
  press(): void {
    this.pressCalls += 1;
  }
}

function asPage(fake: FakePage): Page {
  return fake as unknown as Page;
}

/** An operator turn: mutate the fake (navigate/hotkey/new-tab) and return the sentinel signal for that turn. */
type Turn = () => Promise<CalibrationCheckpointSignal> | CalibrationCheckpointSignal;

function depsWith(
  getActivePage: () => FakePage,
  turns: Turn[],
  extra: Partial<CalibrationSessionDeps> = {},
): CalibrationSessionDeps {
  const base = buildPageSessionDeps(() => asPage(getActivePage()), "api_center_host");
  let ti = 0;
  return {
    ...base,
    waitForStageSentinel: async () => {
      const turn = turns[ti++];
      return turn ? await turn() : "timeout";
    },
    ...extra,
  };
}

/** Simulate the production event hook (context "page" / page "load"/"framenavigated") re-arming the newest page. */
async function eventRearm(page: FakePage, kind: CalibrationTargetKind): Promise<void> {
  const base = buildPageSessionDeps(() => asPage(page), "api_center_host");
  await base.armCaptureOnNewestPage(); // idempotent: only arms a NOT-armed (fresh) document
  await base.setTargetKind(kind);
}

describe("runCalibrationSession — the four-surface happy path (app exists)", () => {
  it("walks all four stages in one session, resolving safe controls and excluding the credential value", async () => {
    const page = new FakePage({ appEntryCount: 1 }); // existing app → app_list calibrates open_app
    const captures: RawCapturedShape[] = [
      shape({ candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] }),
      shape({ tagName: "h1", role: "heading", candidateSelector: 'h1[id="appTitle"]', stableAttributes: [{ name: "id", value: "appTitle" }] }),
      shape({ candidateSelector: 'button[id="addGroup"]', stableAttributes: [{ name: "id", value: "addGroup" }] }),
      CREDENTIAL_VALUE_SHAPE,
    ];
    const turns: Turn[] = captures.map((cap) => () => {
      page.hotkey(cap);
      return "ready";
    });
    const result = await runCalibrationSession(depsWith(() => page, turns));

    expect(result.aborted).toBe(false);
    expect(result.stagesCompleted).toBe(4);
    expect(result.summary.pages).toHaveLength(4);
    expect(result.summary.targets).toHaveLength(4);

    // open_app (list) + app_detail_anchor + api_group = 3 resolved; credentials excluded.
    expect(result.summary.resolvedCount).toBe(3);
    const byKind = Object.fromEntries(result.summary.targets.map((t) => [t.targetKind + ":" + t.resolution, t]));
    expect(byKind["open_app:resolved"]).toBeTruthy();
    expect(byKind["app_detail_anchor:resolved"]).toBeTruthy();
    expect(byKind["api_group:resolved"]).toBeTruthy();
    expect(byKind["credentials:excluded_credential_value"]).toBeTruthy();

    // Every stage confirmed armed; nothing skipped or refused.
    expect(result.stagesArmed).toBe(4);
    expect(result.skippedCount).toBe(0);
    expect(result.captureRequiredCount).toBe(0);

    // The ack toast was fed the right kinds (value-free enum injected each stage).
    expect(result.summary.targets.map((t) => t.targetKind)).toEqual(["open_app", "app_detail_anchor", "api_group", "credentials"]);
    expect(page.targetKindsSet).toContain("open_app");
    expect(page.targetKindsSet).toContain("app_detail_anchor");

    // Raw entries exist ONLY for the three safe resolved controls — never for the credential value.
    expect(result.rawEntries).toHaveLength(3);
    expect(result.rawEntries.some((e) => e.targetKind === "credentials")).toBe(false);

    // No duplicate arm on the same (never-navigated) document, and no automatic marketplace action.
    expect(page.armCalls).toBe(1);
    expect(page.clickCalls).toBe(0);
    expect(page.typeCalls).toBe(0);
    expect(page.fillCalls).toBe(0);
    expect(page.pressCalls).toBe(0);

    // `return` is NOT walked — only the four calibration surfaces produced pages/targets.
    expect(JSON.stringify(result.summary)).not.toContain("return");
  });

  it("the sanitized/logged summary carries NO raw selector; the raw artifact lives at the gitignored path", async () => {
    const page = new FakePage({ appEntryCount: 1 });
    const turns: Turn[] = [
      () => {
        page.hotkey(shape({ candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] }));
        return "ready";
      },
      () => "abort",
    ];
    const result = await runCalibrationSession(depsWith(() => page, turns));

    const loggedSummary = JSON.stringify(result.summary);
    expect(loggedSummary).not.toContain("openApp"); // the raw selector token never enters the sanitized summary
    expect(result.rawEntries[0]?.selector).toBe('button[id="openApp"]');
    expect(calibrationArtifactRelPath("cal_abc123")).toBe(".calibration/api-center-cal_abc123.json");
  });
});

describe("runCalibrationSession — empty-app branch (create instead of open)", () => {
  it("calibrates create_app on the list when no application exists", async () => {
    const page = new FakePage({ appEntryCount: 0 }); // no app → app_list = create_app
    const captures: RawCapturedShape[] = [
      shape({ candidateSelector: 'button[id="createApp"]', stableAttributes: [{ name: "id", value: "createApp" }] }),
      shape({ tagName: "h1", role: "heading", candidateSelector: 'h1[id="appTitle"]', stableAttributes: [{ name: "id", value: "appTitle" }] }),
      shape({ candidateSelector: 'button[id="addGroup"]', stableAttributes: [{ name: "id", value: "addGroup" }] }),
      CREDENTIAL_VALUE_SHAPE,
    ];
    const turns: Turn[] = captures.map((cap) => () => {
      page.hotkey(cap);
      return "ready";
    });
    const result = await runCalibrationSession(depsWith(() => page, turns));

    const kinds = result.summary.targets.map((t) => t.targetKind);
    expect(kinds).toContain("create_app");
    expect(kinds.filter((k) => k === "open_app")).toHaveLength(0);
    expect(result.stagesCompleted).toBe(4);
  });
});

describe("runCalibrationSession — match count decides resolution per surface", () => {
  it("0 → unresolved_none, ≥2 → unresolved_multiple, 1 → resolved (credential always excluded)", async () => {
    const page = new FakePage({ appEntryCount: 1 });
    const captures: RawCapturedShape[] = [
      shape({ matchCount: 0, candidateSelector: 'button[id="none"]', stableAttributes: [{ name: "id", value: "none" }] }),
      shape({ tagName: "h1", role: "heading", matchCount: 3, candidateSelector: 'h1[id="many"]', stableAttributes: [{ name: "id", value: "many" }] }),
      shape({ matchCount: 1, candidateSelector: 'button[id="one"]', stableAttributes: [{ name: "id", value: "one" }] }),
      CREDENTIAL_VALUE_SHAPE,
    ];
    const turns: Turn[] = captures.map((cap) => () => {
      page.hotkey(cap);
      return "ready";
    });
    const result = await runCalibrationSession(depsWith(() => page, turns));
    const t = result.summary.targets;
    // Stage order: app_list, app_detail_anchor, api_group, credentials.
    expect(t[0]).toMatchObject({ targetKind: "open_app", resolution: "unresolved_none" });
    expect(t[1]).toMatchObject({ targetKind: "app_detail_anchor", resolution: "unresolved_multiple" });
    expect(t[2]).toMatchObject({ targetKind: "api_group", resolution: "resolved" });
    expect(t[3]).toMatchObject({ targetKind: "credentials", resolution: "excluded_credential_value" });
  });
});

describe("runCalibrationSession — NAVIGATION DESTROYS LISTENERS: re-arm makes the post-nav hotkey succeed", () => {
  it("bug reproduction: WITHOUT a re-arm, a post-navigation hotkey captures NOTHING (the live failure)", async () => {
    const page = new FakePage({ appEntryCount: 1 });
    let captureRequiredSeen = 0;
    const turns: Turn[] = [
      // app_list: operator navigates (listeners destroyed), then presses the hotkey with NO re-arm → no capture.
      () => {
        page.navigate();
        page.hotkey(shape({ candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] }));
        return "ready";
      },
      // second signal on the SAME required stage → give up (timeout) so the test terminates.
      () => "timeout",
    ];
    const result = await runCalibrationSession(
      depsWith(() => page, turns, { announceCaptureRequired: () => void (captureRequiredSeen += 1) }),
    );
    // The required app_list stage never advanced — exactly the zero-capture regression.
    expect(result.stagesCompleted).toBe(0);
    expect(result.summary.targets).toHaveLength(0);
    expect(result.captureRequiredCount).toBe(1);
    expect(captureRequiredSeen).toBe(1);
  });

  for (const nav of ["navigate", "reload", "openNewTab"] as const) {
    it(`WITH event-driven re-arm on the newest page, a post-${nav} hotkey capture SUCCEEDS`, async () => {
      // A tab list so "openNewTab" can push a fresh page that becomes the newest (as the operator opening the
      // next step in a new tab would).
      const first = new FakePage({ appEntryCount: 1 });
      const tabs: FakePage[] = [first];
      const newest = (): FakePage => tabs[tabs.length - 1]!;

      const captures: RawCapturedShape[] = [
        shape({ candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] }),
        shape({ tagName: "h1", role: "heading", candidateSelector: 'h1[id="appTitle"]', stableAttributes: [{ name: "id", value: "appTitle" }] }),
        shape({ candidateSelector: 'button[id="addGroup"]', stableAttributes: [{ name: "id", value: "addGroup" }] }),
        CREDENTIAL_VALUE_SHAPE,
      ];
      const kindByStage: CalibrationTargetKind[] = ["open_app", "app_detail_anchor", "api_group", "credentials"];
      const turns: Turn[] = captures.map((cap, i) => async (): Promise<CalibrationCheckpointSignal> => {
        // Operator moves — this destroys the prior document's listeners (fresh document / new tab).
        if (nav === "openNewTab") tabs.push(new FakePage({ appEntryCount: 1 }));
        else if (nav === "reload") newest().reload();
        else newest().navigate();
        // The production event hook fires and RE-ARMS the newest page (idempotent) + re-injects the kind.
        await eventRearm(newest(), kindByStage[i]!);
        // Only NOW does the operator press the hotkey — a live listener records the capture.
        newest().hotkey(cap);
        return "ready";
      });

      const result = await runCalibrationSession(depsWith(newest, turns));

      expect(result.stagesCompleted).toBe(4);
      expect(result.summary.resolvedCount).toBe(3); // credential excluded
      expect(result.summary.targets.map((t) => t.targetKind)).toEqual(kindByStage);
      // The stale first tab is never read for capture in the new-tab case.
      if (nav === "openNewTab") expect(first.scripts.some((s) => s.includes("cal-read-capture"))).toBe(false);
    });
  }

  it("re-arm is idempotent (no duplicate arm on a live document) but re-arms after a fresh document", async () => {
    const page = new FakePage();
    const base = buildPageSessionDeps(() => asPage(page), "api_center_host");
    await base.armCaptureOnNewestPage();
    expect(page.armCalls).toBe(1);
    await base.armCaptureOnNewestPage(); // already armed → no-op
    expect(page.armCalls).toBe(1);
    page.navigate(); // fresh document drops the listeners
    await base.armCaptureOnNewestPage(); // re-arms
    expect(page.armCalls).toBe(2);
  });
});

describe("runCalibrationSession — required vs optional advance rules", () => {
  it("a REQUIRED stage does NOT advance on a capture-less ready (CAPTURE_REQUIRED), then advances once captured", async () => {
    const page = new FakePage({ appEntryCount: 1 });
    let requiredToasts = 0;
    const turns: Turn[] = [
      () => "ready", // app_list: no hotkey pressed → capture is null → refuse
      () => {
        page.hotkey(shape({ candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] }));
        return "ready"; // now captured → advance
      },
      () => {
        page.hotkey(shape({ tagName: "h1", role: "heading", candidateSelector: 'h1[id="t"]', stableAttributes: [{ name: "id", value: "t" }] }));
        return "ready"; // app_detail_anchor captured
      },
      () => {
        page.hotkey(shape({ candidateSelector: 'button[id="g"]', stableAttributes: [{ name: "id", value: "g" }] }));
        return "ready"; // api_group captured
      },
      () => {
        page.hotkey(CREDENTIAL_VALUE_SHAPE);
        return "ready"; // credentials
      },
    ];
    const result = await runCalibrationSession(
      depsWith(() => page, turns, { notifyCaptureRequired: async () => void (requiredToasts += 1) }),
    );
    expect(result.captureRequiredCount).toBe(1);
    expect(requiredToasts).toBe(1); // a value-free "capture required" toast was rendered
    expect(result.stagesCompleted).toBe(4);
    expect(result.summary.targets[0]).toMatchObject({ targetKind: "open_app", resolution: "resolved" });
  });

  it("an OPTIONAL stage (app_detail_anchor) never advances on a bare capture-less ready — only on an explicit skip", async () => {
    const page = new FakePage({ appEntryCount: 1 });
    let skippableAnnounced = 0;
    const turns: Turn[] = [
      () => {
        page.hotkey(shape({ candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] }));
        return "ready"; // app_list captured
      },
      () => "ready", // app_detail_anchor: no capture → bare ready must NOT advance
      () => "skip", // explicit skip advances the optional stage (no target)
      () => {
        page.hotkey(shape({ candidateSelector: 'button[id="g"]', stableAttributes: [{ name: "id", value: "g" }] }));
        return "ready"; // api_group captured
      },
      () => {
        page.hotkey(CREDENTIAL_VALUE_SHAPE);
        return "ready"; // credentials
      },
    ];
    const result = await runCalibrationSession(
      depsWith(() => page, turns, { announceSkippable: () => void (skippableAnnounced += 1) }),
    );
    expect(skippableAnnounced).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.stagesCompleted).toBe(4);
    // The skipped stage produced a PAGE SIGNATURE but no target.
    expect(result.summary.pages).toHaveLength(4);
    expect(result.summary.targets.map((t) => t.targetKind)).toEqual(["open_app", "api_group", "credentials"]);
    expect(result.summary.targets.some((t) => t.targetKind === "app_detail_anchor")).toBe(false);
  });

  it("a REQUIRED stage cannot be skipped — a skip signal is treated as capture-required", async () => {
    const page = new FakePage({ appEntryCount: 1 });
    const turns: Turn[] = [
      () => "skip", // app_list is required → skip refused
      () => "timeout", // give up
    ];
    const result = await runCalibrationSession(depsWith(() => page, turns));
    expect(result.captureRequiredCount).toBe(1);
    expect(result.stagesCompleted).toBe(0);
  });
});

describe("runCalibrationSession — credential value read = 0 and automatic action = 0", () => {
  it("never reads a value and never clicks/types/fills/presses, across every evaluate script", async () => {
    const page = new FakePage({ appEntryCount: 1 });
    const captures: RawCapturedShape[] = [shape(), shape({ tagName: "h1", role: "heading" }), shape(), CREDENTIAL_VALUE_SHAPE];
    const turns: Turn[] = captures.map((cap) => () => {
      page.hotkey(cap);
      return "ready";
    });
    await runCalibrationSession(depsWith(() => page, turns));

    for (const s of page.scripts) {
      for (const tok of [".value", "inputValue", "clipboard", "readText(", ".screenshot(", ".textContent", ".innerText", ".innerHTML", ".outerHTML"]) {
        expect(s, `leaked ${tok}`).not.toContain(tok);
      }
    }
    expect(page.clickCalls).toBe(0);
    expect(page.typeCalls).toBe(0);
    expect(page.fillCalls).toBe(0);
    expect(page.pressCalls).toBe(0);
  });
});

describe("runCalibrationSession — operator click observation", () => {
  it("counts the operator's own observed navigation clicks (sanitized count only)", async () => {
    const page = new FakePage({ appEntryCount: 1, clickObs: [true, false, true, false] });
    const captures: RawCapturedShape[] = [shape(), shape({ tagName: "h1", role: "heading" }), shape(), CREDENTIAL_VALUE_SHAPE];
    const turns: Turn[] = captures.map((cap) => () => {
      page.hotkey(cap);
      return "ready";
    });
    const result = await runCalibrationSession(depsWith(() => page, turns));
    expect(result.clicksObserved).toBe(2);
    expect(page.clickCalls).toBe(0); // observed, never generated
  });
});

describe("runCalibrationSession — newest-tab retention (window kept open once)", () => {
  it("reads the NEWEST tab when a context is injected; a stale tab is never read", async () => {
    const stale = new FakePage();
    const fresh = new FakePage({ appEntryCount: 1 });
    const pages = [asPage(stale), asPage(fresh)];
    const base = buildPageSessionDeps(() => pages[pages.length - 1] as Page, "api_center_host");
    const captures: RawCapturedShape[] = [shape(), shape({ tagName: "h1", role: "heading" }), shape(), CREDENTIAL_VALUE_SHAPE];
    let ti = 0;
    const turns: Turn[] = captures.map((cap) => () => {
      fresh.hotkey(cap);
      return "ready" as CalibrationCheckpointSignal;
    });
    const deps: CalibrationSessionDeps = { ...base, waitForStageSentinel: async () => turns[ti++]?.() ?? "timeout" };

    const result = await runCalibrationSession(deps);
    expect(result.stagesCompleted).toBe(4);
    expect(fresh.scripts.length).toBeGreaterThan(0);
    expect(stale.scripts.length).toBe(0); // the stale tab was never read
  });
});

describe("runCalibrationSession — abort yields cleanup + a partial sanitized summary", () => {
  it("stops on an abort signal, keeping only the surfaces walked so far", async () => {
    const page = new FakePage({ appEntryCount: 1 });
    const turns: Turn[] = [
      () => {
        page.hotkey(shape({ candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] }));
        return "ready";
      },
      () => {
        page.hotkey(shape({ tagName: "h1", role: "heading", candidateSelector: 'h1[id="t"]', stableAttributes: [{ name: "id", value: "t" }] }));
        return "ready";
      },
      () => "abort",
    ];
    const result = await runCalibrationSession(depsWith(() => page, turns));

    expect(result.aborted).toBe(true);
    expect(result.stagesCompleted).toBe(2);
    expect(result.summary.pages).toHaveLength(2);
    expect(result.summary.targets).toHaveLength(2);
    expect(page.clickCalls).toBe(0);
  });

  it("a timeout also stops the walk without marking it an explicit abort", async () => {
    const page = new FakePage({ appEntryCount: 1 });
    const turns: Turn[] = [
      () => {
        page.hotkey(shape());
        return "ready";
      },
      () => "timeout",
    ];
    const result = await runCalibrationSession(depsWith(() => page, turns));
    expect(result.aborted).toBe(false);
    expect(result.stagesCompleted).toBe(1);
  });
});
