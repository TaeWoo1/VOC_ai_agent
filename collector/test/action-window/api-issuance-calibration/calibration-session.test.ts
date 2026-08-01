/**
 * The multi-checkpoint calibration SESSION driven over the REAL capture channel + fake operator turns — no
 * browser, no network, no live NAVER. Each "turn" returns the sentinel signal for that stage and, to model a
 * hotkey capture, pushes a structural payload into the channel exactly as the in-page init script would
 * (`channel.onStageQuery()` to read the active nonce, then `channel.onCapture(source, payload)`). The tests
 * prove:
 *   - a REQUIRED stage does NOT advance on a capture-less ready (`CAPTURE_REQUIRED`) and never crashes;
 *   - an OPTIONAL stage advances only on an explicit skip (a bare ready never advances it);
 *   - a capture pushed for the stage's nonce → advance + sanitized candidate pushed;
 *   - abort/timeout stop the walk with a partial sanitized summary AND still call `clearActiveStage` (cleanup);
 *   - a late capture pushed AFTER the stage cleared is not adopted (no active stage);
 *   - the four surfaces walk in one session, app_list picks open_app vs create_app by app-entry count,
 *     resolution follows match count, credential values are excluded, and RAW selectors stay off the summary;
 *   - the deps model carries NO polling/re-arm seam (the retired reliability crutch) — the reliability now
 *     comes from the init script surviving navigation, proven in the RUN_INTEGRATION browser test.
 */
import { describe, expect, it } from "vitest";
import {
  buildPageSessionDeps,
  calibrationArtifactRelPath,
  runCalibrationSession,
  type CalibrationCheckpointSignal,
  type CalibrationSessionDeps,
} from "../../../src/cli/calibrate-api-center";
import {
  createCaptureChannel,
  type CaptureChannel,
} from "../../../src/action-window/api-issuance-calibration/calibration-binding";
import type { Page } from "playwright";
import type { ApiCenterStructuralCensus } from "../../../src/cli/observe-api-center";

const APP_LIST_CENSUS: ApiCenterStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  formCount: 0,
  editableTextInputCount: 0,
  readonlyFieldCount: 0,
  listLikeContainerCount: 1,
};

const API_CENTER_HOST = "https://apicenter.commerce.naver.com/ko/member/application/manage/list";

/** A structural capture payload, exactly as the init script would push (targetKind/stageNonce filled per stage). */
function payload(o: Record<string, unknown> = {}): Record<string, unknown> {
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
    operatorClickObserved: false,
    frameCategory: "top",
    ...o,
  };
}

const CREDENTIAL_VALUE_PAYLOAD = payload({
  tagName: "input",
  inputType: "password",
  isCredentialValueElement: true,
  candidateSelector: "",
  stableAttributes: [],
  matchCount: 0,
});

/** Push a capture for the CURRENT active stage (reads the nonce via the stage binding, like the init script). */
function pushCapture(
  channel: CaptureChannel,
  overrides: Record<string, unknown> = {},
  source: { host?: string; child?: boolean } = {},
): void {
  const stage = channel.onStageQuery();
  if (!stage) return;
  const frame = { url: () => source.host ?? API_CENTER_HOST };
  // top: mainFrame() returns the SAME frame ref; child: a different object.
  const page = { mainFrame: () => (source.child ? {} : frame) };
  channel.onCapture({ frame, page }, { ...payload(overrides), stageNonce: stage.nonce, targetKind: stage.kind });
}

/** An operator turn: mutate the channel (push a capture) and return the sentinel signal for that stage. */
type Turn = () => CalibrationCheckpointSignal;

interface HarnessOptions {
  appEntryCount?: number;
  census?: ApiCenterStructuralCensus;
  isActivePage?: boolean;
  extra?: Partial<CalibrationSessionDeps>;
}

interface Harness {
  deps: CalibrationSessionDeps;
  channel: CaptureChannel;
  clearCalls: () => number;
  captureRequiredToasts: () => number;
}

