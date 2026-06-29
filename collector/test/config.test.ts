import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { resolveProfileDir } from "../src/profile";

describe("loadConfig — browserChannel", () => {
  it("is undefined by default (→ bundled Chromium)", () => {
    expect(loadConfig({}).browserChannel).toBeUndefined();
  });

  it("reads COLLECTOR_BROWSER_CHANNEL=chrome", () => {
    expect(loadConfig({ COLLECTOR_BROWSER_CHANNEL: "chrome" }).browserChannel).toBe("chrome");
  });
});

describe("loadConfig — ESM+ review discovery (model-C)", () => {
  it("esmReviewUrl is undefined by default and reads ESM_REVIEW_URL", () => {
    expect(loadConfig({}).esmReviewUrl).toBeUndefined();
    expect(loadConfig({ ESM_REVIEW_URL: "https://www.esmplus.com/Home/v2/manage-feedback" }).esmReviewUrl).toBe(
      "https://www.esmplus.com/Home/v2/manage-feedback",
    );
  });

  it("esmProfileDir defaults under .profile/esm, SEPARATE from the NAVER profile", () => {
    const cfg = loadConfig({});
    expect(cfg.esmProfileDir.endsWith("/.profile/esm")).toBe(true);
    expect(cfg.profileDir.endsWith("/.profile/naver")).toBe(true);
    expect(cfg.esmProfileDir).not.toBe(cfg.profileDir);
  });

  it("reads COLLECTOR_ESM_PROFILE_DIR override", () => {
    const cfg = loadConfig({ COLLECTOR_ESM_PROFILE_DIR: "/some/where/.profile/esm-test" });
    expect(cfg.esmProfileDir).toBe("/some/where/.profile/esm-test");
  });

  it("the default ESM profile dir cannot escape the collector tree (path guard)", () => {
    // The default lives inside the collector tree, so the shared guard accepts it...
    expect(() => resolveProfileDir(loadConfig({}).esmProfileDir)).not.toThrow();
    // ...but an escaping ESM profile dir is rejected, exactly like the NAVER one.
    expect(() => resolveProfileDir("/tmp/evil-esm-profile")).toThrow(/inside the collector/);
  });
});
