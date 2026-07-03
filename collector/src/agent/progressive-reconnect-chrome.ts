/**
 * **LIVE-ONLY** real browser port for the Progressive Reconnect runtime.
 *
 * Implements `ProgressiveReconnectBrowser` with the posture proven by the M-Agent-Auth throwaway
 * probes: a NORMAL Chrome Stable launch + `chromium.connectOverCDP` (so `navigator.webdriver` is
 * false and Chrome's password manager behaves normally), the BOUNDED, self-stopping document-start
 * login-mode bootstrap (for GMARKET/AUCTION), and a ZERO-interaction credential-population
 * observation. It reuses the shipped `classifyOpenEsmReviewPage` verdict, `frameHostAllowed`,
 * `computeFormSignature`, and the policy core's `boundedBootstrapPlan` budget.
 *
 * This is the only Progressive Reconnect module that touches a real browser. Like
 * `local-agent-real-chrome.ts` it is NEVER exercised by unit tests (the pure runtime is tested behind
 * a fake port); its live DOM behavior is validated by a later, separately-approved smoke.
 *
 * Sanitized boundary: every method returns a coarse verdict / booleans-only observation — never a URL,
 * host, selector, DOM text, or credential value. It performs NO export / download / upload / status /
 * capability write, and fires at most ONE gated submit. `launchPersistentContext`,
 * `--enable-automation`, `--use-mock-keychain`, and `--headless` are refused.
 */

import type { BrowserContext, CDPSession, Page } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { resolveProfileDir } from "../profile";
import { classifyOpenEsmReviewPage } from "../esm/esm-review-live-scan";
import { frameHostAllowed } from "../esm/esm-frame-scan";
import { computeFormSignature, type SanitizedFormShape } from "./local-agent-login-mode";
import { boundedBootstrapPlan, type InitialFormStrategy } from "./progressive-reconnect";
import { submitPreconditionMet, type ProgressiveReconnectBrowser } from "./progressive-reconnect-runtime";
import type { InspectionVerdict, CredentialPopulationObservation } from "./local-agent-state";

const HOST = "127.0.0.1";
const FORBIDDEN_ARGS = ["--enable-automation", "--use-mock-keychain", "--headless"];
const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface ProgressiveReconnectChromeOptions {
  /** Dedicated in-tree profile dir (guarded by `resolveProfileDir`). */
  profileDir: string;
  /** ESM auth-surface URL (config-supplied; never committed). */
  authSurfaceUrl: string;
  /** ESM-family cross-origin frame allowlist (hostnames). */
  allowlist: readonly string[];
  /** `STORAGE_PROBE_SALT` for the form signature. */
  salt: string;
  /** Chrome Stable executable path (defaults to the macOS location). */
  chromePath?: string;
}

