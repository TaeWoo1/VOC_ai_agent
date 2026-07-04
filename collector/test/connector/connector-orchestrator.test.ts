/**
 * Pure offline tests for the multi-channel Connector Orchestrator.
 *
 * Focus (per the architecture slice's scope):
 *  - the common `ChannelConnector` contract driven uniformly via a single `ensureReady()` per connector,
 *  - the four common outcomes (READY / NEEDS_USER_ACTION / FAILED / SKIPPED) across API + browser,
 *  - sync-intent GENERATION gated on outcome READY AND implementation AVAILABLE — NOT on CapabilityStatus,
 *  - MIXED API/browser boots settling independently and in order,
 *  - per-connection FAILURE ISOLATION (a throwing connector → FAILED, never aborts the others),
 *  - discovery-required + not-implemented channels handled honestly (skipped / no sync intent),
 *  - no execution (a source-guard proves no export/upload/status path),
 *  - clean, idempotent, isolated shutdown.
 *
 * Everything uses fakes — no browser, no http, no fs beyond reading module source for the purity guard.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { ConnectorOrchestrator, type ConnectorStartupResult } from "../../src/connector/connector-orchestrator";
import {
  createConnectorHandle,
  descriptorFor,
  discoveryRequiredChannels,
  type ConnectorHandle,
} from "../../src/connector/channel-registry";
import { authStatusFromLocalAgentState } from "../../src/connector/browser-connector";
import { ApiChannelConnector, type ApiConnectorPort } from "../../src/connector/api-connector";
import { connectorActionFromUserAction, type ConnectorUserAction, type ImplementationStatus } from "../../src/connector/channel-connector";
import type { ProgressiveServiceLike, ProgressiveSnapshot } from "../../src/agent/local-agent-startup";
import {
  dedicatedProfileIdFor,
  initialFormStrategyForMode,
  type ProgressiveReconnectConnection,
  type UserActionCategory,
} from "../../src/agent/progressive-reconnect";
import type { AuthStatus, CapabilityStatus } from "../../src/connection/sync-state";

// ── Fakes ────────────────────────────────────────────────────────────────────────────────────────

function browserConnection(connectionId: string, opts?: { autoReconnectConsent?: boolean }): ProgressiveReconnectConnection {
  const account = { connectionId, boundStoreFingerprintHash: null, fingerprintSourceCategory: null };
  return {
    account,
    loginMode: "ESM_PLUS",
    dedicatedProfileId: dedicatedProfileIdFor(account),
    initialFormStrategy: initialFormStrategyForMode("ESM_PLUS"),
    autoReconnectCapability: "UNKNOWN",
    autoReconnectConsent: opts?.autoReconnectConsent ?? true,
    autoSubmitConsent: true,
    assistedReconnectConsent: true,
  };
}

/** A scripted `ProgressiveServiceLike` — models the real service (no snapshot until `start`). */
class FakeProgressiveService implements ProgressiveServiceLike {
  readonly startCalls = new Map<string, number>();
  readonly stopCalls = new Map<string, number>();
  private readonly snapshots = new Map<string, ProgressiveSnapshot>();
  private readonly actions = new Map<string, UserActionCategory[]>();
  private readonly throwOnStart = new Set<string>();
  private readonly throwOnStop = new Set<string>();
  private readonly started = new Set<string>();

  script(id: string, snapshot: ProgressiveSnapshot, actions: UserActionCategory[] = []): void {
    this.snapshots.set(id, snapshot);
    this.actions.set(id, [...actions]);
  }
  failStart(id: string): void {
    this.throwOnStart.add(id);
  }
  failStop(id: string): void {
    this.throwOnStop.add(id);
  }

  async start(connection: ProgressiveReconnectConnection): Promise<ProgressiveSnapshot> {
    const id = connection.account.connectionId;
    this.startCalls.set(id, (this.startCalls.get(id) ?? 0) + 1);
    if (this.throwOnStart.has(id)) throw new Error(`start failed for ${id}`);
    this.started.add(id);
    const snap = this.snapshots.get(id);
    if (!snap) throw new Error(`no snapshot scripted for ${id}`);
    return snap;
  }
  async sessionLost(): Promise<ProgressiveSnapshot | null> {
    return null;
  }
  async humanCompleted(): Promise<ProgressiveSnapshot | null> {
    return null;
  }
  async stop(id: string): Promise<void> {
    this.stopCalls.set(id, (this.stopCalls.get(id) ?? 0) + 1);
    if (this.throwOnStop.has(id)) throw new Error(`teardown failed for ${id}`);
  }
  drainUserActionRequests(id: string): UserActionCategory[] {
    const q = this.actions.get(id) ?? [];
    this.actions.set(id, []);
    return q;
  }
  getSnapshot(id: string): ProgressiveSnapshot | null {
    return this.started.has(id) ? this.snapshots.get(id) ?? null : null;
  }
}

