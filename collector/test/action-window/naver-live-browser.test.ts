/**
 * **LIVE NAVER driver real-DOM seam proof (RUN_INTEGRATION=1; headed = AW_HEADED=1).** Drives the
 * `NaverLiveProbeDriver` over a REAL Chromium page shaped like a seller-center review export surface —
 * but, unlike `naver-browser.test.ts`, the page has NO pre-applied `data-aw-target`, so this proves the
 * live driver's own in-page target BINDING (`locate` tagging) + the generic overlay/observer/read-only
 * download/quarantine seams over real markup. The page is 100% synthetic (no marketplace trademark/
 * markup/seller data) and NOTHING here touches live NAVER or the network — ingest is an injected fake.
 *
 * The driver's `prepareSurface` session gate is covered hermetically in `naver-live-driver.test.ts`
 * (a real seller-center URL cannot be faked via `setContent`), so this proof begins at `locate`.
 *
 *   # automated (TEST-ONLY simulated click), headless:
 *   RUN_INTEGRATION=1 npx vitest run test/action-window/naver-live-browser.test.ts
 *   # headed operator proof — a HUMAN performs the real export click in the visible window:
 *   RUN_INTEGRATION=1 AW_HEADED=1 npx vitest run test/action-window/naver-live-browser.test.ts
 *
 * The ONLY click on the target is the TEST-ONLY `page.click(...)` (automated) or the real human click
 * (headed). No production Action Window code clicks — the Runtime only observes.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { findProhibitedFields } from "../../../contracts/action-window/v1/index";
import { NaverLiveProbeDriver } from "../../src/action-window/naver-live-driver";
import { overlayMounted } from "../../src/action-window/overlay";
import type { AwIngestSource, AwIngestOutcome } from "../../src/action-window/ingest-handoff";

const RUN = process.env.RUN_INTEGRATION === "1";
const HEADED = process.env.AW_HEADED === "1";
const HEX16 = /^[0-9a-f]{16}$/;
const HEADED_CLICK_WAIT_MS = 240_000;

/** OOXML-shaped synthetic blob (ZIP magic all single-byte, so UTF-8 keeps the magic) — not a real book. */
const XLSX_BLOB = `'PK\\u0003\\u0004\\u0014\\u0000\\u0000\\u0000\\u0008\\u0000[Content_Types].xml (sellerops synthetic)'`;
/** A non-OOXML payload under an .xlsx name — the quarantine magic-sniff fail-closed shape. */
const BADMAGIC_BLOB = `'<html><body>오류 안내 (합성)</body></html>'`;

/** A review-export-shaped page with an Excel-download anchor and NO `data-aw-target` (the driver tags it). */
const livePage = (blobLiteral: string): string => `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui;margin:0;padding:24px} a{display:inline-block;padding:10px 18px}
  </style></head><body>
    <h1>리뷰 관리 (합성 픽스처)</h1>
    <table><tbody><tr><td>합성 행 A</td><td>★★★★☆</td></tr></tbody></table>
    <div class="toolbar"><a id="exp" download="review-export.xlsx" href="#">엑셀 다운로드</a></div>
    <script>
      (function(){ var t = document.getElementById('exp');
        t.setAttribute('href', URL.createObjectURL(new Blob([${blobLiteral}], { type: 'application/octet-stream' })));
      })();
    </script>
  </body></html>`;

/** No synthetic page string may ever reach the injected ingest source or a driver result. */
const NEEDLES = ["리뷰 관리", "합성", "엑셀", "다운로드", "review-export", ".xlsx", "content_types", "blob:", "exp"];

interface CapturedIngest {
  bytesHead: number[];
  artifactRef: string;
  keys: string[];
}

function capturingUpload(box: { captured: CapturedIngest | null }) {
  return (src: AwIngestSource): Promise<AwIngestOutcome> => {
    const bytes = src.bytes();
    box.captured = { bytesHead: Array.from(bytes.slice(0, 4)), artifactRef: src.artifactRef, keys: Object.keys(src) };
    return Promise.resolve({ ok: true, processed: 1 });
  };
}

