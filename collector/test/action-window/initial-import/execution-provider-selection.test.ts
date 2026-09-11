/**
 * Provider selection is explicit, defaults to LOCAL_HELPER, and never downgrades silently.
 */
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/config";
import {
  EXECUTION_PROVIDER_ENV,
  assertExecutionProviderBootable,
  parseExecutionProvider,
} from "../../../src/action-window/initial-import/execution-provider-selection";

describe("execution provider selection", () => {
  it("absent / blank → LOCAL_HELPER (the production default is untouched)", () => {
    expect(parseExecutionProvider(undefined)).toBe("LOCAL_HELPER");
    expect(parseExecutionProvider("  ")).toBe("LOCAL_HELPER");
    expect(loadConfig({}).executionProvider).toBe("LOCAL_HELPER");
  });
  it("an explicit ASIDE is honoured by the config", () => {
    expect(loadConfig({ [EXECUTION_PROVIDER_ENV]: "ASIDE" }).executionProvider).toBe("ASIDE");
  });
  it("an unknown value is a configuration error, not a default", () => {
    expect(() => parseExecutionProvider("aside")).toThrow(/unknown execution provider/);
    expect(() => loadConfig({ [EXECUTION_PROVIDER_ENV]: "PLAYWRIGHT" })).toThrow(/unknown execution provider/);
  });
  it("ASIDE with no bound workflow refuses to boot — it does not fall back to LOCAL_HELPER", () => {
    expect(() => assertExecutionProviderBootable("ASIDE", [])).toThrow(/Refusing to start rather than falling back/);
    expect(() => assertExecutionProviderBootable("LOCAL_HELPER", [])).not.toThrow();
    expect(() => assertExecutionProviderBootable("ASIDE", ["naver-review-export"])).not.toThrow();
  });
  it("Aside CLI settings: a command path and an optional account, never a credential", () => {
    expect(loadConfig({}).asideCli).toBe("aside");
    expect(loadConfig({}).asideAccount).toBeUndefined();
    expect(loadConfig({ ASIDE_CLI: "/opt/aside/bin/aside", ASIDE_ACCOUNT: "u1" })).toMatchObject({ asideCli: "/opt/aside/bin/aside", asideAccount: "u1" });
  });
});