class FakeApiPort implements ApiConnectorPort {
  inspectCalls = 0;
  refreshCalls = 0;
  constructor(
    private readonly insp: { authStatus: AuthStatus },
    private readonly ref?: { recovered: boolean; authStatus: AuthStatus; userAction: ConnectorUserAction | null },
    private readonly throwInspect = false,
  ) {}
  async inspect(): Promise<{ authStatus: AuthStatus }> {
    this.inspectCalls += 1;
    if (this.throwInspect) throw new Error("api inspect failed");
    return this.insp;
  }
  async refresh(): Promise<{ recovered: boolean; authStatus: AuthStatus; userAction: ConnectorUserAction | null }> {
    this.refreshCalls += 1;
    return this.ref ?? { recovered: false, authStatus: "UNKNOWN", userAction: null };
  }
}

function browserHandle(service: ProgressiveServiceLike, connectionId: string, opts?: { autoReconnectConsent?: boolean }): ConnectorHandle {
  // ESM is AVAILABLE + BROWSER in the registry.
  return createConnectorHandle("ESM", connectionId, { browser: { service, connection: browserConnection(connectionId, opts) } });
}
function apiHandle(
  port: ApiConnectorPort,
  connectionId: string,
  capability: CapabilityStatus = "NEEDS_VERIFICATION",
  implementationStatus: ImplementationStatus = "AVAILABLE",
): ConnectorHandle {
  // Constructed directly to control the declared capability + implementation axis independently of the
  // registry (which has no AVAILABLE API channel yet — Cafe24 is NOT_IMPLEMENTED).
  return { status: "READY_TO_START", implementationStatus, connector: new ApiChannelConnector("CAFE24", connectionId, "API", capability, port) };
}

function resultById(results: readonly ConnectorStartupResult[], id: string): ConnectorStartupResult {
  const r = results.find((x) => x.connectionId === id);
  if (!r) throw new Error(`no result for ${id}`);
  return r;
}

// ── ensureReady flow: browser strategy ───────────────────────────────────────────────────────

describe("browser connector ensureReady", () => {
  it("an already-valid session settles READY and eligible for sync", async () => {
    const svc = new FakeProgressiveService();
    svc.script("b-ok", { localAgentState: "READY", reconnectPath: "EXISTING_SESSION", pendingUserAction: null, pendingCatchUp: false });
    const [r] = await new ConnectorOrchestrator().boot([browserHandle(svc, "b-ok")]);
    expect(r!.outcome).toBe("READY");
    expect(r!.strategy).toBe("BROWSER");
    expect(r!.implementationStatus).toBe("AVAILABLE");
    expect(r!.authStatus).toBe("CONNECTED");
    expect(r!.reconnectPath).toBe("EXISTING_SESSION");
    expect(r!.syncIntent).toMatchObject({ mechanism: "BROWSER_EXPORT", capabilityStatus: "NEEDS_VERIFICATION" });
    expect(svc.startCalls.get("b-ok")).toBe(1); // ensureReady ran exactly once
  });

  it("a zero-touch auto-recovered session also settles READY with its rung recorded", async () => {
    const svc = new FakeProgressiveService();
    svc.script("b-auto", { localAgentState: "READY", reconnectPath: "ZERO_TOUCH_AUTOFILL", pendingUserAction: null, pendingCatchUp: false });
    const [r] = await new ConnectorOrchestrator().boot([browserHandle(svc, "b-auto")]);
    expect(r!.outcome).toBe("READY");
    expect(r!.reconnectPath).toBe("ZERO_TOUCH_AUTOFILL");
    expect(r!.syncIntent).not.toBeNull();
  });

  it("a session needing credential selection surfaces NEEDS_USER_ACTION and no sync intent", async () => {
    const svc = new FakeProgressiveService();
    svc.script(
      "b-user",
      { localAgentState: "WAITING_FOR_CREDENTIAL_SELECTION", reconnectPath: "ASSISTED_CREDENTIAL_SELECTION", pendingUserAction: "SELECT_SAVED_CREDENTIAL", pendingCatchUp: false },
      ["SELECT_SAVED_CREDENTIAL"],
    );
    const [r] = await new ConnectorOrchestrator().boot([browserHandle(svc, "b-user")]);
    expect(r!.outcome).toBe("NEEDS_USER_ACTION");
    expect(r!.pendingUserAction).toBe("SELECT_SAVED_CREDENTIAL");
    expect(r!.authStatus).toBe("RECONNECT_REQUIRED");
    expect(r!.syncIntent).toBeNull();
  });

  it("an unrecoverable session settles FAILED", async () => {
    const svc = new FakeProgressiveService();
    svc.script("b-dead", { localAgentState: "DEGRADED", reconnectPath: null, pendingUserAction: null, pendingCatchUp: false });
    const [r] = await new ConnectorOrchestrator().boot([browserHandle(svc, "b-dead")]);
    expect(r!.outcome).toBe("FAILED");
    expect(r!.syncIntent).toBeNull();
  });

  it("without auto-reconnect consent, ensureReady returns SKIPPED and never starts the browser", async () => {
    const svc = new FakeProgressiveService();
    svc.script("b-noconsent", { localAgentState: "READY", reconnectPath: "EXISTING_SESSION", pendingUserAction: null, pendingCatchUp: false });
    const [r] = await new ConnectorOrchestrator().boot([browserHandle(svc, "b-noconsent", { autoReconnectConsent: false })]);
    expect(r!.outcome).toBe("SKIPPED");
    expect(r!.pendingUserAction).toBe("COMPLETE_MANUAL_LOGIN");
    expect(svc.startCalls.get("b-noconsent")).toBeUndefined(); // never launched
  });
});