function harness(turns: Turn[], opts: HarnessOptions = {}): Harness {
  const channel = createCaptureChannel({
    urlCategory: "api_center_host",
    isActivePage: () => opts.isActivePage ?? true,
  });
  let ti = 0;
  let nonceSeq = 0;
  let clears = 0;
  let toasts = 0;
  const deps: CalibrationSessionDeps = {
    urlCategory: "api_center_host",
    readCensus: async () => opts.census ?? APP_LIST_CENSUS,
    readAppEntryCount: async () => opts.appEntryCount ?? 1,
    mintNonce: () => `nonce_${nonceSeq++}`,
    setActiveStage: (nonce, kind) => channel.setActiveStage(nonce, kind),
    clearActiveStage: () => {
      clears += 1;
      channel.clearActiveStage();
    },
    takeCaptureFor: (nonce) => channel.takeCaptureFor(nonce),
    waitForStageSentinel: async (_stage) => {
      const turn = turns[ti++];
      return turn ? turn() : "timeout";
    },
    notifyCaptureRequired: async () => void (toasts += 1),
    ...opts.extra,
  };
  return { deps, channel, clearCalls: () => clears, captureRequiredToasts: () => toasts };
}

describe("runCalibrationSession — the four-surface happy path (app exists)", () => {
  it("walks all four stages, resolving safe controls and excluding the credential value", async () => {
    const h = harness([
      () => {
        pushCapture(h.channel, { candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] });
        return "ready";
      },
      () => {
        pushCapture(h.channel, { tagName: "h1", role: "heading", candidateSelector: 'h1[id="appTitle"]', stableAttributes: [{ name: "id", value: "appTitle" }] });
        return "ready";
      },
      () => {
        pushCapture(h.channel, { candidateSelector: 'button[id="addGroup"]', stableAttributes: [{ name: "id", value: "addGroup" }] });
        return "ready";
      },
      () => {
        pushCapture(h.channel, CREDENTIAL_VALUE_PAYLOAD);
        return "ready";
      },
    ]);
    const result = await runCalibrationSession(h.deps);

    expect(result.aborted).toBe(false);
    expect(result.stagesCompleted).toBe(4);
    expect(result.capturesCollected).toBe(4);
    expect(result.summary.pages).toHaveLength(4);
    expect(result.summary.targets).toHaveLength(4);

    // open_app (list) + app_detail_anchor + api_group = 3 resolved; credentials excluded.
    expect(result.summary.resolvedCount).toBe(3);
    const byKind = Object.fromEntries(result.summary.targets.map((t) => [t.targetKind + ":" + t.resolution, t]));
    expect(byKind["open_app:resolved"]).toBeTruthy();
    expect(byKind["app_detail_anchor:resolved"]).toBeTruthy();
    expect(byKind["api_group:resolved"]).toBeTruthy();
    expect(byKind["credentials:excluded_credential_value"]).toBeTruthy();

    expect(result.skippedCount).toBe(0);
    expect(result.captureRequiredCount).toBe(0);
    // All captures came from the top frame in this walk.
    expect(result.topFrameCaptures).toBe(4);
    expect(result.childFrameCaptures).toBe(0);

    expect(result.summary.targets.map((t) => t.targetKind)).toEqual(["open_app", "app_detail_anchor", "api_group", "credentials"]);

    // Raw entries exist ONLY for the three safe resolved controls — never for the credential value.
    expect(result.rawEntries).toHaveLength(3);
    expect(result.rawEntries.some((e) => e.targetKind === "credentials")).toBe(false);

    // clearActiveStage ran once per resolved stage (cleanup so a late hotkey finds no active stage).
    expect(h.clearCalls()).toBe(4);

    // `return` is NOT walked — only the four calibration surfaces produced pages/targets.
    expect(JSON.stringify(result.summary)).not.toContain("return");
  });

  it("the sanitized/logged summary carries NO raw selector; the raw artifact lives at the gitignored path", async () => {
    const h = harness([
      () => {
        pushCapture(h.channel, { candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] });
        return "ready";
      },
      () => "abort",
    ]);
    const result = await runCalibrationSession(h.deps);

    const loggedSummary = JSON.stringify(result.summary);
    expect(loggedSummary).not.toContain("openApp"); // the raw selector token never enters the sanitized summary
    expect(result.rawEntries[0]?.selector).toBe('button[id="openApp"]');
    expect(calibrationArtifactRelPath("cal_abc123")).toBe(".calibration/api-center-cal_abc123.json");
  });
});

