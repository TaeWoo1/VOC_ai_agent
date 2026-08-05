// NAVER walkthrough — browser-level UI login smoke (the preflight gate that /health + proxy could not be).
//
// Proves the REAL product path from a CLEAN browser profile: open the login page on the ONE approved
// frontend origin, log in through the UI with the disposable demo account, reach the authenticated shell,
// and confirm the NAVER card is at "연결하기" (account baseline = 0). It asserts ZERO NAVER API calls and
// ZERO credential access, and starts from empty storage so it reproduces the seller's first-load path
// (this is what catches the localhost/127.0.0.1 + stale-base CORS failure a health check misses).
//
// Sanitized: prints only origins, HTTP status, a closed error category, and booleans — never a token,
// cookie, credential, or NAVER value. Uses collector's bundled Playwright chromium. Exit 0 = PASS.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(__dirname, "../../collector/node_modules/playwright"));

const FRONTEND_ORIGIN = (process.env.SELLEROPS_FRONTEND_ORIGIN || "http://localhost:5173").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL || "demo@sellerops.ai";
const PASSWORD = process.env.SMOKE_PASSWORD || "demo1234"; // disposable demo cred, NOT a NAVER secret
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS || 20000);

// Any request that would mean a live NAVER call or a credential touch during a login+browse smoke.
const NAVER_HOST = /naver\.com/i;
const FORBIDDEN_PATH = /\/(test-connection|backfill|sync)\b|\/credentials\b|manualSync/i;

function line(ok, msg) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  line(ok, `${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  const naverCalls = [];
  const credentialCalls = [];
  let loginStatus = null;
  let loginUrl = null;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  }
  // Fresh context = empty storage (no stale token/base): reproduces a clean first load.
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("request", (req) => {
    const u = req.url();
    let host = "";
    try { host = new URL(u).host; } catch { /* ignore */ }
    const pathOnly = (() => { try { return new URL(u).pathname; } catch { return u; } })();
    if (NAVER_HOST.test(host)) naverCalls.push(pathOnly);
    if (FORBIDDEN_PATH.test(pathOnly)) credentialCalls.push(pathOnly);
  });

  try {
    // 1. Open the login page on the ONE approved origin.
    await page.goto(`${FRONTEND_ORIGIN}/login`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    const onLogin = await page.getByRole("button", { name: "로그인" }).isVisible().catch(() => false);
    check("login page reachable on the approved origin", onLogin, FRONTEND_ORIGIN);

    // 2. UI login with the disposable demo account, capturing the actual login request URL + status.
    const emailBox = page.locator('input[type="email"]');
    const pwBox = page.locator('input[type="password"]');
    await emailBox.fill(EMAIL);
    await pwBox.fill(PASSWORD);
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/auth/login"), { timeout: TIMEOUT }).catch(() => null),
      page.getByRole("button", { name: "로그인" }).click(),
    ]);
    if (resp) { loginStatus = resp.status(); loginUrl = new URL(resp.url()); }
    check(
      "login request is SAME-ORIGIN via the /api proxy",
      !!loginUrl && `${loginUrl.protocol}//${loginUrl.host}` === FRONTEND_ORIGIN && loginUrl.pathname === "/api/auth/login",
      loginUrl ? `${loginUrl.protocol}//${loginUrl.host}${loginUrl.pathname}` : "no login request observed",
    );
    check("login returned HTTP 200", loginStatus === 200, `HTTP ${loginStatus ?? "none"}`);

    // 3. Reached the authenticated shell (navigated off /login, not bounced back).
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: TIMEOUT }).catch(() => {});
    const afterPath = new URL(page.url()).pathname;
    check("reached the authenticated shell (left /login)", !afterPath.startsWith("/login"), `path=${afterPath}`);

    // 4. Channels shell + NAVER card at 연결하기 (account baseline = 0). The card list is async, so wait
    //    for the NAVER card to actually render before reading — not just the static heading.
    await page.goto(`${FRONTEND_ORIGIN}/settings/channels`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await page.getByRole("heading", { name: "채널 연결" }).waitFor({ timeout: TIMEOUT }).catch(() => {});
    await page.getByText(/네이버/).first().waitFor({ timeout: TIMEOUT }).catch(() => {});
    const bodyText = await page.locator("body").innerText().catch(() => "");
    check("channels shell rendered (authenticated)", bodyText.includes("채널 연결"));
    check("NAVER present and connectable (연결하기 → account baseline 0)", /네이버/.test(bodyText) && bodyText.includes("연결하기"));

    // 5. Safety: no live NAVER call, no credential access during the smoke.
    check("zero NAVER API calls during smoke", naverCalls.length === 0, `count=${naverCalls.length}`);
    check("zero credential/test/sync access during smoke", credentialCalls.length === 0, credentialCalls.map((p) => p).join(",") || "count=0");

    // 6. Leave clean: clear this context's storage (does not touch the operator's own browser).
    await context.clearCookies();
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } }).catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  const passed = results.every((r) => r.ok);
  console.log(`  SMOKE_LOGIN_STATUS=${loginStatus ?? "none"} NAVER_CALLS=${naverCalls.length} CREDENTIAL_CALLS=${credentialCalls.length}`);
  console.log(passed ? "UI-LOGIN-SMOKE PASS" : "UI-LOGIN-SMOKE FAIL");
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  // Sanitized: never print an error object that might carry a URL/token — just a category.
  console.log(`  FAIL  smoke crashed — category=${(e && e.name) || "Error"}`);
  console.log("UI-LOGIN-SMOKE FAIL");
  process.exit(1);
});
