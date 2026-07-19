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
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { findProhibitedFields } from "../../../../contracts/action-window/v2/index";
import { ReplyEngine, makeReplyClock } from "../../../src/action-window/reply-submission/reply-engine";
import { NaverReplySubmitProbeDriver } from "../../../src/action-window/reply-submission/naver-reply-driver";
import { REPLY_FIXTURE_CANARIES, REPLY_FIXTURE_HINT, replyComposerFixtureHtml } from "../../../src/action-window/reply-submission/reply-fixture";
import { composerSigFor, reviewRowLocateDecision, type ReplyTargetHint, type ReviewRowSignal } from "../../../src/action-window/reply-submission/reply-surface";
import type { LocateRowResult } from "../../../src/action-window/reply-submission/reply-engine";
import { reviewBodyFingerprint } from "../../../src/action-window/reply-submission/review-body-fingerprint";
import { IN_PAGE_FINGERPRINT_FN } from "../../../src/action-window/reply-submission/review-body-fingerprint-inpage";
import { inPageRowFingerprintAt } from "../../../src/action-window/reply-submission/reply-row-inpage";
import { compareCrossSource } from "../../../src/action-window/reply-submission/reply-cross-source";
import {
  IN_PAGE_CALIBRATION_INSTALL,
  IN_PAGE_CALIBRATION_READ,
  type CalibrationReadState,
} from "../../../src/action-window/reply-submission/reply-calibrate-inpage";
import { ROW_MAPPING_SCHEMA_VERSION, type ReplyRowMapping } from "../../../src/action-window/reply-submission/reply-row-mapping-artifact";
import { mappingFromCalibration } from "../../../src/cli/calibrate-reply-target";

const RUN = process.env.RUN_INTEGRATION === "1";
const HEX16 = /^[0-9a-f]{16}$/;
/** Short bound — the TEST clicks immediately, so no seated-human window is needed. */
const SUBMIT_TIMEOUT_MS = 20_000;

/**
 * TEST-ONLY real-DOM row driver for the FIXTURE's own `[data-review-row]` convention. It is DELIBERATELY
 * separate from the fail-closed live `NaverReplySubmitProbeDriver` row seam — `[data-review-row]` is OUR
 * synthetic fixture marker, never asserted about live NAVER. It reads sanitized per-row signals, runs the
 * SHARED `reviewRowLocateDecision`, annotates read-only, and observes the TEST's row-open click.
 */
const EXTRACT_ROWS = `(() => Array.prototype.slice.call(document.querySelectorAll('[data-review-row]')).map(function (r) {
  return { rating: Number(r.getAttribute('data-rating')), recencyBucket: r.getAttribute('data-recency-bucket'), bodyFingerprint: r.getAttribute('data-fingerprint') };
}))()`;
const ARM_ROW_OBSERVER = `(() => { window.__awReplyRowOpened = false; document.addEventListener('click', function () { window.__awReplyRowOpened = true; }, true); return true; })()`;

function uniqueMatchIndex(rows: readonly ReviewRowSignal[], hint: ReplyTargetHint): number {
  let idx = -1;
  let count = 0;
  rows.forEach((r, i) => {
    if (r.rating === hint.rating && r.recencyBucket === hint.recencyBucket && r.bodyFingerprint === hint.bodyFingerprint) {
      count += 1;
      idx = i;
    }
  });
  return count === 1 ? idx : -1;
}

class FixtureRowBrowserDriver {
  constructor(private readonly page: Page, private readonly hint: ReplyTargetHint) {}
  private async rows(): Promise<ReviewRowSignal[]> {
    return (await this.page.evaluate(EXTRACT_ROWS)) as ReviewRowSignal[];
  }
  async locateReviewRow(): Promise<LocateRowResult> {
    return reviewRowLocateDecision(this.hint, await this.rows());
  }
  async highlightRow(): Promise<LocateRowResult> {
    const rows = await this.rows();
    const idx = uniqueMatchIndex(rows, this.hint); // retained match; anti-drift re-validation happens here
    if (idx >= 0) {
      await this.page.evaluate((i: number) => {
        const els = Array.from(document.querySelectorAll("[data-review-row]"));
        els[i]?.setAttribute("data-aw-reply-row-target", "1");
      }, idx);
    }
    return reviewRowLocateDecision(this.hint, rows);
  }
  async armRowObserve(): Promise<void> {
    await this.page.evaluate(ARM_ROW_OBSERVER);
  }
  async waitForRowOpen(): Promise<boolean> {
    try {
      await this.page.waitForFunction("window.__awReplyRowOpened === true", { timeout: SUBMIT_TIMEOUT_MS });
      return true;
    } catch {
      return false;
    }
  }
}

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