// ── ensureReady flow: API strategy ───────────────────────────────────────────────────────────

describe("api connector ensureReady", () => {
  it("a healthy credential settles READY WITHOUT a refresh", async () => {
    const port = new FakeApiPort({ authStatus: "CONNECTED" });
    const [r] = await new ConnectorOrchestrator().boot([apiHandle(port, "a-ok", "CONFIRMED")]);
    expect(r!.outcome).toBe("READY");
    expect(r!.strategy).toBe("API");
    expect(r!.reconnectPath).toBeNull();
    expect(port.inspectCalls).toBe(1);
    expect(port.refreshCalls).toBe(0); // healthy inspection → refresh never attempted
    expect(r!.syncIntent).toMatchObject({ mechanism: "API_FETCH", capabilityStatus: "CONFIRMED" });
  });

  it("an expired credential recovered by one refresh settles READY", async () => {
    const port = new FakeApiPort({ authStatus: "EXPIRED" }, { recovered: true, authStatus: "CONNECTED", userAction: null });
    const [r] = await new ConnectorOrchestrator().boot([apiHandle(port, "a-refresh", "CONFIRMED")]);
    expect(r!.outcome).toBe("READY");
    expect(port.refreshCalls).toBe(1);
    expect(r!.syncIntent).not.toBeNull();
  });

  it("a credential needing re-entry surfaces NEEDS_USER_ACTION / PROVIDE_API_CREDENTIAL", async () => {
    const port = new FakeApiPort({ authStatus: "RECONNECT_REQUIRED" }, { recovered: false, authStatus: "RECONNECT_REQUIRED", userAction: "PROVIDE_API_CREDENTIAL" });
    const [r] = await new ConnectorOrchestrator().boot([apiHandle(port, "a-user", "CONFIRMED")]);
    expect(r!.outcome).toBe("NEEDS_USER_ACTION");
    expect(r!.pendingUserAction).toBe("PROVIDE_API_CREDENTIAL");
    expect(r!.syncIntent).toBeNull();
  });

  it("an unusable (permanent) auth state settles FAILED without a refresh", async () => {
    const port = new FakeApiPort({ authStatus: "AUTH_CHALLENGE" });
    const [r] = await new ConnectorOrchestrator().boot([apiHandle(port, "a-dead", "CONFIRMED")]);
    expect(r!.outcome).toBe("FAILED");
    expect(port.refreshCalls).toBe(0); // not a recoverable state
    expect(r!.syncIntent).toBeNull();
  });
});

// ── The two axes: implementation gate vs capability posture ──────────────────────────────────

