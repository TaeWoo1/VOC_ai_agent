/**
 * **A detection window that expired is not an answer about the run.**
 * — NAVER Guided Acquisition, live development loop 2026-09-02.
 *
 * The consent barrier awaits ONE cached download race. The race's deadline is 15 seconds; a seller reading
 * NAVER's own consent dialog routinely takes longer than that. When it expired, the resolved `false` stayed
 * cached, so every later poll of the barrier re-awaited the same answer instantly — the run could never
 * advance again, even once the file had arrived. Nothing in the trail said so: the barrier simply reported
 * "the seller has not acted" forever.
 *
 * Two halves, and both are needed:
 *
 *  1. the import driver DROPS a spent race so the next poll arms a new one;
 *  2. the proven driver KEEPS the underlying `waitForEvent("download")` listener across attempts, because
 *     Playwright delivers nothing that happened while no listener was armed — re-arming from scratch would
 *     lose exactly the download that arrived during the gap.
 */
import { describe, expect, it, vi } from "vitest";
import { NaverLiveImportDriver } from "../../../src/action-window/initial-import/naver-live-import-driver";
import type { DownloadDetectResult } from "../../../src/action-window/engine";

/** A composed driver stubbed to the download path: successive `detectDownload` answers, counted. */
function build(answers: DownloadDetectResult[]) {
  let call = 0;
  const detectDownload = vi.fn(async (): Promise<DownloadDetectResult> => {
    const at = Math.min(call, answers.length - 1);
    call += 1;
    return answers[at]!;
  });
  const ctx = { evaluate: vi.fn(async () => undefined) };
  const proven = {
    surfaceContext: () => ctx,
    surfacePage: () => ({ on: () => undefined }),
    detectDownload,
    armObserve: vi.fn(async () => undefined),
  };
  const driver = new NaverLiveImportDriver(proven as never, { guidanceEnabled: true });
  return { driver, detectDownload };
}

describe("the consent barrier can be polled more than once", () => {
  it("arms a NEW race after one expires, so a slow seller can still finish", async () => {
    const { driver, detectDownload } = build([{ detected: false }, { detected: true, artifactRef: "a".repeat(16) }]);
    await driver.armDownloadDetection();

    // First poll: the 15-second window expired while the seller was reading the dialog.
    expect(await driver.waitForTargetAction("consent")).toBe(false);
    // Second poll: this is the one that used to return the cached `false` forever.
    expect(await driver.waitForTargetAction("consent")).toBe(true);
    expect(detectDownload).toHaveBeenCalledTimes(2);
    expect((await driver.detectDownload()).detected).toBe(true);
  });

  it("keeps a DETECTED race — the artifact is read once and not re-raced", async () => {
    const { driver, detectDownload } = build([{ detected: true, artifactRef: "b".repeat(16) }]);
    await driver.armDownloadDetection();
    expect(await driver.waitForTargetAction("consent")).toBe(true);
    expect(await driver.waitForTargetAction("consent")).toBe(true);
    // One race, joined twice: a second race could contradict the first about the same file.
    expect(detectDownload).toHaveBeenCalledTimes(1);
  });
});