describe("runCalibrationSession — empty-app branch (create instead of open)", () => {
  it("calibrates create_app on the list when no application exists", async () => {
    const h = harness(
      [
        () => {
          pushCapture(h.channel, { candidateSelector: 'button[id="createApp"]', stableAttributes: [{ name: "id", value: "createApp" }] });
          return "ready";
        },
        () => {
          pushCapture(h.channel, { tagName: "h1", role: "heading", candidateSelector: 'h1[id="appTitle"]', stableAttributes: [{ name: "id", value: "appTitle" }] });
          return "ready";
        },
        () => {
          pushCapture(h.channel, { candidateSelector: 'button[id="addGroup"]', stableAttributes: [{ name: "id", value: "addGroup" }] });
          return "ready";
        },
        () => {
          pushCapture(h.channel, CREDENTIAL_VALUE_PAYLOAD);
          return "ready";
        },
      ],
      { appEntryCount: 0 },
    );
    const result = await runCalibrationSession(h.deps);

    const kinds = result.summary.targets.map((t) => t.targetKind);
    expect(kinds).toContain("create_app");
    expect(kinds.filter((k) => k === "open_app")).toHaveLength(0);
    expect(result.stagesCompleted).toBe(4);
  });
});

describe("runCalibrationSession — match count decides resolution per surface", () => {
  it("0 → unresolved_none, ≥2 → unresolved_multiple, 1 → resolved (credential always excluded)", async () => {
    const h = harness([
      () => {
        pushCapture(h.channel, { matchCount: 0, candidateSelector: 'button[id="none"]', stableAttributes: [{ name: "id", value: "none" }] });
        return "ready";
      },
      () => {
        pushCapture(h.channel, { tagName: "h1", role: "heading", matchCount: 3, candidateSelector: 'h1[id="many"]', stableAttributes: [{ name: "id", value: "many" }] });
        return "ready";
      },
      () => {
        pushCapture(h.channel, { matchCount: 1, candidateSelector: 'button[id="one"]', stableAttributes: [{ name: "id", value: "one" }] });
        return "ready";
      },
      () => {
        pushCapture(h.channel, CREDENTIAL_VALUE_PAYLOAD);
        return "ready";
      },
    ]);
    const result = await runCalibrationSession(h.deps);
    const t = result.summary.targets;
    expect(t[0]).toMatchObject({ targetKind: "open_app", resolution: "unresolved_none" });
    expect(t[1]).toMatchObject({ targetKind: "app_detail_anchor", resolution: "unresolved_multiple" });
    expect(t[2]).toMatchObject({ targetKind: "api_group", resolution: "resolved" });
    expect(t[3]).toMatchObject({ targetKind: "credentials", resolution: "excluded_credential_value" });
  });
});

