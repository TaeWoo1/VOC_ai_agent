/**
 * **DEV-ONLY live-debug diagnostics proof (RUN_INTEGRATION=1; headed = AW_HEADED=1).**
 *
 * The seated NAVER live-debug sprint (2026-07-24) adds, GATED behind `liveDebug`, three things this
 * pins against the real `NaverLiveProbeDriver` over 100% synthetic pages (no marketplace markup / data /
 * network):
 *
 *   1. **Candidate inspection + labels** — on a fail-closed continuation the driver overlays a sanitized
 *      local label (`B1`/`B2`…) on every eligible Path-A/Path-B candidate and records SANITIZED
 *      structural buckets only (`lastInspection()`): counts + per-candidate tag/role bucket + enabled +
 *      in-export-dialog. No page text / attributes / URLs / content ever appear.
 *   2. **Operator hint selection** — given the label the operator identified (`continuationSelectLabel`),
 *      the matcher HIGHLIGHTS that one candidate instead of failing closed on ambiguity. It still never
 *      clicks; the seller performs the click, and only then does the download begin.
 *   3. **Hint safety** — an unresolvable/out-of-range label NEVER forces a guess: it falls straight
 *      through to the unchanged ambiguous fail-closed. And `clearContinuationDebug()` removes the labels.
 *
 * The `liveDebug:false` production path is proven UNCHANGED by the sibling
 * `naver-live-continuation-dialog.test.ts` (21/21) — those drivers pass no debug options.
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/naver-live-debug-diagnostics.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { findProhibitedFields } from "../../../contracts/action-window/v1/index";
import { NaverLiveProbeDriver } from "../../src/action-window/naver-live-driver";

const RUN = process.env.RUN_INTEGRATION === "1";
const HEADED = process.env.AW_HEADED === "1";
const HEX16 = /^[0-9a-f]{16}$/;
const DETECT_MS = HEADED ? 60_000 : 4_000;
const FAILCLOSED_DETECT_MS = 1_500;
const CONTINUATION_OBSERVE_MS = HEADED ? 240_000 : 1_500;
const POLL_MS = 100;
const DLG_DELAY_MS = HEADED ? 3_000 : 250;
const HEADED_TEST_TIMEOUT_MS = 600_000;

const XLSX_BLOB = `'PK\\u0003\\u0004\\u0014\\u0000\\u0000\\u0000\\u0008\\u0000[Content_Types].xml (sellerops synthetic)'`;

/** A review-export page whose export click raises a consent dialog with TWO generic primary actions. */
const twoPrimariesPage = (): string => `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui;margin:0;padding:24px} button,a{display:inline-block;padding:10px 18px}
    .dlg{position:fixed;inset:28% 22%;background:#fff;border:1px solid #888;padding:20px}
  </style></head><body>
    <h1>리뷰 관리 (합성 픽스처)</h1>
    <table><tbody><tr><td>합성 행 A</td><td>★★★★☆</td></tr></tbody></table>
    <div class="toolbar"><a id="exp" href="#">엑셀 다운로드</a></div>
    <div id="host"></div>
    <script>
      (function(){
        var blobUrl = URL.createObjectURL(new Blob([${XLSX_BLOB}], { type: 'application/octet-stream' }));
        function fireDownload(){
          var a = document.createElement('a'); a.href = blobUrl; a.download = 'review-export.xlsx';
          document.body.appendChild(a); a.click();
        }
        function btn(id, label){
          var b = document.createElement('button'); b.id = id; b.textContent = label;
          b.addEventListener('click', fireDownload); return b;
        }
        function build(){
          var d = document.createElement('div'); d.id = 'dlg1'; d.className = 'dlg';
          var p = document.createElement('p');
          p.textContent = '리뷰 엑셀 다운로드 이용에 동의하시면 파일이 저장됩니다 (합성 동의창)';
          d.appendChild(p);
          d.appendChild((function(){ var c = document.createElement('button'); c.id='dlg1-cancel'; c.textContent='취소'; return c; })());
          d.appendChild(btn('ok1', '확인'));
          d.appendChild(btn('ok2', '동의'));
          document.getElementById('host').appendChild(d);
        }
        document.getElementById('exp').addEventListener('click', function(e){ e.preventDefault(); setTimeout(build, ${DLG_DELAY_MS}); });
      })();
    </script>
  </body></html>`;

/** No synthetic page string may reach a driver-visible result. */
const NEEDLES = ["리뷰 관리", "합성", "엑셀", "다운로드", "내려받기", "확인", "동의", "취소", "이용", "저장", "동의창", "review-export", ".xlsx", "blob:", "dlg", "host", "ok1", "ok2"];