describe("sync-intent gate is the implementation axis, not CapabilityStatus", () => {
  it("READY + AVAILABLE + a discovery-posture capability STILL generates an intent (capability is informational)", async () => {
    const port = new FakeApiPort({ authStatus: "CONNECTED" });
    const [r] = await new ConnectorOrchestrator().boot([apiHandle(port, "cap-info", "NEEDS_DISCOVERY", "AVAILABLE")]);
    expect(r!.outcome).toBe("READY");
    expect(r!.syncIntent).not.toBeNull(); // NOT gated by CapabilityStatus
    expect(r!.syncIntent).toMatchObject({ capabilityStatus: "NEEDS_DISCOVERY" }); // carried as information only
  });

  it("READY but NOT_IMPLEMENTED generates NO intent even with a confirmed capability", async () => {
    const port = new FakeApiPort({ authStatus: "CONNECTED" });
    const [r] = await new ConnectorOrchestrator().boot([apiHandle(port, "not-impl", "CONFIRMED", "NOT_IMPLEMENTED")]);
    expect(r!.outcome).toBe("READY");
    expect(r!.implementationStatus).toBe("NOT_IMPLEMENTED");
    expect(r!.syncIntent).toBeNull(); // gated by the implementation axis
  });
});

// ── Mixed boots + isolation ──────────────────────────────────────────────────────────────────

describe("mixed API/browser orchestration", () => {
  it("boots browser + API + browser independently, preserving order", async () => {
    const svc = new FakeProgressiveService();
    svc.script("m-b1", { localAgentState: "READY", reconnectPath: "EXISTING_SESSION", pendingUserAction: null, pendingCatchUp: false });
    svc.script("m-b2", { localAgentState: "HUMAN_RECONNECT_REQUIRED", reconnectPath: "MANUAL_LOGIN", pendingUserAction: null, pendingCatchUp: false });
    const port = new FakeApiPort({ authStatus: "CONNECTED" });

    const orch = new ConnectorOrchestrator();
    const results = await orch.boot([
      browserHandle(svc, "m-b1"),
      apiHandle(port, "m-api", "CONFIRMED"),
      browserHandle(svc, "m-b2"),
    ]);

    expect(results.map((r) => r.connectionId)).toEqual(["m-b1", "m-api", "m-b2"]);
    expect(results.map((r) => r.strategy)).toEqual(["BROWSER", "API", "BROWSER"]);
    expect(results.map((r) => r.outcome)).toEqual(["READY", "READY", "NEEDS_USER_ACTION"]);
    // b2 reached HUMAN_RECONNECT_REQUIRED with no explicit action → the manual-login fallback.
    expect(resultById(results, "m-b2").pendingUserAction).toBe("COMPLETE_MANUAL_LOGIN");
    // Only the two READY+AVAILABLE connections generate a sync intent.
    expect(results.map((r) => r.syncIntent !== null)).toEqual([true, true, false]);
    expect(orch.managedConnectionIds()).toEqual(["m-b1", "m-api", "m-b2"]);
  });

  it("mixes an available browser, a not-implemented API, and a discovery-required channel", async () => {
    const svc = new FakeProgressiveService();
    svc.script("x-b", { localAgentState: "READY", reconnectPath: "EXISTING_SESSION", pendingUserAction: null, pendingCatchUp: false });
    const port = new FakeApiPort({ authStatus: "CONNECTED" });

    const results = await new ConnectorOrchestrator().boot([
      browserHandle(svc, "x-b"),
      apiHandle(port, "x-notimpl", "CONFIRMED", "NOT_IMPLEMENTED"),
      createConnectorHandle("SSG", "x-disc", {}),
    ]);

    expect(results.map((r) => r.outcome)).toEqual(["READY", "READY", "SKIPPED"]);
    expect(results.map((r) => r.implementationStatus)).toEqual(["AVAILABLE", "NOT_IMPLEMENTED", "DISCOVERY_REQUIRED"]);
    expect(results.map((r) => r.syncIntent !== null)).toEqual([true, false, false]);
  });

  it("a throwing connector is isolated (FAILED) and never aborts the others", async () => {
    const svc = new FakeProgressiveService();
    svc.script("i-b1", { localAgentState: "READY", reconnectPath: "EXISTING_SESSION", pendingUserAction: null, pendingCatchUp: false });
    svc.script("i-b2", { localAgentState: "READY", reconnectPath: "ZERO_TOUCH_AUTOFILL", pendingUserAction: null, pendingCatchUp: false });
    svc.failStart("i-b1"); // first connection blows up inside ensureReady()

    const orch = new ConnectorOrchestrator();
    const results = await orch.boot([browserHandle(svc, "i-b1"), browserHandle(svc, "i-b2")]);

    expect(resultById(results, "i-b1").outcome).toBe("FAILED");
    expect(resultById(results, "i-b1").syncIntent).toBeNull();
    expect(resultById(results, "i-b2").outcome).toBe("READY"); // the next one still boots
    // Both are still held so shutdown can release anything partially opened.
    expect(orch.managedConnectionIds()).toEqual(["i-b1", "i-b2"]);
  });

  it("an API connector whose inspect throws is isolated too", async () => {
    const svc = new FakeProgressiveService();
    svc.script("y-b", { localAgentState: "READY", reconnectPath: "EXISTING_SESSION", pendingUserAction: null, pendingCatchUp: false });
    const badPort = new FakeApiPort({ authStatus: "CONNECTED" }, undefined, true);

    const results = await new ConnectorOrchestrator().boot([apiHandle(badPort, "y-api", "CONFIRMED"), browserHandle(svc, "y-b")]);
    expect(resultById(results, "y-api").outcome).toBe("FAILED");
    expect(resultById(results, "y-b").outcome).toBe("READY");
  });

  it("double boot throws", async () => {
    const orch = new ConnectorOrchestrator();
    await orch.boot([]);
    await expect(orch.boot([])).rejects.toThrow(/already booted/);
  });
});

