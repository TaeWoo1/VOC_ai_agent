/**
 * **Local Agent macOS Chrome launch policy** (M-Agent-1C1).
 *
 * M-Agent-1B proved that Playwright's default `--use-mock-keychain` severs Chrome
 * from the real macOS Keychain, so the seller's saved marketplace credential (stored
 * under the OS keychain) is invisible and cannot autofill. The Local Agent reconnect
 * therefore needs a **macOS-specific, local-agent-specific** launch that omits that
 * one default arg — nothing else changes, and this exception is applied ONLY here.
 *
 * This module is **pure** (option computation only; the one live launcher at the
 * bottom is a thin wrapper that is never exercised by unit tests). It NEVER:
 *  - touches the personal / OS-default Chrome profile (the dedicated in-tree
 *    account-scoped profile guard, reused from `profile.ts`, rejects any escape);
 *  - forces `--password-store=basic` (1B showed dropping `--use-mock-keychain`
 *    alone suffices on macOS; forcing the basic store would re-break the keychain);
 *  - changes any unrelated collector launcher (`buildLaunchOptions` /
 *    `launchNaverContext` are untouched — the mock-keychain default stays for them).
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchOptions, resolveProfileDir } from "../profile";

const here = dirname(fileURLToPath(import.meta.url));
const collectorRoot = resolve(here, "../..");

/** The single Playwright default arg the macOS Local Agent drops so the real Keychain loads. */
export const LOCAL_AGENT_MOCK_KEYCHAIN_ARG = "--use-mock-keychain";

/** The password-store arg we must NEVER force (forcing it re-breaks Keychain autofill on macOS). */
export const FORBIDDEN_PASSWORD_STORE_ARG = "--password-store=basic";

/**
 * The computed persistent-context launch policy for the Local Agent. Mirrors the
 * collector's existing launch options and adds ONLY `ignoreDefaultArgs` — present
 * (and equal to `[--use-mock-keychain]`) on macOS, absent on every other platform.
 */
export interface LocalAgentLaunchPolicy {
  userDataDir: string;
  headless: false;
  acceptDownloads: boolean;
  chromiumSandbox: boolean;
  /** Always an installed Chrome channel (default `chrome`) — never bundled Chromium. */
  channel: string;
  /**
   * `null` = the page uses the REAL window size, which is the only correct setting for a window a human works in.
   *
   * Omitting this pins the page viewport to Playwright's 1280x720 default, INDEPENDENTLY of the window: the
   * seller maximizes the window and the page does not reflow. Live-observed 2026-08-12 on the guided walk — the
   * WING key-issuance dialog is taller than 720px, and the guidance panel is anchored to the bottom of that
   * fixed viewport, which is exactly where WING puts a dialog's primary buttons. The seller could not reach
   * '확인' without zooming out. A walk that covers the control it is asking the seller to press is worse than
   * no walk, and this is a launch default, not a WING quirk.
   */
  viewport: null;
  /** macOS ONLY: `['--use-mock-keychain']`. Undefined on other platforms. */
  ignoreDefaultArgs?: string[];
}

/**
 * Guard the Local Agent profile dir: a dedicated, account-scoped directory INSIDE
 * the collector tree. Reuses `resolveProfileDir` (which rejects any path escaping
 * the collector tree — including the personal / OS-default Chrome profile) and
 * additionally rejects an empty dir or the collector root itself (not dedicated).
 */
export function assertDedicatedProfileDir(profileDir: string): string {
  if (!profileDir || profileDir.trim().length === 0) {
    throw new Error("local agent requires a dedicated account-scoped profile dir");
  }
  const resolved = resolveProfileDir(profileDir); // throws for the personal / out-of-tree Chrome profile
  if (resolved === collectorRoot) {
    throw new Error("local agent profile dir must be a dedicated subdirectory, not the collector root");
  }
  return resolved;
}

/**
 * Build the Local Agent launch policy. `--use-mock-keychain` is dropped ONLY on
 * macOS (`darwin`); on any other platform the policy carries no `ignoreDefaultArgs`
 * so the exception never leaks cross-platform. Never forces `--password-store=basic`.
 * Always an installed Chrome channel + a dedicated in-tree profile.
 */
export function buildLocalAgentLaunchPolicy(opts: {
  platform: NodeJS.Platform;
  profileDir: string;
  channel?: string;
}): LocalAgentLaunchPolicy {
  const channel = (opts.channel ?? "chrome").trim();
  if (channel.length === 0) {
    throw new Error("local agent requires an installed Chrome channel (never bundled Chromium)");
  }
  const userDataDir = assertDedicatedProfileDir(opts.profileDir);
  const base = buildLaunchOptions(channel); // { headless:false, acceptDownloads, chromiumSandbox, channel }

  const policy: LocalAgentLaunchPolicy = {
    userDataDir,
    headless: false,
    acceptDownloads: base.acceptDownloads,
    chromiumSandbox: base.chromiumSandbox,
    channel,
    // The page follows the WINDOW. See the field's doc: without this the seller works in a 1280x720 page no
    // matter how large they make the window, and the guidance panel sits on top of WING's own buttons.
    viewport: null,
  };
  if (opts.platform === "darwin") {
    policy.ignoreDefaultArgs = [LOCAL_AGENT_MOCK_KEYCHAIN_ARG];
  }
  return policy;
}

/**
 * LIVE-ONLY thin launcher — launches Chrome Stable against the dedicated profile
 * using {@link buildLocalAgentLaunchPolicy}. Imports Playwright lazily so this module
 * stays free of a top-level browser import; NEVER called by unit tests (the adapter
 * is tested behind an injected page). Runs only under explicit, per-run approval.
 */
export async function launchLocalAgentChrome(opts: {
  platform: NodeJS.Platform;
  profileDir: string;
  channel?: string;
}): Promise<import("playwright").BrowserContext> {
  const policy = buildLocalAgentLaunchPolicy(opts);
  const { chromium } = await import("playwright");
  const { userDataDir, ...launchOptions } = policy;
  return chromium.launchPersistentContext(userDataDir, launchOptions);
}
