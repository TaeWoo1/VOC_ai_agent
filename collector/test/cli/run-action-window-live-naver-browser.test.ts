/**
 * **Live-NAVER entrypoint ASSEMBLY proof over a real browser (RUN_INTEGRATION=1; headed = AW_HEADED=1).**
 *
 * This is the missing seam: `assembleLiveRun(page, deps)` — the ONLY place a real Playwright `Page`
 * meets the engine — is proven here for the first time. The gated live entrypoint's own assembly
 * (`assembleLiveRun` + the `driveOneRun` command sequence) drives the REAL `NaverLiveProbeDriver`
 * through a persistent Operation Run over a REAL Chromium page. Unlike `naver-live-browser.test.ts`
 * (which drives the driver primitives in isolation and skips `prepareSurface`), this exercises the FULL
 * engine chain the live command runs — **including the §8-4 session gate `prepareSurface`** — plus real
 * run-store persistence, then asserts the sanitized outcome + no leakage.
 *
 * 100% SYNTHETIC / OFFLINE. The page is a self-contained review-export fixture served locally via
 * `page.route(...).fulfill(...)` — no navigation to any marketplace, no network, no live NAVER, no
 * seller data. To satisfy the session gate's seller-center URL check WITHOUT touching NAVER, the
 * fixture is served from the synthetic host `commerce.localhost` (route-fulfilled, never resolved);
 * `urlCategory` classifies it "seller-center" purely from the "commerce" substring. Ingest is an
 * injected fake — nothing reaches `/api/uploads`. The only click on the target is the TEST-ONLY
 * `page.click(...)` (automated) or a real human click (headed); no production code clicks.
 *
 *   # automated (TEST-ONLY simulated click), headless:
 *   RUN_INTEGRATION=1 npx vitest run test/cli/run-action-window-live-naver-browser.test.ts
 *   # headed operator proof — a HUMAN performs the real export click in the visible window:
 *   RUN_INTEGRATION=1 AW_HEADED=1 npx vitest run test/cli/run-action-window-live-naver-browser.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { findProhibitedFields } from "../../../contracts/action-window/v1/index";
import {
  assembleLiveRun,
  driveOneRun,
  type LiveRunDeps,
} from "../../instruments/live-runs/run-action-window-live-naver";
import {
  NAVER_CHANNEL_CODE,
  NAVER_RUN_COPY_KEY,
  type NaverPrepareDiagnostic,
} from "../../src/action-window/naver-surface";
import { loadOperationRun } from "../../src/action-window/run-store";
import { overlayMounted } from "../../src/action-window/overlay";
import { getLogSink, clearLogSink, log } from "../../src/log";
import type { AwIngestSource, AwIngestOutcome } from "../../src/action-window/ingest-handoff";

const RUN = process.env.RUN_INTEGRATION === "1";
const HEADED = process.env.AW_HEADED === "1";
const HEX16 = /^[0-9a-f]{16}$/;
const HEADED_CLICK_WAIT_MS = 240_000;
/**
 * Per-test timeout for the headed case — MUST exceed the driver's human-click wait plus margin, else
 * vitest's default 5s cap kills the window before a seated human can click. Same pattern as
 * `naver-live-browser.test.ts`; only reached when the headed case runs (RUN_INTEGRATION && AW_HEADED).
 */
const HEADED_TEST_TIMEOUT_MS = HEADED_CLICK_WAIT_MS + 60_000;

/**
 * A SYNTHETIC seller-center URL. `urlCategory` (session-check.ts) classifies any URL containing
 * "commerce" as "seller-center", which the LOGGED_IN verdict requires. `commerce.localhost` is a
 * reserved-TLD synthetic host that is never resolved: `page.route(...)` fulfills the request locally, so
 * no network request is ever made and no NAVER host is referenced anywhere.
 */
const SELLER_CENTER_URL = "http://commerce.localhost/review-management";

/** OOXML-shaped synthetic blob (ZIP magic all single-byte, so UTF-8 keeps the magic) — not a real book. */
const XLSX_BLOB = `'PK\\u0003\\u0004\\u0014\\u0000\\u0000\\u0000\\u0008\\u0000[Content_Types].xml (sellerops synthetic)'`;
/** A non-OOXML payload under an .xlsx name — the quarantine magic-sniff fail-closed shape. */
const BADMAGIC_BLOB = `'<body>error (synthetic)</body>'`;

