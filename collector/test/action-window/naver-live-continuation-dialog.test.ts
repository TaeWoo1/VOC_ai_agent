/**
 * **Contextual-dialog continuation DISCOVERY proof (RUN_INTEGRATION=1; headed = AW_HEADED=1).**
 *
 * Run 7 attempt 6 (dispatch §21) failed closed with `continuation {checkpoints:0}` AGAIN, on code that
 * already had the #350 role-less fix: the live NAVER second control is a GENERIC `확인`/`동의` whose
 * export meaning lives in the surrounding consent MODAL, not in the button text — so own-wording
 * matching (path A) can never find it. Path B (added here) recognises exactly ONE primary action
 * INSIDE an export-context dialog, and is deliberately narrow: a control is eligible only when it sits
 * in a container that is an ARIA dialog OR carries a confirm+cancel footer AND whose body has export
 * context. It NEVER matches a bare global `확인`.
 *
 * These drive the real `NaverLiveProbeDriver` over 100% synthetic pages (no marketplace markup /
 * trademark / data, no network) modelling the operator-described consent dialog:
 *   - body has review-export / Excel / usage-consent context,
 *   - actions are `취소` and a generic `확인`/`동의`,
 *   - only the single primary action inside that context is highlighted; the Runtime never clicks it.
 *
 * Fail-closed and the two frame diagnostics are pinned: multiple eligible dialogs OR multiple primary
 * actions → ambiguous; an export dialog with no unique action → `dialog:"export-dialog-no-action"`; no
 * export dialog in this frame → `dialog:"no-export-dialog"`; a bare `확인` outside any dialog → not
 * matched. iframe traversal is out of scope by design.
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/naver-live-continuation-dialog.test.ts
 *   RUN_INTEGRATION=1 AW_HEADED=1 npx vitest run test/action-window/naver-live-continuation-dialog.test.ts
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
const FAILCLOSED_DETECT_MS = 1_500; // the no-download cases lapse fast — never wait the headed budget
const CONTINUATION_OBSERVE_MS = HEADED ? 240_000 : 1_500;
const POLL_MS = 100;
const DLG_DELAY_MS = HEADED ? 3_000 : 250; // renders AFTER verify, as the live surface does
const HEADED_TEST_TIMEOUT_MS = 600_000;

const XLSX_BLOB = `'PK\\u0003\\u0004\\u0014\\u0000\\u0000\\u0000\\u0008\\u0000[Content_Types].xml (sellerops synthetic)'`;

/** The consent-dialog shapes under proof. */
type Kase =
  | "confirm" // 취소 + 확인, export context → the 확인 is the single primary action
  | "agree" // 취소 + 동의, export context → the 동의 is the single primary action
  | "two-dialogs" // TWO export-context dialogs each with a primary → ambiguous
  | "two-primaries" // one export-context dialog with 확인 AND 동의 → ambiguous
  | "aria-no-action" // role=dialog, export context, only 취소 (no primary) → export-dialog-no-action
  | "no-context" // 취소 + 확인 but body has NO export context → no-export-dialog
  | "bare-global"; // a 확인 OUTSIDE any dialog, export context only on the page → never matched

/**
 * A review-export page whose export click raises the consent dialog described by `kase`, built
 * DYNAMICALLY on the click (so no export/consent wording sits in the first-locate HTML). For the
 * matched shapes the primary action fires the download directly, as the live consent does.
 */
