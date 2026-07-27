import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { accountScopedProfileDirFor, buildLaunchOptions, resolveProfileDir } from "../src/profile";

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
    expect(() => resolveProfileDir("/etc/passwd", ROOT)).toThrow(/inside the collector/);
  });

  it("rejects a traversal that escapes the collector root", () => {
    expect(() => resolveProfileDir(`${ROOT}/../evil`, ROOT)).toThrow(/inside the collector/);
  });

  it("rejects a sibling whose name only prefixes the root", () => {
    // `${ROOT}-evil` shares the string prefix but is NOT under `${ROOT}/`.
    expect(() => resolveProfileDir(`${ROOT}-evil/profile`, ROOT)).toThrow(/inside the collector/);
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
    expect(() => accountScopedProfileDirFor("/tmp/evil", "naver", SLOT_A)).toThrow(/inside the collector/);
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
