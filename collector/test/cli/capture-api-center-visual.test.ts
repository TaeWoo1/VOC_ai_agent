/**
 * Offline behaviour of the VISUAL RECON orchestrator (`runVisualReconSession`) over fakes — no browser, no
 * screenshot. Proves the screenshot is taken ONLY after redaction verifies, is discarded on a post-shot
 * regression, happens at most once per operator `ready`, and that skip/abort/timeout behave. Plus the
 * artifact-path guards (only ever inside the gitignored `.calibration/visual/` sink).
 */
import { describe, expect, it } from "vitest";
import {
  isSafeVisualArtifactPath,
  runVisualReconSession,
  visualArtifactDirAbs,
  visualScreenshotAbsPath,
  visualSummaryAbsPath,
  type VisualCheckpointSignal,
  type VisualReconSessionDeps,
} from "../../src/cli/capture-api-center-visual";
import type { RawRedactionReport, RawVisualSummary, RedactionCounts, SanitizedVisualSummary } from "../../src/action-window/api-issuance-calibration/visual-recon";

function zero(): RedactionCounts {
  return { form_field: 0, password: 0, readonly_or_code: 0, credential_area: 0, copy_linked: 0, identity_text: 0, chrome_region: 0 };
}
const PASS: RawRedactionReport[] = [{ bodyPresent: true, overlayCount: 2, integrityOk: true, detected: { ...zero(), form_field: 2 }, covered: { ...zero(), form_field: 2 } }];
const FAIL: RawRedactionReport[] = [{ bodyPresent: true, overlayCount: 0, integrityOk: true, detected: { ...zero(), form_field: 1 }, covered: { ...zero(), form_field: 0 } }];
const RAW: RawVisualSummary = { controls: [], census: { passwordFieldPresent: false, submitAffordancePresent: false, formCount: 1, editableTextInputCount: 1, readonlyFieldCount: 0, listLikeContainerCount: 2 } };

interface Harness {
  deps: VisualReconSessionDeps;
  calls: { screenshot: string[]; commit: string[]; discard: string[]; persisted: SanitizedVisualSummary[]; apply: number; verify: number };
}

/**
 * Build a fake session. `signals` maps each screen (in VISUAL_RECON_SCREENS order) to a checkpoint signal.
 * `applyQ` / `verifyQ` are consumed in call order to script the redaction reports for the apply pass and each
 * verify pass (gate verify, then post-shot verify).
 */
function harness(opts: { signals: VisualCheckpointSignal[]; applyQ: RawRedactionReport[][]; verifyQ: RawRedactionReport[][] }): Harness {
  const calls = { screenshot: [] as string[], commit: [] as string[], discard: [] as string[], persisted: [] as SanitizedVisualSummary[], apply: 0, verify: 0 };
  let sigIdx = 0;
  const applyQ = [...opts.applyQ];
  const verifyQ = [...opts.verifyQ];
  const deps: VisualReconSessionDeps = {
    urlCategory: "api_center_host",
    waitForScreenSentinel: async () => opts.signals[sigIdx++] ?? "timeout",
    applyRedactionAllFrames: async () => {
      calls.apply += 1;
      return applyQ.shift() ?? FAIL;
    },
    verifyRedactionAllFrames: async () => {
      calls.verify += 1;
      return verifyQ.shift() ?? FAIL;
    },
    screenshotRedactedViewport: async (scr) => {
      calls.screenshot.push(scr);
      return { taken: true };
    },
    commitScreenshot: async (scr) => {
      calls.commit.push(scr);
    },
    discardScreenshot: async (scr) => {
      calls.discard.push(scr);
    },
    readRawSummary: async () => RAW,
    readViewport: async () => ({ w: 1280, h: 800 }),
    persistSummary: async (s) => {
      calls.persisted.push(s);
    },
  };
  return { deps, calls };
}

