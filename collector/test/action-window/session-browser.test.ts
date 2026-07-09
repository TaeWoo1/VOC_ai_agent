/**
 * **Action Window R2 browser E2E (RUN_INTEGRATION=1).** The synthetic loopback E2E
 * (`session-integration.test.ts`) proven against a REAL Chromium page via `BrowserProbeDriver`, so
 * the same `ActionWindowSession` + transport drives an actual DOM: prepare → locate → highlight →
 * observe a click → verify → downstream → completed. Includes the R4 fixture download ladder: the
 * user's click fires a REAL synthetic-blob download that is detected read-only (opaque ref only,
 * artifact discarded), the no-download → DOWNLOAD_TIMEOUT path, and an operator-cancel abort drill.
 * Gated so the default offline `npm test` never launches a browser.
 *
 *   # automated (TEST-ONLY simulated click), headless:
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/session-browser.test.ts
 *
 *   # headed operator proof — a HUMAN performs the real fixture click in the visible window:
 *   RUN_INTEGRATION=1 AW_HEADED=1 npx vitest run test/action-window/session-browser.test.ts
 *
 * The ONLY click on the target is either the TEST-ONLY `page.click(...)` (automated case) or the real
 * human click (headed case). No production Action Window code clicks — the Runtime only observes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  findProhibitedFields,
  validateEventEnvelope,
  validateRunView,
  type ActionWindowRunView,
  type CommandEnvelope,
  type CommandType,
  type EventEnvelope,
} from "../../../contracts/action-window/v1/index";
import { createLoopbackChannel, type AwClientTransport, type AwServerFrame } from "../../../contracts/action-window/v1/transport";
import { ActionWindowEngine } from "../../src/action-window/engine";
import { ActionWindowSession } from "../../src/action-window/session";
import { BrowserProbeDriver } from "../../src/action-window/browser-driver";
import { overlayMounted } from "../../src/action-window/overlay";

const RUN = process.env.RUN_INTEGRATION === "1";
const HEADED = process.env.AW_HEADED === "1";
const RUN_ID = "run_be2e";
const clickTarget = (page: Page) => page.click("[data-aw-target]"); // TEST-ONLY user simulation

class FeClient {
  view: ActionWindowRunView | null = null;
  events: EventEnvelope[] = [];
  frames: AwServerFrame[] = [];
  private cmdSeq = 0;
  constructor(private readonly transport: AwClientTransport) {
    transport.subscribe((f) => {
      this.frames.push(f);
      if (f.kind === "aw_event") this.events.push(f.event);
      if (f.kind === "aw_view" && (this.view === null || f.view.revision >= this.view.revision)) this.view = f.view;
    });
  }
  send(type: CommandType, payload?: CommandEnvelope["payload"]): void {
    this.transport.send({
      kind: "aw_command",
      command: {
        protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
        commandId: `${RUN_ID}-c${++this.cmdSeq}`,
        runId: RUN_ID,
        expectedRevision: this.view?.revision ?? 0,
        type,
        ...(payload ? { payload } : {}),
      },
    });
  }
  types(): string[] {
    return this.events.map((e) => e.type);
  }
}

/** Headed-only wait for the REAL human click (was 120s; raised after an operator-visibility miss). */
const HEADED_CLICK_WAIT_MS = 240_000;

/**
 * TEST-ONLY headed ergonomics: title the window and pin a fixed, non-interactive banner so the
 * operator can tell WHICH proof window they are looking at. `pointer-events:none` + `position:fixed`
 * — the banner can never intercept the click or shift the target/overlay layout.
 */
