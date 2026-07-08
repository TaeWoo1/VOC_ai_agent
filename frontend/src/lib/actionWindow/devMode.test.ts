import { describe, it, expect } from "vitest";
import { isFixturePreviewEnabled } from "./devMode";

describe("fixture preview mode (dev-only)", () => {
  it("is gated on the Vite DEV flag, not shown in production", () => {
    expect(typeof isFixturePreviewEnabled()).toBe("boolean");
    // Derived solely from import.meta.env.DEV. The production build sets DEV=false,
    // so the scenario selector is tree-shaken out of the production UI.
    expect(isFixturePreviewEnabled()).toBe(import.meta.env.DEV === true);
  });
});
