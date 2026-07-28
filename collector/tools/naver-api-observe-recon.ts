/**
 * DEV-ONLY · UNCOMMITTED · read-only NAVER Commerce API-center observation recon —
 * STABLE PAGE-OWNERSHIP build.
 *
 * One supervisor process owns the persistent context from launchPersistentContext() to
 * context.close(). Playwright creates exactly ONE page, pins it (window.name), foregrounds it, and
 * that fixed page is the ONLY thing ever observed. Restored/other tabs are never selected. Every
 * observation first validates (context alive, fixed page open + in context, window.name matches,
 * host is the API center); ANY failure returns an honest failure — it never falls back to another
 * tab or a stale URL. Graceful shutdown on a close-sentinel (and SIGINT/SIGTERM) via context.close()
 * so cookies flush and nothing is orphaned.
 *
 * Read-only, sanitized: no app ID / Secret / store ID / raw IP / token is read/printed/saved; the
 * screenshot is taken in-memory (byte size reported only) and never written to disk.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "playwright";
import { accountScopedProfileDirFor, launchNaverContext } from "../src/profile";

const APPROVAL_FLAG = "--i-understand-this-opens-live-naver";
const RECON_WINDOW_NAME = "sellerops-naver-api-recon";
const APICENTER_HOST = "apicenter.commerce.naver.com";

const here = dirname(fileURLToPath(import.meta.url));
const collectorRoot = resolve(here, "..");
const PROFILE_BASE = resolve(collectorRoot, ".profile");
const STATUS_DIR = resolve(collectorRoot, ".status");
const OBSERVE_SENTINEL = resolve(STATUS_DIR, "api-recon-observe.ready");
const CLOSE_SENTINEL = resolve(STATUS_DIR, "api-recon-observe.close");
const RESULT = resolve(STATUS_DIR, "api-recon-observe.json");
const RECON_SLOT = "api-center-observe-recon-pw-v1";
const APICENTER_URL = "https://apicenter.commerce.naver.com/ko/member/application/manage/list";

function write(obj: unknown): void {
  writeFileSync(RESULT, JSON.stringify(obj, null, 2));
  console.error("[recon] " + JSON.stringify(obj));
}

async function main(): Promise<void> {
  if (!process.argv.includes(APPROVAL_FLAG)) {
    console.error(`[recon] refusing: requires ${APPROVAL_FLAG}`);
    process.exitCode = 2;
    return;
  }
  mkdirSync(STATUS_DIR, { recursive: true });
  for (const f of [OBSERVE_SENTINEL, CLOSE_SENTINEL, RESULT]) if (existsSync(f)) rmSync(f);

  const profileDir = accountScopedProfileDirFor(PROFILE_BASE, "naver", RECON_SLOT);
  console.error("[recon] launching real Chrome (channel=chrome, headed); profile leaf:", profileDir.split("/").pop());
  const ctx: BrowserContext = await launchNaverContext(profileDir, "chrome");

  // Single owner: close the context (flush cookies, no orphan) on a close-sentinel or a signal.
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    console.error("[recon] shutting down — context.close()");
    try {
      await ctx.close();
    } catch {
      /* already gone */
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  // The ONE fixed recon page Playwright owns. Pin its identity on every document (survives the
  // cross-origin login redirect chain), foreground it, and drive it to the API center.
  const reconPage: Page = await ctx.newPage();
  await reconPage.addInitScript((name) => {
    try {
      window.name = name as string;
    } catch {
      /* ignore */
    }
  }, RECON_WINDOW_NAME);
  await reconPage.bringToFront();
  try {
    await reconPage.goto(APICENTER_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch {
    /* redirect to login / slow load — operator drives from here */
  }

  console.error("[recon] LAUNCH_OK — Playwright created & foregrounded ONE tab (its own recon page).");
  console.error("[recon] Log into NAVER IN THAT EXACT FOREGROUND TAB, reach the API-center screen, then say 'ready'.");
  console.error("[recon] Do NOT use any other/restored tab — only the Playwright tab is observed.");
  console.error(`[recon] ready:  touch "${OBSERVE_SENTINEL}"   |   close:  touch "${CLOSE_SENTINEL}"`);

  for (;;) {
    const which = await waitForEitherSentinel();
    if (which === "close") {
      await shutdown();
      return;
    }
    if (existsSync(OBSERVE_SENTINEL)) rmSync(OBSERVE_SENTINEL);
    await observeFixed(ctx, reconPage);
    console.error(`[recon] re-observe: touch "${OBSERVE_SENTINEL}" again (same fixed page).`);
  }
}

async function waitForEitherSentinel(): Promise<"observe" | "close"> {
  for (;;) {
    if (existsSync(CLOSE_SENTINEL)) return "close";
    if (existsSync(OBSERVE_SENTINEL)) return "observe";
    await new Promise((r) => setTimeout(r, 1000));
  }
}

let observeCount = 0;
async function observeFixed(ctx: BrowserContext, reconPage: Page): Promise<void> {
  observeCount++;
  const problems: string[] = [];

  // Validity gate — observe ONLY the fixed page, and only if it is genuinely the owned live target.
  const pageCount = ctx.pages().length;
  if (!ctx.pages().includes(reconPage)) problems.push("fixed-page-not-in-context");
  if (reconPage.isClosed()) problems.push("fixed-page-closed");

  let windowName = "";
  if (problems.length === 0) {
    try {
      windowName = await reconPage.evaluate(() => window.name); // also proves context/page is live
    } catch {
      problems.push("evaluate-failed(context-or-page-dead)");
    }
  }
  if (problems.length === 0 && windowName !== RECON_WINDOW_NAME) {
    problems.push(`window-name-mismatch:${windowName || "(empty)"}`);
  }
  let host = "";
  try {
    host = new URL(reconPage.url()).host;
  } catch {
    /* keep "" */
  }
  if (problems.length === 0 && host !== APICENTER_HOST) problems.push(`host-not-apicenter:${host}`);

  // Fail immediately — never read a fallback URL or another tab.
  if (problems.length > 0) {
    write({ ok: false, observeCount, windowName, host, pageCount, problems });
    return;
  }

  // Foreground + settle, then observe ONLY the fixed page.
  try {
    await reconPage.bringToFront();
    await reconPage.waitForTimeout(600);
  } catch {
    /* non-fatal */
  }
  const title = await reconPage.title().catch(() => "");
  let screenshotBytes = -1;
  try {
    screenshotBytes = (await reconPage.screenshot({ fullPage: true })).length;
  } catch {
    screenshotBytes = -1;
  }
  // Label extraction via Playwright LOCATORS, one selector at a time. Each selector is isolated:
  // a failure is recorded per-selector and NEVER zeroes the other selectors' results. Only element
  // label TEXT (allInnerTexts) is read — never an input's .value — so no Client ID / Secret / store
  // id / raw IP / token can be captured.
  const SELECTORS: Array<[string, string]> = [
    ["titleMenu", "p.title-menu"],
    ["itemMenu", "a.item-menu"],
    ["btnArea", ".btn-area button"],
    ["controls", "main button, .content button, section button"], // A2–A3 capability hints (재발급/복사/…)
  ];
  const labelSets: Record<string, string[]> = {};
  const selectorErrors: Record<string, string> = {};
  for (const [key, sel] of SELECTORS) {
    try {
      labelSets[key] = dedupeShort(await reconPage.locator(sel).allInnerTexts());
    } catch (e) {
      selectorErrors[key] = String((e as { message?: string })?.message ?? e).slice(0, 100);
      labelSets[key] = [];
    }
  }
  let itemMenuCount = -1;
  try {
    itemMenuCount = await reconPage.locator("a.item-menu").count();
  } catch {
    itemMenuCount = -1;
  }
  const menuLabels = dedupeShort([
    ...(labelSets.titleMenu ?? []),
    ...(labelSets.itemMenu ?? []),
    ...(labelSets.btnArea ?? []),
  ]);
  const controlLabels = labelSets.controls ?? [];
  const frameCount = reconPage.frames().length;

  write({
    ok: true,
    observeCount,
    windowName,
    host,
    title,
    screenshotBytes,
    itemMenuCount,
    menuLabels,
    controlLabels,
    selectorErrors,
    frameCount,
    pageCount,
  });
}

/** Collapse whitespace, drop empties/over-long, dedupe, cap. UI label text only — no values. */
function dedupeShort(texts: string[]): string[] {
  const out: string[] = [];
  for (const raw of texts) {
    const t = (raw || "").replace(/\s+/g, " ").trim();
    if (t && t.length <= 24 && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 30);
}

void main();
