/**
 * **Continuation-candidate DISCOVERY proof (RUN_INTEGRATION=1; headed = AW_HEADED=1).** Run 7
 * attempt 4 (2026-07-24) failed closed with `continuation {checkpoints:0}`: the live NAVER surface
 * showed a SECOND operator-required download control after the first export confirmation, but
 * `markContinuationTarget` matched NOTHING on any poll (dispatch record §19.3). Reclassified — with
 * the operator — as a candidate-DISCOVERY defect, not a timing miss: §17's multi-checkpoint runtime
 * DID poll, it simply never RECOGNISED the live control.
 *
 * These drive the real `NaverLiveProbeDriver` over 100% synthetic pages (no marketplace markup /
 * trademark / data, no network) modelling a NAVER-native modal after the first export confirmation,
 * with the actual download action represented as each likely real shape:
 *
 *   1) a native <button>            2) an <a> anchor        3) a role-less clickable <div>
 *   4) a portal-hosted modal (appended to <body>)          5) a delayed enabled control
 *
 * Every shape must be DISCOVERED read-only, re-tagged, HIGHLIGHTED, and awaited — the Runtime never
 * clicks. Wording spans the operator's audit list (엑셀 파일 생성 / 파일 다운로드 / 다운로드 요청 / 엑셀 내려받기).
 * Ambiguity still fails closed (a separate pin, below).
 *
 * NOTE: the control wording is injected via a JS global AFTER first-locate, never baked into the page
 * source — otherwise the always-present script text (e.g. "다운로드 요청", whose "요청" is an async-job
 * marker) would pollute the first-locate HTML scan. The modal still RENDERS the real wording.
 *
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/naver-live-continuation-shapes.test.ts
 *   RUN_INTEGRATION=1 AW_HEADED=1 npx vitest run test/action-window/naver-live-continuation-shapes.test.ts
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
const CONTINUATION_OBSERVE_MS = HEADED ? 240_000 : 1_500;
const POLL_MS = 100;
const NOTIF_DELAY_MS = HEADED ? 3_000 : 400;
const ENABLE_DELAY_MS = HEADED ? 3_000 : 500;
const HEADED_TEST_TIMEOUT_MS = 600_000;

const XLSX_BLOB = `'PK\\u0003\\u0004\\u0014\\u0000\\u0000\\u0000\\u0008\\u0000[Content_Types].xml (sellerops synthetic)'`;

/** How the modal's actual download control is realised — the five audited real shapes. */
type Shape = "button" | "anchor" | "roleless" | "portal" | "delayed";

/** The wording each shape's control carries (operator's audit list). Injected post-locate, never baked in. */
const WORDING: Record<Shape, string> = {
  button: "엑셀 파일 생성",
  anchor: "파일 다운로드",
  roleless: "다운로드 요청",
  portal: "다운로드",
  delayed: "엑셀 내려받기",
};

/**
 * A review-export-shaped page: native-anchor first control → 확인 dialog → NAVER-native modal whose
 * download control is `shape`. The control text is read from `window.__CTL_TEXT__` (injected before
 * the export click) so no export/async wording sits in the page source at first-locate. For `portal`
 * the modal is appended straight to <body> rather than an in-flow container.
 */