async function announceHeadedWindow(page: Page, windowLabel: string, proofTitle: string, instruction: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\n${"=".repeat(72)}\n[${windowLabel}] ${proofTitle}\n👉 ${instruction}\n${"=".repeat(72)}\n`);
  await page.evaluate(
    (args: { title: string; text: string }) => {
      document.title = args.title;
      const banner = document.createElement("div");
      banner.id = "aw-headed-banner";
      banner.textContent = args.text;
      banner.setAttribute(
        "style",
        "position:fixed;top:0;left:0;right:0;z-index:2147483646;background:#b91c1c;color:#fff;" +
          "font:700 15px/1.5 system-ui;padding:10px 16px;text-align:center;pointer-events:none;",
      );
      document.body.appendChild(banner);
    },
    { title: `${windowLabel} — ${proofTitle}`, text: `${windowLabel} · ${proofTitle} — ${instruction}` },
  );
}

/** Poll until `predicate` holds or the timeout elapses (used to await a real human click). */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = timeoutMs;
  for (let waited = 0; waited < deadline; waited += 150) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return predicate();
}

describe.skipIf(!RUN)("Action Window R2 browser E2E (FE ↔ loopback ↔ Runtime ↔ Chromium)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: !HEADED });
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("completes end-to-end on a simulated click, only sanitized frames cross", async () => {
    const page = await browser.newPage();
    try {
      const channel = createLoopbackChannel();
      const engine = new ActionWindowEngine({ runId: RUN_ID, channelCode: "synthetic", runCopyKey: "actionWindow.run.synthetic" });
      const driver = new BrowserProbeDriver(page, { mode: "normal", simulateUserAction: clickTarget, observeTimeoutMs: 5000 });
      const session = new ActionWindowSession(engine, driver, channel.server);
      session.attach();
      const fe = new FeClient(channel.client);

      fe.send("START_RUN", { channelCode: "synthetic" });
      await session.whenSettled(); // reached the human checkpoint barrier
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
      expect(await overlayMounted(page)).toBe(true);

      // The (simulated) click is real DOM I/O — wait for the observation event, not an auto-drive settle.
      expect(await waitFor(() => fe.types().includes("USER_ACTION_OBSERVED"), 10_000)).toBe(true);
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN"); // observation ≠ completion

      fe.send("REQUEST_STEP_RECHECK");
      expect(await waitFor(() => fe.view?.status === "COMPLETED", 10_000)).toBe(true);
      expect(fe.view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });

      for (const f of fe.frames) {
        expect(findProhibitedFields(f)).toEqual([]);
        if (f.kind === "aw_event") expect(validateEventEnvelope(f.event)).toEqual({ ok: true });
        if (f.kind === "aw_view") expect(validateRunView(f.view)).toEqual({ ok: true });
      }
      // cleanup: overlay removed, observation flag cleared
      expect(await overlayMounted(page)).toBe(false);
      expect(await page.evaluate(() => "__aw_observed__" in window)).toBe(false);
    } finally {
      await page.close();
    }
  });

  it("detects a REAL fixture download read-only and completes with an opaque artifact ref only", async () => {
    const page = await browser.newPage();
    try {
      const channel = createLoopbackChannel();
      const engine = new ActionWindowEngine({ runId: RUN_ID, channelCode: "synthetic", runCopyKey: "actionWindow.run.synthetic" });
      const driver = new BrowserProbeDriver(page, {
        mode: "download",
        simulateUserAction: clickTarget, // TEST-ONLY: the user's click is what fires the download
        observeTimeoutMs: 5000,
        downstream: { realDetection: { timeoutMs: 10_000 } },
      });
      const session = new ActionWindowSession(engine, driver, channel.server);
      session.attach();
      const fe = new FeClient(channel.client);

      fe.send("START_RUN", { channelCode: "synthetic" });
      await session.whenSettled();
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
      expect(await waitFor(() => fe.types().includes("USER_ACTION_OBSERVED"), 10_000)).toBe(true);

      fe.send("REQUEST_STEP_RECHECK");
      expect(await waitFor(() => fe.view?.status === "COMPLETED", 15_000)).toBe(true);

      // A REAL browser download fired and was observed read-only: opaque 16-hex ref, nothing else.
      const detected = fe.events.find((e) => e.type === "DOWNLOAD_DETECTED");
      expect(detected?.payload.artifactRef).toMatch(/^[0-9a-f]{16}$/);
      const wire = JSON.stringify(fe.frames);
      for (const needle of ["synthetic-export", ".txt", "blob:", "data:", "filename", "suggested", "http://", "https://", "file://", "/Users/", "/home/", "selector"]) {
        expect(wire).not.toContain(needle);
      }
      for (const f of fe.frames) expect(findProhibitedFields(f)).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it("fails closed with DOWNLOAD_TIMEOUT when the verified action fires no download", async () => {
    const page = await browser.newPage();
    try {
      const channel = createLoopbackChannel();
      const engine = new ActionWindowEngine({ runId: RUN_ID, channelCode: "synthetic", runCopyKey: "actionWindow.run.synthetic" });
      const driver = new BrowserProbeDriver(page, {
        mode: "download-none",
        simulateUserAction: clickTarget,
        observeTimeoutMs: 5000,
        downstream: { realDetection: { timeoutMs: 1500 } },
      });
      const session = new ActionWindowSession(engine, driver, channel.server);
      session.attach();
      const fe = new FeClient(channel.client);

      fe.send("START_RUN", { channelCode: "synthetic" });
      await session.whenSettled();
      expect(await waitFor(() => fe.types().includes("USER_ACTION_OBSERVED"), 10_000)).toBe(true);
      fe.send("REQUEST_STEP_RECHECK");
      expect(await waitFor(() => fe.view?.status === "FAILED", 15_000)).toBe(true);

      expect(fe.view?.blocker?.code).toBe("DOWNLOAD_TIMEOUT");
      expect(fe.types()).not.toContain("DOWNLOAD_DETECTED");
      expect(fe.types()).not.toContain("RUN_COMPLETED");
      expect(fe.view?.progress).toEqual({ completedSteps: 2, totalSteps: 3 }); // human step verified, downstream failed
      for (const f of fe.frames) expect(findProhibitedFields(f)).toEqual([]);
      // Fail-closed cleanup: no overlay or observer left behind.
      expect(await overlayMounted(page)).toBe(false);
    } finally {
      await page.close();
    }
  });

  it("abort drill: an operator cancel at the checkpoint tears down cleanly (no click ever issued)", async () => {
    const page = await browser.newPage();
    try {
      const channel = createLoopbackChannel();
      const engine = new ActionWindowEngine({ runId: RUN_ID, channelCode: "synthetic", runCopyKey: "actionWindow.run.synthetic" });
      const driver = new BrowserProbeDriver(page, { mode: "download", observeTimeoutMs: 60_000, downstream: { realDetection: {} } });
      const session = new ActionWindowSession(engine, driver, channel.server);
      session.attach();
      const fe = new FeClient(channel.client);

      fe.send("START_RUN", { channelCode: "synthetic" });
      await session.whenSettled();
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
      expect(await overlayMounted(page)).toBe(true);

      fe.send("CANCEL_RUN"); // the operator walks away — no user action ever happens
      expect(await waitFor(() => fe.view?.status === "CANCELLED", 10_000)).toBe(true);
      expect(fe.types()).not.toContain("USER_ACTION_OBSERVED");
      expect(fe.types()).not.toContain("DOWNLOAD_DETECTED");
      expect(fe.view?.allowedCommands).toEqual([]);
      expect(await overlayMounted(page)).toBe(false);
      expect(await page.evaluate(() => "__aw_observed__" in window)).toBe(false);
    } finally {
      await page.close();
    }
  });

  it("fails closed on an ambiguous target (no user step reached)", async () => {
    const page = await browser.newPage();
    try {
      const channel = createLoopbackChannel();
      const engine = new ActionWindowEngine({ runId: RUN_ID, channelCode: "synthetic", runCopyKey: "actionWindow.run.synthetic" });
      const driver = new BrowserProbeDriver(page, { mode: "multi-candidate", observeTimeoutMs: 1500 });
      const session = new ActionWindowSession(engine, driver, channel.server);
      session.attach();
      const fe = new FeClient(channel.client);

      fe.send("START_RUN", { channelCode: "synthetic" });
      await session.whenSettled();
      expect(fe.view?.status).toBe("FAILED");
      expect(fe.view?.blocker?.code).toBe("TARGET_AMBIGUOUS");
      expect(fe.types()).not.toContain("USER_ACTION_OBSERVED");
    } finally {
      await page.close();
    }
  });

  // Headed operator proof: a HUMAN clicks the highlighted target in the visible window. No
  // simulateUserAction — the session waits on the real observer, so the click is genuinely the user's.
  it.skipIf(!HEADED)("headed: a REAL human click drives the loop to completion, then cleans up", async () => {
    const page = await browser.newPage();
    try {
      const channel = createLoopbackChannel();
      const engine = new ActionWindowEngine({ runId: RUN_ID, channelCode: "synthetic", runCopyKey: "actionWindow.run.synthetic" });
      const driver = new BrowserProbeDriver(page, { mode: "normal", observeTimeoutMs: HEADED_CLICK_WAIT_MS }); // no simulateUserAction
      const session = new ActionWindowSession(engine, driver, channel.server);
      session.attach();
      const fe = new FeClient(channel.client);

      // 1) FE/controller starts the Run; Runtime reaches the human checkpoint with a visible overlay.
      fe.send("START_RUN", { channelCode: "synthetic" });
      await session.whenSettled();
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
      expect(fe.view?.currentStep?.status).toBe("AWAITING_USER");
      expect(await overlayMounted(page)).toBe(true);
      await announceHeadedWindow(page, "window 1 of 2", "R2A NORMAL PROOF", "Click the highlighted 내보내기 button in THIS window now.");

      // 2) Wait for the REAL user action (no Runtime click). Observation must NOT complete the step.
      const observed = await waitFor(() => fe.types().includes("USER_ACTION_OBSERVED"), HEADED_CLICK_WAIT_MS);
      expect(observed).toBe(true);
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
      expect(fe.types()).not.toContain("STEP_COMPLETED");

      // 3) Recheck → verify → dummy downstream → completed; latest view reaches the FE adapter.
      fe.send("REQUEST_STEP_RECHECK");
      const completed = await waitFor(() => fe.view?.status === "COMPLETED", 15_000);
      expect(completed).toBe(true);
      expect(fe.view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
      expect(fe.view?.blocker).toBeUndefined();

      // 4) Sanitization + cleanup (no leftover overlay/observer resources).
      for (const f of fe.frames) {
        expect(findProhibitedFields(f)).toEqual([]);
        if (f.kind === "aw_event") expect(validateEventEnvelope(f.event)).toEqual({ ok: true });
        if (f.kind === "aw_view") expect(validateRunView(f.view)).toEqual({ ok: true });
      }
      expect(await overlayMounted(page)).toBe(false);
      expect(await page.evaluate(() => "__aw_observed__" in window)).toBe(false);
    } finally {
      await page.close();
    }
  }, HEADED_CLICK_WAIT_MS + 60_000);

  // Headed download proof: the HUMAN's click on the highlighted control fires a REAL browser
  // download; the Runtime only observes it (read-only), reports an opaque ref, and discards it.
  it.skipIf(!HEADED)("headed: a REAL human click fires a real download, detected read-only", async () => {
    const page = await browser.newPage();
    try {
      const channel = createLoopbackChannel();
      const engine = new ActionWindowEngine({ runId: RUN_ID, channelCode: "synthetic", runCopyKey: "actionWindow.run.synthetic" });
      const driver = new BrowserProbeDriver(page, {
        mode: "download",
        observeTimeoutMs: HEADED_CLICK_WAIT_MS, // no simulateUserAction — only the human clicks
        downstream: { realDetection: { timeoutMs: 30_000 } },
      });
      const session = new ActionWindowSession(engine, driver, channel.server);
      session.attach();
      const fe = new FeClient(channel.client);

      fe.send("START_RUN", { channelCode: "synthetic" });
      await session.whenSettled();
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
      expect(await overlayMounted(page)).toBe(true);
      await announceHeadedWindow(page, "window 2 of 2", "R4 DOWNLOAD PROOF", "Click the highlighted 내보내기 control — your click fires the download.");

      expect(await waitFor(() => fe.types().includes("USER_ACTION_OBSERVED"), HEADED_CLICK_WAIT_MS)).toBe(true);
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN"); // observation ≠ completion

      fe.send("REQUEST_STEP_RECHECK");
      expect(await waitFor(() => fe.view?.status === "COMPLETED", 40_000)).toBe(true);
      const detected = fe.events.find((e) => e.type === "DOWNLOAD_DETECTED");
      expect(detected?.payload.artifactRef).toMatch(/^[0-9a-f]{16}$/);
      const wire = JSON.stringify(fe.frames);
      for (const needle of ["synthetic-export", ".txt", "blob:", "data:", "filename", "suggested", "http://", "file://", "/Users/"]) expect(wire).not.toContain(needle);
      for (const f of fe.frames) expect(findProhibitedFields(f)).toEqual([]);
      expect(await overlayMounted(page)).toBe(false);
    } finally {
      await page.close();
    }
  }, HEADED_CLICK_WAIT_MS + 100_000);
});
