/**
 * Hermetic unit tests for the LIVE NAVER driver CORE (`src/action-window/naver-live-driver.ts`).
 * NO browser, NO network, NO live NAVER — the read-only decision methods (`prepareSurface` / `verify`)
 * are driven over a fake page that returns controlled `url()` + `content()`. Covers the §8-4 session
 * seam wiring, fail-closed precondition mapping, verify drift/completion, sanitized-output privacy, the
 * export-keyword/no-drift guard, and the module source guard (no click, no legacy capture, no upload
 * import). The real-DOM seams (locate tagging, overlay/observer, download/quarantine) are exercised by
 * the RUN_INTEGRATION browser proof in `naver-live-browser.test.ts` — this file stays browser-free.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { Frame, Page } from "playwright";
import {
  NaverLiveProbeDriver,
  EXPORT_TARGET_KEYWORDS,
  type NaverLiveProbeDriverOptions,
} from "../../src/action-window/naver-live-driver";
import { naverLocateDecision } from "../../src/action-window/naver-surface";
import { EXPORT_WORDING_KEYWORDS } from "../../src/naver/review-export";
import type { AwIngestUploadFn } from "../../src/action-window/ingest-handoff";

const HEX16 = /^[0-9a-f]{16}$/;

/**
 * A read-only frame double. `content()` returns the fixture; `evaluate` is a stub whose call log is
 * captured so a test can prove WHICH frame received the tag/overlay/observer work. For a `string` body
 * (the `NAME_SHIM`) it returns undefined; for a function body (the in-page tagger) it returns
 * `taggerCount`, standing in for the real DOM match count. `content()` may be forced to reject to model
 * a detached / cross-navigating frame.
 */
function fakeFrame(
  html: string,
  opts: { url?: string; taggerCount?: number; rejectContent?: boolean; calls?: string[] } = {},
): Frame {
  return {
    url: () => opts.url ?? "",
    content: () => (opts.rejectContent ? Promise.reject(new Error("detached")) : Promise.resolve(html)),
    evaluate: (body: unknown) => {
      opts.calls?.push(typeof body === "string" ? "shim" : "fn");
      return Promise.resolve(typeof body === "string" ? undefined : (opts.taggerCount ?? 0));
    },
    waitForFunction: () => Promise.resolve(undefined),
  } as unknown as Frame;
}

/** A minimal read-only page double: a single top-document frame (no child frames). */
function fakePage(url: string, html: string): Page {
  const main = fakeFrame(html, { url });
  return {
    url: () => url,
    content: () => Promise.resolve(html),
    mainFrame: () => main,
    frames: () => [main],
  } as unknown as Page;
}

/** A page double with a top-document shell plus one or more child frames (an iframe/SPA surface). */
function fakePageWithFrames(
  main: { url: string; html: string; calls?: string[] },
  children: Array<{ html: string; url?: string; taggerCount?: number; rejectContent?: boolean; calls?: string[] }>,
): Page {
  const mainFrame = fakeFrame(main.html, { url: main.url, ...(main.calls ? { calls: main.calls } : {}) });
  const childFrames = children.map((c) => fakeFrame(c.html, c));
  const all = [mainFrame, ...childFrames];
  return {
    url: () => main.url,
    content: () => Promise.resolve(main.html),
    mainFrame: () => mainFrame,
    frames: () => all,
  } as unknown as Page;
}

/**
 * Fast, deterministic readiness-settle defaults for the hermetic driver tests: an INSTANT sleep and a
 * 2-check window, so a still-hydrating (pending) fixture resolves in microtasks instead of the live
 * ~8s poll. Individual tests override these to exercise multi-cycle hydration.
 */
const FAST_SETTLE: Partial<NaverLiveProbeDriverOptions> = {
  readinessSettleTimeoutMs: 40,
  readinessSettleIntervalMs: 20,
  sleepFn: () => Promise.resolve(),
};

function driverForPage(page: Page, opts: Partial<NaverLiveProbeDriverOptions> = {}): NaverLiveProbeDriver {
  return new NaverLiveProbeDriver(page, { quarantineDir: "/tmp/unused", ingest: neverIngest, ...FAST_SETTLE, ...opts });
}

const neverIngest: AwIngestUploadFn = () => Promise.resolve({ ok: false, processed: 0 });

function driverFor(url: string, html: string, opts: Partial<NaverLiveProbeDriverOptions> = {}): NaverLiveProbeDriver {
  return new NaverLiveProbeDriver(fakePage(url, html), { quarantineDir: "/tmp/unused", ingest: neverIngest, ...FAST_SETTLE, ...opts });
}