const shapePage = (shape: Shape): string => `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui;margin:0;padding:24px} a,button{display:inline-block;padding:10px 18px}
    #dlg1{display:none;position:fixed;inset:30% 22%;background:#fff;border:1px solid #888;padding:20px}
    #modal{display:none;position:fixed;right:16px;bottom:16px;background:#f6f8ff;border:1px solid #99a;padding:16px}
    .clickable{cursor:pointer;padding:10px 18px;display:inline-block;border:1px solid #77a}
  </style></head><body>
    <h1>리뷰 관리 (합성 픽스처)</h1>
    <table><tbody><tr><td>합성 행 A</td><td>★★★★☆</td></tr></tbody></table>
    <div class="toolbar"><a id="exp" href="#">엑셀 다운로드</a></div>
    <div id="dlg1"></div>
    <div id="modal"></div>
    <script>
      (function(){
        var SHAPE = ${JSON.stringify(shape)};
        var blobUrl = URL.createObjectURL(new Blob([${XLSX_BLOB}], { type: 'application/octet-stream' }));
        function fireDownload(){
          var a = document.createElement('a');
          a.href = blobUrl; a.download = 'review-export.xlsx';
          document.body.appendChild(a); a.click();
        }
        (window).__fire = fireDownload; // exposed so injected-control review tests can trigger a download
        function ctlText(){ return String((window).__CTL_TEXT__ || 'x'); }
        function makeControl(){
          if (SHAPE === 'anchor'){
            var a = document.createElement('a'); a.id='ctl'; a.href='#'; a.textContent=ctlText();
            a.addEventListener('click', function(e){ e.preventDefault(); fireDownload(); }); return a;
          }
          if (SHAPE === 'roleless'){
            // A styled, clickable DIV with NO role and NO tabindex — a real custom-control shape.
            var d = document.createElement('div'); d.id='ctl'; d.className='clickable';
            d.textContent=ctlText(); d.addEventListener('click', fireDownload); return d;
          }
          if (SHAPE === 'delayed'){
            var b = document.createElement('button'); b.id='ctl'; b.textContent=ctlText();
            b.disabled = true; b.addEventListener('click', fireDownload);
            setTimeout(function(){ b.disabled = false; }, ${ENABLE_DELAY_MS}); return b;
          }
          // 'button' and 'portal' both use a native button; they differ only in WHERE it mounts.
          var b2 = document.createElement('button'); b2.id='ctl'; b2.textContent=ctlText();
          b2.addEventListener('click', fireDownload); return b2;
        }
        function showModal(){
          var host;
          if (SHAPE === 'portal'){
            host = document.createElement('div');
            host.style.cssText = 'position:fixed;left:30%;top:30%;background:#fff;border:1px solid #888;padding:20px';
            document.body.appendChild(host);
          } else {
            host = document.getElementById('modal'); host.style.display = 'block';
          }
          var p = document.createElement('p'); p.textContent = '파일이 준비되었습니다 (합성 알림창)';
          host.appendChild(p); host.appendChild(makeControl());
        }
        function showDialog(){
          var d = document.getElementById('dlg1');
          var p = document.createElement('p'); p.textContent = '진행할까요 (합성창)';
          d.appendChild(p);
          var ok = document.createElement('button'); ok.id='ok1'; ok.textContent='확인';
          ok.addEventListener('click', function(){
            d.style.display='none'; d.replaceChildren();
            setTimeout(showModal, ${NOTIF_DELAY_MS});
          });
          d.appendChild(ok); d.style.display='block';
        }
        document.getElementById('exp').addEventListener('click', function(e){ e.preventDefault(); showDialog(); });
      })();
    </script>
  </body></html>`;

const NEEDLES = ["리뷰 관리", "합성", "엑셀", "다운로드", "내려받기", "요청", "생성", "확인", "알림", "review-export", ".xlsx", "blob:", "modal", "ctl"];

