/**
 * **WING-RESIDENT overlay browser E2E (RUN_INTEGRATION=1).** The offline proof that the guided Coupang WING
 * issuance walk is driven ON the WING page — the overlay's own advance button — not by the SellerOps FE.
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/coupang-issuance/coupang-wing-resident-overlay.browser.test.ts
 *
 * Fully SYNTHETIC and offline: a real headless Chromium renders a synthetic page served (via page.route) at a
 * wing.coupang.com URL — NO network, NO live WING, NO credential, NO approval. It proves two things on a REAL DOM:
 *
 *   1. The overlay advance affordance: mountOverlay draws a guidance panel + advance button, a REAL click on it
 *      flips the value-free latch (readOverlayAdvancePressed false→true), reset re-arms it per step, and unmount
 *      clears it — while the spotlight RING stays pointer-events:none.
 *   2. The full guided walk completes driven ONLY by real clicks on the WING-resident advance button: a single
 *      START_RUN, then the "seller" clicks the on-page button at each checkpoint — never a REQUEST_STEP_RECHECK.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  mountOverlay,
  unmountOverlay,
  overlayMounted,
  advancePanelMounted,
  resetOverlayAdvance,
  readOverlayAdvancePressed,
} from "../../../src/action-window/overlay";
import { CoupangWingIssuanceDriver } from "../../../src/action-window/coupang-wing-issuance-driver";
import { CoupangIssuanceEngine, makeCoupangIssuanceClock } from "../../../src/action-window/coupang-issuance/coupang-issuance-engine";
import { CoupangIssuanceGuidanceSession } from "../../../src/action-window/coupang-issuance/coupang-issuance-session";
import type { AwClientFrame, AwServerFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import type { ActionWindowRunView } from "../../../../contracts/action-window/v2/index";

const RUN = process.env.RUN_INTEGRATION === "1";

/**
 * A synthetic WING open-API issuance page. Each highlight label is exposed via a UNIQUE `aria-label` (with
 * DIFFERENT visible text) so the value-free fixed-label locate resolves to exactly one element. The "Access Key"
 * anchor makes the value-free classifier read this as `open_api_issuance` (so the walk skips the reach step and
 * guides 자체개발 first). No password field ⇒ not login. There are NO real credential values anywhere.
 */
const WING_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>오픈API</title></head>
<body>
  <h1 aria-label="오픈API 키 발급">개발자 센터</h1>
  <form>
    <fieldset>
      <button type="button" aria-label="자체개발">개발 유형 선택</button>
      <span aria-label="업체명">사업자 정보</span>
      <span aria-label="호출 IP">허용 IP 입력란</span>
      <button type="button" aria-label="발급">키 생성</button>
    </fieldset>
    <table><tbody>
      <tr><th aria-label="Access Key">키 이름</th><td>••••••••</td></tr>
    </tbody></table>
  </form>