/**
 * Guided review-row locator, real-DOM. The ROW step runs over the FIXTURE's own `[data-review-row]`
 * convention via {@link FixtureRowBrowserDriver}; the COMPOSER step runs over the existing live composer
 * scan. The live `NaverReplySubmitProbeDriver` row seam stays fail-closed (asserted last).
 */
describe.skipIf(!RUN)("guided review-row locator real-DOM (fixture rows → operator opens → composer chain)", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser?.close(); });

  function guidedEngine(runId: string) {
    const engine = new ReplyEngine({ runId, channelCode: "naver", targetHint: REPLY_FIXTURE_HINT }, { clock: makeReplyClock() });
    engine.command({ type: "START_RUN", expectedRevision: 0 });
    return engine;
  }

  it("rows-present: locate 1 row → annotate → TEST opens the row → composer chain → OPERATOR_REPORTED, no leak", async () => {
    const page: Page = await browser.newPage();
    await page.setContent(replyComposerFixtureHtml("rows-present"));
    const rowDriver = new FixtureRowBrowserDriver(page, REPLY_FIXTURE_HINT);
    const composerDriver = new NaverReplySubmitProbeDriver(page, { submitTimeoutMs: SUBMIT_TIMEOUT_MS });
    const engine = guidedEngine("run_reply_rows_present");

    expect(engine.onSurfaceReady(await composerDriver.prepareSurface())).toBe("LOCATE_ROW");
    const located = await rowDriver.locateReviewRow();
    expect(located.count).toBe(1);
    expect(located.sig).toMatch(HEX16);
    expect(engine.onRowLocated(located)).toBe("HIGHLIGHT_ROW");

    expect(await page.locator("[data-aw-reply-row-target]").count()).toBe(0);
    const revalidated = await rowDriver.highlightRow();
    expect(await page.locator("[data-aw-reply-row-target]").count()).toBe(1);
    expect(engine.onRowHighlighted(revalidated)).toBe("OBSERVE_ROW");

    await rowDriver.armRowObserve();
    await page.click("#aw-reply-open-1"); // TEST-ONLY: the operator opens the matched review's reply control
    expect(await rowDriver.waitForRowOpen()).toBe(true);
    expect(engine.onRowOpened()).toBe("LOCATE");

    // Rejoin the existing composer chain over the same page (the matching row hosts the sole composer).
    expect(engine.onLocated(await composerDriver.locateComposer())).toBe("HIGHLIGHT");
    await composerDriver.highlight();
    engine.onHighlighted();
    await composerDriver.armObserve();
    await page.click("#aw-reply-submit"); // TEST-ONLY: the seller's own submit
    expect(await composerDriver.waitForSubmit()).toBe(true);
    engine.onUserActionObserved();
    engine.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: engine.view().revision });

    expect(engine.view().status).toBe("OPERATOR_REPORTED");
    const blob = JSON.stringify({ located, events: engine.events(), view: engine.view() }).toLowerCase();
    for (const canary of REPLY_FIXTURE_CANARIES) expect(blob.includes(canary.toLowerCase()), `leaked "${canary}"`).toBe(false);
    expect(findProhibitedFields({ located, events: engine.events(), view: engine.view() })).toEqual([]);
    await page.close();
  });

  it("rows-ambiguous → TARGET_AMBIGUOUS; rows-missing → TARGET_NOT_FOUND (never annotated)", async () => {
    for (const [mode, code] of [["rows-ambiguous", "TARGET_AMBIGUOUS"], ["rows-missing", "TARGET_NOT_FOUND"]] as const) {
      const page = await browser.newPage();
      await page.setContent(replyComposerFixtureHtml(mode));
      const rowDriver = new FixtureRowBrowserDriver(page, REPLY_FIXTURE_HINT);
      const engine = guidedEngine(`run_reply_${mode}`);
      engine.onSurfaceReady(true);
      engine.onRowLocated(await rowDriver.locateReviewRow());
      expect(engine.view().status, mode).toBe("FAILED");
      expect(engine.view().blocker?.code, mode).toBe(code);
      expect(await page.locator("[data-aw-reply-row-target]").count()).toBe(0);
      await page.close();
    }
  });

  it("the LIVE driver's row seam stays fail-closed against a real rows page (no invented selector)", async () => {
    const page = await browser.newPage();
    await page.setContent(replyComposerFixtureHtml("rows-present"));
    const live = new NaverReplySubmitProbeDriver(page);
    expect(await live.locateReviewRow()).toEqual({ count: 0 }); // → engine TARGET_NOT_FOUND
    expect(await live.waitForRowOpen()).toBe(false);
    await page.close();
  });
});