// --- surface fixtures (TEST inputs only; the driver never emits any of this) ---------------------
const SELLER_URL = "https://sell.smartstore.naver.com/#/review/list";
const LOGIN_URL = "https://nid.naver.com/nidlogin.login";
const LOGGED_IN_READY = `<html><body>
  <nav id="seller-gnb">메뉴</nav><button>로그아웃</button>
  <table><tbody><tr><td>합성 행 A</td></tr><tr><td>합성 행 B</td></tr></tbody></table>
  <button id="exp">엑셀 다운로드</button>
</body></html>`;
const LOGGED_IN_EMPTY = `<html><body>
  <nav id="seller-gnb">메뉴</nav><button>로그아웃</button>
  <table><tbody></tbody></table><button id="exp">엑셀 다운로드</button>
</body></html>`;
const LOGIN_PAGE = `<html><body><form><input type="password" name="pw"></form></body></html>`;
const RECONNECT_PAGE = `<html><body><section><p>현재 로그인 중인 계정으로 계속</p></section><form><input type="password"></form></body></html>`;
const AMBIGUOUS_PAGE = `<html><body><div>지연 렌더 (로딩중)</div></body></html>`;

describe("NaverLiveProbeDriver — prepareSurface over the §8-4 session seam", () => {
  it("a usable seller-center session with a ready export surface → ok", async () => {
    const driver = driverFor(SELLER_URL, LOGGED_IN_READY);
    expect(await driver.prepareSurface()).toEqual({ ok: true });
    expect(driver.prepareDiagnostic()).toMatchObject({ verdict: "LOGGED_IN", readinessDecision: "READY" });
  });

  it("a NAVER account-login page fails closed → LOGIN_REQUIRED", async () => {
    const driver = driverFor(LOGIN_URL, LOGIN_PAGE);
    expect(await driver.prepareSurface()).toEqual({ ok: false, blockerCode: "LOGIN_REQUIRED" });
    expect(driver.prepareDiagnostic()).toEqual({ verdict: "ACCOUNT_LOGIN_REQUIRED" });
  });

  it("a Commerce reconnect interstitial fails closed → SESSION_EXPIRED", async () => {
    const driver = driverFor("https://accounts.commerce.naver.com/", RECONNECT_PAGE);
    expect(await driver.prepareSurface()).toEqual({ ok: false, blockerCode: "SESSION_EXPIRED" });
    expect(driver.prepareDiagnostic()).toEqual({ verdict: "RECONNECT_REQUIRED" });
  });

  it("an ambiguous surface fails closed → UNSUPPORTED_STATE", async () => {
    const driver = driverFor("https://example.test/", AMBIGUOUS_PAGE);
    expect(await driver.prepareSurface()).toEqual({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
  });

  it("a usable session but an EMPTY export surface halts before the checkpoint → UNSUPPORTED_STATE", async () => {
    const driver = driverFor(SELLER_URL, LOGGED_IN_EMPTY);
    expect(await driver.prepareSurface()).toEqual({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
    expect(driver.prepareDiagnostic()).toMatchObject({ readinessState: "EXPORT_TARGET_EMPTY" });
  });
});

// --- frame surfaces: the review grid + export control render inside a child frame (iframe / SPA) ------
// A logged-in top-document SHELL (strong seller-center signal, but NO rows and NO export control) …
const SHELL_LOGGED_IN = `<html><body>
  <nav id="seller-gnb">메뉴</nav><button>로그아웃</button><div id="app"></div>
</body></html>`;
// … while the actual export surface (rows + the one sync control) lives in a child frame.
const FRAME_GRID_READY = `<html><body>
  <table><tbody><tr><td>합성 행 A</td></tr><tr><td>합성 행 B</td></tr></tbody></table>
  <button id="exp">엑셀 다운로드</button>
</body></html>`;
const FRAME_GRID_EMPTY = `<html><body>
  <table><tbody></tbody></table><button id="exp">엑셀 다운로드</button>
</body></html>`;
const FRAME_NOISE = `<html><body><div>광고 배너 (무관 프레임)</div></body></html>`;

describe("NaverLiveProbeDriver — frame-aware surface resolution (iframe / SPA readiness)", () => {
  it("the SAME shell alone (top document only) fails closed — the pre-fix behavior", async () => {
    // Baseline: a bare SPA shell with the grid NOT in the top document halts UNKNOWN — exactly the
    // Run-1 UNSUPPORTED_STATE. This is what the frame-aware resolution below is designed to fix.
    const driver = driverFor(SELLER_URL, SHELL_LOGGED_IN);
    expect(await driver.prepareSurface()).toEqual({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
    expect(driver.prepareDiagnostic()).toMatchObject({ verdict: "LOGGED_IN", readinessState: "EXPORT_TARGET_UNKNOWN" });
  });

  it("resolves the child frame that hosts the ready export surface → ok", async () => {
    const driver = driverForPage(fakePageWithFrames({ url: SELLER_URL, html: SHELL_LOGGED_IN }, [{ html: FRAME_GRID_READY }]));
    expect(await driver.prepareSurface()).toEqual({ ok: true });
    expect(driver.prepareDiagnostic()).toMatchObject({ verdict: "LOGGED_IN", readinessDecision: "READY" });
  });

  it("a genuinely EMPTY grid in the child frame still halts honestly (no false-positive) → UNSUPPORTED_STATE", async () => {
    const driver = driverForPage(fakePageWithFrames({ url: SELLER_URL, html: SHELL_LOGGED_IN }, [{ html: FRAME_GRID_EMPTY }]));
    expect(await driver.prepareSurface()).toEqual({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
    expect(driver.prepareDiagnostic()).toMatchObject({ readinessState: "EXPORT_TARGET_EMPTY" });
  });

  it("picks the actionable grid frame among several child frames, ignoring an unrelated one", async () => {
    const driver = driverForPage(
      fakePageWithFrames({ url: SELLER_URL, html: SHELL_LOGGED_IN }, [{ html: FRAME_NOISE }, { html: FRAME_GRID_READY }]),
    );
    expect(await driver.prepareSurface()).toEqual({ ok: true });
  });

  it("skips a child frame whose content() rejects (detached) rather than failing the whole probe", async () => {
    const driver = driverForPage(
      fakePageWithFrames({ url: SELLER_URL, html: SHELL_LOGGED_IN }, [{ html: "", rejectContent: true }, { html: FRAME_GRID_READY }]),
    );
    expect(await driver.prepareSurface()).toEqual({ ok: true });
  });

  it("binds the export control IN the resolved child frame — the top document is never tagged", async () => {
    const mainCalls: string[] = [];
    const childCalls: string[] = [];
    const page = fakePageWithFrames(
      { url: SELLER_URL, html: SHELL_LOGGED_IN, calls: mainCalls },
      [{ html: FRAME_GRID_READY, taggerCount: 1, calls: childCalls }],
    );
    const driver = driverForPage(page);
    expect(await driver.prepareSurface()).toEqual({ ok: true });
    expect(await driver.locate()).toMatchObject({ count: 1, sig: expect.stringMatching(HEX16) });
    // The NAME_SHIM + in-page tagger both ran in the CHILD frame; the top document was never touched.
    expect(childCalls).toEqual(["shim", "fn"]);
    expect(mainCalls).toEqual([]);
  });
});

// --- readiness SETTLE: the review grid renders client-side AFTER we reach the surface (§8-11) --------
/**
 * A page whose surface frame HYDRATES: `content()` yields each html in `seq` in turn (the last value
 * repeats), so the same read-only frame reads empty first and then rows — modelling a NAVER SPA that
 * renders the review grid a beat after the driver arrives. `page.content()` returns a STABLE logged-in
 * shell so the §8-4 session verdict is fixed while the surface settles.
 */
function hydratingPage(url: string, shellHtml: string, seq: string[]): Page {
  let i = 0;
  const nextHtml = (): string => {
    const html = seq[Math.min(i, seq.length - 1)] ?? "";
    i += 1;
    return html;
  };
  const frame = {
    url: () => url,
    content: () => Promise.resolve(nextHtml()),
    evaluate: (body: unknown) => Promise.resolve(typeof body === "string" ? undefined : 1),
    waitForFunction: () => Promise.resolve(undefined),
  } as unknown as Frame;
  return {
    url: () => url,
    content: () => Promise.resolve(shellHtml),
    mainFrame: () => frame,
    frames: () => [frame],
  } as unknown as Page;
}

describe("NaverLiveProbeDriver — prepareSurface readiness settle (render-timing fix, §8-11)", () => {
  it("a surface that reads EMPTY first then renders rows settles to READY (no false-positive-empty)", async () => {
    // The exact Run-1 shape: a bare empty container on arrival (would have failed closed single-shot),
    // then the grid hydrates. The settle poll re-reads read-only and proceeds once rows render.
    const page = hydratingPage(SELLER_URL, SHELL_LOGGED_IN, [FRAME_GRID_EMPTY, FRAME_GRID_READY]);
    const driver = driverForPage(page);
    expect(await driver.prepareSurface()).toEqual({ ok: true });
    expect(driver.prepareDiagnostic()).toMatchObject({ verdict: "LOGGED_IN", readinessDecision: "READY" });
  });

  it("a surface that stays a bare empty container through the window still fails closed → UNSUPPORTED_STATE", async () => {
    // Rows never render: the settle polls to timeout and halts on the last (zero-rows) observation.
    const page = hydratingPage(SELLER_URL, SHELL_LOGGED_IN, [FRAME_GRID_EMPTY]);
    const driver = driverForPage(page);
    expect(await driver.prepareSurface()).toEqual({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
    expect(driver.prepareDiagnostic()).toMatchObject({ verdict: "LOGGED_IN", readinessState: "EXPORT_TARGET_EMPTY" });
  });

  it("does NOT poll when the session itself is unusable — a login page decides immediately", async () => {
    // A non-LOGGED_IN verdict never hydrates into a surface; settle is skipped (would waste the window).
    // The 2nd sequence value is rows, but it is never read because the login verdict short-circuits.
    const page = hydratingPage(LOGIN_URL, LOGIN_PAGE, [LOGIN_PAGE, FRAME_GRID_READY]);
    const driver = driverForPage(page);
    expect(await driver.prepareSurface()).toEqual({ ok: false, blockerCode: "LOGIN_REQUIRED" });
  });
});

describe("NaverLiveProbeDriver — verify over the live content", () => {
  const sig = naverLocateDecision(LOGGED_IN_READY).sig!;

  it("a non-drifted target authorizes proceeding (verified true; the download stage is the evidence)", async () => {
    expect(await driverFor(SELLER_URL, LOGGED_IN_READY).verify(sig)).toEqual({ verified: true, drift: false });
  });

  it("a drifted / vanished target reports drift → engine fails UI_DRIFT", async () => {
    const drifted = LOGGED_IN_READY.replace(`<button id="exp">엑셀 다운로드</button>`, `<button id="exp2">내려받기</button>`);
    expect(await driverFor(SELLER_URL, drifted).verify(sig)).toEqual({ verified: false, drift: true });
  });
});

describe("NaverLiveProbeDriver — privacy boundary", () => {
  it("prepareSurface / verify outputs carry no url, page content, or wording", async () => {
    const driver = driverFor(SELLER_URL, LOGGED_IN_READY);
    const surface = await driver.prepareSurface();
    const verify = await driver.verify(naverLocateDecision(LOGGED_IN_READY).sig!);
    const blob = JSON.stringify([surface, verify, driver.prepareDiagnostic()]).toLowerCase();
    for (const needle of ["smartstore", "naver", "엑셀", "다운로드", "seller-gnb", "<button", "password", "http"]) {
      expect(blob.includes(needle.toLowerCase()), `live-driver output leaked "${needle}"`).toBe(false);
    }
  });
});

describe("NaverLiveProbeDriver — the in-page tagger keyword list cannot drift", () => {
  it("EXPORT_TARGET_KEYWORDS equals review-export's confirmed EXPORT_WORDING_KEYWORDS", () => {
    expect([...EXPORT_TARGET_KEYWORDS]).toEqual([...EXPORT_WORDING_KEYWORDS]);
  });
});

describe("NaverLiveProbeDriver — module source guard (no click, no legacy capture, no upload import)", () => {
  const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/action-window");
  const stripComments = (code: string): string =>
    code
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join("\n");
  const code = stripComments(readFileSync(join(srcDir, "naver-live-driver.ts"), "utf8"));

  it("never clicks the target and never simulates a user action", () => {
    // A read-only detection `waitForEvent("download")` IS allowed (like the browser driver); a target
    // `.click(` or a `simulateUserAction` hook is NOT — the seller performs the action.
    expect(/\.click\s*\(/.test(code)).toBe(false);
    expect(/simulateUserAction/.test(code)).toBe(false);
    expect(/dispatchEvent\s*\(/.test(code)).toBe(false);
  });

  it("imports no legacy capture path, no upload client, and no click-trigger builder", () => {
    const bannedImports = [
      /runExport/,
      /buildTriggerSelectors/,
      /findModalConfirm/,
      /review-download-save/,
      /review-upload-diagnostic/,
      /capture-export-same-session/,
      /live-export-target-probe/,
      /\.\.\/upload/,
    ];
    const importStatements = code.match(/import[\s\S]*?from\s*["'][^"']+["']/g) ?? [];
    for (const statement of importStatements) {
      for (const re of bannedImports) {
        expect(re.test(statement), `live driver import :: ${re} :: ${statement.replace(/\s+/g, " ")}`).toBe(false);
      }
    }
  });
});
