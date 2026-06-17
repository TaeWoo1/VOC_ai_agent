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

/**
 * Launch a headed, persistent Chromium context against the local profile dir.
 * Headed so a human can log into NAVER and clear any 2FA/CAPTCHA themselves — the
 * collector never types credentials. Downloads are accepted so a sync export can
 * be captured. The session lives ONLY in userDataDir; it is never serialized or
 * sent anywhere.
 *
 * LIVE-ONLY: launches a real browser. Run only under explicit, per-run operator
 * approval (see README).
 */
export async function launchNaverContext(profileDir: string): Promise<BrowserContext> {
  const userDataDir = resolveProfileDir(profileDir);
  mkdirSync(userDataDir, { recursive: true });
  log("profile.launch", { headless: false });
  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    acceptDownloads: true,
  });
}
