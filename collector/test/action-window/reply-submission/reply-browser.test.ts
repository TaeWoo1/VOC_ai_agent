/**
 * **Reply-submission real-DOM seam proof (RUN_INTEGRATION=1; headless, fully automated).** Drives the
 * READ-ONLY `NaverReplySubmitProbeDriver` over a REAL Chromium page shaped like a NAVER reply-composer
 * surface (`replyComposerFixtureHtml`) — the reply analogue of `naver-live-browser.test.ts`, and the
 * top rung of the reply synthetic ladder ("live is never the first execution").
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/reply-submission/reply-browser.test.ts
 *
 * It is deliberately **fully automated / headless** — no `AW_HEADED`, no human. The ONLY click on the
 * page is the TEST-ONLY `page.click("#aw-reply-submit")` standing in for the seller's own submit; the
 * driver only annotates read-only, observes the boolean its capture-phase listener records, and
 * reports. The page is 100% synthetic (no marketplace trademark/markup/seller data) and NOTHING here
 * touches live NAVER or the network. The canary-laden fixture proves no page content ever crosses the
 * sanitized v2 boundary.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { findProhibitedFields } from "../../../../contracts/action-window/v2/index";
import { ReplyEngine, makeReplyClock } from "../../../src/action-window/reply-submission/reply-engine";
import { NaverReplySubmitProbeDriver } from "../../../src/action-window/reply-submission/naver-reply-driver";
import { REPLY_FIXTURE_CANARIES, replyComposerFixtureHtml } from "../../../src/action-window/reply-submission/reply-fixture";

const RUN = process.env.RUN_INTEGRATION === "1";
const HEX16 = /^[0-9a-f]{16}$/;
/** Short bound — the TEST clicks immediately, so no seated-human window is needed. */
const SUBMIT_TIMEOUT_MS = 20_000;

/** Drive a ReplyEngine to a terminal from real-driver outputs, mirroring `ReplySubmitSession.drive`. */
async function runEngineOverDriver(driver: NaverReplySubmitProbeDriver, runId: string) {
  const engine = new ReplyEngine({ runId, channelCode: "naver" }, { clock: makeReplyClock() });
  engine.command({ type: "START_RUN", expectedRevision: 0 });
  const surface = await driver.prepareSurface();
  const afterSurface = engine.onSurfaceReady(surface);
  if (afterSurface !== "LOCATE") return engine; // fail-closed / blocked before locate
  const located = engine.onLocated(await driver.locateComposer());
  if (located !== "HIGHLIGHT") return engine; // ambiguous / not-found fail closed
  await driver.highlight();
  engine.onHighlighted();
  return engine;
}

describe.skipIf(!RUN)("NaverReplySubmitProbeDriver real-DOM seams (locate-tag → annotate → observe, read-only)", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("present: real-DOM locate → annotate → TEST-only submit click observed → operator reports SUBMITTED, no leak", async () => {
    const page: Page = await browser.newPage();
    await page.setContent(replyComposerFixtureHtml("composer-present"));
    const driver = new NaverReplySubmitProbeDriver(page, { submitTimeoutMs: SUBMIT_TIMEOUT_MS });

    expect(await driver.prepareSurface()).toBe(true);
    const located = await driver.locateComposer();
    expect(located.count).toBe(1);
    expect(located.sig).toMatch(HEX16);

    // Read-only annotation binds the driver's OWN target over untagged markup.
    expect(await page.locator("[data-aw-reply-target]").count()).toBe(0);
    await driver.highlight();
    expect(await page.locator("[data-aw-reply-target]").count()).toBe(1);

    await driver.armObserve();
    await page.click("#aw-reply-submit"); // TEST-ONLY: stands in for the seller's own submit
    expect(await driver.waitForSubmit()).toBe(true);

    // The engine reaches its honest terminal from these driver outputs — reported, never COMPLETED.
    const engine = new ReplyEngine({ runId: "run_reply_browser", channelCode: "naver" }, { clock: makeReplyClock() });
    engine.command({ type: "START_RUN", expectedRevision: 0 });
    expect(engine.onSurfaceReady(await driver.prepareSurface())).toBe("LOCATE");
    expect(engine.onLocated(await driver.locateComposer())).toBe("HIGHLIGHT");
    await driver.highlight();
    engine.onHighlighted();
    engine.onUserActionObserved();
    engine.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: engine.view().revision });
    expect(engine.view().status).toBe("OPERATOR_REPORTED");
    const reported = engine.events().find((e) => e.type === "SUBMISSION_REPORTED");
    expect(reported?.payload).toMatchObject({ operatorOutcome: "OPERATOR_REPORTED_SUBMITTED", verification: "UNVERIFIED" });
    expect(engine.events().some((e) => e.type === "RUN_COMPLETED")).toBe(false);

    await driver.cleanup();
    expect(await page.locator("[data-aw-reply-target]").count()).toBe(0);

    // No page content / canary / selector / URL crossed into any sanitized output.
    const blob = JSON.stringify({ located, events: engine.events(), view: engine.view() }).toLowerCase();
    for (const canary of REPLY_FIXTURE_CANARIES) {
      expect(blob.includes(canary.toLowerCase()), `leaked "${canary}"`).toBe(false);
    }
    expect(findProhibitedFields({ located, events: engine.events(), view: engine.view() })).toEqual([]);
    await page.close();
  });

  it("ambiguous: two composers fail closed TARGET_AMBIGUOUS — never annotated", async () => {
    const page = await browser.newPage();
    await page.setContent(replyComposerFixtureHtml("composer-ambiguous"));
    const driver = new NaverReplySubmitProbeDriver(page);
    const engine = await runEngineOverDriver(driver, "run_reply_ambiguous");
    expect(engine.view().status).toBe("FAILED");
    expect(engine.view().blocker?.code).toBe("TARGET_AMBIGUOUS");
    expect(await page.locator("[data-aw-reply-target]").count()).toBe(0);
    await page.close();
  });

  it("missing: no reply composer fails closed TARGET_NOT_FOUND", async () => {
    const page = await browser.newPage();
    await page.setContent(replyComposerFixtureHtml("composer-missing"));
    const driver = new NaverReplySubmitProbeDriver(page);
    const engine = await runEngineOverDriver(driver, "run_reply_missing");
    expect(engine.view().status).toBe("FAILED");
    expect(engine.view().blocker?.code).toBe("TARGET_NOT_FOUND");
    await page.close();
  });

  it("login-required: the surface precondition fails as a recoverable blocker (never located)", async () => {
    const page = await browser.newPage();
    await page.setContent(replyComposerFixtureHtml("login-required"));
    const driver = new NaverReplySubmitProbeDriver(page);
    const surface = await driver.prepareSurface();
    expect(surface).toEqual({ ok: false, code: "LOGIN_REQUIRED" });
    const engine = await runEngineOverDriver(driver, "run_reply_login");
    expect(engine.view().blocker?.code).toBe("LOGIN_REQUIRED");
    expect(engine.view().blocker?.recoverable).toBe(true);
    await page.close();
  });
});