// ── in-page scanners (mirrored; __name-free: only var/for/inline; NO inner named const/fn/arrow) ──
function formShapeInPage() {
  var pw: any = document.querySelectorAll('input[type="password"]');
  var ids: any = document.querySelectorAll('input[type="text"],input[type="email"],input[type="tel"],input[name*="id" i],input[autocomplete="username"]');
  var submits: any = document.querySelectorAll('button[type="submit"],input[type="submit"]');
  var loginBtns = 0;
  var btns: any = document.querySelectorAll("button,a[role='button']");
  var i = 0;
  for (i = 0; i < btns.length; i++) { var t = (btns[i].innerText || btns[i].textContent || "").trim(); if (/로그인|login|sign\s*in/i.test(t)) loginBtns++; }
  var challenge = /captcha|recaptcha|otp|인증번호|2fa|보안문자|자동입력\s*방지/i.test(document.body.innerText || "");
  var gmActive = false;
  var tabs: any = document.querySelectorAll('[role="tab"],[aria-selected]');
  for (i = 0; i < tabs.length; i++) { var tt = (tabs[i].innerText || tabs[i].textContent || "").trim(); if (/gmarket|지마켓|g마켓/i.test(tt) && tabs[i].getAttribute("aria-selected") === "true") gmActive = true; }
  var idN = ids.length; var pwN = pw.length; var subN = submits.length + (loginBtns > 0 ? 1 : 0);
  return {
    idFieldBucket: idN === 0 ? "zero" : idN === 1 ? "one" : "many",
    pwFieldBucket: pwN === 0 ? "zero" : pwN === 1 ? "one" : "many",
    submitBucket: subN === 0 ? "zero" : subN === 1 ? "one" : "many",
    formPresent: idN >= 1 && pwN >= 1 && subN >= 1,
    gmarketTabActive: gmActive,
    challengePresent: challenge,
  };
}
function populationInPage() {
  var pw: any = document.querySelectorAll('input[type="password"]');
  var ids: any = document.querySelectorAll('input[type="text"],input[type="email"],input[type="tel"],input[name*="id" i],input[autocomplete="username"]');
  var userPop = false; var pwPop = false; var i = 0;
  for (i = 0; i < ids.length; i++) if ((ids[i].value || "").length > 0) userPop = true;
  for (i = 0; i < pw.length; i++) if ((pw[i].value || "").length > 0) pwPop = true;
  var challenge = /captcha|recaptcha|otp|인증번호|2fa|보안문자|자동입력\s*방지/i.test(document.body.innerText || "");
  return { usernamePopulated: userPop, passwordPopulated: pwPop, challengePresent: challenge };
}
function stampSubmitInPage() {
  var s: any = document.querySelector('button[type="submit"],input[type="submit"]');
  if (!s) {
    var btns: any = document.querySelectorAll("button,a[role='button']");
    var i = 0;
    for (i = 0; i < btns.length; i++) { var t = (btns[i].innerText || btns[i].textContent || "").trim(); if (/로그인|login|sign\s*in/i.test(t)) { s = btns[i]; break; } }
  }
  if (!s) return false;
  s.setAttribute("data-la-submit", "1");
  return true;
}

/** Bounded, self-stopping GMARKET document-start bootstrap (injected as source; not tsx-compiled). */
function bootstrapSource(maxAttempts: number): string {
  return "(function(){var RE=/gmarket|지마켓|g마켓|gmkt|g-?market/i;var CH=/captcha|recaptcha|otp|인증번호|2fa|보안문자|자동입력\\s*방지/i;var clicks=0,ticks=0;window.__bootDone=false;window.__bootStop=false;var iv=setInterval(function(){ticks++;if(window.__bootStop){clearInterval(iv);window.__bootDone=true;return;}if(ticks>60||clicks>=" + String(maxAttempts) + "){clearInterval(iv);window.__bootDone=true;return;}var body=document.body?document.body.innerText:'';if(CH.test(body)){clearInterval(iv);window.__bootDone=true;return;}var active=false,i;var tabs=document.querySelectorAll('[role=\"tab\"],[aria-selected]');for(i=0;i<tabs.length;i++){var tt=(tabs[i].innerText||tabs[i].textContent||'').trim();if(RE.test(tt)&&tabs[i].getAttribute('aria-selected')==='true')active=true;}var pw=document.querySelectorAll('input[type=\"password\"]').length;var idf=document.querySelectorAll('input[type=\"text\"],input[type=\"email\"],input[type=\"tel\"],input[name*=\"id\" i],input[autocomplete=\"username\"]').length;if(active&&pw>=1&&idf>=1){clearInterval(iv);window.__bootDone=true;return;}var nodes=document.querySelectorAll('[role=\"tab\"],a,button,li,[role=\"button\"]');for(i=0;i<nodes.length;i++){var el=nodes[i];var role=el.getAttribute&&el.getAttribute('role');var inTab=!!(el.closest&&el.closest('[role=\"tablist\"]'));if(role!=='tab'&&!inTab)continue;if(el.tagName.toLowerCase()==='a'&&el.getAttribute('href'))continue;var t=(el.getAttribute('aria-label')||el.innerText||el.textContent||'').trim();if(t.length>24)continue;if(RE.test(t)){try{el.click();clicks++;}catch(e){}break;}}},150);})();";
}

