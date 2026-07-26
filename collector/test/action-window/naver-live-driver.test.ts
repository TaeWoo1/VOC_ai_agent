/**
 * Hermetic unit tests for the LIVE NAVER driver CORE (`src/action-window/naver-live-driver.ts`).
 * NO browser, NO network, NO live NAVER — the read-only decision methods (`prepareSurface` / `verify`)
 * are driven over a fake page that returns controlled `url()` + `content()`. Covers the §8-4 session
 * seam wiring, fail-closed precondition mapping, verify drift/completion, sanitized-output privacy, the
 * export-keyword/no-drift guard, the declined-ingest leak-safety proof (D-027), and the module source
 * guard (no click, no legacy capture, no upload import). The real-DOM seams (locate tagging,
 * overlay/observer) are exercised by the RUN_INTEGRATION browser proof in `naver-live-browser.test.ts`
 * — this file stays browser-free. The download/quarantine seam is covered BOTH ways: hermetically here
 * (byte-carrying download double + in-memory io, because a declined run's only teardown is `cleanup()`
 * and that must not rest on an argument) and against a real browser there.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
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
import { reviewExportBytes, reviewExportEmptyBytes } from "../support/review-export-fixture";

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
    // Every in-page evaluate ran in the CHILD frame, never the top document: prepareSurface's IDL
    // range-read (the leading "fn"), then locate's NAME_SHIM + in-page tagger. `mainCalls` stays empty.
    expect(childCalls).toEqual(["fn", "shim", "fn"]);
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

/**
 * Leak-safety when the ingest handoff is DECLINED (`--no-ingest`, D-027).
 *
 * On the normal path `ingest()` drops the retained bytes itself. A declined run never calls it, so
 * the ONLY thing standing between a real seller's export and a process that keeps holding it is
 * `cleanup()`. That has to be a test, not an argument — so this exercises the download/quarantine
 * seam hermetically (a byte-carrying fake download + an in-memory io), which the RUN_INTEGRATION
 * browser proof otherwise covers only against a real browser.
 */