// ── Registry: strategy, implementation axis, discovery-required ───────────────────────────────

describe("channel registry", () => {
  it("a discovery-required handle is a no-connector SKIP, not a fake", async () => {
    const handle = createConnectorHandle("COUPANG", "c-coupang", {});
    expect(handle.status).toBe("SKIPPED");
    const orch = new ConnectorOrchestrator();
    const [r] = await orch.boot([handle]);
    expect(r!.outcome).toBe("SKIPPED");
    expect(r!.strategy).toBeNull();
    expect(r!.implementationStatus).toBe("DISCOVERY_REQUIRED");
    expect(r!.syncIntent).toBeNull();
    expect(orch.managedConnectionIds()).toEqual([]); // never held
  });

  it("declares exactly the four not-yet-discovered channels as DISCOVERY_REQUIRED", () => {
    expect(discoveryRequiredChannels().sort()).toEqual(["COUPANG", "ELEVENST", "SSG", "TODAYHOUSE"].sort());
    for (const channel of ["COUPANG", "ELEVENST", "SSG", "TODAYHOUSE"] as const) {
      const d = descriptorFor(channel)!;
      expect(d.strategy).toBeNull();
      expect(d.implementationStatus).toBe("DISCOVERY_REQUIRED");
      expect(d.connectorType).toBe("NONE");
    }
  });

  it("declares NAVER/ESM as AVAILABLE browser and Cafe24 as NOT_IMPLEMENTED API", () => {
    expect(descriptorFor("NAVER")).toMatchObject({ strategy: "BROWSER", connectorType: "BROWSER_EXPORT", implementationStatus: "AVAILABLE" });
    expect(descriptorFor("ESM")).toMatchObject({ strategy: "BROWSER", connectorType: "BROWSER_EXPORT", implementationStatus: "AVAILABLE" });
    expect(descriptorFor("CAFE24")).toMatchObject({ strategy: "API", connectorType: "API", implementationStatus: "NOT_IMPLEMENTED" });
  });

  it("Cafe24 (NOT_IMPLEMENTED) without deps is a SKIP, while an AVAILABLE channel without deps is a config error", () => {
    const cafe24 = createConnectorHandle("CAFE24", "c1", {});
    expect(cafe24).toMatchObject({ status: "SKIPPED", implementationStatus: "NOT_IMPLEMENTED" });
    expect(() => createConnectorHandle("NAVER", "n1", {})).toThrow(/requires browser deps/);
  });

  it("Cafe24 WITH a port builds a runnable connector that still yields no sync intent", async () => {
    const port = new FakeApiPort({ authStatus: "CONNECTED" });
    const handle = createConnectorHandle("CAFE24", "c-live", { api: { port } });
    expect(handle.status).toBe("READY_TO_START");
    const [r] = await new ConnectorOrchestrator().boot([handle]);
    expect(r!.outcome).toBe("READY");
    expect(r!.implementationStatus).toBe("NOT_IMPLEMENTED");
    expect(r!.syncIntent).toBeNull();
  });
});