function assertLaunchArgsSafe(args: string[]): void {
  for (const bad of FORBIDDEN_ARGS) {
    if (args.some((a) => a === bad || a.startsWith(bad + "="))) throw new Error(`forbidden launch arg: ${bad}`);
  }
}
async function freePort(): Promise<number> {
  const net = await import("node:net");
  return await new Promise((res, rej) => {
    const s = net.createServer();
    s.on("error", rej);
    s.listen(0, HOST, () => { const a = s.address(); const p = typeof a === "object" && a ? a.port : 0; s.close(() => res(p)); });
  });
}
async function waitForCdp(port: number, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://${HOST}:${port}/json/version`); if (r.ok) return await r.json(); } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("CDP endpoint did not come up");
}

/**
 * LIVE-ONLY real port. Lazy-imports Playwright so importing the module never launches a browser.
 *
 * **Browser ownership (explicit):** this instance OWNS the spawned Chrome process, the CDP-attached
 * `browser`/`ctx`/`page`, and the CDP session. It NEVER auto-closes — the page stays open across
 * `establishLoginMode`/`submitLoginOnce` and while the runtime waits on a human. Teardown happens
 * ONLY through `close()`, which is idempotent (safe to call more than once).
 */
export class ProgressiveReconnectChromeBrowser implements ProgressiveReconnectBrowser {
  private proc: ChildProcess | null = null;
  private browser: any = null;
  private ctx: BrowserContext | null = null;
  private page: Page | null = null;
  private client: CDPSession | null = null;
  private scriptId: string | null = null;
  private boundFormSignature: string | null = null;
  /** Number of REAL submit clicks fired (a pre-submit re-check can fail closed → 0). */
  submitClickCount = 0;

  constructor(private readonly opts: ProgressiveReconnectChromeOptions) {}