describe("runCalibrationSession — required vs optional advance rules", () => {
  it("a REQUIRED stage does NOT advance on a capture-less ready (CAPTURE_REQUIRED), then advances once captured", async () => {
    const h = harness([
      () => "ready", // app_list: no capture pushed → refuse
      () => {
        pushCapture(h.channel, { candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] });
        return "ready"; // now captured → advance
      },
      () => {
        pushCapture(h.channel, { tagName: "h1", role: "heading", candidateSelector: 'h1[id="t"]', stableAttributes: [{ name: "id", value: "t" }] });
        return "ready";
      },
      () => {
        pushCapture(h.channel, { candidateSelector: 'button[id="g"]', stableAttributes: [{ name: "id", value: "g" }] });
        return "ready";
      },
      () => {
        pushCapture(h.channel, CREDENTIAL_VALUE_PAYLOAD);
        return "ready";
      },
    ]);
    const result = await runCalibrationSession(h.deps);
    expect(result.captureRequiredCount).toBe(1);
    expect(h.captureRequiredToasts()).toBe(1); // a value-free "capture required" toast was rendered
    expect(result.stagesCompleted).toBe(4);
    expect(result.summary.targets[0]).toMatchObject({ targetKind: "open_app", resolution: "resolved" });
    // clearActiveStage runs once per RESOLVED stage (not on the refused capture-less loop iteration).
    expect(h.clearCalls()).toBe(4);
  });

  it("an OPTIONAL stage (app_detail_anchor) never advances on a bare capture-less ready — only on an explicit skip", async () => {
    let skippableAnnounced = 0;
    const h = harness(
      [
        () => {
          pushCapture(h.channel, { candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] });
          return "ready"; // app_list captured
        },
        () => "ready", // app_detail_anchor: no capture → bare ready must NOT advance
        () => "skip", // explicit skip advances the optional stage (no target)
        () => {
          pushCapture(h.channel, { candidateSelector: 'button[id="g"]', stableAttributes: [{ name: "id", value: "g" }] });
          return "ready"; // api_group captured
        },
        () => {
          pushCapture(h.channel, CREDENTIAL_VALUE_PAYLOAD);
          return "ready"; // credentials
        },
      ],
      { extra: { announceSkippable: () => void (skippableAnnounced += 1) } },
    );
    const result = await runCalibrationSession(h.deps);
    expect(skippableAnnounced).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.stagesCompleted).toBe(4);
    // The skipped stage produced a PAGE SIGNATURE but no target.
    expect(result.summary.pages).toHaveLength(4);
    expect(result.summary.targets.map((t) => t.targetKind)).toEqual(["open_app", "api_group", "credentials"]);
    expect(result.summary.targets.some((t) => t.targetKind === "app_detail_anchor")).toBe(false);
  });

  it("a REQUIRED stage cannot be skipped — a skip signal is treated as capture-required", async () => {
    const h = harness([
      () => "skip", // app_list is required → skip refused
      () => "timeout", // give up
    ]);
    const result = await runCalibrationSession(h.deps);
    expect(result.captureRequiredCount).toBe(1);
    expect(result.stagesCompleted).toBe(0);
  });
});

describe("runCalibrationSession — a late capture after clearActiveStage is not adopted", () => {
  it("advances the stage on the in-window capture; a post-clear push for the same nonce is dropped", async () => {
    let leakedNonce = "";
    const h = harness([
      () => {
        const stage = h.channel.onStageQuery();
        leakedNonce = stage?.nonce ?? "";
        pushCapture(h.channel, { candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] });
        return "ready";
      },
      () => "abort",
    ]);
    const result = await runCalibrationSession(h.deps);
    expect(result.stagesCompleted).toBe(1);

    // The stage was cleared; a LATE hotkey for the finished stage finds no active stage. Because first-valid
    // already stored one, a new push cannot overwrite it — and with no active stage it is rejected outright.
    const before = h.channel.takeCaptureFor(leakedNonce);
    h.channel.onCapture(
      { frame: { url: () => API_CENTER_HOST }, page: { mainFrame: () => ({}) } },
      { ...payload({ candidateSelector: 'button[id="LATE"]' }), stageNonce: leakedNonce },
    );
    const after = h.channel.takeCaptureFor(leakedNonce);
    expect(after).toEqual(before); // unchanged — the late push was NOT adopted
  });
});

describe("runCalibrationSession — abort/timeout stop + cleanup", () => {
  it("stops on an abort signal, keeping only the surfaces walked so far, and clears the active stage", async () => {
    const h = harness([
      () => {
        pushCapture(h.channel, { candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] });
        return "ready";
      },
      () => {
        pushCapture(h.channel, { tagName: "h1", role: "heading", candidateSelector: 'h1[id="t"]', stableAttributes: [{ name: "id", value: "t" }] });
        return "ready";
      },
      () => "abort",
    ]);
    const result = await runCalibrationSession(h.deps);

    expect(result.aborted).toBe(true);
    expect(result.stagesCompleted).toBe(2);
    expect(result.summary.pages).toHaveLength(2);
    expect(result.summary.targets).toHaveLength(2);
    // clearActiveStage ran for each stage INCLUDING the aborting one (cleanup on abort).
    expect(h.clearCalls()).toBe(3);
    expect(h.channel.onStageQuery()).toBeNull();
  });

  it("a timeout also stops the walk without marking it an explicit abort, and clears the stage", async () => {
    const h = harness([
      () => {
        pushCapture(h.channel);
        return "ready";
      },
      () => "timeout",
    ]);
    const result = await runCalibrationSession(h.deps);
    expect(result.aborted).toBe(false);
    expect(result.stagesCompleted).toBe(1);
    expect(h.channel.onStageQuery()).toBeNull(); // cleared even on timeout
  });
});