describe.skipIf(!RUN)("NaverLiveProbeDriver DEV live-debug diagnostics (Run 7 sprint)", () => {
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

  function newDriver(detectMs: number, opts: { liveDebug?: boolean; continuationSelectLabel?: string }): NaverLiveProbeDriver {
    const d = mkdtempSync(join(tmpdir(), "aw-live-dbg-"));
    dirs.push(d);
    return new NaverLiveProbeDriver(page, {
      quarantineDir: d,
      ingest: () => Promise.reject(new Error("ingest is out of scope for discovery proofs")),
      downloadTimeoutMs: detectMs,
      continuationObserveTimeoutMs: CONTINUATION_OBSERVE_MS,
      continuationPollMs: POLL_MS,
      ...(HEADED ? { observeTimeoutMs: 240_000 } : {}),
      ...opts,
    });
  }

  async function driveToDetectStart(detectMs: number, opts: { liveDebug?: boolean; continuationSelectLabel?: string }): Promise<NaverLiveProbeDriver> {
    page = await browser.newPage();
    const driver = newDriver(detectMs, opts);
    await page.setContent(twoPrimariesPage());
    const located = await driver.locate();
    expect(located.count).toBe(1);
    await driver.highlight();
    await driver.armObserve();
    if (!HEADED) await page.click("[data-aw-target]"); // TEST-ONLY: the seller's export click
    expect(await driver.waitForUserAction()).toBe(true);
    expect(await driver.verify(located.sig!)).toEqual({ verified: true, drift: false });
    return driver;
  }

  it(
    "labels the ambiguous candidates + records SANITIZED buckets; clearContinuationDebug removes them",
    async () => {
      const driver = await driveToDetectStart(FAILCLOSED_DETECT_MS, { liveDebug: true });
      const detected = await driver.detectDownload();
      expect(detected).toEqual({ detected: false }); // still fails closed by itself — labels are diagnostic only
      expect(driver.lastContinuation()).toEqual({ checkpoints: 0, observedLast: false, ambiguous: true, dialog: "export-dialog-no-action" });

      const ins = driver.lastInspection();
      expect(ins).not.toBeNull();
      expect({ a: ins!.pathACount, b: ins!.pathBCount, d: ins!.dialogCount, o: ins!.overlapCount }).toEqual({ a: 0, b: 2, d: 1, o: 0 });
      expect(ins!.candidates.map((c) => c.label)).toEqual(["B1", "B2"]);
      expect(ins!.candidates.every((c) => c.via === "B" && c.tagBucket === "button" && c.enabled && c.inExportDialog)).toBe(true);

      // The labels are painted ON the page (pointer-events:none), and are NOT the tag.
      expect(await page.locator(".__aw_cand_label__").count()).toBe(2);
      expect(await page.locator('[data-aw-label="review-export-continuation"]').count()).toBe(0);

      // Sanitized: nothing content-bearing crosses into the inspection.
      const blob = JSON.stringify(ins).toLowerCase();
      for (const n of NEEDLES) expect(blob.includes(n.toLowerCase()), `leaked "${n}"`).toBe(false);
      expect(findProhibitedFields({ inspection: ins })).toEqual([]);

      await driver.clearContinuationDebug();
      expect(await page.locator(".__aw_cand_label__").count()).toBe(0);
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );

  it(
    "honors the operator hint: B1 is highlighted (never B2, never auto-clicked) and the seller click detects",
    async () => {
      const driver = await driveToDetectStart(DETECT_MS, { liveDebug: true, continuationSelectLabel: "B1" });
      const detectP = driver.detectDownload();
      await page.waitForSelector("#ok1[data-aw-target]", { timeout: DETECT_MS });
      expect(await page.locator('[data-aw-label="review-export-continuation"]').count()).toBe(1);
      expect(await page.locator("#ok2[data-aw-target]").count()).toBe(0); // the non-selected primary is NEVER tagged
      expect(await page.locator("#dlg1-cancel[data-aw-target]").count()).toBe(0); // 취소 is never tagged
      if (!HEADED) await page.click("#ok1"); // TEST-ONLY: the seller clicks the operator-identified control
      const detected = await detectP;
      expect(detected.detected).toBe(true);
      expect(detected.artifactRef).toMatch(HEX16);
      expect(driver.lastContinuation()).toEqual({ checkpoints: 1, observedLast: true, ambiguous: false, dialog: "matched" });
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );

  it(
    "an unresolvable hint NEVER forces a guess — it falls through to the unchanged fail-closed",
    async () => {
      const driver = await driveToDetectStart(FAILCLOSED_DETECT_MS, { liveDebug: true, continuationSelectLabel: "B9" });
      const detected = await driver.detectDownload();
      expect(detected).toEqual({ detected: false });
      expect(driver.lastContinuation()).toEqual({ checkpoints: 0, observedLast: false, ambiguous: true, dialog: "export-dialog-no-action" });
      expect(await page.locator('[data-aw-label="review-export-continuation"]').count()).toBe(0);
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );
});