const casePage = (kase: Kase): string => `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui;margin:0;padding:24px} a,button{display:inline-block;padding:10px 18px}
    .dlg{position:fixed;inset:28% 22%;background:#fff;border:1px solid #888;padding:20px}
    .dlg#dlgB{inset:auto 8% 8% auto}
  </style></head><body>
    <h1>리뷰 관리 (합성 픽스처)</h1>
    <table><tbody><tr><td>합성 행 A</td><td>★★★★☆</td></tr></tbody></table>
    <div class="toolbar"><a id="exp" href="#">엑셀 다운로드</a></div>
    <div id="host"></div>
    <script>
      (function(){
        var KASE = ${JSON.stringify(kase)};
        var blobUrl = URL.createObjectURL(new Blob([${XLSX_BLOB}], { type: 'application/octet-stream' }));
        function fireDownload(){
          var a = document.createElement('a'); a.href = blobUrl; a.download = 'review-export.xlsx';
          document.body.appendChild(a); a.click();
        }
        function btn(id, label, fn){
          var b = document.createElement('button'); b.id = id; b.textContent = label;
          if (fn) b.addEventListener('click', fn); return b;
        }
        // opts: { id, role?, ctx:boolean, cancel:boolean, primaries:[{id,label}], onPrimary:boolean }
        function dialog(opts){
          var d = document.createElement('div'); d.id = opts.id; d.className = 'dlg';
          if (opts.role) d.setAttribute('role', opts.role);
          var p = document.createElement('p');
          p.textContent = opts.ctx
            ? '리뷰 엑셀 다운로드 이용에 동의하시면 파일이 저장됩니다 (합성 동의창)'
            : '계속 진행하시겠습니까 (합성 확인창)';
          d.appendChild(p);
          if (opts.cancel) d.appendChild(btn(opts.id + '-cancel', '취소'));
          (opts.primaries || []).forEach(function(pr){ d.appendChild(btn(pr.id, pr.label, opts.onPrimary ? fireDownload : null)); });
          document.getElementById('host').appendChild(d);
        }
        function build(){
          if (KASE === 'confirm') dialog({ id:'dlg1', ctx:true, cancel:true, primaries:[{id:'ok1',label:'확인'}], onPrimary:true });
          else if (KASE === 'agree') dialog({ id:'dlg1', ctx:true, cancel:true, primaries:[{id:'ok1',label:'동의'}], onPrimary:true });
          else if (KASE === 'two-dialogs'){
            dialog({ id:'dlgA', ctx:true, cancel:true, primaries:[{id:'okA',label:'확인'}], onPrimary:true });
            dialog({ id:'dlgB', ctx:true, cancel:true, primaries:[{id:'okB',label:'확인'}], onPrimary:true });
          }
          else if (KASE === 'two-primaries') dialog({ id:'dlg1', ctx:true, cancel:true, primaries:[{id:'ok1',label:'확인'},{id:'ok2',label:'동의'}], onPrimary:true });
          else if (KASE === 'aria-no-action') dialog({ id:'dlg1', role:'dialog', ctx:true, cancel:true, primaries:[] });
          else if (KASE === 'no-context') dialog({ id:'dlg1', ctx:false, cancel:true, primaries:[{id:'ok1',label:'확인'}], onPrimary:true });
          else if (KASE === 'bare-global'){
            // A generic 확인 with NO surrounding dialog; export context is only the page toolbar text.
            document.getElementById('host').appendChild(btn('ok1', '확인', fireDownload));
          }
        }
        document.getElementById('exp').addEventListener('click', function(e){ e.preventDefault(); setTimeout(build, ${DLG_DELAY_MS}); });
      })();
    </script>
  </body></html>`;

/** No synthetic page string may reach a driver result. */
const NEEDLES = ["리뷰 관리", "합성", "엑셀", "다운로드", "내려받기", "확인", "동의", "취소", "이용", "저장", "동의창", "review-export", ".xlsx", "blob:", "dlg", "host"];

