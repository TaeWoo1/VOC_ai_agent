import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  accountScopedProfileDirFor,
  buildLaunchOptions,
  markProfileCleanExit,
  resolveProfileDir,
} from "../src/profile";

const ROOT = "/tmp/collector-root";

// The account-scoped resolver guards against the REAL collector tree (it calls resolveProfileDir with no
// injected root), so its base must live inside it. This test file sits at collector/test/.
const COLLECTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = resolve(COLLECTOR_ROOT, ".profile");
const SLOT_A = "aabbccddeeff00112233abcd";
const SLOT_B = "0011223344556677889900ff";

describe("resolveProfileDir", () => {
  it("accepts the collector root itself", () => {
    expect(resolveProfileDir(ROOT, ROOT)).toBe(ROOT);
  });

  it("accepts a path nested under the collector root", () => {
    expect(resolveProfileDir(`${ROOT}/.profile/naver`, ROOT)).toBe(`${ROOT}/.profile/naver`);
  });

  it("rejects an absolute path outside the collector root", () => {
    expect(() => resolveProfileDir("/etc/passwd", ROOT)).toThrow(/controlled profile base/);
  });

  it("rejects a traversal that escapes the collector root", () => {
    expect(() => resolveProfileDir(`${ROOT}/../evil`, ROOT)).toThrow(/controlled profile base/);
  });

  it("rejects a sibling whose name only prefixes the root", () => {
    // `${ROOT}-evil` shares the string prefix but is NOT under `${ROOT}/`.
    expect(() => resolveProfileDir(`${ROOT}-evil/profile`, ROOT)).toThrow(/controlled profile base/);
  });

  it("accepts a path under the pilot data-root base (COLLECTOR_PROFILE_BASE_DIR) even when outside the tree", () => {
    const prev = process.env.COLLECTOR_PROFILE_BASE_DIR;
    process.env.COLLECTOR_PROFILE_BASE_DIR = "/data/root/profiles";
    try {
      // A profile under the relocated pilot base is allowed (survives an update)...
      expect(resolveProfileDir("/data/root/profiles/naver")).toBe("/data/root/profiles/naver");
      // ...but a path under neither the tree nor the pilot base is still refused.
      expect(() => resolveProfileDir("/somewhere/else/profile")).toThrow(/controlled profile base/);
    } finally {
      if (prev === undefined) delete process.env.COLLECTOR_PROFILE_BASE_DIR;
      else process.env.COLLECTOR_PROFILE_BASE_DIR = prev;
    }
  });
});

describe("accountScopedProfileDirFor", () => {
  it("resolves the SAME dir for the same (channel, slot) — so a login survives an agent restart", () => {
    const first = accountScopedProfileDirFor(BASE, "naver", SLOT_A);
    const second = accountScopedProfileDirFor(BASE, "naver", SLOT_A);
    expect(first).toBe(second);
  });

  it("resolves DIFFERENT dirs for two accounts on one channel — so their cookies never mix", () => {
    expect(accountScopedProfileDirFor(BASE, "naver", SLOT_A)).not.toBe(
      accountScopedProfileDirFor(BASE, "naver", SLOT_B),
    );
  });

  it("separates the same slot across channels", () => {
    expect(accountScopedProfileDirFor(BASE, "naver", SLOT_A)).not.toBe(
      accountScopedProfileDirFor(BASE, "esm", SLOT_A),
    );
  });

  it("puts a channel-prefixed one-way hash leaf under the base, never the raw slot", () => {
    const dir = accountScopedProfileDirFor(BASE, "naver", SLOT_A);
    expect(dir.startsWith(`${BASE}/`)).toBe(true);
    expect(dir).toMatch(/\/naver-agent-[0-9a-f]{24}$/);
    // The opaque slot is a surrogate already, but it must not appear verbatim in a filesystem path either.
    expect(dir).not.toContain(SLOT_A);
  });

  it("is distinct from the ESM reconnect path's esm-agent-<hash> leaves", () => {
    // Even for channel 'esm', the leaf is `esm-agent-<hash of account-session-profile ...>`, a different
    // hash input than the ESM connection resolver, so the two families cannot collide by construction.
    const dir = accountScopedProfileDirFor(BASE, "esm", SLOT_A);
    expect(dir).toMatch(/\/esm-agent-[0-9a-f]{24}$/);
  });

  it("cannot escape the collector tree even with a hostile channel code or base", () => {
    // A hostile channel code is sanitized to alnum before it becomes a directory prefix.
    const dir = accountScopedProfileDirFor(BASE, "../../etc", SLOT_A);
    expect(dir.startsWith(`${BASE}/`)).toBe(true);
    // A base outside the collector tree is refused by the in-tree guard.
    expect(() => accountScopedProfileDirFor("/tmp/evil", "naver", SLOT_A)).toThrow(/controlled profile base/);
  });
});