describe("runVisualReconSession — screenshot only after redaction verifies", () => {
  it("captures a screen where apply + gate-verify + post-verify all pass (one screenshot)", async () => {
    const h = harness({ signals: ["ready", "skip", "skip", "skip"], applyQ: [PASS], verifyQ: [PASS, PASS] });
    const r = await runVisualReconSession(h.deps);
    expect(h.calls.screenshot).toEqual(["app_list"]);
    expect(h.calls.commit).toEqual(["app_list"]); // buffer committed to disk only after post-shot verify
    expect(h.calls.discard).toEqual([]);
    expect(r.screenshotsTaken).toBe(1);
    expect(r.screensSkipped).toBe(3);
    expect(h.calls.persisted[0]!.screenshot.taken).toBe(true);
  });

  it("HALTS at the apply verdict — no screenshot, records a screenshot-less summary", async () => {
    const h = harness({ signals: ["ready", "skip", "skip", "skip"], applyQ: [FAIL], verifyQ: [] });
    const r = await runVisualReconSession(h.deps);
    expect(h.calls.screenshot).toEqual([]);
    expect(h.calls.verify).toBe(0); // never even reached the gate verify
    expect(r.screenshotsTaken).toBe(0);
    expect(r.screensHalted).toBe(1);
    expect(h.calls.persisted[0]!.screenshot.taken).toBe(false);
  });

  it("HALTS at the gate verify even when apply looked clean", async () => {
    const h = harness({ signals: ["ready", "skip", "skip", "skip"], applyQ: [PASS], verifyQ: [FAIL] });
    const r = await runVisualReconSession(h.deps);
    expect(h.calls.screenshot).toEqual([]);
    expect(r.screensHalted).toBe(1);
  });

  it("DISCARDS the screenshot when the overlays regress AFTER the shot", async () => {
    const h = harness({ signals: ["ready", "skip", "skip", "skip"], applyQ: [PASS], verifyQ: [PASS, FAIL] });
    const r = await runVisualReconSession(h.deps);
    expect(h.calls.screenshot).toEqual(["app_list"]); // buffer was captured …
    expect(h.calls.commit).toEqual([]); // … never written to disk …
    expect(h.calls.discard).toEqual(["app_list"]); // … and dropped unwritten
    expect(r.screenshotsTaken).toBe(0);
    expect(r.screensHalted).toBe(1);
    expect(h.calls.persisted[0]!.screenshot.taken).toBe(false);
  });

  it("takes at most ONE screenshot per operator ready", async () => {
    const h = harness({ signals: ["ready", "ready", "skip", "skip"], applyQ: [PASS, PASS], verifyQ: [PASS, PASS, PASS, PASS] });
    await runVisualReconSession(h.deps);
    expect(h.calls.screenshot.length).toBe(2); // exactly one per ready screen, never more
    expect(h.calls.commit.length).toBe(2);
    expect(new Set(h.calls.screenshot).size).toBe(2);
  });

  it("skip advances without redacting or screenshotting", async () => {
    const h = harness({ signals: ["skip", "skip", "skip", "skip"], applyQ: [], verifyQ: [] });
    const r = await runVisualReconSession(h.deps);
    expect(h.calls.apply).toBe(0);
    expect(h.calls.screenshot).toEqual([]);
    expect(r.screensSkipped).toBe(4);
  });

  it("abort stops the walk immediately", async () => {
    const h = harness({ signals: ["ready", "abort", "ready", "ready"], applyQ: [PASS], verifyQ: [PASS, PASS] });
    const r = await runVisualReconSession(h.deps);
    expect(r.aborted).toBe(true);
    expect(h.calls.screenshot).toEqual(["app_list"]); // first screen captured, then abort halted the rest
    expect(r.screensWalked).toBe(1);
  });

  it("timeout ends the walk (no screenshot for the timed-out screen)", async () => {
    const h = harness({ signals: ["timeout", "ready", "ready", "ready"], applyQ: [], verifyQ: [] });
    const r = await runVisualReconSession(h.deps);
    expect(h.calls.screenshot).toEqual([]);
    expect(r.screensWalked).toBe(0);
  });
});

describe("visual-recon artifact paths — confined to the gitignored sink", () => {
  it("screenshot + summary paths live under .calibration/visual/", () => {
    const dir = visualArtifactDirAbs();
    expect(dir.endsWith("/.calibration/visual")).toBe(true);
    expect(isSafeVisualArtifactPath(visualScreenshotAbsPath("vis_abc", "app_list"))).toBe(true);
    expect(isSafeVisualArtifactPath(visualSummaryAbsPath("vis_abc", "credentials"))).toBe(true);
  });

  it("rejects any path that escapes the sink", () => {
    expect(isSafeVisualArtifactPath(visualArtifactDirAbs() + "/../escape.png")).toBe(false);
    expect(isSafeVisualArtifactPath("/etc/passwd")).toBe(false);
  });
});
