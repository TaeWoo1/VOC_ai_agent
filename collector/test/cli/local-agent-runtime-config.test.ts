import { describe, it, expect } from "vitest";
import { resolveBrowserRuntimeConfig, decideRun, shouldExitAfterBoot, LOCAL_AGENT_APPROVAL_FLAG } from "../../src/cli/local-agent";

const ESM_CONN = JSON.stringify([
  { connectionId: "c", channel: "ESM", loginMode: "ESM_PLUS", autoReconnectConsent: true, autoSubmitConsent: false, assistedReconnectConsent: true },
]);
const AUTH = "https://signin.example/login";
const PROBE = "https://seller.example/manage-feedback";
const FULL_ENV = { ESM_AUTH_SURFACE_URL: AUTH, ESM_SESSION_PROBE_URL: PROBE, STORAGE_PROBE_SALT: "salt" } as NodeJS.ProcessEnv;

describe("local-agent browser runtime config — auth surface vs session probe", () => {
  it("passes the auth URL and the session-probe URL separately (distinct roles)", () => {
    const r = resolveBrowserRuntimeConfig(FULL_ENV);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.authSurfaceUrl).toBe(AUTH);
      expect(r.config.sessionProbeUrl).toBe(PROBE);
      expect(r.config.sessionProbeUrl).not.toBe(r.config.authSurfaceUrl); // never a silent fallback
    }
  });

  it("missing ESM_SESSION_PROBE_URL fails closed (does NOT fall back to the auth URL)", () => {
    const r = resolveBrowserRuntimeConfig({ ESM_AUTH_SURFACE_URL: AUTH, STORAGE_PROBE_SALT: "s" } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("ESM_SESSION_PROBE_URL");
  });

  it("missing probe URL blocks a runnable ESM browser boot → DRY_RUN (no live browser)", () => {
    const d = decideRun([LOCAL_AGENT_APPROVAL_FLAG], ESM_CONN, { ESM_AUTH_SURFACE_URL: AUTH, STORAGE_PROBE_SALT: "s" } as NodeJS.ProcessEnv);
    expect(d.mode).toBe("DRY_RUN");
    if (d.mode === "DRY_RUN") expect(d.missingConfig).toContain("ESM_SESSION_PROBE_URL");
  });

  it("full config + approval → LIVE_BOOT carrying a distinct probe URL", () => {
    const d = decideRun([LOCAL_AGENT_APPROVAL_FLAG], ESM_CONN, FULL_ENV);
    expect(d.mode).toBe("LIVE_BOOT");
    if (d.mode === "LIVE_BOOT") {
      expect(d.config.browser?.sessionProbeUrl).toBe(PROBE);
      expect(d.config.browser?.sessionProbeUrl).not.toBe(d.config.browser?.authSurfaceUrl);
    }
  });
});

/**
 * The boot's exit rule. It used to ask about CONNECTIONS while the thing that must stay alive is the BRIDGE
 * CARRIER — so a Coupang guided walk (COUPANG is DISCOVERY_REQUIRED ⇒ SKIPPED ⇒ nothing managed) shut itself
 * down one line after announcing `coupangIssuance: true`, and the frontend found nothing on loopback.
 */
describe("shouldExitAfterBoot", () => {
  it("stays resident whenever a carrier is hosted, even with nothing runnable", () => {
    expect(shouldExitAfterBoot({ managedConnectionCount: 0, hostsBridgeCarrier: true })).toBe(false);
  });

  it("exits when nothing is runnable and no client will ever attach", () => {
    expect(shouldExitAfterBoot({ managedConnectionCount: 0, hostsBridgeCarrier: false })).toBe(true);
  });

  it("stays resident for a runnable connection, carrier or not", () => {
    expect(shouldExitAfterBoot({ managedConnectionCount: 1, hostsBridgeCarrier: false })).toBe(false);
    expect(shouldExitAfterBoot({ managedConnectionCount: 1, hostsBridgeCarrier: true })).toBe(false);
  });
});
