// NAVER walkthrough — environment-binding browser smoke. Proves (from a CLEAN browser profile) that the
// operator's tab, opened at the EXACT bootstrapped URL, is bound to this run: the disposable banner shows
// the run id and the wizard is reachable (gate matched), OR — when the URL run id is missing/wrong — the
// fail-closed WALKTHROUGH_ENVIRONMENT_MISMATCH screen blocks it. It logs in (the connect page is
// protected), never submits a credential, and asserts 0 NAVER API calls.
//
// Env: SELLEROPS_FRONTEND_ORIGIN (default http://localhost:5173), SMOKE_RUN_ID (the ?walkthroughRun= value;
// empty → omitted → expect mismatch), SMOKE_EXPECT (matched|mismatch, default matched), SMOKE_EMAIL/PASSWORD.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(__dirname, "../../collector/node_modules/playwright"));

const FRONTEND_ORIGIN = (process.env.SELLEROPS_FRONTEND_ORIGIN || "http://localhost:5173").replace(/\/$/, "");
const RUN_ID = process.env.SMOKE_RUN_ID || "";
const EXPECT = process.env.SMOKE_EXPECT || "matched";
const EMAIL = process.env.SMOKE_EMAIL || "demo@sellerops.ai";
const PASSWORD = process.env.SMOKE_PASSWORD || "demo1234";
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS || 20000);

const NAVER_HOST = /naver\.com/i;
const FORBIDDEN_PATH = /\/(test-connection|backfill|sync)\b|\/credentials\b|manualSync|api-channel/i;

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

async function main() {
  const naverCalls = [];
  const writeCalls = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("request", (req) => {
    let host = "", pathOnly = req.url();
    try { const u = new URL(req.url()); host = u.host; pathOnly = u.pathname; } catch { /* ignore */ }
    if (NAVER_HOST.test(host)) naverCalls.push(pathOnly);
    if (FORBIDDEN_PATH.test(pathOnly)) writeCalls.push(pathOnly);
  });

  try {
    // Log in (the connect page is protected).
    await page.goto(`${FRONTEND_ORIGIN}/login`, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: TIMEOUT }).catch(() => {}),
      page.getByRole("button", { name: "로그인" }).click(),
    ]);

    // Open the connect page at the (maybe-)exact walkthrough URL.
    const url = `${FRONTEND_ORIGIN}/connect/naver${RUN_ID ? `?walkthroughRun=${encodeURIComponent(RUN_ID)}` : ""}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT });

    // The disposable banner must always render in walkthrough mode.
    const banner = page.getByRole("note", { name: "Disposable NAVER Walkthrough" });
    await banner.waitFor({ timeout: TIMEOUT }).catch(() => {});
    check("disposable walkthrough banner is visible", await banner.isVisible().catch(() => false));

    // Race the two terminal outcomes.
    const mismatch = page.getByRole("alert", { name: "WALKTHROUGH_ENVIRONMENT_MISMATCH" });
    // The wizard's stable anchor is its section REGION (aria-label), present in EVERY phase — unlike the
    // phase-specific buttons/heading this previously keyed on, which the FE v2 guided-journey rewrite
    // reshaped. Role "region" matches the <section aria-label="NAVER 연결 마법사"> wrapper in
    // GuidedConnectionWizard, so "wizard reachable" is detected independent of which phase it lands in.
    const wizard = page.getByRole("region", { name: "NAVER 연결 마법사" });
    await Promise.race([
      mismatch.waitFor({ timeout: TIMEOUT }).catch(() => {}),
      wizard.waitFor({ timeout: TIMEOUT }).catch(() => {}),
    ]);
    const isMismatch = await mismatch.isVisible().catch(() => false);
    const isMatched = !isMismatch && (await wizard.isVisible().catch(() => false));

    if (EXPECT === "matched") {
      check("gate MATCHED → wizard reachable (no mismatch screen)", isMatched && !isMismatch);
      if (RUN_ID) {
        const bannerText = await banner.innerText().catch(() => "");
        check("banner shows the bootstrapped run id prefix", bannerText.includes(RUN_ID.slice(0, 8)), RUN_ID.slice(0, 8));
      }
    } else {
      check("gate MISMATCH → fail-closed screen, wizard blocked", isMismatch && !isMatched);
      check("no credential form on the mismatch screen", !(await page.getByRole("button", { name: "연결 정보 저장" }).isVisible().catch(() => false)));
    }

    check("zero NAVER API calls", naverCalls.length === 0, `count=${naverCalls.length}`);
    check("zero account-bootstrap / credential / test / sync writes", writeCalls.length === 0, writeCalls.join(",") || "count=0");

    await context.clearCookies();
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } }).catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  const passed = results.every(Boolean);
  console.log(`  EXPECT=${EXPECT} NAVER_CALLS=${naverCalls.length} WRITE_CALLS=${writeCalls.length}`);
  console.log(passed ? "ENV-BINDING-SMOKE PASS" : "ENV-BINDING-SMOKE FAIL");
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.log(`  FAIL  smoke crashed — category=${(e && e.name) || "Error"}`);
  console.log("ENV-BINDING-SMOKE FAIL");
  process.exit(1);
});
