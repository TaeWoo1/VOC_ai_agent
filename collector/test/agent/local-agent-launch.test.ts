import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLocalAgentLaunchPolicy,
  LOCAL_AGENT_MOCK_KEYCHAIN_ARG,
  type LocalAgentLaunchPolicy,
} from "../../src/agent/local-agent-launch";
import { buildLaunchOptions } from "../../src/profile";

const collectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEDICATED = resolve(collectorRoot, ".profile/esm-agent-local");

function macPolicy(overrides: Partial<Parameters<typeof buildLocalAgentLaunchPolicy>[0]> = {}): LocalAgentLaunchPolicy {
  return buildLocalAgentLaunchPolicy({ platform: "darwin", profileDir: DEDICATED, ...overrides });
}

describe("Local Agent launch policy (macOS-specific, local-agent-specific)", () => {
  it("[1] macOS launch policy drops --use-mock-keychain (so the real Keychain loads)", () => {
    const p = macPolicy();
    expect(p.ignoreDefaultArgs).toEqual([LOCAL_AGENT_MOCK_KEYCHAIN_ARG]);
    expect(p.channel).toBe("chrome");
    expect(p.headless).toBe(false);
  });

  it("[1b] **the page follows the WINDOW** — viewport is explicitly null on every platform", () => {
    // Omitting `viewport` does not mean "use the window": Playwright pins the page to 1280x720 regardless of how
    // large the seller makes the window, and the page never reflows. Live-observed 2026-08-12 on the Coupang
    // guided walk — the WING key-issuance dialog is taller than 720px and the guidance panel is anchored to the
    // bottom of that fixed viewport, which is exactly where WING puts a dialog's primary buttons, so the walk
    // covered the '확인' it was asking the seller to press. `null` is load-bearing; it is not a default.
    for (const platform of ["darwin", "linux", "win32"] as NodeJS.Platform[]) {
      const p = buildLocalAgentLaunchPolicy({ platform, profileDir: DEDICATED });
      expect(p.viewport, platform).toBeNull();
      // Not merely absent — an omitted key is the defect this pins.
      expect("viewport" in p, platform).toBe(true);
    }
  });

  it("[2] it never forces --password-store=basic", () => {
    const p = macPolicy();
    expect(JSON.stringify(p)).not.toContain("--password-store");
    expect(p.ignoreDefaultArgs).not.toContain("--password-store=basic");
  });

  it("[3] the unrelated shared launcher (buildLaunchOptions) is unchanged — no ignoreDefaultArgs, no exception", () => {
    const shared = buildLaunchOptions("chrome") as unknown as Record<string, unknown>;
    expect(shared).toEqual({ headless: false, acceptDownloads: true, chromiumSandbox: true, channel: "chrome" });
    expect("ignoreDefaultArgs" in shared).toBe(false);
    expect(JSON.stringify(shared)).not.toContain("--use-mock-keychain");
  });

  it("[4] non-macOS never applies the macOS exception", () => {
    for (const platform of ["linux", "win32"] as NodeJS.Platform[]) {
      const p = buildLocalAgentLaunchPolicy({ platform, profileDir: DEDICATED });
      expect(p.ignoreDefaultArgs).toBeUndefined();
    }
  });

  it("[5] a dedicated account-scoped profile dir is required (empty / collector-root rejected)", () => {
    expect(() => macPolicy({ profileDir: "" })).toThrow();
    expect(() => macPolicy({ profileDir: "   " })).toThrow();
    expect(() => macPolicy({ profileDir: collectorRoot })).toThrow();
  });

  it("[6] the personal / OS-default Chrome profile is rejected (out-of-tree)", () => {
    expect(() => macPolicy({ profileDir: "/Users/someone/Library/Application Support/Google/Chrome" })).toThrow();
    expect(() => macPolicy({ profileDir: resolve(collectorRoot, "../outside-the-collector") })).toThrow();
  });

  it("(extra) a dedicated in-tree profile is accepted and Chrome Stable is required", () => {
    expect(() => macPolicy()).not.toThrow();
    expect(macPolicy().userDataDir).toBe(DEDICATED);
    expect(() => macPolicy({ channel: "  " })).toThrow(); // blank channel → no bundled Chromium fallback
  });
});
