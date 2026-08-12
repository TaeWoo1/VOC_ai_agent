import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  /**
   * `null` means "stop overriding the page's metrics" — present ONLY under {@link LaunchWindowPolicy.followWindow}.
   * See {@link buildLaunchOptions} for what it is measured to fix.
   */
  viewport?: null;
  /** Chromium args — present only under `followWindow`, where the window must open at the desktop's size. */
  args?: string[];
}

/** Should the PAGE be laid out against the WINDOW the seller actually has? Off by default; see below. */
export interface LaunchWindowPolicy {
  followWindow?: boolean;
}

/** Opens the window at the size of the desktop. Load-bearing under `followWindow` — see the measurement below. */
const START_MAXIMIZED_ARG = "--start-maximized";

/**
 * Pure: build the persistent-context launch options. Always headed (a human logs
 * in), download-accepting (a sync export can be captured), and sandbox-enabled
 * (no `--no-sandbox` warning). A non-empty `channel` (e.g. `chrome`) selects the
 * installed browser of that channel instead of the bundled Chromium; an
 * unset/blank channel omits the key, so Playwright uses its bundled Chromium.
 * This only changes WHICH browser binary launches — it never changes the profile
 * dir, so the dedicated SellerOps profile (not the user's personal Chrome
 * profile) is used regardless.
 *
 * ## `followWindow` — the guided-walk crop, and what measurement says about it
 *
 * Playwright's default is to OVERRIDE the page's device metrics: without an explicit `viewport` it pins every
 * page to 1280×720 at DPR 1, no matter what window the operator has. `measure-walk-window-geometry.ts` read
 * this back from real Chrome on 2026-08-12:
 *
 * ```
 * AS_SHIPPED      inner 1280×720   outer 1420×850   screenAvail 1280×720    dpr 1
 * MAXIMIZED       inner 1280×720   outer 1420×850   screenAvail 1280×720    dpr 1
 * FOLLOWS_WINDOW  inner 1440×783   outer 1440×870   screenAvail 1440×870    dpr 2
 * ```
 *
 * Three things that only a measurement could settle. The page is laid out for 140×130 CSS px LESS than the
 * window it is displayed in — WING's own dialog then runs past the bottom of what the seller can see, which is
 * the live-observed crop where the vendor `확인` was unreachable. `--start-maximized` alone changes NOTHING,
 * because the override wins over the window; that is why the operator's only working workaround was `cmd -`
 * (page zoom is the one thing that alters CSS layout size while the viewport is pinned). And the override fakes
 * the SCREEN too — a page asking how big the display is gets 1280×720 at DPR 1 rather than the real 1440×870 at
 * DPR 2, so a responsive marketplace layout is answering a question about a monitor that does not exist.
 *
 * `followWindow` turns the override off (`viewport: null`) AND opens the window at the desktop's size. The two
 * belong together: `viewport: null` alone leaves Playwright's default 1280×720 WINDOW, whose page area is
 * SHORTER than the 720 px it replaces. Off by default, so no other launcher moves.
 */
export function buildLaunchOptions(channel?: string, policy?: LaunchWindowPolicy): NaverLaunchOptions {
  const base: NaverLaunchOptions = {
    headless: false,
    acceptDownloads: true,
    chromiumSandbox: true,
  };
  const withWindow: NaverLaunchOptions = policy?.followWindow
    ? { ...base, viewport: null, args: [START_MAXIMIZED_ARG] }
    : base;
  const trimmed = channel?.trim();
  return trimmed ? { ...withWindow, channel: trimmed } : withWindow;
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
  policy?: LaunchWindowPolicy,
): Promise<BrowserContext> {
  const userDataDir = resolveProfileDir(profileDir);
  mkdirSync(userDataDir, { recursive: true });
  // Suppress Chrome's crash-restore bubble on this reopen — Playwright left the profile flagged dirty when it
  // tore the previous browser down. Cookies/login are untouched; only the restore prompt is cleared.
  markProfileCleanExit(userDataDir);
  const options = buildLaunchOptions(channel, policy);
  // `followWindow` is logged because it changes what the seller sees, and a run that came up cropped should be
  // answerable from the log rather than from re-deriving which call site launched it. A boolean, not a size.
  log("profile.launch", {
    headless: options.headless,
    channel: options.channel ?? "bundled",
    followWindow: policy?.followWindow === true,
  });
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
