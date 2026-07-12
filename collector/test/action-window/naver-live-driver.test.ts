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
import type { Page } from "playwright";
import {
  NaverLiveProbeDriver,
  EXPORT_TARGET_KEYWORDS,
  type NaverLiveProbeDriverOptions,
} from "../../src/action-window/naver-live-driver";
import { naverLocateDecision } from "../../src/action-window/naver-surface";
import { EXPORT_WORDING_KEYWORDS } from "../../src/naver/review-export";
import type { AwIngestUploadFn } from "../../src/action-window/ingest-handoff";

const HEX16 = /^[0-9a-f]{16}$/;

/** A minimal read-only page double — only `url()` + `content()` are touched by prepare/verify. */
function fakePage(url: string, html: string): Page {
  return { url: () => url, content: () => Promise.resolve(html) } as unknown as Page;
}

const neverIngest: AwIngestUploadFn = () => Promise.resolve({ ok: false, processed: 0 });

function driverFor(url: string, html: string, opts: Partial<NaverLiveProbeDriverOptions> = {}): NaverLiveProbeDriver {
  return new NaverLiveProbeDriver(fakePage(url, html), { quarantineDir: "/tmp/unused", ingest: neverIngest, ...opts });
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