  /** Fully stop the document-start bootstrap: halt its interval + remove the injected script. */
  private async stopBootstrap(page: Page): Promise<void> {
    try { await page.evaluate(() => { (window as any).__bootStop = true; }); } catch { /* best effort */ }
    if (this.scriptId && this.client) {
      try { await this.client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: this.scriptId }); } catch { /* best effort */ }
      this.scriptId = null;
    }
  }

  private async ensureLaunched(): Promise<void> {
    if (this.browser) return;
    const profileDir = resolveProfileDir(this.opts.profileDir); // in-tree guard
    const debugPort = await freePort();
    const args = [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-allow-origins=*",
    ];
    assertLaunchArgsSafe(args);
    this.proc = spawn(this.opts.chromePath ?? DEFAULT_CHROME, args, { stdio: "ignore", detached: false });
    const version = await waitForCdp(debugPort, 20000);
    if (!/Chrome\/\d/.test(version.Browser || "") || /Headless/.test(version.Browser || "")) {
      throw new Error("progressive reconnect port: not Chrome Stable");
    }
    const { chromium } = await import("playwright");
    this.browser = await chromium.connectOverCDP(`http://${HOST}:${debugPort}`);
    this.ctx = this.browser.contexts()[0];
    this.page = this.ctx!.pages()[0] ?? (await this.ctx!.newPage());
    const wd = await this.page!.evaluate(() => (navigator as any).webdriver ?? false);
    if (wd !== false) throw new Error("progressive reconnect port: navigator.webdriver !== false");
    this.client = await this.ctx!.newCDPSession(this.page!);
    await this.client.send("Page.enable");
  }

  private requirePage(): Page {
    if (!this.page) throw new Error("progressive reconnect port: no active page");
    return this.page;
  }

  async inspectSession(): Promise<InspectionVerdict> {
    await this.ensureLaunched();
    const page = this.requirePage();
    await page.goto(this.opts.authSurfaceUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    const cls = await classifyOpenEsmReviewPage(page, this.opts.allowlist);
    return cls.signals.sessionVerdict === "LOGGED_IN" ? "LOGGED_IN" : "NOT_LOGGED_IN";
  }

  async establishLoginMode(strategy: InitialFormStrategy): Promise<CredentialPopulationObservation> {
    const page = this.requirePage();
    if (strategy === "DOCUMENT_START_BOOTSTRAP") {
      const plan = boundedBootstrapPlan(strategy);
      const added = await this.client!.send("Page.addScriptToEvaluateOnNewDocument", { source: bootstrapSource(plan.maxAttempts) });
      this.scriptId = added.identifier;
      await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
      for (let i = 0; i < 80; i++) { if (await page.evaluate(() => (window as any).__bootDone === true)) break; await sleep(150); }
      // Fully stop + remove the bootstrap here so it can never re-fire after a later submit/navigation.
      await this.stopBootstrap(page);
    }
    // frame-safety gate + structural establishment (no field interaction)
    let unexpectedIframe = false;
    for (const fr of page.frames()) { if (fr === page.mainFrame()) continue; if (!frameHostAllowed(fr.url(), this.opts.allowlist)) unexpectedIframe = true; }
    const shape = (await page.evaluate(formShapeInPage)) as unknown as SanitizedFormShape;
    const established = !unexpectedIframe && shape.formPresent && shape.idFieldBucket === "one" && shape.pwFieldBucket === "one" && !shape.challengePresent;
    if (!established) {
      this.boundFormSignature = null;
      return { usernamePopulated: false, passwordPopulated: false, challengePresent: shape.challengePresent, formSignatureMatch: false };
    }
    // Bind the form signature now; submitLoginOnce re-computes + compares it immediately before submit.
    this.boundFormSignature = computeFormSignature(shape, this.opts.salt);
    const pop = (await page.evaluate(populationInPage)) as unknown as { usernamePopulated: boolean; passwordPopulated: boolean; challengePresent: boolean };
    return { usernamePopulated: pop.usernamePopulated, passwordPopulated: pop.passwordPopulated, challengePresent: pop.challengePresent, formSignatureMatch: true };
  }

  async submitLoginOnce(): Promise<InspectionVerdict> {
    const page = this.requirePage();
    // (Property 2) Ensure the bootstrap is FULLY stopped before any submit — defensive re-assert.
    await this.stopBootstrap(page);
    // (Property 1) Re-check the live form signature + challenge + populated booleans IMMEDIATELY
    // before submit; fail closed with ZERO clicks on any drift.
    const shape = (await page.evaluate(formShapeInPage)) as unknown as SanitizedFormShape;
    const pop = (await page.evaluate(populationInPage)) as unknown as { usernamePopulated: boolean; passwordPopulated: boolean; challengePresent: boolean };
    const recheck: CredentialPopulationObservation = {
      usernamePopulated: pop.usernamePopulated,
      passwordPopulated: pop.passwordPopulated,
      challengePresent: pop.challengePresent,
      formSignatureMatch: this.boundFormSignature !== null && computeFormSignature(shape, this.opts.salt) === this.boundFormSignature,
    };
    if (!submitPreconditionMet(recheck)) {
      return "NOT_LOGGED_IN"; // drift / challenge / de-populated → no submit fired
    }
    const stamped = (await page.evaluate(stampSubmitInPage)) as boolean;
    if (!stamped) return "NOT_LOGGED_IN";
    await page.click('[data-la-submit="1"]', { timeout: 8000 });
    this.submitClickCount++;
    await sleep(1500);
    const cls = await classifyOpenEsmReviewPage(page, this.opts.allowlist);
    return cls.signals.sessionVerdict === "LOGGED_IN" ? "LOGGED_IN" : "NOT_LOGGED_IN";
  }

  async close(): Promise<void> {
    try { if (this.scriptId && this.client) await this.client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: this.scriptId }); } catch { /* best effort */ }
    try { if (this.browser) await this.browser.close(); } catch { /* best effort */ }
    try { if (this.proc) this.proc.kill("SIGTERM"); } catch { /* best effort */ }
    this.browser = null; this.ctx = null; this.page = null; this.client = null; this.scriptId = null;
  }
}