describe.skipIf(!RUN)("NaverLiveProbeDriver continuation candidate DISCOVERY (Run 7 attempt-4 shapes)", () => {
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

  function newDriver(): NaverLiveProbeDriver {
    const d = mkdtempSync(join(tmpdir(), "aw-live-shape-"));
    dirs.push(d);
    return new NaverLiveProbeDriver(page, {
      quarantineDir: d,
      ingest: () => Promise.reject(new Error("ingest is out of scope for discovery proofs")),
      downloadTimeoutMs: DETECT_MS,
      continuationObserveTimeoutMs: CONTINUATION_OBSERVE_MS,
      continuationPollMs: POLL_MS,
      ...(HEADED ? { observeTimeoutMs: 240_000 } : {}),
    });
  }

  async function driveToDetectStart(shape: Shape): Promise<NaverLiveProbeDriver> {
    page = await browser.newPage();
    const driver = newDriver();
    await page.setContent(shapePage(shape));
    // Inject the control wording as a global AFTER content is set but BEFORE first-locate: it reaches
    // the modal (rendered on confirm) without ever appearing in the first-locate HTML scan.
    await page.evaluate((t) => ((window as unknown as Record<string, unknown>).__CTL_TEXT__ = t), WORDING[shape]);
    const located = await driver.locate();
    expect(located.count).toBe(1);
    await driver.highlight();
    await driver.armObserve();
    if (!HEADED) await page.click("[data-aw-target]"); // TEST-ONLY: the seller's export click
    expect(await driver.waitForUserAction()).toBe(true);
    expect(await driver.verify(located.sig!)).toEqual({ verified: true, drift: false });
    return driver;
  }

  const SHAPES: Shape[] = ["button", "anchor", "roleless", "portal", "delayed"];

  for (const shape of SHAPES) {
    it(
      `discovers the modal's download control when it is a ${shape}: highlighted, awaited, then DETECTED on the operator click`,
      async () => {
        const driver = await driveToDetectStart(shape);
        const detectP = driver.detectDownload();
        if (!HEADED) await page.click("#ok1"); // TEST-ONLY: the seller confirms the 확인 dialog
        // The driver must find the NEW control (whatever its element type), move the tag, highlight —
        // WITHOUT clicking. This is the assertion attempt 4 failed live (checkpoints:0).
        await page.waitForSelector('[data-aw-label="review-export-continuation"]', { timeout: DETECT_MS });
        expect(await page.locator("#ctl[data-aw-target]").count()).toBe(1);
        expect(await page.locator("#exp[data-aw-target]").count()).toBe(0); // tag MOVED off the original
        expect(await overlayMounted(page)).toBe(true);
        if (!HEADED) await page.click("#ctl"); // TEST-ONLY: the seller acts on the highlighted checkpoint
        const detected = await detectP;
        expect(detected.detected).toBe(true);
        expect(detected.artifactRef).toMatch(HEX16);
        expect(driver.lastContinuation()).toEqual({ checkpoints: 1, observedLast: true, ambiguous: false });
        // No synthetic page string may reach a driver result.
        const blob = JSON.stringify([detected, driver.lastContinuation()]).toLowerCase();
        for (const n of NEEDLES) expect(blob.includes(n.toLowerCase()), `leaked "${n}"`).toBe(false);
        expect(findProhibitedFields({ detected })).toEqual([]);
        await driver.cleanup();
      },
      HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
    );
  }

  it(
    "fail closed on ambiguity: a native button AND a role-less clickable both carry download wording → nothing tagged",
    async () => {
      const driver = await driveToDetectStart("button");
      const detectP = driver.detectDownload();
      // Render TWO wording-matched controls AT ONCE — a native button AND a role-less clickable — so a
      // single poll sees both: ambiguity, never a guess (injected together to avoid a tag-then-inject race).
      await page.evaluate(() => {
        const host = document.getElementById("modal") as HTMLElement;
        host.style.display = "block";
        const b = document.createElement("button");
        b.textContent = "엑셀 파일 생성";
        const d = document.createElement("div");
        d.className = "clickable";
        d.textContent = "엑셀 내려받기";
        host.append(b, d);
      });
      const detected = await detectP;
      expect(detected).toEqual({ detected: false });
      expect(driver.lastContinuation()).toEqual({ checkpoints: 0, observedLast: false, ambiguous: true });
      expect(await page.locator('[data-aw-label="review-export-continuation"]').count()).toBe(0);
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );

  it(
    "inherited cursor:pointer is NOT enough: instructional text under a pointer region is ignored, only the control resolves",
    async () => {
      // The inherited-pointer review case: the modal region carries cursor:pointer, so a non-interactive
      // <p> of instructional text (which happens to contain export wording) INHERITS pointer. A bare
      // pointer test would make it a phantom candidate → false ambiguity. The introduces-pointer rule
      // must ignore it and resolve to the single real control.
      const driver = await driveToDetectStart("button");
      const detectP = driver.detectDownload();
      await page.evaluate(() => {
        const host = document.getElementById("modal") as HTMLElement;
        host.style.display = "block";
        host.style.cursor = "pointer"; // whole region → children inherit pointer
        const p = document.createElement("p");
        p.textContent = "엑셀 다운로드 관련 안내입니다"; // wording, but NOT interactive (inherits pointer only)
        const b = document.createElement("button");
        b.id = "ctl";
        b.textContent = "파일 다운로드";
        b.addEventListener("click", () => (window as unknown as { __fire(): void }).__fire());
        host.append(p, b);
      });
      await page.waitForSelector("#ctl[data-aw-target]", { timeout: DETECT_MS });
      expect(await page.locator('[data-aw-label="review-export-continuation"]').count()).toBe(1);
      if (!HEADED) await page.click("#ctl");
      const detected = await detectP;
      expect(detected.detected).toBe(true);
      expect(driver.lastContinuation()).toEqual({ checkpoints: 1, observedLast: true, ambiguous: false });
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );

  it(
    "a clickable wrapper whose text sits in a child resolves to the wrapper (the click target), not the inner text",
    async () => {
      const driver = await driveToDetectStart("button");
      const detectP = driver.detectDownload();
      await page.evaluate(() => {
        const host = document.getElementById("modal") as HTMLElement;
        host.style.display = "block";
        // The clickable is the DIV (owns the listener + introduces pointer); its wording is in a child
        // <span> (which only inherits pointer). We must tag the DIV, not the span.
        const wrap = document.createElement("div");
        wrap.id = "ctl";
        wrap.className = "clickable";
        const span = document.createElement("span");
        span.id = "inner";
        span.textContent = "다운로드 요청";
        wrap.appendChild(span);
        wrap.addEventListener("click", () => (window as unknown as { __fire(): void }).__fire());
        host.appendChild(wrap);
      });
      await page.waitForSelector('[data-aw-label="review-export-continuation"]', { timeout: DETECT_MS });
      expect(await page.locator("#ctl[data-aw-target]").count()).toBe(1); // the wrapper, not #inner
      expect(await page.locator("#inner[data-aw-target]").count()).toBe(0);
      if (!HEADED) await page.click("#ctl");
      const detected = await detectP;
      expect(detected.detected).toBe(true);
      expect(driver.lastContinuation()).toEqual({ checkpoints: 1, observedLast: true, ambiguous: false });
      await driver.cleanup();
    },
    HEADED ? HEADED_TEST_TIMEOUT_MS : 30_000,
  );
});
