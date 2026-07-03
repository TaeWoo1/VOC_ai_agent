/**
 * **LIVE-ONLY** real Chrome implementation of the `LocalAgentPage` boundary +
 * its launcher (M-Agent-1C1).
 *
 * This is the only Local Agent module that touches a real browser. It is NEVER
 * exercised by unit tests (the adapter is tested behind a fake page); its live DOM
 * behavior is validated by a later, separately-approved bounded smoke. It runs the
 * `__name`-free in-page scanners M-Agent-1B proved, reuses the shipped
 * `classifyOpenEsmReviewPage` verdict + `frameHostAllowed`, and launches Chrome via
 * the macOS-aware `buildLocalAgentLaunchPolicy` (dropping `--use-mock-keychain` on
 * darwin so the real Keychain-backed saved credential loads).
 *
 * Sanitized boundary: every method returns booleans / buckets / a small enum — never
 * a URL, host, selector, label, DOM text, or credential value. No export / download /
 * upload / status / capability write occurs here.
 */

import type { BrowserContext, Page } from "playwright";
import { launchLocalAgentChrome } from "./local-agent-launch";
import { frameHostAllowed } from "../esm/esm-frame-scan";
import { classifyOpenEsmReviewPage } from "../esm/esm-review-live-scan";
import type {
  GateSignals,
  LocalAgentContext,
  LocalAgentPage,
  RawModeCandidate,
  RawPopulation,
} from "./local-agent-chrome-adapter";
import type { SanitizedFormShape } from "./local-agent-login-mode";
import type { InspectionVerdict } from "./local-agent-state";

// ── In-page functions (must be __name-free: only var / for / inline; no inner named const/fn/arrow) ─

function scanModesInPage() {
  var GM = /gmarket|지마켓|g마켓|gmkt|g-?market/i;
  var AUC = /auction|옥션/i;
  var ESM = /esmplus|esm\s*plus|통합|integrated|esm-?plus/i;
  var LOGINWORD = /로그인|login|sign\s*in/i;
  var nodes: any = document.querySelectorAll('a,button,li,[role="tab"],[role="button"]');
  var out = [];
  var idx = 0;
  var i = 0;
  for (i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var aria = el.getAttribute && el.getAttribute("aria-label");
    var text = (aria || el.innerText || el.textContent || "").trim();
    if (!text) continue;
    var mode = "OTHER";
    if (GM.test(text)) mode = "GMARKET";
    else if (AUC.test(text)) mode = "AUCTION";
    else if (ESM.test(text)) mode = "ESM_PLUS";
    if (mode === "OTHER") continue;
    if (text.length > 24 && !LOGINWORD.test(text)) continue;
    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);
    var visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    var ariaDisabled = el.getAttribute && el.getAttribute("aria-disabled") === "true";
    var enabled = !el.disabled && !ariaDisabled;
    var role = el.getAttribute && el.getAttribute("role");
    var tag = el.tagName.toLowerCase();
    var inTablist = !!(el.closest && el.closest('[role="tablist"]'));
    var interactive = "other";
    if (role === "tab" || inTablist) interactive = "tab";
    else if (tag === "a" && el.getAttribute("href")) interactive = "link";
    else if (tag === "button" || role === "button") interactive = "button";
    var area = rect.width * rect.height;
    var bucket = area < 5000 ? "small" : area < 30000 ? "medium" : "large";
    el.setAttribute("data-la-token", String(idx));
    out.push({
      modeCategory: mode,
      interactiveCategory: interactive,
      visible: visible,
      enabled: enabled,
      topFrame: true,
      rectBucket: bucket,
      token: String(idx),
    });
    idx++;
  }
  return out;
}

function formShapeInPage() {
  var pw: any = document.querySelectorAll('input[type="password"]');
  var ids: any = document.querySelectorAll(
    'input[type="text"],input[type="email"],input[type="tel"],input[name*="id" i],input[autocomplete="username"]',
  );
  var submits: any = document.querySelectorAll('button[type="submit"],input[type="submit"]');
  var loginBtns = 0;
  var btns: any = document.querySelectorAll("button,a[role='button']");
  var i = 0;
  for (i = 0; i < btns.length; i++) {
    var t = (btns[i].innerText || btns[i].textContent || "").trim();
    if (/로그인|login|sign\s*in/i.test(t)) loginBtns++;
  }
  var challenge = /captcha|recaptcha|otp|인증번호|2fa|보안문자|자동입력\s*방지/i.test(document.body.innerText || "");
  var gmActive = false;
  var tabs: any = document.querySelectorAll('[role="tab"],[aria-selected]');
  for (i = 0; i < tabs.length; i++) {
    var tt = (tabs[i].innerText || tabs[i].textContent || "").trim();
    if (/gmarket|지마켓|g마켓/i.test(tt) && tabs[i].getAttribute("aria-selected") === "true") gmActive = true;
  }
  var idN = ids.length;
  var pwN = pw.length;
  var subN = submits.length + (loginBtns > 0 ? 1 : 0);
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
  var ids: any = document.querySelectorAll(
    'input[type="text"],input[type="email"],input[type="tel"],input[name*="id" i],input[autocomplete="username"]',
  );
  var userPop = false;
  var pwPop = false;
  var i = 0;
  for (i = 0; i < ids.length; i++) if ((ids[i].value || "").length > 0) userPop = true;
  for (i = 0; i < pw.length; i++) if ((pw[i].value || "").length > 0) pwPop = true;
  var challenge = /captcha|recaptcha|otp|인증번호|2fa|보안문자|자동입력\s*방지/i.test(document.body.innerText || "");
  return { usernamePopulated: userPop, passwordPopulated: pwPop, challengePresent: challenge };
}

