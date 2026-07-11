/**
 * **NAVER-shaped review-export browser proof (RUN_INTEGRATION=1; headed = AW_HEADED=1).** The R4
 * boot-wiring slice's operator-facing evidence (r4-preparation §6 "Overlay + observation", §8 item 3):
 * the same `ActionWindowSession` drives a REAL Chromium page shaped like a seller-center review export
 * surface (a synthetic review list + an Excel-download control) via `BrowserProbeDriver`. The user's
 * real click fires a REAL synthetic-OOXML download; the Runtime detects it read-only, quarantine-validates
 * it (temporary save → OOXML sniff → DELETE), hands off to a synthetic OFFLINE ingest, and completes.
 * The real `/api/uploads` ingest is proven separately (offline injected upload in
 * `naver-session-integration.test.ts`; a gated local-backend CSV in `upload.test.ts`) — this proof never
 * touches the network and the page is 100% synthetic (no marketplace trademark/markup/seller data).
 *
 *   # automated (TEST-ONLY simulated click), headless:
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/naver-browser.test.ts
 *
 *   # headed operator proof — a HUMAN performs the real review-export click in the visible window
 *   # (run ONLY with a seated operator; not part of the default or CI suite):
 *   RUN_INTEGRATION=1 AW_HEADED=1 npx vitest run test/action-window/naver-browser.test.ts
 *
 * The ONLY click on the target is either the TEST-ONLY `page.click(...)` (automated) or the real human
 * click (headed). No production Action Window code clicks — the Runtime only observes.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { NAVER_CHANNEL_CODE, NAVER_RUN_COPY_KEY } from "../../src/action-window/naver-driver";
import { overlayMounted } from "../../src/action-window/overlay";

const RUN = process.env.RUN_INTEGRATION === "1";
const HEADED = process.env.AW_HEADED === "1";
const RUN_ID = "run_naver_be2e";
const clickTarget = (page: Page) => page.click("[data-aw-target]"); // TEST-ONLY user simulation
const HEADED_CLICK_WAIT_MS = 240_000;

/** No fixture page string — review rows, control wording, artifact naming, OOXML — may cross the wire. */
const WIRE_NEEDLES = [
  "리뷰 관리",
  "합성",
  "엑셀",
  "다운로드",
  "별점",
  "synthetic-review-export",
  ".xlsx",
  "content_types",
  "blob:",
  "data:",
  "filename",
  "suggested",
  "/users/",
  "/home/",
  "file://",
];

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

async function announceHeadedWindow(page: Page, proofTitle: string, instruction: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`\n${"=".repeat(72)}\n[${proofTitle}]\n👉 ${instruction}\n${"=".repeat(72)}\n`);
  await page.evaluate(
    (args: { title: string; text: string }) => {
      document.title = args.title;
      const banner = document.createElement("div");
      banner.id = "aw-headed-banner";
      banner.textContent = args.text;
      banner.setAttribute(
        "style",
        "position:fixed;top:0;left:0;right:0;z-index:2147483646;background:#166534;color:#fff;" +
          "font:700 15px/1.5 system-ui;padding:10px 16px;text-align:center;pointer-events:none;",
      );
      document.body.appendChild(banner);
    },
    { title: proofTitle, text: `${proofTitle} — ${instruction}` },
  );
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += 150) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return predicate();
}

function assertSanitized(fe: FeClient): void {
  const wire = JSON.stringify(fe.frames).toLowerCase();
  for (const needle of WIRE_NEEDLES) expect(wire.includes(needle.toLowerCase()), `wire leaked "${needle}"`).toBe(false);
  for (const f of fe.frames) {
    expect(findProhibitedFields(f)).toEqual([]);
    if (f.kind === "aw_event") expect(validateEventEnvelope(f.event)).toEqual({ ok: true });
    if (f.kind === "aw_view") expect(validateRunView(f.view)).toEqual({ ok: true });
  }
}

