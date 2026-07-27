/**
 * The gate whose failure mode is launching a live browser. Tested offline and exhaustively, because
 * "we checked by running it" is not an option for that.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTION_WINDOW_IMPORT_FLAG,
  IMPORT_LIVE_APPROVAL_FLAG,
  NON_INTERACTIVE_ENV_KEYS,
  OTHER_CARRIER_FLAGS,
  importModeRefusalMessage,
  resolveImportMode,
  type ImportModeRefusal,
} from "../../src/cli/import-mode-gate";

const BOTH = [ACTION_WINDOW_IMPORT_FLAG, IMPORT_LIVE_APPROVAL_FLAG];

describe("import mode gate — closed by default", () => {
  it("hosts nothing without the mode flag", () => {
    expect(resolveImportMode([], {})).toEqual({ host: false, reason: "NOT_REQUESTED" });
    expect(resolveImportMode([IMPORT_LIVE_APPROVAL_FLAG], {})).toEqual({ host: false, reason: "NOT_REQUESTED" });
  });

  /** One flag could be left in a shell history; two, one naming the consequence, cannot be accidental. */
  it("refuses the mode flag alone — the live approval is also required", () => {
    expect(resolveImportMode([ACTION_WINDOW_IMPORT_FLAG], {})).toEqual({
      host: false,
      reason: "APPROVAL_MISSING",
    });
  });

  it("hosts only when both flags are present", () => {
    expect(resolveImportMode(BOTH, {})).toEqual({ host: true });
  });

  it("refuses in production", () => {
    expect(resolveImportMode(BOTH, { NODE_ENV: "production" })).toEqual({
      host: false,
      reason: "PRODUCTION",
    });
  });

  /** A scheduled live browser would be exactly the standing authorization the per-run rule forbids. */
  it("refuses on every non-interactive marker", () => {
    for (const key of NON_INTERACTIVE_ENV_KEYS) {
      expect(resolveImportMode(BOTH, { [key]: "1" }), key).toEqual({
        host: false,
        reason: "NON_INTERACTIVE",
      });
      expect(resolveImportMode(BOTH, { [key]: "true" }), key).toEqual({
        host: false,
        reason: "NON_INTERACTIVE",
      });
    }
  });

  it("treats an explicitly falsy marker as absent, not as a refusal", () => {
    for (const key of NON_INTERACTIVE_ENV_KEYS) {
      expect(resolveImportMode(BOTH, { [key]: "0" }), key).toEqual({ host: true });
      expect(resolveImportMode(BOTH, { [key]: "false" }), key).toEqual({ host: true });
      expect(resolveImportMode(BOTH, { [key]: "" }), key).toEqual({ host: true });
    }
  });

  /** Silently picking a winner is how an operator ends up in a mode they did not intend. */
  it("refuses rather than resolving a carrier conflict by precedence", () => {
    for (const other of OTHER_CARRIER_FLAGS) {
      expect(resolveImportMode([...BOTH, other], {}), other).toEqual({
        host: false,
        reason: "CARRIER_CONFLICT",
      });
    }
  });

  /**
   * A conflicting command line reports the conflict even without the approval flag, so an operator is not
   * led one flag at a time toward a mode they cannot have.
   */
  it("reports the conflict before the missing approval", () => {
    expect(resolveImportMode([ACTION_WINDOW_IMPORT_FLAG, OTHER_CARRIER_FLAGS[0]!], {})).toEqual({
      host: false,
      reason: "CARRIER_CONFLICT",
    });
  });

  it("reports production before the missing approval", () => {
    expect(resolveImportMode([ACTION_WINDOW_IMPORT_FLAG], { NODE_ENV: "production" })).toEqual({
      host: false,
      reason: "PRODUCTION",
    });
  });

  it("is unaffected by unrelated arguments", () => {
    expect(resolveImportMode([...BOTH, "--port", "8765", "--verbose"], {})).toEqual({ host: true });
  });
});

describe("refusal messages", () => {
  it("says nothing for the ordinary case", () => {
    expect(importModeRefusalMessage("NOT_REQUESTED")).toBeNull();
  });

  it("explains every other refusal and names the flag involved", () => {
    const reasons: ImportModeRefusal[] = ["APPROVAL_MISSING", "PRODUCTION", "NON_INTERACTIVE", "CARRIER_CONFLICT"];
    for (const reason of reasons) {
      const message = importModeRefusalMessage(reason)!;
      expect(message, reason).toContain(ACTION_WINDOW_IMPORT_FLAG);
      expect(message.length, reason).toBeGreaterThan(40);
    }
  });

  it("tells the operator a per-run approval is still needed, not just a flag", () => {
    const message = importModeRefusalMessage("APPROVAL_MISSING")!;
    expect(message).toContain("per-run approval");
    expect(message).toContain("channel / account / date / operator");
  });
});

