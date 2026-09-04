import { describe, expect, it } from "vitest";
import { invokedDirectly } from "../../src/cli/invoked-directly";

describe("invokedDirectly — a bundled module is never the entry", () => {
  const url = "file:///repo/collector/src/cli/local-agent.ts";
  it("is true only for the file node was told to run AND the file that asks", () => {
    expect(invokedDirectly(url, "local-agent.ts", "/repo/collector/src/cli/local-agent.ts")).toBe(true);
    expect(invokedDirectly(url, "local-agent.ts", "/repo/collector/src/cli/other.ts")).toBe(false);
    expect(invokedDirectly(url, "local-agent.ts", undefined)).toBe(false);
  });
  it("inside a bundle every module shares the bundle's URL, and none of them matches its own name", () => {
    const bundle = "file:///Users/seller/Library/Application%20Support/reviewnary-helper/app/helper.mjs";
    const argv1 = "/Users/seller/Library/Application Support/reviewnary-helper/app/helper.mjs";
    for (const src of ["local-agent.ts", "observe-api-center.ts", "local-agent-service.ts", "bridge.ts"]) {
      expect(invokedDirectly(bundle, src, argv1)).toBe(false);
    }
  });
});