describe.skipIf(!RUN)("NaverLiveProbeDriver contextual-dialog continuation DISCOVERY (Run 7 attempt-6 shape)", () => {
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

  function newDriver(detectMs: number): NaverLiveProbeDriver {
    const d = mkdtempSync(join(tmpdir(), "aw-live-dlg-"));
    dirs.push(d);
    return new NaverLiveProbeDriver(page, {
      quarantineDir: d,
      ingest: () => Promise.reject(new Error("ingest is out of scope for discovery proofs")),
      downloadTimeoutMs: detectMs,
      continuationObserveTimeoutMs: CONTINUATION_OBSERVE_MS,
      continuationPollMs: POLL_MS,
      ...(HEADED ? { observeTimeoutMs: 240_000 } : {}),
    });
  }

  /** locate → highlight → arm → (seller clicks export) → observed → verify — the engine's order. */
  async function driveToDetectStart(kase: Kase, detectMs: number): Promise<NaverLiveProbeDriver> {
    page = await browser.newPage();
    const driver = newDriver(detectMs);
    await page.setContent(casePage(kase));
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
    for (const n of NEEDLES) expect(blob.includes(n.toLowerCase()), `leaked "${n}"`).toBe(false);
    expect(findProhibitedFields({ detected })).toEqual([]);
  }

  for (const kase of ["confirm", "agree"] as const) {
    it(
      `MATCHED: a generic ${kase === "confirm" ? "확인" : "동의"} inside an export-context dialog is the single tagged primary action`,
      async () => {
        const driver = await driveToDetectStart(kase, DETECT_MS);
        const detectP = driver.detectDownload();
        // The generic control carries NO export wording of its own — only the dialog context makes it
        // the continuation. This is the assertion attempt 6 failed live (checkpoints:0).
        await page.waitForSelector("#ok1[data-aw-target]", { timeout: DETECT_MS });
        expect(await page.locator('[data-aw-label="review-export-continuation"]').count()).toBe(1);
        expect(await page.locator("#dlg1-cancel[data-aw-target]").count()).toBe(0); // 취소 is NEVER tagged
        expect(await page.locator("#exp[data-aw-target]").count()).toBe(0); // tag moved off the export control
        expect(await overlayMounted(page)).toBe(true);
        if (!HEADED) await page.click("#ok1"); // TEST-ONLY: the seller clicks the generic consent control
        const detected = await detectP; // the download begins automatically after the consent
        expect(detected.detected).toBe(true);
        expect(detected.artifactRef).toMatch(HEX16);
        expect(driver.lastContinuation()).toEqual({ checkpoints: 1, observedLast: true, ambiguous: false, dialog: "matched" });
        assertSanitized(driver, detected);
        await driver.cleanup();
      },
      HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
    );
  }

  it(
    "fail closed: TWO eligible export-context dialogs → ambiguous, nothing tagged",
    async () => {
      const driver = await driveToDetectStart("two-dialogs", FAILCLOSED_DETECT_MS);
      const detected = await driver.detectDownload();
      expect(detected).toEqual({ detected: false });
      expect(driver.lastContinuation()).toEqual({ checkpoints: 0, observedLast: false, ambiguous: true, dialog: "export-dialog-no-action" });
      expect(await page.locator('[data-aw-label="review-export-continuation"]').count()).toBe(0);
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );

  it(
    "fail closed: TWO primary actions in one export dialog (확인 AND 동의) → ambiguous, nothing tagged",
    async () => {
      const driver = await driveToDetectStart("two-primaries", FAILCLOSED_DETECT_MS);
      const detected = await driver.detectDownload();
      expect(detected).toEqual({ detected: false });
      expect(driver.lastContinuation()).toEqual({ checkpoints: 0, observedLast: false, ambiguous: true, dialog: "export-dialog-no-action" });
      expect(await page.locator('[data-aw-label="review-export-continuation"]').count()).toBe(0);
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );

  it(
    'diagnostic "export-dialog-no-action": an export-context dialog with no unique primary action → fail closed, nothing tagged',
    async () => {
      const driver = await driveToDetectStart("aria-no-action", FAILCLOSED_DETECT_MS);
      const detected = await driver.detectDownload();
      expect(detected).toEqual({ detected: false });
      expect(driver.lastContinuation()).toEqual({ checkpoints: 0, observedLast: false, ambiguous: false, dialog: "export-dialog-no-action" });
      expect(await page.locator('[data-aw-label="review-export-continuation"]').count()).toBe(0);
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );

  it(
    'diagnostic "no-export-dialog": a 확인/취소 dialog whose body lacks export context is NOT an export dialog',
    async () => {
      const driver = await driveToDetectStart("no-context", FAILCLOSED_DETECT_MS);
      const detected = await driver.detectDownload();
      expect(detected).toEqual({ detected: false });
      expect(driver.lastContinuation()).toEqual({ checkpoints: 0, observedLast: false, ambiguous: false, dialog: "no-export-dialog" });
      expect(await page.locator('[data-aw-label="review-export-continuation"]').count()).toBe(0);
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );

  it(
    "never bare-global: a generic 확인 OUTSIDE any dialog is not matched even with export context on the page",
    async () => {
      const driver = await driveToDetectStart("bare-global", FAILCLOSED_DETECT_MS);
      const detected = await driver.detectDownload();
      expect(detected).toEqual({ detected: false });
      expect(driver.lastContinuation()).toEqual({ checkpoints: 0, observedLast: false, ambiguous: false, dialog: "no-export-dialog" });
      expect(await page.locator('[data-aw-label="review-export-continuation"]').count()).toBe(0);
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );
});