describe.skipIf(!RUN)("NaverLiveProbeDriver real-DOM seams (locate-tag → overlay → observe → detect → quarantine)", () => {
  let browser: Browser;
  let page: Page;
  const dirs: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch({ headless: !HEADED });
  });
  afterAll(async () => {
    await browser?.close();
  });
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function newQuarantineDir(): string {
    const d = mkdtempSync(join(tmpdir(), "aw-live-q-"));
    dirs.push(d);
    return d;
  }

  it("automated: bind untagged control → highlight → observed click → real download → quarantine validate → ingest", async () => {
    page = await browser.newPage();
    const quarantineDir = newQuarantineDir();
    const box: { captured: CapturedIngest | null } = { captured: null };
    const driver = new NaverLiveProbeDriver(page, { quarantineDir, ingest: capturingUpload(box) });
    await page.setContent(livePage(XLSX_BLOB));

    const located = await driver.locate();
    expect(located.count).toBe(1);
    expect(located.sig).toMatch(HEX16);
    // The driver bound the previously-untagged control so the generic seams can attach.
    expect(await page.locator("[data-aw-target]").count()).toBe(1);

    expect(await overlayMounted(page)).toBe(false);
    await driver.highlight();
    expect(await overlayMounted(page)).toBe(true);

    await driver.armObserve();
    await page.click("[data-aw-target]"); // TEST-ONLY: stands in for the seller's own click
    expect(await driver.waitForUserAction()).toBe(true);

    expect(await driver.verify(located.sig!)).toEqual({ verified: true, drift: false });

    const detected = await driver.detectDownload();
    expect(detected.detected).toBe(true);
    expect(detected.artifactRef).toMatch(HEX16);

    expect(await driver.validateArtifact(detected.artifactRef!)).toEqual({ valid: true });
    expect(readdirSync(quarantineDir)).toEqual([]); // deleted after validate

    expect(await driver.ingest(detected.artifactRef!)).toEqual({ ok: true, processed: 1 });
    // The injected ingest received the validated OOXML bytes under the opaque ref — no filename.
    expect(box.captured!.bytesHead).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(box.captured!.artifactRef).toBe(detected.artifactRef);
    expect(box.captured!.keys).toEqual(["bytes", "artifactRef"]);

    await driver.cleanup();
    expect(await overlayMounted(page)).toBe(false);

    // No page content / wording / filename crossed into any sanitized result or the ingest ref.
    const blob = JSON.stringify([located, detected, { ref: box.captured!.artifactRef, keys: box.captured!.keys }]).toLowerCase();
    for (const needle of NEEDLES) expect(blob.includes(needle.toLowerCase()), `leaked "${needle}"`).toBe(false);
    expect(findProhibitedFields({ located, detected })).toEqual([]);
    await page.close();
  });

  it("automated: an xlsx-named download whose bytes are not OOXML fails closed ARTIFACT_INVALID; dir empty", async () => {
    page = await browser.newPage();
    const quarantineDir = newQuarantineDir();
    const driver = new NaverLiveProbeDriver(page, { quarantineDir, ingest: () => Promise.resolve({ ok: false, processed: 0 }) });
    await page.setContent(livePage(BADMAGIC_BLOB));

    const located = await driver.locate();
    expect(located.count).toBe(1);
    await driver.highlight();
    await driver.armObserve();
    await page.click("[data-aw-target]");
    expect(await driver.waitForUserAction()).toBe(true);
    expect(await driver.verify(located.sig!)).toEqual({ verified: true, drift: false });

    const detected = await driver.detectDownload();
    expect(detected.detected).toBe(true);
    expect(await driver.validateArtifact(detected.artifactRef!)).toEqual({ valid: false });
    expect(readdirSync(quarantineDir)).toEqual([]); // fail-closed cleanup still empties the dir
    await driver.cleanup();
    await page.close();
  });

  it.skipIf(!HEADED)("headed: a REAL human export click drives bind → detect → quarantine validate", async () => {
    page = await browser.newPage();
    const quarantineDir = newQuarantineDir();
    const box: { captured: CapturedIngest | null } = { captured: null };
    const driver = new NaverLiveProbeDriver(page, {
      quarantineDir,
      ingest: capturingUpload(box),
      observeTimeoutMs: HEADED_CLICK_WAIT_MS,
    });
    await page.setContent(livePage(XLSX_BLOB));

    const located = await driver.locate();
    expect(located.count).toBe(1);
    await driver.highlight();
    await driver.armObserve();
    // No TEST click — a seated human clicks the highlighted control in the visible window.
    expect(await driver.waitForUserAction()).toBe(true);
    expect(await driver.verify(located.sig!)).toEqual({ verified: true, drift: false });

    const detected = await driver.detectDownload();
    expect(detected.detected).toBe(true);
    expect(await driver.validateArtifact(detected.artifactRef!)).toEqual({ valid: true });
    expect(readdirSync(quarantineDir)).toEqual([]);
    expect(await driver.ingest(detected.artifactRef!)).toEqual({ ok: true, processed: 1 });
    await driver.cleanup();
    await page.close();
  });
});
