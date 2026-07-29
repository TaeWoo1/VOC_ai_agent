/**
 * DEV-ONLY recon launcher for the NAVER Commerce API Center live recon (slice G3-C).
 *
 * NOT a product path. This does NOT modify the product launcher (`src/profile.ts`), the
 * account-scoped session runtime, the Pilot Runtime, or the normal NAVER profile. It exists
 * only so a seated operator can attach the "Claude in Chrome" extension to a headed, real
 * Chrome that runs against a recon-only, opaque profile — separate from every verified profile.
 *
 * Recon-only deviation from the product launcher: `ignoreDefaultArgs: ["--disable-extensions"]`,
 * so a Web-Store extension the OPERATOR installs can load. It never passes `--load-extension`
 * and never side-loads a local extension. `--enable-automation` / `--remote-debugging-pipe`
 * (Playwright's defaults) are LEFT ON — that is the open question this feasibility run probes.
 *
 * Safety: opens a blank tab only. It never navigates to NAVER, never logs in, never reads any
 * value. It reads nothing from any other profile. All output is sanitized (opaque leaf, counts,
 * booleans — never a path secret, cookie, extension value, or page content).
 *
 * Run (gated):
 *   npx tsx tools/naver-api-recon-chrome.ts --i-understand-this-opens-live-chrome-for-recon
 *
 * Flow: launch → operator installs "Claude in Chrome" from the Web Store IN THIS WINDOW →
 * operator `touch .status/naver-api-recon.teardown` → this re-checks extension state, prints it,
 * and tears down. Then verify `/chrome` / `claude --chrome` connection separately (native
 * messaging, not observable here).
 */
import { mkdirSync, rmSync, existsSync, mkdtempSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext } from "playwright";
import { accountScopedProfileDirFor } from "../src/profile";

const here = dirname(fileURLToPath(import.meta.url));
const collectorRoot = resolve(here, "..");
const RECON_FLAG = "--i-understand-this-opens-live-chrome-for-recon";
const RECON_SLOT = "naver-api-recon"; // opaque recon slot — NOT a real seller-account id
const SENTINEL = resolve(collectorRoot, ".status", "naver-api-recon.teardown");

function leafOf(dir: string): string {
  return dir.slice(dir.lastIndexOf("/") + 1);
}

/** Sanitized extension-presence snapshot: counts + boolean only, never an extension value/id. */
function extensionSnapshot(ctx: BrowserContext): { extensionServiceWorkers: number; extensionBackgroundPages: number } {
  const isExt = (u: string) => u.startsWith("chrome-extension://");
  const sw = ctx.serviceWorkers().filter((w) => isExt(w.url())).length;
  const bg = ctx.backgroundPages().filter((p) => isExt(p.url())).length;
  return { extensionServiceWorkers: sw, extensionBackgroundPages: bg };
}

/**
 * CDP target enumeration — catches an installed-but-dormant MV3 service worker that
 * `context.serviceWorkers()` has not surfaced yet. Returns a sanitized count only
 * (chrome-extension:// service_worker / background_page targets), never any id/url.
 */
async function cdpExtensionTargets(ctx: BrowserContext): Promise<number> {
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const session = await ctx.newCDPSession(page);
    const { targetInfos } = (await session.send("Target.getTargets")) as {
      targetInfos: Array<{ type: string; url: string }>;
    };
    await session.detach().catch(() => {});
    return targetInfos.filter(
      (t) => (t.type === "service_worker" || t.type === "background_page") && t.url.startsWith("chrome-extension://"),
    ).length;
  } catch {
    return -1; // CDP probe unavailable
  }
}

/** Poll for an extension to surface (SW may wake lazily), up to ~timeoutMs. */
async function detectExtensions(ctx: BrowserContext, timeoutMs: number): Promise<{ extensionServiceWorkers: number; extensionBackgroundPages: number; cdpExtensionTargets: number; anyExtension: boolean }> {
  let iterations = Math.max(1, Math.floor(timeoutMs / 500));
  let snap = extensionSnapshot(ctx);
  let cdp = await cdpExtensionTargets(ctx);
  while (iterations-- > 0 && snap.extensionServiceWorkers + snap.extensionBackgroundPages + Math.max(0, cdp) === 0) {
    await new Promise((r) => setTimeout(r, 500));
    snap = extensionSnapshot(ctx);
    cdp = await cdpExtensionTargets(ctx);
  }
  return { ...snap, cdpExtensionTargets: cdp, anyExtension: snap.extensionServiceWorkers + snap.extensionBackgroundPages + Math.max(0, cdp) > 0 };
}

async function main(): Promise<void> {
  if (!process.argv.includes(RECON_FLAG)) {
    console.error(`refusing: this opens a real Chrome. Pass ${RECON_FLAG} to proceed.`);
    process.exit(2);
  }

  const profileDir = accountScopedProfileDirFor(resolve(collectorRoot, ".profile"), "naver", RECON_SLOT);
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(resolve(collectorRoot, ".status"), { recursive: true });
  if (existsSync(SENTINEL)) rmSync(SENTINEL); // clear a stale teardown signal

  // Recon-only launch options. Product launcher (src/profile.ts) is NOT used and NOT changed.
  const launchOptions = {
    headless: false as const,
    channel: "chrome",
    acceptDownloads: true,
    chromiumSandbox: true,
    ignoreDefaultArgs: ["--disable-extensions"], // recon-only; lets the operator's Web-Store extension load
  };

  console.log("[recon] launch options (sanitized):", JSON.stringify(launchOptions));
  console.log("[recon] recon profile leaf (opaque):", leafOf(profileDir));

  const ctx = await chromium.launchPersistentContext(profileDir, launchOptions);
  const teardown = async () => {
    try { await ctx.close(); } catch { /* already closing */ }
  };
  process.on("SIGINT", () => { void teardown().then(() => process.exit(0)); });
  process.on("SIGTERM", () => { void teardown().then(() => process.exit(0)); });

  // Harmless action only: a blank tab + read its title. No NAVER, no navigation to any site.
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("about:blank");
  const title = await page.title();
  console.log("[recon] blank-tab title read (harmless):", JSON.stringify(title));

  const atStart = await detectExtensions(ctx, 8000);
  console.log("[recon] extension detection at launch:", JSON.stringify(atStart));
  console.log("[recon] EXTENSION_ACTIVE:", atStart.anyExtension);
  console.log("[recon] LAUNCH_OK — window is open on the recon-only profile.");
  console.log(`[recon] NEXT: in Claude Code run  /chrome  (or claude --chrome) and confirm it targets THIS window,`);
  console.log(`[recon]       then run:  touch ${SENTINEL}`);
  console.log("[recon] waiting for the teardown sentinel…");

  // Keep the context alive so the operator can install the extension, then re-check on the sentinel.
  await new Promise<void>((resolveWait) => {
    const timer = setInterval(() => {
      if (existsSync(SENTINEL)) {
        clearInterval(timer);
        rmSync(SENTINEL);
        resolveWait();
      }
    }, 1000);
  });

  const finalDetect = await detectExtensions(ctx, 3000);
  console.log("[recon] extension detection at teardown:", JSON.stringify(finalDetect));
  console.log("[recon] EXTENSION_ACTIVE_FINAL:", finalDetect.anyExtension);
  await teardown();
  console.log("[recon] torn down cleanly.");
  process.exit(0);
}

void main();