describe("markProfileCleanExit", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function profileWith(prefs: unknown): string {
    const root = mkdtempSync(join(tmpdir(), "sellerops-prof-"));
    dirs.push(root);
    mkdirSync(join(root, "Default"), { recursive: true });
    if (prefs !== undefined) writeFileSync(join(root, "Default", "Preferences"), JSON.stringify(prefs));
    return root;
  }

  it("flips a crashed profile to a clean exit so no restore bubble shows next launch", () => {
    const root = profileWith({ profile: { exit_type: "Crashed", exited_cleanly: false }, other: { keep: 1 } });
    markProfileCleanExit(root);
    const after = JSON.parse(readFileSync(join(root, "Default", "Preferences"), "utf8"));
    expect(after.profile.exit_type).toBe("Normal");
    expect(after.profile.exited_cleanly).toBe(true);
    // Unrelated preferences are preserved — we touch only the crash-restore flags.
    expect(after.other).toEqual({ keep: 1 });
  });

  it("is a no-op that never throws when the profile has no Preferences yet (fresh profile)", () => {
    const root = profileWith(undefined);
    expect(() => markProfileCleanExit(root)).not.toThrow();
  });

  it("never throws on unreadable/garbage Preferences", () => {
    const root = mkdtempSync(join(tmpdir(), "sellerops-prof-"));
    dirs.push(root);
    mkdirSync(join(root, "Default"), { recursive: true });
    writeFileSync(join(root, "Default", "Preferences"), "not json {{{");
    expect(() => markProfileCleanExit(root)).not.toThrow();
  });
});

describe("buildLaunchOptions", () => {
  it("defaults to bundled Chromium (no channel) with the sandbox enabled", () => {
    const opts = buildLaunchOptions(undefined);
    expect(opts).toEqual({ headless: false, acceptDownloads: true, chromiumSandbox: true });
    expect("channel" in opts).toBe(false);
  });

  it("maps a configured channel (chrome) to Playwright's channel option, sandbox enabled", () => {
    expect(buildLaunchOptions("chrome")).toEqual({
      headless: false,
      acceptDownloads: true,
      chromiumSandbox: true,
      channel: "chrome",
    });
  });

  it("enables chromiumSandbox (no --no-sandbox) for both bundled and chrome channel", () => {
    expect(buildLaunchOptions(undefined).chromiumSandbox).toBe(true);
    expect(buildLaunchOptions("chrome").chromiumSandbox).toBe(true);
  });

  it("treats a blank/whitespace channel as unset (bundled Chromium)", () => {
    expect("channel" in buildLaunchOptions("")).toBe(false);
    expect("channel" in buildLaunchOptions("   ")).toBe(false);
  });

  it("trims surrounding whitespace from a configured channel", () => {
    expect(buildLaunchOptions("  chrome  ").channel).toBe("chrome");
  });

  it("is always headed and download-accepting (human login + sync capture)", () => {
    const opts = buildLaunchOptions("chrome");
    expect(opts.headless).toBe(false);
    expect(opts.acceptDownloads).toBe(true);
  });
});