</body></html>`;

let browser: Browser;
beforeAll(async () => {
  if (!RUN) return;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

async function wingPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: WING_HTML }));
  await page.goto("https://wing.coupang.com/vendor/open-api");
  return page;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe.skipIf(!RUN)("WING-resident overlay — advance affordance on a real DOM", () => {
  it("draws a guidance panel + advance button, a real click flips the value-free latch, reset re-arms, unmount clears", async () => {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body><button data-aw-target>여기</button></body></html>`);

    await mountOverlay(page, {
      stepNumber: 2,
      totalSteps: 7,
      copyKey: "actionWindow.coupangIssuance.step.self_dev",
      label: "표시된 '자체개발' 옵션을 선택하세요.",
      guidanceEnabled: true,
      advance: { buttonLabel: "다음", token: "tok-step-2" },
    });

    expect(await overlayMounted(page)).toBe(true);
    expect(await advancePanelMounted(page)).toBe(true);
    // The spotlight RING never intercepts a click; only the panel is interactive.
    expect(await page.evaluate(() => getComputedStyle(document.getElementById("__aw_overlay__")!).pointerEvents)).toBe("none");
    expect(await page.evaluate(() => getComputedStyle(document.getElementById("__aw_advance_panel__")!).pointerEvents)).toBe("auto");

    // The latch starts un-pressed, and a REAL click on the on-page button flips it — value-free (token equality).
    expect(await readOverlayAdvancePressed(page, "tok-step-2")).toBe(false);
    await page.locator("#__aw_advance_panel__ button[data-aw-advance]").click();
    expect(await readOverlayAdvancePressed(page, "tok-step-2")).toBe(true);

    // Re-arming for the NEXT step drops the prior press so a stale click can never skip: the old token no longer
    // reads pressed, the new one only after a fresh click.
    await resetOverlayAdvance(page, "tok-step-3");
    expect(await readOverlayAdvancePressed(page, "tok-step-2")).toBe(false);
    expect(await readOverlayAdvancePressed(page, "tok-step-3")).toBe(false);
    await page.locator("#__aw_advance_panel__ button[data-aw-advance]").click();
    expect(await readOverlayAdvancePressed(page, "tok-step-3")).toBe(true);

    // Unmount tears down the panel and clears the latch.
    await unmountOverlay(page);
    expect(await advancePanelMounted(page)).toBe(false);
    expect(await readOverlayAdvancePressed(page, "tok-step-3")).toBe(false);
    await page.close();
  });

  it("a guidance-only step (no advance button) still shows the panel copy but exposes no button", async () => {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body><button data-aw-target>여기</button></body></html>`);
    await mountOverlay(page, {
      stepNumber: 1,
      totalSteps: 7,
      copyKey: "actionWindow.coupangIssuance.step.reach_open_api",
      label: "오픈API 키 발급 페이지로 이동하세요.",
      guidanceEnabled: true,
    });
    expect(await advancePanelMounted(page)).toBe(true);
    expect(await page.locator("#__aw_advance_panel__ button[data-aw-advance]").count()).toBe(0);
    await page.close();
  });
});

/** A loopback v2 transport that records the client frames the FE would send, so we can assert none was needed. */
function loopback() {
  const sent: AwServerFrame[] = [];
  let listener: ((frame: AwClientFrame) => void) | null = null;
  const transport: AwServerTransport = {
    send: (frame) => void sent.push(frame),
    subscribe: (l) => {
      listener = l;
      return () => (listener = null);
    },
  };
  return {
    transport,
    send: (f: AwClientFrame) => listener?.(f),
    commandResults: () => sent.filter((f) => f.kind === "aw_command_result"),
    lastView: () => {
      const vs = sent.filter((f) => f.kind === "aw_view");
      return (vs[vs.length - 1] as { view: ActionWindowRunView } | undefined)?.view;
    },
  };
}

describe.skipIf(!RUN)("WING-resident overlay — the guided walk completes on real on-page clicks ALONE", () => {
  it("a single START_RUN → the seller clicks the WING-resident advance button at each checkpoint → COMPLETED, no FE 다음", async () => {
    const page = await wingPage();
    const io = loopback();
    const engine = new CoupangIssuanceEngine({ runId: "run_wingres01", channelCode: "coupang" }, { clock: makeCoupangIssuanceClock() });
    // A real driver on the real page; short observe window so a stuck step fails fast instead of hanging 10 min.
    const driver = new CoupangWingIssuanceDriver(page, { observeTimeoutMs: 8000, verifyPollMs: 0 });
    const session = new CoupangIssuanceGuidanceSession(engine, driver, io.transport, { rearmDelayMs: 20 });
    session.attach();

    // The ONLY command: a single START_RUN.
    io.send({
      kind: "aw_command",
      command: { protocolVersion: 2, commandId: "start", runId: "run_wingres01", expectedRevision: 0, type: "START_RUN", payload: { channelCode: "coupang", intent: "API_ISSUANCE_GUIDANCE" } },
    });

    // The seller works ON THE WING PAGE: whenever the WING-resident advance button is present, click it. This is
    // the whole product interaction — no SellerOps-tab step control is ever touched.
    const deadline = Date.now() + 30_000;
    while (engine.currentStage() !== "guidance_complete" && engine.currentStage() !== "operator_aborted" && Date.now() < deadline) {
      const btn = page.locator("#__aw_advance_panel__ button[data-aw-advance]");
      if ((await btn.count()) > 0) await btn.click({ timeout: 500 }).catch(() => undefined);
      await sleep(120);
    }
    await session.whenSettled();

    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
    // PROOF the FE never drove a step: the only command received was the single START_RUN.
    expect(io.commandResults()).toHaveLength(1);
    await page.close();
  }, 45_000);
});