describe("NaverLiveProbeDriver — declined ingest drops the artifact (leak-safety)", () => {
  /**
   * A structurally OOXML-shaped head — ZIP local-header magic + the content-types entry name. Mirrors
   * `quarantine.test.ts`'s `ooxmlBytes`: the sniff is dependency-free and wants both, so the bare
   * magic alone is (correctly) rejected. Synthetic bytes; never a real export.
   */
  function ooxmlBytes(): Uint8Array {
    const tail = new TextEncoder().encode("[Content_Types].xml (synthetic)");
    const out = new Uint8Array(10 + tail.length);
    out.set([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00], 0);
    out.set(tail, 10);
    return out;
  }

  /**
   * A REAL workbook — the committed golden export (`contracts/review-export/naver/v1`). Since the
   * parse gate joined `validateArtifact`, sniff-shaped bytes are no longer enough to reach the
   * retained-bytes path: only an artifact that actually parses does. Using the shared fixture keeps
   * "a real workbook" defined in exactly one place.
   */
  const workbookBytes = (): Uint8Array => reviewExportBytes();
  /** The committed EMPTY workbook — valid and readable, with no data rows. */
  const emptyWorkbookBytes = (): Uint8Array => reviewExportEmptyBytes();

  /** In-memory QuarantineIo: proves the file is written AND removed without touching a real disk. */
  function memIo() {
    const files = new Map<string, Uint8Array>();
    const written: string[] = [];
    return {
      io: {
        ensureDir: () => {},
        writeFile: (path: string, bytes: Uint8Array) => {
          files.set(path, bytes);
          written.push(path);
        },
        readHead: (path: string, maxBytes: number) => (files.get(path) ?? new Uint8Array()).slice(0, maxBytes),
        removeFile: (path: string) => {
          files.delete(path);
        },
        listDir: () => [...files.keys()].map((p) => p.split("/").pop()!),
      },
      files,
      written,
    };
  }

  /** A byte-carrying download double: the minimal surface `bufferDownload` + `detectDownload` use. */
  function fakeDownload(bytes: Uint8Array, deleted: { count: number }) {
    return {
      suggestedFilename: () => "리뷰_목록.xlsx", // a realistic name that must never reach the ref
      createReadStream: () => Promise.resolve(Readable.from([Buffer.from(bytes)])),
      delete: () => {
        deleted.count += 1;
        return Promise.resolve();
      },
    };
  }

  function downloadingPage(bytes: Uint8Array, deleted: { count: number }): Page {
    const base = fakePage(SELLER_URL, LOGGED_IN_READY) as unknown as Record<string, unknown>;
    return { ...base, waitForEvent: () => Promise.resolve(fakeDownload(bytes, deleted)) } as unknown as Page;
  }

  it("cleanup() drops the retained bytes, so a later ingest has nothing to upload", async () => {
    const deleted = { count: 0 };
    const { io } = memIo();
    const driver = driverForPage(downloadingPage(workbookBytes(), deleted), { quarantineDir: "/q", io });

    const detected = await driver.detectDownload();
    expect(detected.detected).toBe(true);
    expect(detected.artifactRef).toMatch(HEX16); // the filename never influences the ref
    expect(await driver.validateArtifact(detected.artifactRef!)).toEqual({ valid: true });

    // The declined run's ONLY teardown. On the normal path ingest() would have dropped these bytes.
    await driver.cleanup();

    // Observable proof the retained bytes are gone: ingest can no longer find anything to send.
    expect(await driver.ingest(detected.artifactRef!, "MACHINE_MATCHED")).toEqual({ ok: false, processed: 0 });
  });

  it("the quarantine file is deleted at validate and the dir is swept at cleanup", async () => {
    const deleted = { count: 0 };
    const { io, files, written } = memIo();
    const driver = driverForPage(downloadingPage(workbookBytes(), deleted), { quarantineDir: "/q", io });

    const detected = await driver.detectDownload();
    await driver.validateArtifact(detected.artifactRef!);

    expect(written).toHaveLength(1); // it really was written — this is not a vacuous pass
    expect(files.size).toBe(0); // …and deleted inside the validation window (D-021)
    expect(deleted.count).toBe(1); // the browser's own copy was dropped too

    await driver.cleanup();
    expect(io.listDir()).toEqual([]);
  });

  it("a sniff-passing NON-workbook now fails validation → ARTIFACT_INVALID, and nothing is retained", async () => {
    // THE TIGHTENING, pinned on the LIVE driver. `ooxmlBytes()` carries ZIP magic + the
    // `[Content_Types].xml` entry NAME, which is exactly what the D-021 sniff looks for — so before
    // the parse gate this artifact validated clean and was handed to ingest, where the backend would
    // reject it and the seller would be told "저장 중 문제가 생겼어요 / 잠시 후 다시 시도해 주세요":
    // false, and useless advice. Now it fails HERE, as ARTIFACT_INVALID ("받은 파일을 확인할 수
    // 없어요 / 다시 내려받아 주세요"), which is true and actionable.
    const deleted = { count: 0 };
    const { io, written, files } = memIo();
    const driver = driverForPage(downloadingPage(ooxmlBytes(), deleted), { quarantineDir: "/q", io });

    const detected = await driver.detectDownload();
    expect(await driver.validateArtifact(detected.artifactRef!)).toEqual({ valid: false });

    // The quarantine leg still ran and still cleaned up — the sniff passed; only the parse failed.
    expect(driver.lastQuarantine()).toMatchObject({ valid: true });
    expect(driver.lastParse()).toEqual({
      workbookReadable: false,
      sheetPresent: false,
      dataRowPresent: false,
      parseOk: false,
    });
    expect(written).toHaveLength(1);
    expect(files.size).toBe(0);

    // …and an invalid artifact is never retained, so the handoff has nothing to upload.
    expect(await driver.ingest(detected.artifactRef!, "MACHINE_MATCHED")).toEqual({ ok: false, processed: 0 });
  });

  it("an empty-but-valid workbook still validates — an empty export is a legitimate outcome", async () => {
    // `dataRowPresent` is observed, never gating. A seller who exports a quiet date range gets a
    // correct, readable file with no rows; failing their run would tell them it was broken.
    const deleted = { count: 0 };
    const { io } = memIo();
    const driver = driverForPage(downloadingPage(emptyWorkbookBytes(), deleted), { quarantineDir: "/q", io });

    const detected = await driver.detectDownload();
    expect(await driver.validateArtifact(detected.artifactRef!)).toEqual({ valid: true });
    expect(driver.lastParse()).toEqual({
      workbookReadable: true,
      sheetPresent: true,
      dataRowPresent: false, // observed — and deliberately not part of `parseOk`
      parseOk: true,
    });
  });

  it("declining never fabricates a completion — a nothing-retained ingest is not success", async () => {
    // The invariant behind `ingest` being required on the live path: no synthetic completion.
    const driver = driverForPage(fakePage(SELLER_URL, LOGGED_IN_READY), { quarantineDir: "/q" });
    expect(await driver.ingest("0f1e2d3c4b5a6978", "MACHINE_MATCHED")).toEqual({ ok: false, processed: 0 });
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

  it("wires an operator-legible overlay label for the human step (headed run has no product FE)", () => {
    // The badge otherwise shows the raw dotted copyKey; the seated operator gets a readable line at
    // the highlight, echoing the Run-4 two-step (click, then confirm the NAVER dialog per run scope).
    expect(code).toContain('"actionWindow.step.userTargetAction":');
    expect(code).toContain("리뷰 내보내기 버튼을 클릭하세요. NAVER 확인창이 뜨면 이번 실행 범위 안에서 확인하세요.");
    // and the highlight mount must actually pass that label through to the overlay.
    expect(/label:\s*OPERATOR_STEP_LABELS\[humanStep\.copyKey\]/.test(code)).toBe(true);
  });
});
