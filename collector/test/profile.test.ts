import { describe, expect, it } from "vitest";
import { buildLaunchOptions, resolveProfileDir } from "../src/profile";

const ROOT = "/tmp/collector-root";

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

describe("buildLaunchOptions", () => {
  it("defaults to bundled Chromium (no channel) when unset", () => {
    const opts = buildLaunchOptions(undefined);
    expect(opts).toEqual({ headless: false, acceptDownloads: true });
    expect("channel" in opts).toBe(false);
  });

  it("maps a configured channel (chrome) to Playwright's channel option", () => {
    expect(buildLaunchOptions("chrome")).toEqual({
      headless: false,
      acceptDownloads: true,
      channel: "chrome",
    });
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
