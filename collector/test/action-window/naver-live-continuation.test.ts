/**
 * **NAVER export consent/continuation proof (RUN_INTEGRATION=1; headed = AW_HEADED=1).**
 *
 * NORMAL NAVER review-export flow — TWO seller clicks: (1) click the export control; NAVER raises ONE
 * in-page consent/notice dialog; (2) click that dialog's confirm/agree control, and the browser
 * download then begins AUTOMATICALLY. The driver highlights exactly ONE consent checkpoint after the
 * export click, waits for the seller's click on it (it never clicks), and detects the download that
 * follows. That single consent step is the expected choreography — NOT three clicks.
 *
 * These drive the real `NaverLiveProbeDriver` over 100% synthetic pages (no marketplace markup/
 * trademark/data, no network). They prove the normal one-consent flow, plus the two variants the same
 * loop absorbs: the Run-4 direct shape (the confirm fires the download, ZERO checkpoints), and — only
 * as a DEFENSIVE fallback (Run 7 attempt-2 finding) — a FURTHER export-related control appearing when
 * the consent alone did not deliver a download. Fail-closed is pinned from every exit: unacted
 * checkpoint, ambiguous candidates, and the defensive checkpoint cap. The Runtime never clicks.
 *
 *   # automated (TEST-ONLY simulated clicks), headless:
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/naver-live-continuation.test.ts
 *   # headed operator proof — a HUMAN performs every click in the visible window:
 *   RUN_INTEGRATION=1 AW_HEADED=1 npx vitest run test/action-window/naver-live-continuation.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { findProhibitedFields } from "../../../contracts/action-window/v1/index";
import { NaverLiveProbeDriver } from "../../src/action-window/naver-live-driver";
import { overlayMounted } from "../../src/action-window/overlay";

const RUN = process.env.RUN_INTEGRATION === "1";
const HEADED = process.env.AW_HEADED === "1";
const HEX16 = /^[0-9a-f]{16}$/;
const DETECT_MS = HEADED ? 60_000 : 4_000;
const CONTINUATION_OBSERVE_MS = HEADED ? 240_000 : 1_200;
const POLL_MS = 100;
const NOTIF_DELAY_MS = HEADED ? 3_000 : 700;
const HEADED_TEST_TIMEOUT_MS = 600_000;

/** OOXML-shaped synthetic blob (ZIP magic single-byte, so UTF-8 keeps the magic) — not a real book. */
const XLSX_BLOB = `'PK\\u0003\\u0004\\u0014\\u0000\\u0000\\u0000\\u0008\\u0000[Content_Types].xml (sellerops synthetic)'`;

interface FlowShape {
  /** The confirmation dialog's button wording. "확인" never matches export wording; a consent-shaped
   * "리뷰데이터 다운로드 계속" DOES match, making the dialog itself a continuation checkpoint. */
  confirmLabel: string;
  /** What confirming does: fire the download directly (Run 4) or schedule the notification. */
  afterConfirm: "direct-download" | "notification";
  /** How many wording-matched controls the notification carries (2 = the ambiguity shape). */
  notifButtons?: 1 | 2;
  notifDelayMs?: number;
  /**
   * Render delay for the confirmation dialog after the export click. A consent-worded dialog must
   * render AFTER the engine's `verify` (as the live surface evidently does — attempt 2's verify
   * passed), otherwise its wording-matched button reads as target drift and verify fails closed.
   */
  dlgDelayMs?: number;
}

/** A review-export-shaped page realizing the operator-described multi-step export choreography. */
const flowPage = (shape: FlowShape): string => `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui;margin:0;padding:24px} a,button{display:inline-block;padding:10px 18px}
    #dlg1{display:none;position:fixed;inset:30% 22%;background:#fff;border:1px solid #888;padding:20px}
    #notif{display:none;position:fixed;right:16px;bottom:16px;background:#f6f8ff;border:1px solid #99a;padding:16px}
  </style></head><body>
    <h1>리뷰 관리 (합성 픽스처)</h1>
    <table><tbody><tr><td>합성 행 A</td><td>★★★★☆</td></tr></tbody></table>
    <div class="toolbar"><a id="exp" href="#">엑셀 다운로드</a></div>
    <div id="dlg1"></div>
    <div id="notif"></div>
    <script>
      (function(){
        // Dialog/notification CONTENT is inserted dynamically, like the real SPA surface — a
        // pre-rendered-but-hidden button would still read as visible via its own computed style.
        var blobUrl = URL.createObjectURL(new Blob([${XLSX_BLOB}], { type: 'application/octet-stream' }));
        function fireDownload(){
          var a = document.createElement('a');
          a.href = blobUrl; a.download = 'review-export.xlsx';
          document.body.appendChild(a); a.click();
        }
        function button(id, label, onClick){
          var b = document.createElement('button');
          b.id = id; b.textContent = label; b.addEventListener('click', onClick);
          return b;
        }
        function showNotif(){
          var n = document.getElementById('notif');
          var p = document.createElement('p'); p.textContent = '파일이 준비되었습니다 (합성 알림창)';
          n.appendChild(p);
          n.appendChild(button('dl1', '다운로드 받기', fireDownload));
          ${shape.notifButtons === 2 ? "n.appendChild(button('dl2', '엑셀 내려받기', fireDownload));" : ""}
          n.style.display = 'block';
        }
        function showDialog(){
          var d = document.getElementById('dlg1');
          var p = document.createElement('p'); p.textContent = '내보내기를 진행할까요? (합성 확인창)';
          d.appendChild(p);
          d.appendChild(button('ok1', ${JSON.stringify(shape.confirmLabel)}, function(){
            d.style.display = 'none';
            d.replaceChildren();
            ${
              shape.afterConfirm === "direct-download"
                ? "fireDownload();"
                : `setTimeout(showNotif, ${shape.notifDelayMs ?? 0});`
            }
          }));
          d.style.display = 'block';
        }
        document.getElementById('exp').addEventListener('click', function(e){
          e.preventDefault();
          setTimeout(showDialog, ${shape.dlgDelayMs ?? 0});
        });
      })();
    </script>
  </body></html>`;