// ── Shutdown ─────────────────────────────────────────────────────────────────────────────────

describe("shutdown", () => {
  it("stops each started connector exactly once and is idempotent", async () => {
    const svc = new FakeProgressiveService();
    svc.script("s-b", { localAgentState: "READY", reconnectPath: "EXISTING_SESSION", pendingUserAction: null, pendingCatchUp: false });
    const orch = new ConnectorOrchestrator();
    await orch.boot([browserHandle(svc, "s-b")]);

    const report1 = await orch.shutdown();
    expect(report1.stoppedConnectionIds).toEqual(["s-b"]);
    expect(svc.stopCalls.get("s-b")).toBe(1);
    const report2 = await orch.shutdown();
    expect(report2.stoppedConnectionIds).toEqual([]); // idempotent — no second teardown
    expect(svc.stopCalls.get("s-b")).toBe(1);
  });

  it("one connector's failed teardown is surfaced and never blocks the rest", async () => {
    const svc = new FakeProgressiveService();
    svc.script("t-bad", { localAgentState: "READY", reconnectPath: "EXISTING_SESSION", pendingUserAction: null, pendingCatchUp: false });
    svc.script("t-ok", { localAgentState: "READY", reconnectPath: "EXISTING_SESSION", pendingUserAction: null, pendingCatchUp: false });
    svc.failStop("t-bad"); // this connection's teardown throws

    const orch = new ConnectorOrchestrator();
    await orch.boot([browserHandle(svc, "t-bad"), browserHandle(svc, "t-ok")]);

    const report = await orch.shutdown();
    expect(report.failedTeardownConnectionIds).toEqual(["t-bad"]);
    expect(report.stoppedConnectionIds).toEqual(["t-ok"]); // the healthy one still tore down
  });
});

// ── Pure helpers ──────────────────────────────────────────────────────────────────────────────

describe("pure mapping helpers", () => {
  it("maps every LocalAgentState onto an AuthStatus", () => {
    expect(authStatusFromLocalAgentState("READY")).toBe("CONNECTED");
    expect(authStatusFromLocalAgentState("SYNCING")).toBe("CONNECTED");
    expect(authStatusFromLocalAgentState("HUMAN_RECONNECT_REQUIRED")).toBe("RECONNECT_REQUIRED");
    expect(authStatusFromLocalAgentState("WAITING_FOR_CREDENTIAL_SELECTION")).toBe("RECONNECT_REQUIRED");
    expect(authStatusFromLocalAgentState("STOPPED")).toBe("UNKNOWN");
  });

  it("bridges browser user actions 1:1 to connector user actions", () => {
    expect(connectorActionFromUserAction("SELECT_SAVED_CREDENTIAL")).toBe("SELECT_SAVED_CREDENTIAL");
    expect(connectorActionFromUserAction("COMPLETE_ADDITIONAL_AUTHENTICATION")).toBe("COMPLETE_ADDITIONAL_AUTHENTICATION");
  });
});

// ── Purity / no-execution source guard ─────────────────────────────────────────────────────────

describe("connector layer is pure and never executes a sync", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const connectorDir = resolve(here, "..", "..", "src", "connector");
  const modules = ["channel-connector.ts", "browser-connector.ts", "api-connector.ts", "channel-registry.ts", "connector-orchestrator.ts"];

  /** Strip line + block comments so prose mentioning a forbidden token can't trip the guard. */
  function codeOnly(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  for (const mod of modules) {
    it(`${mod} imports no fs/http/browser and reaches no execution path`, () => {
      const code = codeOnly(readFileSync(resolve(connectorDir, mod), "utf8"));
      // No runtime I/O imports (type-only agent imports are erased and allowed).
      for (const forbidden of ["node:fs", "node:http", "node:https", "playwright", "../upload", "../status"]) {
        expect(code.includes(`from "${forbidden}"`)).toBe(false);
      }
      // No sync/export/upload/status-write execution tokens.
      for (const token of ["saveAs", "/api/uploads", "waitForEvent(", ".click(", "writeStatus", "runExport"]) {
        expect(code.includes(token)).toBe(false);
      }
    });
  }
});