describe.skipIf(!RUN)("NAVER-shaped review-export browser proof (FE ↔ loopback ↔ Runtime ↔ Chromium)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: !HEADED });
  });
  afterAll(async () => {
    await browser?.close();
  });

  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  function tmpQuarantine(): string {
    const dir = mkdtempSync(join(tmpdir(), "aw-naver-browser-q-"));
    dirs.push(dir);
    return dir;
  }

  it("automated: simulated click → real download → quarantine validate → offline ingest → COMPLETED", async () => {
    const page = await browser.newPage();
    const quarantineDir = tmpQuarantine();
    try {
      const channel = createLoopbackChannel();
      const engine = new ActionWindowEngine({ runId: RUN_ID, channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY });
      const driver = new BrowserProbeDriver(page, {
        mode: "naver-review-export-xlsx",
        simulateUserAction: clickTarget, // TEST-ONLY: the user's click fires the download
        observeTimeoutMs: 5000,
        downstream: { realDetection: { timeoutMs: 10_000 }, quarantine: { dir: quarantineDir } },
      });
      const session = new ActionWindowSession(engine, driver, channel.server);
      session.attach();
      const fe = new FeClient(channel.client);

      fe.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
      await session.whenSettled();
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
      expect(fe.view?.channelCode).toBe(NAVER_CHANNEL_CODE);
      expect(await overlayMounted(page)).toBe(true);

      expect(await waitFor(() => fe.types().includes("USER_ACTION_OBSERVED"), 10_000)).toBe(true);
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN"); // observation ≠ completion

      fe.send("REQUEST_STEP_RECHECK");
      expect(await waitFor(() => fe.view?.status === "COMPLETED", 20_000)).toBe(true);
      expect(fe.view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });

      const detected = fe.events.find((e) => e.type === "DOWNLOAD_DETECTED");
      expect(detected?.payload.artifactRef).toMatch(/^[0-9a-f]{16}$/);
      // delete-after-validate held on the REAL filesystem; nothing lingers.
      expect(readdirSync(quarantineDir)).toEqual([]);
      expect(JSON.stringify(fe.frames).includes(quarantineDir)).toBe(false);
      assertSanitized(fe);
      expect(await overlayMounted(page)).toBe(false);
    } finally {
      await page.close();
    }
  });

  it("automated: an xlsx-named download whose bytes are not OOXML fails closed ARTIFACT_INVALID; dir empty", async () => {
    const page = await browser.newPage();
    const quarantineDir = tmpQuarantine();
    try {
      const channel = createLoopbackChannel();
      const engine = new ActionWindowEngine({ runId: RUN_ID, channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY });
      // Reuse the generic bad-magic surface (xlsx-named, non-OOXML) to drive the fail-closed path.
      const driver = new BrowserProbeDriver(page, {
        mode: "download-badmagic",
        simulateUserAction: clickTarget,
        observeTimeoutMs: 5000,
        downstream: { realDetection: { timeoutMs: 10_000 }, quarantine: { dir: quarantineDir } },
      });
      const session = new ActionWindowSession(engine, driver, channel.server);
      session.attach();
      const fe = new FeClient(channel.client);

      fe.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
      await session.whenSettled();
      expect(await waitFor(() => fe.types().includes("USER_ACTION_OBSERVED"), 10_000)).toBe(true);
      fe.send("REQUEST_STEP_RECHECK");
      expect(await waitFor(() => fe.view?.status === "FAILED", 20_000)).toBe(true);

      expect(fe.view?.blocker?.code).toBe("ARTIFACT_INVALID");
      expect(fe.types()).toContain("DOWNLOAD_DETECTED"); // detection succeeded; validation failed closed
      expect(fe.types()).not.toContain("RUN_COMPLETED");
      expect(readdirSync(quarantineDir)).toEqual([]); // hostile artifact still deleted
      for (const f of fe.frames) expect(findProhibitedFields(f)).toEqual([]);
      expect(await overlayMounted(page)).toBe(false);
    } finally {
      await page.close();
    }
  });

  // Headed operator proof: a HUMAN clicks the highlighted review-export control in the visible window.
  // No simulateUserAction — the session waits on the real observer, so the click is genuinely the user's.
  it.skipIf(!HEADED)("headed: a REAL human review-export click drives detect → quarantine → completion", async () => {
    const page = await browser.newPage();
    const quarantineDir = tmpQuarantine();
    try {
      const channel = createLoopbackChannel();
      const engine = new ActionWindowEngine({ runId: RUN_ID, channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY });
      const driver = new BrowserProbeDriver(page, {
        mode: "naver-review-export-xlsx",
        observeTimeoutMs: HEADED_CLICK_WAIT_MS, // no simulateUserAction — only the human clicks
        downstream: { realDetection: { timeoutMs: 30_000 }, quarantine: { dir: quarantineDir } },
      });
      const session = new ActionWindowSession(engine, driver, channel.server);
      session.attach();
      const fe = new FeClient(channel.client);

      fe.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
      await session.whenSettled();
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
      expect(fe.view?.currentStep?.status).toBe("AWAITING_USER");
      expect(await overlayMounted(page)).toBe(true);
      await announceHeadedWindow(page, "R4 NAVER REVIEW-EXPORT PROOF", "Click the highlighted 엑셀 다운로드 control — your click fires the export download.");

      // Wait for the REAL user action (no Runtime click). Observation must NOT complete the step.
      expect(await waitFor(() => fe.types().includes("USER_ACTION_OBSERVED"), HEADED_CLICK_WAIT_MS)).toBe(true);
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
      expect(fe.types()).not.toContain("STEP_COMPLETED");

      // Recheck → verify → real detect → quarantine validate → offline ingest → completed.
      fe.send("REQUEST_STEP_RECHECK");
      expect(await waitFor(() => fe.view?.status === "COMPLETED", 40_000)).toBe(true);
      expect(fe.view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
      const detected = fe.events.find((e) => e.type === "DOWNLOAD_DETECTED");
      expect(detected?.payload.artifactRef).toMatch(/^[0-9a-f]{16}$/);
      expect(readdirSync(quarantineDir)).toEqual([]);
      assertSanitized(fe);
      expect(await overlayMounted(page)).toBe(false);
      expect(await page.evaluate(() => "__aw_observed__" in window)).toBe(false);
    } finally {
      await page.close();
    }
  }, HEADED_CLICK_WAIT_MS + 100_000);
});
