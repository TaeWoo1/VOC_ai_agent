/**
 * Pure offline tests for the Cloud API connector composition root — the API-track peer of the browser-track
 * Local Agent root.
 *
 * Focus (per the two-track re-alignment):
 *  - RUNTIME OWNERSHIP BOUNDARY: the Cloud owns API connectors only. It runs Cafe24 when its production port
 *    is injected, and SKIPs any non-API (browser / discovery-required) descriptor honestly — never a throw,
 *    never a browser launch (the Cloud constructs no browser service at all),
 *  - Cafe24 is AVAILABLE + sync-intent-eligible ONLY when its port is injected; without a port →
 *    NOT_IMPLEMENTED / SKIPPED,
 *  - the full outcome set through the shared ConnectorOrchestrator: valid authorization, refresh success,
 *    refresh failure requiring re-authorization, transient failure — each via ONE ensureReady(),
 *  - sync intents surfaced (API_FETCH) but never executed; per-connection isolation + clean shutdown,
 *  - a source guard proving the Cloud seam references no browser / progressive service and no Local Agent.
 *
 * Everything uses sanitized seam fakes — no server, scheduler, db, network, fs, or tokens.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import {
  CloudApiConnectorStartup,
  buildCloudApiConnectorHandles,
  createCloudApiConnectorStartup,
  type CloudApiConnectionDescriptor,
} from "../../src/connector/cloud-api-connector-startup";
import {
  Cafe24ApiConnectorPort,
  type Cafe24AuthorizationState,
  type Cafe24AuthorizationStore,
  type Cafe24OAuthClient,
  type Cafe24RefreshOutcome,
} from "../../src/connector/cafe24-api-port";
import type { ConnectorStartupResult, ConnectorOrchestratorObserver } from "../../src/connector/connector-orchestrator";

// ── Sanitized seam fakes (coarse enums only — never a token / id) ──────────────────────────────────

function fakeStore(state: Cafe24AuthorizationState): Cafe24AuthorizationStore {
  return { readAuthorizationState: async () => state };
}
function fakeOAuth(outcome: Cafe24RefreshOutcome): Cafe24OAuthClient {
  return { refreshAuthorization: async () => outcome };
}
function cafe24Port(state: Cafe24AuthorizationState, outcome: Cafe24RefreshOutcome = "TRANSIENT_FAILURE"): Cafe24ApiConnectorPort {
  return new Cafe24ApiConnectorPort(fakeStore(state), fakeOAuth(outcome));
}

function resultById(results: readonly ConnectorStartupResult[], id: string): ConnectorStartupResult {
  const r = results.find((x) => x.connectionId === id);
  if (!r) throw new Error(`no result for ${id}`);
  return r;
}

const cafe24 = (connectionId: string): CloudApiConnectionDescriptor => ({ connectionId, channel: "CAFE24" });

// ── Handle building: ownership boundary ────────────────────────────────────────────────────────────

describe("buildCloudApiConnectorHandles (Cloud owns API only)", () => {
  it("runs Cafe24 with its injected port and SKIPs non-API channels, in order — never throwing on a browser descriptor", () => {
    const connections: CloudApiConnectionDescriptor[] = [
      cafe24("a-cafe24"),
      { connectionId: "b-esm", channel: "ESM" }, // a browser channel handed to the Cloud → SKIPPED, not a throw
      { connectionId: "d-coupang", channel: "COUPANG" },
    ];
    const handles = buildCloudApiConnectorHandles(connections, { cafe24Port: cafe24Port("VALID", "REFRESHED") });
    expect(handles.map((h) => h.status)).toEqual(["READY_TO_START", "SKIPPED", "SKIPPED"]);
    // The browser channel is skipped honestly (the Cloud does not own it) — carrying its real status.
    expect(handles[1]).toMatchObject({ status: "SKIPPED", implementationStatus: "AVAILABLE" });
    expect(handles[2]).toMatchObject({ status: "SKIPPED", implementationStatus: "DISCOVERY_REQUIRED" });
  });

  it("without a Cafe24 port, a Cafe24 descriptor stays NOT_IMPLEMENTED / SKIPPED (no fake connector)", () => {
    const [handle] = buildCloudApiConnectorHandles([cafe24("a")], {});
    expect(handle).toMatchObject({ status: "SKIPPED", implementationStatus: "NOT_IMPLEMENTED" });
  });
});

// ── Booting the Cloud API root ─────────────────────────────────────────────────────────────────────

describe("CloudApiConnectorStartup.boot", () => {
  it("valid authorization → READY + AVAILABLE + an API_FETCH sync intent (surfaced, not executed)", async () => {
    const startup = createCloudApiConnectorStartup({ cafe24Port: cafe24Port("VALID") });
    const [r] = await startup.boot([cafe24("cafe24-1")]);
    expect(r!.outcome).toBe("READY");
    expect(r!.strategy).toBe("API");
    expect(r!.implementationStatus).toBe("AVAILABLE"); // promoted because the production port was injected
    expect(r!.reconnectPath).toBeNull(); // API has no browser rung
    expect(r!.syncIntent).toMatchObject({ mechanism: "API_FETCH" });
    expect(startup.managedConnectionIds()).toEqual(["cafe24-1"]);
  });

  it("refresh success → READY + a sync intent", async () => {
    const [r] = await new CloudApiConnectorStartup({ cafe24Port: cafe24Port("ACCESS_EXPIRED", "REFRESHED") }).boot([cafe24("c")]);
    expect(r!.outcome).toBe("READY");
    expect(r!.syncIntent).not.toBeNull();
  });

  it("refresh failure requiring user action → NEEDS_USER_ACTION (REAUTHORIZE_API_ACCESS), no sync intent", async () => {
    const [r] = await new CloudApiConnectorStartup({ cafe24Port: cafe24Port("ACCESS_EXPIRED", "REAUTHORIZATION_REQUIRED") }).boot([cafe24("c")]);
    expect(r!.outcome).toBe("NEEDS_USER_ACTION");
    expect(r!.pendingUserAction).toBe("REAUTHORIZE_API_ACCESS");
    expect(r!.syncIntent).toBeNull();
  });

  it("a transient refresh failure → FAILED, no user action, no sync intent", async () => {
    const [r] = await new CloudApiConnectorStartup({ cafe24Port: cafe24Port("ACCESS_EXPIRED", "TRANSIENT_FAILURE") }).boot([cafe24("c")]);
    expect(r!.outcome).toBe("FAILED");
    expect(r!.pendingUserAction).toBeNull();
    expect(r!.syncIntent).toBeNull();
  });

  it("without a port, a Cafe24 boot settles SKIPPED / NOT_IMPLEMENTED and holds nothing", async () => {
    const startup = new CloudApiConnectorStartup({});
    const [r] = await startup.boot([cafe24("cafe24-noport")]);
    expect(r!.outcome).toBe("SKIPPED");
    expect(r!.implementationStatus).toBe("NOT_IMPLEMENTED");
    expect(r!.syncIntent).toBeNull();
    expect(startup.managedConnectionIds()).toEqual([]); // never held
  });

  it("a browser descriptor handed to the Cloud is SKIPPED (not owned) and never held — no browser launch", async () => {
    const startup = new CloudApiConnectorStartup({ cafe24Port: cafe24Port("VALID") });
    const [r] = await startup.boot([{ connectionId: "esm-x", channel: "ESM" }]);
    expect(r!.outcome).toBe("SKIPPED");
    expect(r!.strategy).toBeNull();
    expect(startup.managedConnectionIds()).toEqual([]);
  });

  it("isolates a mixed API set: each Cafe24 connection settles independently and in order", async () => {
    const startup = new CloudApiConnectorStartup({ cafe24Port: cafe24Port("VALID") });
    // Two Cafe24 connections + a non-owned browser one — all share the one injected port for the API ones.
    const results = await startup.boot([cafe24("cafe24-a"), { connectionId: "esm-b", channel: "ESM" }, cafe24("cafe24-c")]);
    expect(results.map((r) => r.connectionId)).toEqual(["cafe24-a", "esm-b", "cafe24-c"]);
    expect(results.map((r) => r.outcome)).toEqual(["READY", "SKIPPED", "READY"]);
    expect(resultById(results, "cafe24-a").syncIntent).toMatchObject({ mechanism: "API_FETCH" });
    expect(resultById(results, "cafe24-c").syncIntent).toMatchObject({ mechanism: "API_FETCH" });
    expect(startup.managedConnectionIds()).toEqual(["cafe24-a", "cafe24-c"]); // only the runnable API ones held
  });

  it("shuts down every started connector exactly once and is idempotent", async () => {
    const startup = new CloudApiConnectorStartup({ cafe24Port: cafe24Port("VALID") });
    await startup.boot([cafe24("cafe24-1")]);
    const report1 = await startup.shutdown();
    expect(report1.stoppedConnectionIds).toEqual(["cafe24-1"]);
    const report2 = await startup.shutdown();
    expect(report2.stoppedConnectionIds).toEqual([]); // idempotent
  });

  it("reports each settled connection to an observer (sanitized fields only)", async () => {
    const seen: ConnectorStartupResult[] = [];
    const observer: ConnectorOrchestratorObserver = { onConnectionSettled: (r) => seen.push(r) };
    await new CloudApiConnectorStartup({ cafe24Port: cafe24Port("VALID") }, observer).boot([cafe24("cafe24-1")]);
    expect(seen.map((r) => r.outcome)).toEqual(["READY"]);
    expect(seen[0]!.channel).toBe("CAFE24");
  });
});

// ── Ownership source guard: the Cloud seam is API-only, offline, and touches no browser track ─────────

describe("Cloud API seam references no browser track and no live runtime", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "..", "..", "src", "connector", "cloud-api-connector-startup.ts"), "utf8");
  /** Strip comments so prose that names the browser track can't trip the guard. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("imports no browser / progressive service, no Local Agent, and no fs / http", () => {
    for (const forbidden of [
      "../agent/local-agent-progressive-service",
      "../agent/local-agent-connector-startup",
      "../agent/local-agent-startup",
      "./browser-connector",
      "node:fs",
      "node:http",
      "node:https",
      "playwright",
    ]) {
      expect(code.includes(`from "${forbidden}"`)).toBe(false);
    }
  });

  it("constructs no server / scheduler / db and reaches no fetch/upload path", () => {
    for (const token of ["fetch(", "/api/", "createServer", "setInterval", "setTimeout", "waitForEvent(", ".click(", "runExport", "writeStatus"]) {
      expect(code.includes(token)).toBe(false);
    }
  });
});
