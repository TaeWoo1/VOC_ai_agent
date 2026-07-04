/**
 * Pure offline tests for the production Cafe24 API connector port — the first real `ApiConnectorPort`.
 *
 * Focus:
 *  - `inspect()` maps stored authorization state → AuthStatus; `refresh()` maps the official refresh
 *    outcome → the connector recovery result (READY / NEEDS_USER_ACTION / FAILED),
 *  - end-to-end through `ApiChannelConnector` + the orchestrator: valid authorization, refresh success,
 *    refresh failure requiring re-authorization, and a transient failure,
 *  - a Cafe24 connection is AVAILABLE + sync-intent-eligible ONLY when the port is supplied; missing port
 *    → NOT_IMPLEMENTED / SKIPPED,
 *  - the port fetches NO review/order/inquiry data and uploads nothing — auth only,
 *  - the module leaks no token / refresh_token / client_secret / mall_id / callback payload, and imports no
 *    fs / http / browser (a source guard).
 *
 * Everything uses sanitized seam fakes — no network, no fs, no tokens.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import {
  Cafe24ApiConnectorPort,
  type Cafe24AuthorizationState,
  type Cafe24AuthorizationStore,
  type Cafe24OAuthClient,
  type Cafe24RefreshOutcome,
} from "../../src/connector/cafe24-api-port";
import { ConnectorOrchestrator } from "../../src/connector/connector-orchestrator";
import { createConnectorHandle } from "../../src/connector/channel-registry";

// ── Sanitized seam spies (coarse enums only — never a token / id) ──────────────────────────────────

class SpyStore implements Cafe24AuthorizationStore {
  reads = 0;
  constructor(private readonly state: Cafe24AuthorizationState) {}
  async readAuthorizationState(): Promise<Cafe24AuthorizationState> {
    this.reads++;
    return this.state;
  }
}

class SpyOAuth implements Cafe24OAuthClient {
  refreshes = 0;
  constructor(private readonly outcome: Cafe24RefreshOutcome) {}
  async refreshAuthorization(): Promise<Cafe24RefreshOutcome> {
    this.refreshes++;
    return this.outcome;
  }
}

function port(state: Cafe24AuthorizationState, outcome: Cafe24RefreshOutcome = "TRANSIENT_FAILURE"): {
  port: Cafe24ApiConnectorPort;
  store: SpyStore;
  oauth: SpyOAuth;
} {
  const store = new SpyStore(state);
  const oauth = new SpyOAuth(outcome);
  return { port: new Cafe24ApiConnectorPort(store, oauth), store, oauth };
}

async function bootCafe24(state: Cafe24AuthorizationState, outcome?: Cafe24RefreshOutcome) {
  const p = port(state, outcome);
  const handle = createConnectorHandle("CAFE24", "cafe24-conn", { api: { port: p.port } });
  const [result] = await new ConnectorOrchestrator().boot([handle]);
  return { result: result!, ...p };
}

// ── inspect(): stored authorization state → AuthStatus ─────────────────────────────────────────────

describe("Cafe24ApiConnectorPort.inspect", () => {
  it("maps each stored authorization state to a channel-agnostic AuthStatus", async () => {
    expect(await new Cafe24ApiConnectorPort(new SpyStore("VALID"), new SpyOAuth("REFRESHED")).inspect()).toEqual({ authStatus: "CONNECTED" });
    expect(await new Cafe24ApiConnectorPort(new SpyStore("ACCESS_EXPIRED"), new SpyOAuth("REFRESHED")).inspect()).toEqual({ authStatus: "EXPIRED" });
    expect(await new Cafe24ApiConnectorPort(new SpyStore("REFRESH_EXPIRED"), new SpyOAuth("REFRESHED")).inspect()).toEqual({ authStatus: "RECONNECT_REQUIRED" });
    expect(await new Cafe24ApiConnectorPort(new SpyStore("NONE"), new SpyOAuth("REFRESHED")).inspect()).toEqual({ authStatus: "RECONNECT_REQUIRED" });
  });

  it("is non-mutating — inspect never triggers a refresh", async () => {
    const { store, oauth } = port("VALID");
    await new Cafe24ApiConnectorPort(store, oauth).inspect();
    expect(store.reads).toBe(1);
    expect(oauth.refreshes).toBe(0);
  });
});

// ── refresh(): official outcome → recovery result ──────────────────────────────────────────────────

describe("Cafe24ApiConnectorPort.refresh", () => {
  it("REFRESHED → recovered + CONNECTED, no user action", async () => {
    expect(await port("ACCESS_EXPIRED", "REFRESHED").port.refresh()).toEqual({ recovered: true, authStatus: "CONNECTED", userAction: null });
  });
  it("REAUTHORIZATION_REQUIRED → not recovered, surfaces REAUTHORIZE_API_ACCESS", async () => {
    expect(await port("ACCESS_EXPIRED", "REAUTHORIZATION_REQUIRED").port.refresh()).toEqual({
      recovered: false,
      authStatus: "RECONNECT_REQUIRED",
      userAction: "REAUTHORIZE_API_ACCESS",
    });
  });
  it("TRANSIENT_FAILURE → not recovered, no user action", async () => {
    expect(await port("ACCESS_EXPIRED", "TRANSIENT_FAILURE").port.refresh()).toEqual({ recovered: false, authStatus: "UNKNOWN", userAction: null });
  });
});

// ── End-to-end through ApiChannelConnector + the orchestrator ──────────────────────────────────────

describe("Cafe24 connector end-to-end", () => {
  it("valid authorization → READY + AVAILABLE + a sync intent, without a refresh", async () => {
    const { result, store, oauth } = await bootCafe24("VALID");
    expect(result.outcome).toBe("READY");
    expect(result.strategy).toBe("API");
    expect(result.implementationStatus).toBe("AVAILABLE"); // promoted because the production port exists
    expect(result.reconnectPath).toBeNull(); // API has no browser rung
    expect(result.syncIntent).toMatchObject({ mechanism: "API_FETCH", capabilityStatus: "NEEDS_DISCOVERY" });
    expect(store.reads).toBe(1);
    expect(oauth.refreshes).toBe(0); // healthy inspection → no refresh
  });

  it("refresh success → READY (one refresh) + a sync intent", async () => {
    const { result, store, oauth } = await bootCafe24("ACCESS_EXPIRED", "REFRESHED");
    expect(result.outcome).toBe("READY");
    expect(result.syncIntent).not.toBeNull();
    expect(store.reads).toBe(1);
    expect(oauth.refreshes).toBe(1);
  });

  it("refresh failure requiring user action → NEEDS_USER_ACTION (REAUTHORIZE_API_ACCESS), no sync intent", async () => {
    const { result, oauth } = await bootCafe24("ACCESS_EXPIRED", "REAUTHORIZATION_REQUIRED");
    expect(result.outcome).toBe("NEEDS_USER_ACTION");
    expect(result.pendingUserAction).toBe("REAUTHORIZE_API_ACCESS");
    expect(result.authStatus).toBe("RECONNECT_REQUIRED");
    expect(result.syncIntent).toBeNull();
    expect(oauth.refreshes).toBe(1);
  });

  it("a transient refresh failure → FAILED, no user action, no sync intent", async () => {
    const { result } = await bootCafe24("ACCESS_EXPIRED", "TRANSIENT_FAILURE");
    expect(result.outcome).toBe("FAILED");
    expect(result.pendingUserAction).toBeNull();
    expect(result.syncIntent).toBeNull();
  });

  it("a never-authorized (NONE) connection is guided to re-authorize", async () => {
    const { result } = await bootCafe24("NONE", "REAUTHORIZATION_REQUIRED");
    expect(result.outcome).toBe("NEEDS_USER_ACTION");
    expect(result.pendingUserAction).toBe("REAUTHORIZE_API_ACCESS");
  });
});

// ── Missing port → NOT_IMPLEMENTED / SKIPPED (no fake connector) ───────────────────────────────────

describe("Cafe24 without a production port", () => {
  it("settles SKIPPED / NOT_IMPLEMENTED and is never held", async () => {
    const handle = createConnectorHandle("CAFE24", "cafe24-noport", {});
    expect(handle).toMatchObject({ status: "SKIPPED", implementationStatus: "NOT_IMPLEMENTED" });
    const orch = new ConnectorOrchestrator();
    const [result] = await orch.boot([handle]);
    expect(result!.outcome).toBe("SKIPPED");
    expect(result!.strategy).toBeNull();
    expect(result!.implementationStatus).toBe("NOT_IMPLEMENTED");
    expect(result!.syncIntent).toBeNull();
    expect(orch.managedConnectionIds()).toEqual([]); // never held
  });
});

// ── Auth-only + no-leak source guard ───────────────────────────────────────────────────────────────

describe("Cafe24 port is auth-only, offline, and leaks no secret", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "..", "..", "src", "connector", "cafe24-api-port.ts"), "utf8");
  /** Strip comments so prose that names a forbidden token can't trip the guard. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("imports no fs / http / browser and reaches no fetch/upload path", () => {
    for (const forbidden of ["node:fs", "node:http", "node:https", "playwright", "../upload", "../status"]) {
      expect(code.includes(`from "${forbidden}"`)).toBe(false);
    }
    // No data fetch, upload, download-save, or backend-write execution tokens.
    for (const token of ["fetch(", "/api/", "saveAs", "waitForEvent(", ".click(", "runExport", "writeStatus"]) {
      expect(code.includes(token)).toBe(false);
    }
  });

  it("never names a raw token / secret / shop identifier in code", () => {
    for (const secret of ["access_token", "refresh_token", "client_secret", "authorization_code", "mall_id", "client_id"]) {
      expect(code.includes(secret)).toBe(false);
    }
  });
});
