/**
 * Wiring guard for the pilot runtime inside `cli/local-agent.ts`. The pure pieces (lock, owned-process
 * registry, self-check, consent gate, diagnostics) are unit-tested in `test/runtime/`; this pins the
 * INTEGRATION invariants that only exist where they are composed into the boot — the ones that, if silently
 * dropped, would reintroduce exactly the failures this PR exists to prevent:
 *
 *  - both shutdown paths terminate ONLY owned processes and release the single-instance lock;
 *  - nothing in the boot kills a process by name/pattern (no pgrep, no `taskkill /IM`);
 *  - the production import path is admitted by `decideImportBoot` (consent), not a raw dev flag;
 *  - the Windows approval presenter is wired so pilot pairing no longer fails closed.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  AGENT_VERSION,
  EXPORT_DIAGNOSTICS_FLAG,
  decideApprovalPresenter,
  resolveAgentBridgeConfig,
} from "../../src/cli/local-agent";

const here = dirname(fileURLToPath(import.meta.url));
const cli = readFileSync(resolve(here, "../../src/cli/local-agent.ts"), "utf8");

describe("pilot runtime wiring — exports", () => {
  it("exposes the agent version and the diagnostics flag", () => {
    expect(AGENT_VERSION.length).toBeGreaterThan(0);
    expect(EXPORT_DIAGNOSTICS_FLAG).toBe("--export-diagnostics");
  });

  it("wires the Windows approval presenter for production (pilot pairing stops failing closed)", () => {
    expect(decideApprovalPresenter({ NODE_ENV: "production" } as NodeJS.ProcessEnv, "win32")).toBe("windows_native");
  });
});

describe("pilot runtime wiring — termination discipline", () => {
  it("only ever terminates owned processes (registry), never a name/pattern", () => {
    // The one place the boot terminates processes is the owned-process registry.
    expect(cli).toContain('terminateAll("force")');
    // No name/pattern-based kill anywhere in the boot — this is the mistake the PR forbids.
    expect(cli).not.toMatch(/pgrep/);
    expect(cli).not.toMatch(/taskkill\s+\/IM/i);
    expect(cli).not.toMatch(/killall/);
  });

  it("both shutdown paths release the single-instance lock", () => {
    // Import boot and connector boot each release the lock (via the handle or the exit net).
    const releases = cli.match(/releaseLock\(\)/g) ?? [];
    expect(releases.length).toBeGreaterThanOrEqual(2);
  });

  it("records the launched browser pids as owned (via CDP) and deregisters them on clean close", () => {
    expect(cli).toContain("registerBrowserProcess(");
    expect(cli).toContain("SystemInfo.getProcessInfo");
    expect(cli).toContain("ownedProcesses?.deregister(");
  });

  it("acquires the pilot runtime only in pilot mode, refusing a duplicate", () => {
    expect(cli).toContain("if (isPilotMode(process.env))");
    expect(cli).toContain("acquirePilotRuntime(");
    expect(cli).toContain('event: "ALREADY_RUNNING"');
  });
});

describe("pilot runtime wiring — production import via consent, not a dev flag", () => {
  it("admits the import carrier through decideImportBoot (consent), threading the pilot handle", () => {
    expect(cli).toContain("const importBoot = decideImportBoot(");
    expect(cli).toContain("readImportConsent(");
    expect(cli).toContain("await runImportOnlyBoot(args, process.env, pilot);");
  });

  it("runs the self-check before launching, logging sanitized issues only", () => {
    expect(cli).toContain("runtimeSelfCheckFor(");
    expect(cli).toContain('log("aw_runtime_self_check"');
    // The recovery is a KEY, never prose — resolved to Korean copy by the log/FE.
    expect(cli).toContain("RUNTIME_SELF_CHECK_RECOVERY[issue]");
  });
});

describe("production bridge origins fail closed (no dev-origin fallback under production)", () => {
  it("production with no BRIDGE_ALLOWED_ORIGINS → empty allow-list (bridge refuses every origin)", () => {
    expect(resolveAgentBridgeConfig([], { NODE_ENV: "production" } as NodeJS.ProcessEnv).allowedOrigins).toEqual([]);
  });

  it("dev falls back to the dev origins (unchanged)", () => {
    expect(resolveAgentBridgeConfig([], {} as NodeJS.ProcessEnv).allowedOrigins.length).toBeGreaterThan(0);
  });

  it("an explicit allow-list is honored in production", () => {
    expect(
      resolveAgentBridgeConfig([], {
        NODE_ENV: "production",
        BRIDGE_ALLOWED_ORIGINS: "https://app.example.com",
      } as NodeJS.ProcessEnv).allowedOrigins,
    ).toEqual(["https://app.example.com"]);
  });
});