/**
 * A review-export-shaped page that passes the full session gate: a strong seller-center signal (the
 * export control), one data row (readiness READY), and an Excel-download anchor with NO `data-aw-target`
 * (the driver tags it). No password/CAPTCHA/reconnect markers, so the verdict is LOGGED_IN.
 */
const sellerCenterPage = (blobLiteral: string): string => `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui;margin:0;padding:24px} a{display:inline-block;padding:10px 18px}
  </style></head><body>
    <nav id="seller-gnb">메뉴</nav>
    <h1>리뷰 관리 (합성 픽스처)</h1>
    <table><tbody><tr><td>합성 행 A</td><td>★★★★☆</td></tr></tbody></table>
    <div class="toolbar"><a id="exp" download="review-export.xlsx" href="#">엑셀 다운로드</a></div>
    <script>
      (function(){ var t = document.getElementById('exp');
        t.setAttribute('href', URL.createObjectURL(new Blob([${blobLiteral}], { type: 'application/octet-stream' })));
      })();
    </script>
  </body></html>`;

/** A synthetic account-login page — a real password field with no reconnect card → ACCOUNT_LOGIN_REQUIRED. */
const loginPage = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <h1>로그인</h1>
    <form><input type="password" name="pw" aria-label="password"></form>
  </body></html>`;

/**
 * A READY review-export surface carrying a date picker whose `value` ATTRIBUTE is EMPTY. The test sets
 * its live `.value` IDL property in-page (which does NOT reflect to the attribute) to model exactly the
 * SPA shape D-025 names: `page.content()` serializes `value=""`, so the attribute regex is blind, while
 * the driver's IDL overlay sees the selection. One data row keeps readiness READY.
 */
const rangePickerPage = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <nav id="seller-gnb">메뉴</nav>
    <h1>리뷰 관리 (합성 픽스처)</h1>
    <table><tbody><tr><td>합성 행 A</td><td>★★★★☆</td></tr></tbody></table>
    <div class="toolbar"><input type="date" id="startDate" value=""></div>
  </body></html>`;

/** No synthetic page string may ever reach a persisted record, a wire frame, or the injected ingest ref. */
const NEEDLES = ["리뷰 관리", "합성", "엑셀", "다운로드", "review-export", ".xlsx", "content_types", "blob:", "commerce.localhost", "exp"];

/**
 * The needles for the LOG surface — `NEEDLES` minus the fixture's `id="exp"`.
 *
 * ⚠ Not a relaxation: `"exp"` is a 3-char substring of the SANITIZED readiness enums the live CLI
 * legitimately logs (`EXPORT_TARGET_EMPTY`, `no_export_target`, `EXPORT_DATE_RANGE_REQUIRED`, …), so
 * sweeping the log with it asserts nothing about leakage and fails on a correct diagnostic the moment
 * readiness HALTs. That is exactly the false-failure class `collector/CLAUDE.md` §5 warns about. Every
 * needle that could only come from the page — its wording, filename, blob URL, and host — still applies.
 */
const LOG_NEEDLES = NEEDLES.filter((n) => n !== "exp");

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