describe("runCalibrationSession — operator click observation threaded from the capture", () => {
  it("counts observed navigation clicks from each capture's operatorClickObserved flag", async () => {
    const clickObs = [true, false, true, false];
    const h = harness(
      clickObs.map((obs, i) => () => {
        const cap = i === 3 ? { ...CREDENTIAL_VALUE_PAYLOAD, operatorClickObserved: obs } : payload({ tagName: i === 1 ? "h1" : "button", role: i === 1 ? "heading" : "button", operatorClickObserved: obs });
        pushCapture(h.channel, cap);
        return "ready" as CalibrationCheckpointSignal;
      }),
    );
    const result = await runCalibrationSession(h.deps);
    expect(result.clicksObserved).toBe(2);
  });
});

describe("runCalibrationSession — child-frame capture is counted as a child capture", () => {
  it("threads frameCategory from the authoritative Node derivation", async () => {
    const h = harness([
      () => {
        pushCapture(h.channel, { candidateSelector: 'button[id="openApp"]', stableAttributes: [{ name: "id", value: "openApp" }] }, { child: true });
        return "ready";
      },
      () => {
        pushCapture(h.channel, { tagName: "h1", role: "heading", candidateSelector: 'h1[id="t"]', stableAttributes: [{ name: "id", value: "t" }] });
        return "ready";
      },
      () => {
        pushCapture(h.channel, { candidateSelector: 'button[id="g"]', stableAttributes: [{ name: "id", value: "g" }] });
        return "ready";
      },
      () => {
        pushCapture(h.channel, CREDENTIAL_VALUE_PAYLOAD);
        return "ready";
      },
    ]);
    const result = await runCalibrationSession(h.deps);
    expect(result.childFrameCaptures).toBe(1); // the app_list capture came from a child frame
    expect(result.topFrameCaptures).toBe(3);
  });
});

/**
 * Regression (live-failure #2): capture works with ZERO polling re-arm. The retired model needed a per-tick
 * `onTick` re-arm; the new deps model has NO arm/re-arm seam at all — the init script survives navigation
 * instead. Proven structurally: the page-bound seams carry no arm/read-capture function, and the orchestrator
 * completes a full capture walk without any such call existing.
 */
describe("runCalibrationSession — the retired polling/re-arm seam is gone", () => {
  it("buildPageSessionDeps exposes only census reads + the capture-required toast (no arm/read-capture seam)", () => {
    const base = buildPageSessionDeps(() => ({}) as Page, "api_center_host");
    expect("readCensus" in base).toBe(true);
    expect("readAppEntryCount" in base).toBe(true);
    expect("notifyCaptureRequired" in base).toBe(true);
    for (const gone of ["armCaptureOnNewestPage", "readCaptureArmed", "setTargetKind", "resetCapture", "readCapturedTarget", "readClickObserved"]) {
      expect(gone in base).toBe(false);
    }
  });
});

/**
 * Seam-level crash-resilience — the live crash (#3) was a navigation destroying the execution context
 * mid-`page.evaluate`, whose rejection was uncaught and crashed the calibrator. The census seams are the only
 * remaining `page.evaluate`; this drives them with a Page whose `evaluate` rejects and asserts each SWALLOWS
 * the transient error and returns its safe fallback instead of throwing.
 */
describe("buildPageSessionDeps — a navigation-race rejection never crashes the session", () => {
  const rejectingPage = (): Page =>
    ({
      url: () => API_CENTER_HOST,
      evaluate: () => Promise.reject(new Error("Execution context was destroyed, most likely because of a navigation")),
    }) as unknown as Page;

  it("every census read/toast seam swallows a rejecting evaluate and returns a safe fallback (no throw)", async () => {
    const base = buildPageSessionDeps(() => rejectingPage(), "api_center_host");
    await expect(base.readCensus()).resolves.toMatchObject({ passwordFieldPresent: false, listLikeContainerCount: 0 });
    await expect(base.readAppEntryCount()).resolves.toBe(0);
    await expect(base.notifyCaptureRequired?.()).resolves.toBeUndefined();
  });
});
