import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
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
  /**
   * Live-only: poll a browser-evaluated predicate until it returns truthy or the
   * timeout elapses (rejects with a `TimeoutError` on timeout). OPTIONAL on this
   * structural surface so pure unit tests can fake a page WITHOUT it — the
   * hydration wait then reports `not-attempted`. A real Playwright page always has it.
   */
  waitForFunction?(
    pageFunction: () => boolean,
    arg?: unknown,
    opts?: { timeout?: number },
  ): Promise<unknown>;
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
 * Resolve and guard the persistent-profile directory. A profile must live under a *controlled* base so a
 * misconfiguration cannot scatter session data across the filesystem — but there are now two legitimate
 * bases: the in-tree `.profile` (dev), and the pilot's per-user data root (`COLLECTOR_PROFILE_BASE_DIR`,
 * e.g. `%LOCALAPPDATA%\SellerOps\Agent\profiles`) where the login survives an in-place update. Any path under
 * EITHER is allowed; anything escaping both is refused. Uses `path.sep`, so the containment check is correct
 * on Windows (where `resolve` yields `\` separators) as well as POSIX.
 */
export function resolveProfileDir(profileDir: string, root: string = collectorRoot): string {
  const resolved = resolve(profileDir);
  const bases = new Set<string>([resolve(root)]);
  const pilotBase = process.env.COLLECTOR_PROFILE_BASE_DIR?.trim();
  if (pilotBase) bases.add(resolve(pilotBase));
  for (const base of bases) {
    if (resolved === base || resolved.startsWith(base + sep)) return resolved;
  }
  throw new Error("profile dir must live inside a controlled profile base");
}

/**
 * Sanitize a channel code for use as a human-readable directory prefix — only lowercase alphanumerics
 * survive, so an unexpected value can never inject a path separator or `..`. Directory uniqueness comes from
 * the hash below, not this prefix, so a prefix collision is harmless.
 */
function channelPrefix(channelCode: string): string {
  const safe = channelCode.toLowerCase().replace(/[^a-z0-9]/g, "");
  return safe.length > 0 ? safe : "ch";
}

/**
 * The account-scoped persistent-profile directory: `${profileBaseDir}/<channel>-agent-<24 hex>`.
 *
 * The leaf is a one-way hash of `(channelCode, accountSlot)`, so two accounts on one channel — or the same
 * account on two channels — never share a directory, and no raw slot, path separator, or `..` reaches the
 * filesystem name. The slot is already an opaque server surrogate (never the seller-account id), so nothing
 * here is reversible to an identity. Deterministic on `(channelCode, accountSlot)` alone: the SAME account
 * resolves to the SAME directory every run, which is exactly what lets a login survive an agent restart. The
 * in-tree guard ({@link resolveProfileDir}) still runs, so this cannot escape the collector tree. Distinct
 * from the ESM reconnect path's `esm-agent-<hash>` leaves, so the two never collide.
 */
export function accountScopedProfileDirFor(
  profileBaseDir: string,
  channelCode: string,
  accountSlot: string,
): string {
  const digest = createHash("sha256")
    .update(`account-session-profile ${channelCode}\u0000${accountSlot}`)
    .digest("hex")
    .slice(0, 24);
  const leaf = `${channelPrefix(channelCode)}-agent-${digest}`;
  return resolveProfileDir(resolve(profileBaseDir, leaf));
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
 * Mark a persistent profile as having exited cleanly, BEFORE the next launch.
 *
 * Playwright terminates Chromium without running Chrome's own clean-exit path, so a profile it has used is
 * left flagged as a crash — and on the next launch Chrome shows a "restore pages / didn't shut down
 * correctly" bubble over the page. For an account-scoped session runtime that reopens the SAME profile on
 * every agent restart, that bubble would appear every single time and sit on top of the seller-center. This
 * rewrites the two flags Chrome reads at startup so the bubble never shows. It changes nothing about the
 * session itself (cookies/login are untouched) — only the crash-restore prompt — and is best-effort: a
 * missing or unreadable Preferences file (a brand-new profile has none yet) is simply left alone.
 */
export function markProfileCleanExit(userDataDir: string): void {
  const prefsPath = join(userDataDir, "Default", "Preferences");
  try {
    const prefs = JSON.parse(readFileSync(prefsPath, "utf8")) as {
      profile?: { exit_type?: string; exited_cleanly?: boolean };
    };
    if (!prefs.profile) prefs.profile = {};
    if (prefs.profile.exit_type === "Normal" && prefs.profile.exited_cleanly === true) return;
    prefs.profile.exit_type = "Normal";
    prefs.profile.exited_cleanly = true;
    writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {
    // No Preferences yet (fresh profile) or unreadable JSON — nothing to clean, and this must never fail a launch.
  }
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
  // Suppress Chrome's crash-restore bubble on this reopen — Playwright left the profile flagged dirty when it
  // tore the previous browser down. Cookies/login are untouched; only the restore prompt is cleared.
  markProfileCleanExit(userDataDir);
  const options = buildLaunchOptions(channel);
  log("profile.launch", { headless: options.headless, channel: options.channel ?? "bundled" });
  return chromium.launchPersistentContext(userDataDir, options);
}

/**
 * Channel-generic alias of {@link launchNaverContext}: the persistent-context launcher
 * is NOT NAVER-specific — it only differs by the `profileDir` it is given (and the
 * path guard keeps every profile inside the collector tree). The ESM+ REVIEW discovery
 * layer uses this with its OWN profile dir (`cfg.esmProfileDir`), so the two platforms'
 * sessions never share storage. No behavioural difference from `launchNaverContext`.
 */
export const launchPersistentBrowser = launchNaverContext;