/**
 * The gate is only worth what its reachability is. These read `local-agent.ts` and assert that a browser
 * cannot be launched except through it — the property that actually matters, and the one a unit test of
 * `resolveImportMode` alone would not establish.
 */
describe("browser launch reachability", () => {
  const cli = readFileSync(join(__dirname, "../../src/cli/local-agent.ts"), "utf8");

  it("launches a browser only inside the gated builder", () => {
    // Two launches now: the boot's SellerOps context, and the account-scoped seller-center context opened at
    // run start. The property that matters is unchanged — EVERY launch is inside `buildInitialImportConfig`,
    // so none can be reached except through the gate.
    const calls = [...cli.matchAll(/launchNaverContext\(/g)].map((m) => m.index!);
    expect(calls.length).toBeGreaterThanOrEqual(1);

    const builderStart = cli.indexOf("export async function buildInitialImportConfig");
    const builderEnd = cli.indexOf("/**\n * Build the {@link AgentActionWindowConfig}");
    expect(builderStart).toBeGreaterThan(-1);
    expect(builderEnd).toBeGreaterThan(builderStart);
    for (const at of calls) {
      expect(at).toBeGreaterThan(builderStart);
      expect(at).toBeLessThan(builderEnd);
    }
  });

  it("invokes that builder only from the gated boot", () => {
    // The builder is called exactly once, and inside runImportOnlyBoot — which itself is only reached
    // when the gate says host.
    const calls = [...cli.matchAll(/await buildInitialImportConfig\(/g)].map((m) => m.index!);
    expect(calls).toHaveLength(1);
    const bootStart = cli.indexOf("async function runImportOnlyBoot");
    const bootEnd = cli.indexOf("async function main()");
    expect(calls[0]!).toBeGreaterThan(bootStart);
    expect(calls[0]!).toBeLessThan(bootEnd);
  });

  /**
   * The import mode has its OWN boot, decided before the connections gate.
   *
   * The first version of this wiring put the gate inside the live boot, which coupled a NAVER import to the
   * ESM connector lineage: it required a connections file, and the live boot launches one Chrome per
   * runnable connection — so satisfying it would have opened a browser nobody asked for. The gate running
   * first is the fix, and this pins it.
   */
  it("decides the import mode before the connections gate", () => {
    const gateAt = cli.indexOf("const importGate = resolveImportMode(args, process.env)");
    const connectionsAt = cli.indexOf('const connectionsPath = flagValue(args, "--connections")');
    expect(gateAt).toBeGreaterThan(-1);
    expect(connectionsAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(connectionsAt);
  });

  it("returns from its own boot rather than falling through to the connector path", () => {
    expect(cli).toContain("await runImportOnlyBoot(args, process.env);");
    const gateAt = cli.indexOf("if (importGate.host) {");
    const returnAt = cli.indexOf("return;", gateAt);
    expect(gateAt).toBeGreaterThan(-1);
    expect(returnAt).toBeGreaterThan(gateAt);
    expect(returnAt - gateAt).toBeLessThan(200);
  });

  /** The import boot must not start the connector lifecycle or a per-connection browser. */
  it("its boot hosts only the bridge and the one browser", () => {
    const start = cli.indexOf("async function runImportOnlyBoot");
    const end = cli.indexOf("async function main()");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const boot = cli.slice(start, end);
    for (const token of ["createLocalAgentConnectorStartup", "startup.boot(", "writeStatus"]) {
      expect(boot, token).not.toContain(token);
    }
  });

  it("uses the real live driver on the product path, never the fixture one", () => {
    expect(cli).toContain("NaverLiveImportDriver");
    expect(cli).not.toContain("ImportFixtureDriver");
  });
});

describe("gate purity", () => {
  it("reaches no browser, no filesystem, and no network", () => {
    const source = readFileSync(join(__dirname, "../../src/cli/import-mode-gate.ts"), "utf8");
    const code = source
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");
    for (const token of ["playwright", "chromium", "node:fs", "fetch(", "import ", "require("]) {
      expect(code, token).not.toContain(token);
    }
  });
});