describe.skipIf(!RUN)("run-action-window-live-naver — assembleLiveRun over a real browser (session gate → persisted run)", () => {
  let browser: Browser;
  const dirs: string[] = [];
  const pages: Page[] = [];

  beforeAll(async () => {
    browser = await chromium.launch({ headless: !HEADED });
  });
  afterAll(async () => {
    await browser?.close();
  });
  afterEach(async () => {
    for (const p of pages.splice(0)) await p.close().catch(() => {});
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function newDir(prefix: string): string {
    const d = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(d);
    return d;
  }

  async function newPage(): Promise<Page> {
    const page = await browser.newPage();
    pages.push(page);
    return page;
  }

  /**
   * Serve a MUTABLE body from the seller-center-category host — no network, no live NAVER.
   *
   * The route handler closes over the BOX, not over a string, so a later navigation genuinely fetches
   * whatever the box holds by then. That is what lets a test model a seller logging in: the recovery
   * case swaps the body and re-navigates, and the driver's re-probe reads a real, different page.
   */
  async function serveBox(page: Page, box: { body: string }): Promise<void> {
    await page.route("**/*", (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: box.body }),
    );
    await page.goto(SELLER_CENTER_URL, { waitUntil: "domcontentloaded" });
  }

  /** Serve a FIXED body — a box that never changes. */
  async function serve(page: Page, body: string): Promise<void> {
    await serveBox(page, { body });
  }

  function makeDeps(
    box: { captured: CapturedIngest | null },
    quarantineDir: string,
    persistDir: string,
    runId: string,
    observeTimeoutMs: number,
    /** Short only where the case deliberately lets the barrier lapse; the default is the live value. */
    downloadTimeoutMs = 60_000,
  ): LiveRunDeps {
    return {
      quarantineDir,
      persistDir,
      ingest: capturingUpload(box),
      runConfig: { runId, channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY, guidanceEnabled: true },
      observeTimeoutMs,
      downloadTimeoutMs,
      declineIngest: false, // this suite proves the DEFAULT path: validate → ingest → COMPLETED.
    };
  }

  const logEvents = (): string[] => getLogSink().map((l) => l.event);
  const recoveryOutcomes = (): unknown[] =>
    getLogSink().filter((l) => l.event === "aw.live.recovery").map((l) => l.meta.outcome);

  it("automated: START_RUN → session gate → observed click → detect → validate → ingest → COMPLETED + persisted TERMINAL", async () => {
    const page = await newPage();
    await serve(page, sellerCenterPage(XLSX_BLOB));
    const quarantineDir = newDir("aw-live-cli-q-");
    const persistDir = newDir("aw-live-cli-p-");
    const runId = "run_a1a1b2b2c3c3";
    const box: { captured: CapturedIngest | null } = { captured: null };
    const assembled = assembleLiveRun(page, makeDeps(box, quarantineDir, persistDir, runId, 30_000));

    // START drives prepare(session gate)→locate(tag)→highlight→armObserve and parks at the human barrier.
    assembled.client.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
    await assembled.session.whenSettled();
    expect(assembled.client.view?.status).toBe("WAITING_FOR_HUMAN");
    expect(await overlayMounted(page)).toBe(true);

    // TEST-ONLY: the seller's own click. The observer was armed during START; the driver never clicks.
    await page.click("[data-aw-target]");
    // ⚠ Wait for the observation before rechecking — this case USED to race it and lost ~10 times in 11.
    // `watchUserAction` is untracked, so `whenSettled()` does not wait for it: rechecking immediately left
    // WAIT_FOR_USER_ACTION before the click landed, the stage guard dropped the observation, and
    // `humanCheckpoint.observed` below asserted true against a record that honestly said false. That is the
    // exact defect `40d7c53` fixed for the live path by making `driveOneRun` await this event — but this
    // case hand-rolls the command sequence, so it never received the fix. Waiting here is not a workaround:
    // it is what the production path does, so the assertion now tests the barrier instead of the clock.
    expect(await assembled.client.awaitEvent("USER_ACTION_OBSERVED", 5_000)).toBe(true);
    assembled.client.send("REQUEST_STEP_RECHECK");
    await assembled.session.whenSettled();

    const view = assembled.client.view;
    expect(view?.status).toBe("COMPLETED");
    expect(view?.channelCode).toBe(NAVER_CHANNEL_CODE);
    expect(view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });

    const detected = assembled.client.serverFrames.filter(
      (f) => f.kind === "aw_event" && f.event.type === "DOWNLOAD_DETECTED",
    );
    expect(detected).toHaveLength(1);

    // The injected ingest received the validated OOXML bytes under the opaque ref — no filename.
    expect(box.captured).not.toBeNull();
    expect(box.captured!.bytesHead).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(box.captured!.artifactRef).toMatch(HEX16);
    expect(box.captured!.keys).toEqual(["bytes", "artifactRef"]);

    expect(readdirSync(quarantineDir)).toEqual([]); // deleted after validate

    // The run persisted through to a terminal Operation Run — the live driver IS session-wired here.
    const persisted = loadOperationRun(persistDir, runId)!;
    expect(persisted).not.toBeNull();
    expect(persisted.channelCode).toBe(NAVER_CHANNEL_CODE);
    expect(persisted.latestView.status).toBe("COMPLETED");
    expect(persisted.resumeState).toBe("TERMINAL");
    expect(persisted.humanCheckpoint.observed).toBe(true);
    expect(persisted.tasks.every((t) => t.status === "COMPLETED")).toBe(true);

    // No page content / wording / filename crossed into any frame, the persisted record, or the ingest ref.
    const frameBlob = JSON.stringify(assembled.client.serverFrames).toLowerCase();
    const persistBlob = JSON.stringify(persisted).toLowerCase();
    const refBlob = JSON.stringify({ ref: box.captured!.artifactRef, keys: box.captured!.keys }).toLowerCase();
    for (const needle of NEEDLES) {
      const n = needle.toLowerCase();
      expect(frameBlob.includes(n), `frame leaked "${needle}"`).toBe(false);
      expect(persistBlob.includes(n), `persist leaked "${needle}"`).toBe(false);
      expect(refBlob.includes(n), `ref leaked "${needle}"`).toBe(false);
    }
    expect(findProhibitedFields(persisted)).toEqual([]);
    for (const frame of assembled.client.serverFrames) expect(findProhibitedFields(frame)).toEqual([]);
  });

  it("automated: a hostile session (login page) PARKS recoverable at the gate — LOGIN_REQUIRED, zero clicks, no download, persisted alive", async () => {
    const page = await newPage();
    await page.setContent(loginPage); // fails at the session gate regardless of URL — no seller-center host needed
    const quarantineDir = newDir("aw-live-cli-q-");
    const persistDir = newDir("aw-live-cli-p-");
    const runId = "run_d4d4e5e5f6f6";
    const box: { captured: CapturedIngest | null } = { captured: null };
    const assembled = assembleLiveRun(page, makeDeps(box, quarantineDir, persistDir, runId, 30_000));

    // A login page is a cause the SELLER can clear, so the run parks recoverable instead of failing
    // closed. `driveOneRun` must return at once: a park is WAITING_FOR_HUMAN but it is NOT the export
    // barrier, so waiting on an observation would block for the full observe window for nothing.
    const view = await driveOneRun(assembled.session, assembled.client);

    expect(view?.status).toBe("WAITING_FOR_HUMAN");
    expect(view?.blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
    // Every non-mutation guarantee of the old terminal behavior holds identically.
    expect(box.captured).toBeNull(); // never ingested
    expect(
      assembled.client.serverFrames.filter((f) => f.kind === "aw_event" && f.event.type === "DOWNLOAD_DETECTED"),
    ).toHaveLength(0);
    expect(readdirSync(quarantineDir)).toEqual([]);

    const persisted = loadOperationRun(persistDir, runId)!;
    expect(persisted.latestView.status).toBe("WAITING_FOR_HUMAN");
    expect(persisted.latestView.blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
    expect(persisted.resumeState).toBe("RESUME_AT_CHECKPOINT");
    // The export checkpoint was never reached — parking on a login must never claim otherwise.
    expect(persisted.humanCheckpoint.reached).toBe(false);
    expect(persisted.humanCheckpoint.observed).toBe(false);
    expect(findProhibitedFields(persisted)).toEqual([]);
  });

  it("automated: a detected download whose bytes are not OOXML fails closed ARTIFACT_INVALID — not ingested, dir empty, persisted FAILED", async () => {
    const page = await newPage();
    await serve(page, sellerCenterPage(BADMAGIC_BLOB));
    const quarantineDir = newDir("aw-live-cli-q-");
    const persistDir = newDir("aw-live-cli-p-");
    const runId = "run_070718192a2a";
    const box: { captured: CapturedIngest | null } = { captured: null };
    const assembled = assembleLiveRun(page, makeDeps(box, quarantineDir, persistDir, runId, 30_000));

    assembled.client.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
    await assembled.session.whenSettled();
    expect(assembled.client.view?.status).toBe("WAITING_FOR_HUMAN");
    await page.click("[data-aw-target]");
    assembled.client.send("REQUEST_STEP_RECHECK");
    await assembled.session.whenSettled();

    const view = assembled.client.view;
    expect(view?.status).toBe("FAILED");
    expect(view?.blocker?.code).toBe("ARTIFACT_INVALID");
    expect(box.captured).toBeNull(); // an invalid artifact is never handed to ingest
    // Detection is read-only and DID fire; validation is the gate that fails it closed.
    expect(
      assembled.client.serverFrames.filter((f) => f.kind === "aw_event" && f.event.type === "DOWNLOAD_DETECTED"),
    ).toHaveLength(1);
    expect(readdirSync(quarantineDir)).toEqual([]); // fail-closed cleanup still empties the dir

    const persisted = loadOperationRun(persistDir, runId)!;
    expect(persisted.latestView.status).toBe("FAILED");
    expect(persisted.latestView.blocker?.code).toBe("ARTIFACT_INVALID");
    expect(findProhibitedFields(persisted)).toEqual([]);
    const persistBlob = JSON.stringify(persisted).toLowerCase();
    for (const needle of NEEDLES) expect(persistBlob.includes(needle.toLowerCase()), `persist leaked "${needle}"`).toBe(false);
  });

  /*
   * ── A4 — the SESSION RECOVERY rung (§6) ──────────────────────────────────────────────────────────
   *
   * A3's loop is already proven hermetically (`run-action-window-live-naver.test.ts` — budget, attempt
   * cap, `outcomeOf` honesty, rejection, the stale-diagnostic guard). But every one of those cases runs
   * against `RecoveringProbeDriver`, a FAKE whose "login" is a boolean over an in-process loopback.
   * Nothing had ever called the REAL `NaverLiveProbeDriver.prepareSurface()` twice across a REAL
   * navigation — which is what a recovery IS. These two cases are that, and nothing else: they must not
   * re-prove the loop's semantics.
   *
   * They mirror Run 6's choreography deliberately: park while logged out → the seller logs in and returns
   * to the export surface → re-probe → barrier → CLICK NOTHING. A rehearsal, offline.
   *
   * ⚠ SCOPE — what these do NOT cover, so the §6 rung is never read as covering it:
   *   - `page.content()` MID-navigation. The gate below AWAITS its `page.goto`, so the re-probe reads a
   *     SETTLED page and the destroyed-context window never opens. The unguarded read in
   *     `naver-live-driver.ts` stays an accepted, reported risk — live meets it first.
   *   - `main()`'s own gate closure (`settleSpa` / `awaitFreshSentinel` / the sentinel file). The gate is
   *     INJECTED here precisely so the test needs no operator; `main()` remains untestable.
   */
  it("automated: a login park RECOVERS over a real browser — the re-probe reads the NEW page, the run reaches the export barrier, and with zero clicks it lapses non-mutating", async () => {
    clearLogSink();
    const page = await newPage();
    const box = { body: loginPage };
    // Served from the seller-center host, unlike the `setContent` park above: a recovery needs a URL to
    // navigate BACK to. The park still holds because `classifySessionVerdict` decides the password rule
    // BEFORE the seller-center rule, so a login page on this host is ACCOUNT_LOGIN_REQUIRED regardless.
    await serveBox(page, box);
    const quarantineDir = newDir("aw-live-cli-q-");
    const persistDir = newDir("aw-live-cli-p-");
    const runId = "run_a4a4b5b5c6c6";
    const cap: { captured: CapturedIngest | null } = { captured: null };
    const assembled = assembleLiveRun(page, makeDeps(cap, quarantineDir, persistDir, runId, 500, 500));
    const diagnostics: Array<NaverPrepareDiagnostic | null> = [];

    const view = await driveOneRun(assembled.session, assembled.client, {
      observeTimeoutMs: 500,
      awaitRecovery: async () => {
        // The seller logs in and returns to the review-export surface, in the same window.
        box.body = sellerCenterPage(XLSX_BLOB);
        await page.goto(SELLER_CENTER_URL, { waitUntil: "domcontentloaded" });
        return { ready: true, waitedMs: 0 };
      },
      onRecoveryProbe: (attempt) => {
        // MIRRORS `main()`'s closure — it does not test it (that wiring is locked by a source guard).
        // What it does prove is the DATA: the real diagnostic, through the real `log`/`safeMeta`, sanitized.
        const diagnostic = assembled.driver.prepareDiagnostic();
        diagnostics.push(diagnostic);
        if (diagnostic) log("aw.live.readiness", { ...diagnostic, attempt });
      },
    });

    // THE headline: the real driver re-probed a real page and cleared the blocker positively.
    expect(recoveryOutcomes()).toEqual(["recovered"]);
    // The attempt's diagnostic is the POST-login read — not the pre-login one left behind by a throw.
    // The hermetic suite cannot assert this: its driver's diagnostic is a fake.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.verdict).toBe("LOGGED_IN");
    expect(diagnostics[0]?.readinessDecision).toBe("READY");
    // `driveOneRun` logs a barrier reading ONLY once past its discriminator, so this IS the proof that
    // recovery landed the run at the real export barrier — located, highlighted, armed, and unblocked.
    expect(logEvents()).toContain("aw.live.barrier");
    expect(getLogSink().find((l) => l.event === "aw.live.barrier")?.meta.observed).toBe(false);

    // Nobody clicked, so the run lapses closed. That is Run 6's success condition, not a fault.
    expect(view?.status).toBe("FAILED");
    expect(view?.blocker?.code).toBe("DOWNLOAD_TIMEOUT");
    // Non-mutating BY CONSTRUCTION: no click ⇒ no download ⇒ detect / validate / ingest unreachable.
    expect(cap.captured).toBeNull();
    expect(
      assembled.client.serverFrames.filter((f) => f.kind === "aw_event" && f.event.type === "DOWNLOAD_DETECTED"),
    ).toHaveLength(0);
    expect(readdirSync(quarantineDir)).toEqual([]);

    const persisted = loadOperationRun(persistDir, runId)!;
    expect(persisted.latestView.status).toBe("FAILED");
    expect(persisted.humanCheckpoint.observed).toBe(false);
    expect(findProhibitedFields(persisted)).toEqual([]);

    // The LOG is the surface A3 created, and nothing had ever swept it. `safeMeta` filters KEYS, never
    // values, so a leak would ride through in a value — which is precisely what this catches.
    const persistBlob = JSON.stringify(persisted).toLowerCase();
    const frameBlob = JSON.stringify(assembled.client.serverFrames).toLowerCase();
    const logBlob = JSON.stringify(getLogSink()).toLowerCase();
    for (const needle of NEEDLES) {
      const n = needle.toLowerCase();
      expect(persistBlob.includes(n), `persist leaked "${needle}"`).toBe(false);
      expect(frameBlob.includes(n), `frame leaked "${needle}"`).toBe(false);
    }
    for (const needle of LOG_NEEDLES) {
      expect(logBlob.includes(needle.toLowerCase()), `log leaked "${needle}"`).toBe(false);
    }
    for (const frame of assembled.client.serverFrames) expect(findProhibitedFields(frame)).toEqual([]);
  }, 30_000);

  it("automated: the IDL overlay SEES a range the attribute regex is blind to — D-025's discriminator, over a real browser", async () => {
    clearLogSink();
    const page = await newPage();
    await serve(page, rangePickerPage);
    // Set the picker's live value via the IDL PROPERTY only, then read the ATTRIBUTE back in the SAME
    // evaluate: it stays empty, proving the SPA blindness precondition holds in a real Chromium — not
    // just in prose. This is the shape `page.content()` cannot serialize as filled.
    const attrAfter = await page.$eval("#startDate", (el) => {
      const input = el as HTMLInputElement;
      input.value = "2026-06-01";
      return input.getAttribute("value");
    });
    expect(attrAfter).toBe(""); // the property set did NOT reflect to the serialized attribute

    const quarantineDir = newDir("aw-live-cli-q-");
    const persistDir = newDir("aw-live-cli-p-");
    const cap: { captured: CapturedIngest | null } = { captured: null };
    const assembled = assembleLiveRun(page, makeDeps(cap, quarantineDir, persistDir, "run_d1d1e2e2f3f3", 500, 500));

    const result = await assembled.driver.prepareSurface();
    expect(result).toEqual({ ok: true }); // READY: the range is observed, never gates (D-025)

    const diagnostic = assembled.driver.prepareDiagnostic()!;
    // The attribute regex over `page.content()` is structurally blind — it serializes value="" → false.
    expect(diagnostic.selectedRangePresent).toBe(false);
    // The IDL-property overlay reads the live `.value` and reports the selection. THE discriminator:
    // attribute `false` + live `true` ⇒ the blindness is real AND the different detector works.
    expect(diagnostic.selectedRangePresentLive).toBe(true);

    // The raw date value is reduced to a boolean in the driver and never crosses into the diagnostic,
    // the log, or a persisted record (strictly less exposure than the serialized HTML already read).
    if (diagnostic) log("aw.live.readiness", { ...diagnostic });
    const diagBlob = JSON.stringify(diagnostic);
    const logBlob = JSON.stringify(getLogSink()).toLowerCase();
    expect(diagBlob).not.toContain("2026-06-01");
    for (const needle of LOG_NEEDLES) {
      expect(logBlob.includes(needle.toLowerCase()), `log leaked "${needle}"`).toBe(false);
    }
    expect(logBlob).not.toContain("2026-06-01");
  }, 30_000);

  it("automated: a gate that does NOT fix the session never reports 'recovered' — the real re-probe re-parks and the loop stops honestly", async () => {
    clearLogSink();
    const page = await newPage();
    const box = { body: loginPage };
    await serveBox(page, box);
    const quarantineDir = newDir("aw-live-cli-q-");
    const persistDir = newDir("aw-live-cli-p-");
    const runId = "run_a4a4d7d7e8e8";
    const cap: { captured: CapturedIngest | null } = { captured: null };
    const assembled = assembleLiveRun(page, makeDeps(cap, quarantineDir, persistDir, runId, 500, 500));

    const view = await driveOneRun(assembled.session, assembled.client, {
      observeTimeoutMs: 500,
      awaitRecovery: async () => {
        // The seller signals ready but is STILL logged out — the body is deliberately NOT swapped.
        await page.goto(SELLER_CENTER_URL, { waitUntil: "domcontentloaded" });
        return { ready: true, waitedMs: 0 };
      },
      maxRecoveryAttempts: 2,
    });

    // Without this, the case above proves nothing: "recovered" could be a value the loop always reaches.
    expect(recoveryOutcomes()).toEqual(["still-blocked", "still-blocked", "attempts-exhausted"]);
    expect(view?.status).toBe("WAITING_FOR_HUMAN");
    expect(view?.blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
    // A parked run never reached the export barrier, and must never claim a reading for one.
    expect(logEvents()).not.toContain("aw.live.barrier");
    expect(cap.captured).toBeNull();
    expect(readdirSync(quarantineDir)).toEqual([]);

    const persisted = loadOperationRun(persistDir, runId)!;
    expect(persisted.latestView.blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
    expect(persisted.humanCheckpoint.reached).toBe(false);
    expect(findProhibitedFields(persisted)).toEqual([]);
  }, 30_000);

  it.skipIf(!HEADED)("headed: a REAL human export click drives assembleLiveRun → COMPLETED + persisted TERMINAL", async () => {
    const page = await newPage();
    await serve(page, sellerCenterPage(XLSX_BLOB));
    const quarantineDir = newDir("aw-live-cli-q-");
    const persistDir = newDir("aw-live-cli-p-");
    const runId = "run_bcbcdedef0f0";
    const box: { captured: CapturedIngest | null } = { captured: null };
    const assembled = assembleLiveRun(page, makeDeps(box, quarantineDir, persistDir, runId, HEADED_CLICK_WAIT_MS));

    // driveOneRun runs verbatim: START parks at the highlighted control, then REQUEST_STEP_RECHECK
    // blocks on the SELLER's real click in the visible window (the driver only observes it).
    const view = await driveOneRun(assembled.session, assembled.client);

    expect(view?.status).toBe("COMPLETED");
    expect(view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    expect(box.captured!.bytesHead).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(readdirSync(quarantineDir)).toEqual([]);

    const persisted = loadOperationRun(persistDir, runId)!;
    expect(persisted.latestView.status).toBe("COMPLETED");
    expect(persisted.resumeState).toBe("TERMINAL");
    expect(findProhibitedFields(persisted)).toEqual([]);
  }, HEADED_TEST_TIMEOUT_MS);
});
