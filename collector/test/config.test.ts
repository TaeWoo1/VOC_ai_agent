import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig — browserChannel", () => {
  it("is undefined by default (→ bundled Chromium)", () => {
    expect(loadConfig({}).browserChannel).toBeUndefined();
  });

  it("reads COLLECTOR_BROWSER_CHANNEL=chrome", () => {
    expect(loadConfig({ COLLECTOR_BROWSER_CHANNEL: "chrome" }).browserChannel).toBe("chrome");
  });
});