/** No synthetic page string may ever reach a driver result. */
const NEEDLES = ["리뷰 관리", "합성", "엑셀", "다운로드", "내려받기", "확인", "알림", "review-export", ".xlsx", "blob:", "notif", "dlg1"];

describe.skipIf(!RUN)("NaverLiveProbeDriver continuation checkpoints (Run 7 attempt-2 choreography)", () => {
  let browser: Browser;
  let page: Page;
  const dirs: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch({ headless: !HEADED });
  });
  afterAll(async () => {
    await browser?.close();
  });
  afterEach(async () => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    await page?.close().catch(() => {});
  });

  function newDriver(shapeHtmlReady: Promise<void>): NaverLiveProbeDriver {
    void shapeHtmlReady;
    const d = mkdtempSync(join(tmpdir(), "aw-live-cont-"));
    dirs.push(d);
    return new NaverLiveProbeDriver(page, {
      quarantineDir: d,
      ingest: () => Promise.reject(new Error("ingest is out of scope for choreography proofs")),
      downloadTimeoutMs: DETECT_MS,
      continuationObserveTimeoutMs: CONTINUATION_OBSERVE_MS,
      continuationPollMs: POLL_MS,
      ...(HEADED ? { observeTimeoutMs: 240_000 } : {}),
    });
  }

  /** locate → highlight → arm → (seller clicks export) → observed → verify — the engine's order. */
  async function driveToDetectStart(shape: FlowShape): Promise<NaverLiveProbeDriver> {
    page = await browser.newPage();
    const driver = newDriver(page.setContent(flowPage(shape)));
    await page.setContent(flowPage(shape));
    const located = await driver.locate();
    expect(located.count).toBe(1);
    await driver.highlight();
    await driver.armObserve();
    if (!HEADED) await page.click("[data-aw-target]"); // TEST-ONLY: the seller's export click
    expect(await driver.waitForUserAction()).toBe(true);
    expect(await driver.verify(located.sig!)).toEqual({ verified: true, drift: false });
    return driver;
  }

  function assertSanitized(driver: NaverLiveProbeDriver, detected: unknown): void {
    const blob = JSON.stringify([detected, driver.lastContinuation()]).toLowerCase();
    for (const needle of NEEDLES) expect(blob.includes(needle.toLowerCase()), `leaked "${needle}"`).toBe(false);
    expect(findProhibitedFields({ detected })).toEqual([]);
  }

  it(
    "the NORMAL two-click flow: export click → ONE consent/confirm control → automatic download",
    async () => {
      // The tutorial choreography. After the export click NAVER raises ONE in-page consent dialog whose
      // confirm/agree control carries download wording. The driver highlights that SINGLE control, waits
      // for the SELLER's click on it (never clicking), and the browser download then begins automatically.
      const driver = await driveToDetectStart({
        confirmLabel: "다운로드 동의", // the consent/confirm control (carries download wording)
        afterConfirm: "direct-download", // confirming it makes the download begin automatically
        dlgDelayMs: 250, // renders after verify, as the live surface does
      });
      const detectP = driver.detectDownload();
      // Exactly ONE checkpoint: the consent control is detected, re-tagged, highlighted — never clicked by us.
      await page.waitForSelector('#ok1[data-aw-target]', { timeout: DETECT_MS });
      expect(await page.locator("#exp[data-aw-target]").count()).toBe(0); // tag moved off the export control
      expect(await overlayMounted(page)).toBe(true);
      if (!HEADED) await page.click("#ok1"); // TEST-ONLY: the seller clicks the consent/confirm control
      const detected = await detectP; // the download begins automatically after the consent
      expect(detected.detected).toBe(true);
      expect(detected.artifactRef).toMatch(HEX16);
      expect(driver.lastContinuation()).toEqual({ checkpoints: 1, observedLast: true, ambiguous: false, dialog: "none" });
      assertSanitized(driver, detected);
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );

  it(
    "variant: an unguided confirm, then a follow-up control the driver highlights (one checkpoint)",
    async () => {
      const driver = await driveToDetectStart({
        confirmLabel: "확인",
        afterConfirm: "notification",
        notifDelayMs: NOTIF_DELAY_MS,
      });
      const detectP = driver.detectDownload();
      if (!HEADED) await page.click("#ok1"); // TEST-ONLY: the seller confirms the dialog
      // The driver must find the NEW control, move the tag, and highlight — WITHOUT clicking it.
      await page.waitForSelector('[data-aw-label="review-export-continuation"]', { timeout: DETECT_MS });
      expect(await page.locator("#dl1[data-aw-target]").count()).toBe(1);
      expect(await page.locator("#exp[data-aw-target]").count()).toBe(0); // tag MOVED off the original
      expect(await overlayMounted(page)).toBe(true);
      if (!HEADED) await page.click("#dl1"); // TEST-ONLY: the seller acts on the highlighted checkpoint
      const detected = await detectP;
      expect(detected.detected).toBe(true);
      expect(detected.artifactRef).toMatch(HEX16);
      expect(driver.lastContinuation()).toEqual({ checkpoints: 1, observedLast: true, ambiguous: false, dialog: "none" });
      assertSanitized(driver, detected);
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );

  it(
    "DEFENSIVE fallback: after the consent, a FURTHER export-related control appears — two checkpoints",
    async () => {
      const driver = await driveToDetectStart({
        confirmLabel: "리뷰데이터 다운로드 계속",
        afterConfirm: "notification",
        notifDelayMs: NOTIF_DELAY_MS,
        dlgDelayMs: 250, // renders after verify, as the live surface evidently does
      });
      const detectP = driver.detectDownload();
      // Checkpoint 1: the consent dialog's own button carries download wording → highlighted.
      await page.waitForSelector('#ok1[data-aw-target]', { timeout: DETECT_MS });
      if (!HEADED) await page.click("#ok1");
      // Checkpoint 2: the notification's control.
      await page.waitForSelector('#dl1[data-aw-target]', { timeout: DETECT_MS });
      if (!HEADED) await page.click("#dl1");
      const detected = await detectP;
      expect(detected.detected).toBe(true);
      expect(driver.lastContinuation()).toEqual({ checkpoints: 2, observedLast: true, ambiguous: false, dialog: "none" });
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );

  it(
    "Run 4's direct shape is unchanged: confirm fires the download, zero checkpoints",
    async () => {
      const driver = await driveToDetectStart({ confirmLabel: "확인", afterConfirm: "direct-download" });
      const detectP = driver.detectDownload();
      if (!HEADED) await page.click("#ok1");
      const detected = await detectP;
      expect(detected.detected).toBe(true);
      expect(driver.lastContinuation()).toEqual({ checkpoints: 0, observedLast: false, ambiguous: false, dialog: "none" });
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );

  it(
    "fail closed: the checkpoint is highlighted but never acted on → detected:false",
    async () => {
      const driver = await driveToDetectStart({
        confirmLabel: "확인",
        afterConfirm: "notification",
        notifDelayMs: 100,
      });
      const detectP = driver.detectDownload();
      if (!HEADED) await page.click("#ok1");
      await page.waitForSelector('#dl1[data-aw-target]', { timeout: DETECT_MS });
      // Nobody clicks. The continuation observe window lapses and the run fails closed.
      const detected = await detectP;
      expect(detected).toEqual({ detected: false });
      expect(driver.lastContinuation()).toEqual({ checkpoints: 1, observedLast: false, ambiguous: false, dialog: "none" });
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );

  it(
    "fail closed: TWO simultaneous candidate controls → ambiguous, never a guess",
    async () => {
      const driver = await driveToDetectStart({
        confirmLabel: "확인",
        afterConfirm: "notification",
        notifButtons: 2,
        notifDelayMs: 100,
      });
      const detectP = driver.detectDownload();
      if (!HEADED) await page.click("#ok1");
      const detected = await detectP;
      expect(detected).toEqual({ detected: false });
      expect(driver.lastContinuation()).toEqual({ checkpoints: 0, observedLast: false, ambiguous: true, dialog: "none" });
      // Neither candidate was tagged — ambiguity tags nothing.
      expect(await page.locator('[data-aw-label="review-export-continuation"]').count()).toBe(0);
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );
});