function challengeInPage() {
  return /captcha|recaptcha|otp|인증번호|2fa|보안문자|자동입력\s*방지/i.test(document.body.innerText || "");
}

function stampUserFieldInPage() {
  var ids: any = document.querySelectorAll(
    'input[type="text"],input[type="email"],input[type="tel"],input[name*="id" i],input[autocomplete="username"]',
  );
  if (ids.length === 0) return false;
  ids[0].setAttribute("data-la-user", "1");
  return true;
}

function stampSubmitInPage() {
  var s: any = document.querySelector('button[type="submit"],input[type="submit"]');
  if (!s) {
    var btns: any = document.querySelectorAll("button,a[role='button']");
    var i = 0;
    for (i = 0; i < btns.length; i++) {
      var t = (btns[i].innerText || btns[i].textContent || "").trim();
      if (/로그인|login|sign\s*in/i.test(t)) {
        s = btns[i];
        break;
      }
    }
  }
  if (!s) return false;
  s.setAttribute("data-la-submit", "1");
  return true;
}

// ── Real page ──────────────────────────────────────────────────────────────────────────────────────

class RealChromeLocalAgentPage implements LocalAgentPage {
  constructor(
    private readonly page: Page,
    private readonly allowlist: readonly string[],
  ) {}

  async readGateSignals(): Promise<GateSignals> {
    const url = this.page.url();
    const https = url.startsWith("https://");
    const hostAllowlisted = frameHostAllowed(url, this.allowlist);
    const challengePresent = (await this.page.evaluate(challengeInPage)) as boolean;
    const frames = this.page.frames();
    let unexpectedIframe = false;
    for (const frame of frames) {
      if (frame === this.page.mainFrame()) continue;
      if (!frameHostAllowed(frame.url(), this.allowlist)) unexpectedIframe = true;
    }
    return { https, hostAllowlisted, challengePresent, unexpectedIframe };
  }

  async scanLoginModeCandidates(): Promise<RawModeCandidate[]> {
    return (await this.page.evaluate(scanModesInPage)) as unknown as RawModeCandidate[];
  }

  async readFormShape(): Promise<SanitizedFormShape> {
    return (await this.page.evaluate(formShapeInPage)) as unknown as SanitizedFormShape;
  }

  async clickModeCandidate(token: string): Promise<void> {
    await this.page.click(`[data-la-token="${token}"]`, { timeout: 8000 });
  }

  async focusUsernameField(): Promise<void> {
    const found = (await this.page.evaluate(stampUserFieldInPage)) as boolean;
    if (!found) throw new Error("no username field to focus");
    await this.page.click('[data-la-user="1"]', { timeout: 8000 });
  }

  async submitLoginForm(): Promise<void> {
    const found = (await this.page.evaluate(stampSubmitInPage)) as boolean;
    if (!found) throw new Error("no submit control to click");
    await this.page.click('[data-la-submit="1"]', { timeout: 8000 });
  }

  async readPopulation(): Promise<RawPopulation> {
    return (await this.page.evaluate(populationInPage)) as unknown as RawPopulation;
  }

  async classifySessionVerdict(): Promise<InspectionVerdict> {
    const classification = await classifyOpenEsmReviewPage(this.page, this.allowlist);
    return classification.signals.sessionVerdict === "LOGGED_IN" ? "LOGGED_IN" : "NOT_LOGGED_IN";
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}

// ── Live launcher / page factory ─────────────────────────────────────────────────────────────────

let contextSeq = 0;

/**
 * LIVE-ONLY page factory for the adapter: launches Chrome Stable against the dedicated
 * account-scoped profile (macOS drops `--use-mock-keychain`), navigates to the ESM auth
 * surface, and wraps the page in the sanitized `LocalAgentPage` boundary. The returned
 * `LocalAgentContext.close()` closes the persistent context exactly once.
 */
export function realLocalAgentPageFactory(opts: {
  platform: NodeJS.Platform;
  profileDir: string;
  channel?: string;
  authSurfaceUrl: string;
  allowlist: readonly string[];
}): () => Promise<LocalAgentContext> {
  return async () => {
    const browserContext: BrowserContext = await launchLocalAgentChrome({
      platform: opts.platform,
      profileDir: opts.profileDir,
      channel: opts.channel,
    });
    const page = browserContext.pages()[0] ?? (await browserContext.newPage());
    await page.goto(opts.authSurfaceUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    const localPage = new RealChromeLocalAgentPage(page, opts.allowlist);
    contextSeq += 1;
    const id = `local-agent-ctx-${contextSeq}`;
    let closed = false;
    return {
      id,
      page: localPage,
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        await browserContext.close();
      },
    };
  };
}
