/**
 * **Action Window R2 browser E2E (RUN_INTEGRATION=1).** The synthetic loopback E2E
 * (`session-integration.test.ts`) proven against a REAL Chromium page via `BrowserProbeDriver`, so
 * the same `ActionWindowSession` + transport drives an actual DOM: prepare → locate → highlight →
 * observe a real click → verify → downstream → completed. Gated so the default offline `npm test`
 * never launches a browser.
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/session-browser.test.ts
 *
 * The ONLY click on the target is the TEST-ONLY `page.click(...)` handed to the driver as
 * `simulateUserAction` — no production Action Window code clicks.
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

const RUN = process.env.RUN_INTEGRATION === "1";
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

describe.skipIf(!RUN)("Action Window R2 browser E2E (FE ↔ loopback ↔ Runtime ↔ Chromium)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("completes end-to-end on a real user click, only sanitized frames cross", async () => {
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

      await session.whenSettled(); // the real click was observed
      expect(fe.types()).toContain("USER_ACTION_OBSERVED");
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN"); // observation ≠ completion

      fe.send("REQUEST_STEP_RECHECK");
      await session.whenSettled();
      expect(fe.view?.status).toBe("COMPLETED");
      expect(fe.view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });

      for (const f of fe.frames) {
        expect(findProhibitedFields(f)).toEqual([]);
        if (f.kind === "aw_event") expect(validateEventEnvelope(f.event)).toEqual({ ok: true });
        if (f.kind === "aw_view") expect(validateRunView(f.view)).toEqual({ ok: true });
      }
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
});
