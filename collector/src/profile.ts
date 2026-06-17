import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext } from "playwright";
import { log } from "./log";

const here = dirname(fileURLToPath(import.meta.url));
const collectorRoot = resolve(here, "..");

/**
 * Minimal structural surface of the Playwright objects the collector touches.
 * Declared here (not imported from playwright) so the pure session/export logic
 * can be unit-tested against fakes without importing or launching a browser.
 */
export interface PwPage {
  url(): string;
  content(): Promise<string>;
  goto(
    url: string,
    opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number },
  ): Promise<unknown>;
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  waitForEvent(event: "download", opts?: { timeout?: number }): Promise<PwDownload>;
}

export interface PwDownload {
  suggestedFilename(): string;
  saveAs(path: string): Promise<void>;
  /**
   * Resolves to the local temp path once the download stream completes; rejects on
   * a failed/canceled download. Used (in classify-only) to wait for completion
   * WITHOUT `saveAs` — we never read the file's contents.
   */
  path(): Promise<string | null>;
  /** Download error string if the download failed, else null. */
  failure(): Promise<string | null>;
}

/**
 * Resolve and guard the persistent-profile directory. The POC keeps the NAVER
 * session inside the collector tree only; refuse any path that escapes it so a
 * misconfiguration cannot scatter session data across the filesystem.
 */
export function resolveProfileDir(profileDir: string, root: string = collectorRoot): string {
  const resolved = resolve(profileDir);
  const base = resolve(root);
  if (resolved !== base && !resolved.startsWith(base + "/")) {
    throw new Error("profile dir must live inside the collector directory");
  }
  return resolved;
}

/** Persistent-context launch options the collector controls. */
export interface NaverLaunchOptions {
  headless: boolean;
  acceptDownloads: boolean;
  /**
   * Enable the OS-level Chromium sandbox. Playwright disables it by default
   * (adding `--no-sandbox`), which makes Chrome show an "unsupported
   * command-line flag (--no-sandbox)" security warning. We enable it so the
   * human logs into NAVER in a normally-sandboxed browser. Safe on macOS for a
   * non-root user with both bundled Chromium and an installed-Chrome channel.
   */
  chromiumSandbox: boolean;
  /** Present only when a browser channel is configured (e.g. `chrome`). */
  channel?: string;
}

/**
 * Pure: build the persistent-context launch options. Always headed (a human logs
 * in), download-accepting (a sync export can be captured), and sandbox-enabled
 * (no `--no-sandbox` warning). A non-empty `channel` (e.g. `chrome`) selects the
 * installed browser of that channel instead of the bundled Chromium; an
 * unset/blank channel omits the key, so Playwright uses its bundled Chromium.
 * This only changes WHICH browser binary launches — it never changes the profile
 * dir, so the dedicated SellerOps profile (not the user's personal Chrome
 * profile) is used regardless.
 */
export function buildLaunchOptions(channel?: string): NaverLaunchOptions {
  const base: NaverLaunchOptions = {
    headless: false,
    acceptDownloads: true,
    chromiumSandbox: true,
  };
  const trimmed = channel?.trim();
  return trimmed ? { ...base, channel: trimmed } : base;
}

/**
 * Launch a headed, persistent context against the local profile dir. Headed so a
 * human can log into NAVER and clear any 2FA/CAPTCHA themselves — the collector
 * never types credentials. Downloads are accepted so a sync export can be
 * captured. When `channel` is set the installed browser of that channel is used
 * (e.g. real Chrome) instead of the bundled Chromium; the session still lives
 * ONLY in the dedicated userDataDir and is never serialized or sent anywhere.
 *
 * LIVE-ONLY: launches a real browser. Run only under explicit, per-run operator
 * approval (see README).
 */
export async function launchNaverContext(
  profileDir: string,
  channel?: string,
): Promise<BrowserContext> {
  const userDataDir = resolveProfileDir(profileDir);
  mkdirSync(userDataDir, { recursive: true });
  const options = buildLaunchOptions(channel);
  log("profile.launch", { headless: options.headless, channel: options.channel ?? "bundled" });
  return chromium.launchPersistentContext(userDataDir, options);
}