/**
 * **Operator-assisted live-match slice, real-DOM (served over http://localhost so `crypto.subtle` — used for the
 * in-page fingerprint — has a secure context, exactly as live NAVER https does).** Proves: (A) the in-page
 * fingerprint port matches the shared golden vectors byte-for-byte (hence Java≡TS); (B) the evidence-backed live
 * driver censuses via a calibrated mapping to a unique match, annotates read-only, observes the operator's own
 * row-open, and the cross-source preflight confirms the calibrated row; (C) the interactive calibration overlay
 * captures the operator's badge clicks into a mapping. The page is 100% synthetic — no marketplace markup/data.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(
  readFileSync(resolve(HERE, "../../../../contracts/review-fingerprint/v1/golden-vectors.json"), "utf8"),
) as { cases: { name: string; raw: string; fingerprint: string }[] };

// Review bodies are long (>150 chars) so the tag-agnostic calibration finds each row as a repeated text-rich unit.
const TARGET_BODY = "정말 만족스러운 구매였습니다 강력 추천합니다 배송도 빨라요 품질도 좋습니다 ".repeat(4).trim();
const ROW0_BODY = "배송이 느렸고 포장도 아쉬웠습니다 그냥 평범한 상품이에요 재구매는 글쎄요 ".repeat(4).trim();
const AS_OF = "2026-05-12";
const LIVE_HINT: ReplyTargetHint = { rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: reviewBodyFingerprint(TARGET_BODY) };
const CALIB_MAPPING: ReplyRowMapping = {
  schemaVersion: ROW_MAPPING_SCHEMA_VERSION,
  structuralPageSignature: "sig_test",
  expiresAtEpochMs: 9_999_999_999_999,
  parentPath: [0], // body → <main>
  rowTag: "ARTICLE",
  rowIndex: 1,
  ratingPath: [0],
  datePath: [1],
  bodyPath: [2],
  replyControlPath: [3],
};
// Two review rows (plain <article> children of <main>); only the second matches the hint.
const REVIEW_LIST_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>article,article>*{display:block;min-height:18px;min-width:80px;margin:4px}</style></head><body><main><article><div aria-label="5점">★★★★★</div><time datetime="2026-01-01">1월 1일</time><div>${ROW0_BODY}</div><button type="button">답변</button></article><article><div aria-label="2점">★★</div><time datetime="2026-05-08">5월 8일</time><div>${TARGET_BODY}</div><button type="button">답변</button></article></main></body></html>`;

function serveHtml(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolveP) => {
    const srv = http.createServer((_req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
    });
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolveP({ url: `http://localhost:${port}/`, close: () => new Promise<void>((r) => srv.close(() => r())) });
    });
  });
}

describe.skipIf(!RUN)("operator-assisted live-match slice, real-DOM over localhost (secure context)", () => {
  let browser: Browser;
  let server: { url: string; close: () => Promise<void> };
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    server = await serveHtml(REVIEW_LIST_HTML);
  });
  afterAll(async () => {
    await server?.close();
    await browser?.close();
  });

  it("A: the in-page fingerprint port matches EVERY shared golden vector byte-for-byte (Java≡TS≡in-page)", async () => {
    const page = await browser.newPage();
    await page.goto(server.url);
    for (const v of GOLDEN.cases) {
      const hex = await page.evaluate(
        ([fnSrc, text]) => {
          // eslint-disable-next-line no-new-func
          const f = new Function(`${fnSrc}; return __awReviewBodyFingerprint(arguments[0]);`);
          return f(text) as Promise<string>;
        },
        [IN_PAGE_FINGERPRINT_FN, v.raw] as [string, string],
      );
      expect(hex, `vector ${v.name}`).toBe(v.fingerprint);
    }
    await page.close();
  });

  it("B: the mapped live driver locates the unique row, annotates read-only, observes row-open, cross-source confirms", async () => {
    const page = await browser.newPage();
    await page.goto(server.url);
    const driver = new NaverReplySubmitProbeDriver(page, {
      hint: LIVE_HINT,
      mapping: CALIB_MAPPING,
      asOfDate: AS_OF,
      rowOpenTimeoutMs: SUBMIT_TIMEOUT_MS,
    });

    const located = await driver.locateReviewRow();
    expect(located).toEqual({ count: 1, sig: composerSigFor(["row", 1]) });
    expect(located.sig).not.toBe(LIVE_HINT.bodyFingerprint);

    expect(await page.locator("[data-aw-reply-row-target]").count()).toBe(0);
    const revalidated = await driver.highlightRow();
    expect(revalidated).toEqual({ count: 1, sig: composerSigFor(["row", 1]) });
    expect(await page.locator("[data-aw-reply-row-target]").count()).toBe(1);
    expect(await page.locator("[data-aw-reply-control-target]").count()).toBe(1);

    await driver.armRowObserve();
    await page.click("[data-aw-reply-control-target]"); // TEST-ONLY: the operator opens the reply control
    expect(await driver.waitForRowOpen()).toBe(true);

    // Cross-source preflight: the calibrated row's live in-page fingerprint equals the backend hint fingerprint.
    const liveFp = (await page.evaluate(
      inPageRowFingerprintAt({ parentPath: [0], rowTag: "ARTICLE", rowIndex: 1, bodyPath: [2] }),
    )) as string | null;
    expect(liveFp).toBe(LIVE_HINT.bodyFingerprint);
    expect(compareCrossSource(liveFp, LIVE_HINT.bodyFingerprint)).toEqual({ ok: true });

    await driver.cleanup();
    expect(await page.locator("[data-aw-reply-row-target]").count()).toBe(0);
    await page.close();
  });

  it("B2: a wrong hint fingerprint fails closed (no unique match, no annotation) — cross-source would refuse", async () => {
    const page = await browser.newPage();
    await page.goto(server.url);
    const driver = new NaverReplySubmitProbeDriver(page, {
      hint: { ...LIVE_HINT, bodyFingerprint: "f".repeat(64) },
      mapping: CALIB_MAPPING,
      asOfDate: AS_OF,
    });
    expect(await driver.locateReviewRow()).toEqual({ count: 0 });
    expect(await page.locator("[data-aw-reply-row-target]").count()).toBe(0);
    const liveFp = (await page.evaluate(
      inPageRowFingerprintAt({ parentPath: [0], rowTag: "ARTICLE", rowIndex: 1, bodyPath: [2] }),
    )) as string | null;
    expect(compareCrossSource(liveFp, "f".repeat(64))).toEqual({ ok: false, code: "MISMATCH" });
    await page.close();
  });

  it("C: one body click designates the whole review row; the mapping drives the calibrated locate", async () => {
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.evaluate(IN_PAGE_CALIBRATION_INSTALL);

    // Operator clicks the target review's BODY once. The capture-phase listener walks up to the repeated
    // text-rich unit (the <article> row) and records its identity + the clicked element's path — one click.
    await page.locator("article").nth(1).locator("div:not([aria-label])").click(); // the body div

    const state = (await page.evaluate(IN_PAGE_CALIBRATION_READ)) as CalibrationReadState;
    expect(state.done).toBe(true);
    const mapping = mappingFromCalibration(state, "sig_test", 1_000_000);
    expect(mapping).toMatchObject({
      parentPath: [0], // body → <main>
      rowTag: "ARTICLE",
      rowIndex: 1,
      bodyPath: [2], // the clicked body div within the article
    });

    // The calibrated locate (abort-rehearsal mode) highlights the operator-designated row without a fingerprint match.
    const driver = new NaverReplySubmitProbeDriver(page, { mapping: mapping!, locateMode: "calibrated" });
    expect(await driver.locateReviewRow()).toEqual({ count: 1, sig: composerSigFor(["row", 1]) });
    await page.close();
  });
});
