/**
 * Pure offline tests for the multi-channel Local Agent CONNECTOR startup root.
 *
 * Focus (per the wiring slice's scope):
 *  - loading MIXED sanitized descriptors (browser NAVER/ESM, API Cafe24, discovery-required) resiliently,
 *  - creating connector handles through the registry (browser wired to the shared service; API/discovery
 *    → SKIPPED, never a fake connector, never a live call — Cafe24 is NOT implemented),
 *  - booting each connection independently through the ConnectorOrchestrator via ONE ensureReady() each,
 *  - surfacing READY / NEEDS_USER_ACTION / FAILED / SKIPPED outcomes,
 *  - surfacing sync intents WITHOUT executing them,
 *  - clean shutdown + per-connection failure isolation.
 *
 * Everything uses a fake ProgressiveServiceLike — no browser, no http, no fs, no backend.
 */

import { describe, it, expect } from "vitest";

import {
  parseConnectorConnections,
  buildConnectorHandles,
  LocalAgentConnectorStartup,
  type ValidatedConnectorConnection,
} from "../../src/agent/local-agent-connector-startup";
import type { ProgressiveServiceLike, ProgressiveSnapshot } from "../../src/agent/local-agent-startup";
import type { ProgressiveReconnectConnection, UserActionCategory } from "../../src/agent/progressive-reconnect";
import type { ConnectorStartupResult, ConnectorOrchestratorObserver } from "../../src/connector/connector-orchestrator";

// ── Fakes ────────────────────────────────────────────────────────────────────────────────────────

/** A scripted `ProgressiveServiceLike` — models the real browser-auth service (no snapshot until start). */
class FakeProgressiveService implements ProgressiveServiceLike {
  readonly startCalls = new Map<string, number>();
  readonly stopCalls = new Map<string, number>();
  private readonly snapshots = new Map<string, ProgressiveSnapshot>();
  private readonly actions = new Map<string, UserActionCategory[]>();
  private readonly throwOnStart = new Set<string>();
  private readonly started = new Set<string>();

  script(id: string, snapshot: ProgressiveSnapshot, actions: UserActionCategory[] = []): void {
    this.snapshots.set(id, snapshot);
    this.actions.set(id, [...actions]);
  }
  failStart(id: string): void {
    this.throwOnStart.add(id);
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

/** A browser descriptor JSON object (NAVER/ESM). */
function browserDescriptor(connectionId: string, channel: "NAVER" | "ESM", opts?: { autoReconnectConsent?: boolean }): Record<string, unknown> {
  return {
    connectionId,
    channel,
    loginMode: "ESM_PLUS",
    autoReconnectConsent: opts?.autoReconnectConsent ?? true,
    autoSubmitConsent: true,
    assistedReconnectConsent: true,
  };
}

function parseOrThrow(raw: string): ValidatedConnectorConnection[] {
  const result = parseConnectorConnections(raw);
  if (!result.ok) throw new Error(`parse failed: ${result.errorCategory}`);
  return result.value.connections;
}

function resultById(results: readonly ConnectorStartupResult[], id: string): ConnectorStartupResult {
  const r = results.find((x) => x.connectionId === id);
  if (!r) throw new Error(`no result for ${id}`);
  return r;
}

const READY_SNAPSHOT: ProgressiveSnapshot = { localAgentState: "READY", reconnectPath: "EXISTING_SESSION", pendingUserAction: null, pendingCatchUp: false };

// ── Parsing mixed descriptors ──────────────────────────────────────────────────────────────────

describe("parseConnectorConnections (mixed descriptors)", () => {
  it("parses a mixed browser + API + discovery-required config, reading strategy from the registry", () => {
    const raw = JSON.stringify([
      browserDescriptor("b-esm", "ESM"),
      { connectionId: "a-cafe24", channel: "CAFE24" },
      { connectionId: "d-coupang", channel: "COUPANG" },
    ]);
    const parsed = parseConnectorConnections(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.connections.map((c) => c.channel)).toEqual(["ESM", "CAFE24", "COUPANG"]);
    expect(parsed.value.connections.map((c) => c.strategy)).toEqual(["BROWSER", "API", null]);
    // Only the browser channel builds a progressive-reconnect connection for its auth subcomponent.
    expect(parsed.value.connections.map((c) => c.browserConnection !== null)).toEqual([true, false, false]);
    expect(parsed.value.connections[0]!.browserConnection!.account.connectionId).toBe("b-esm");
  });

  it("rejects a browser descriptor missing its login mode / consents, but keeps the rest", () => {
    const raw = JSON.stringify([
      { connectionId: "bad-browser", channel: "NAVER" }, // BROWSER channel with no auth fields → malformed
      browserDescriptor("ok-browser", "NAVER"),
    ]);
    const parsed = parseConnectorConnections(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.rejectedEntryIndexes).toEqual([0]);
    expect(parsed.value.connections.map((c) => c.connectionId)).toEqual(["ok-browser"]);
  });

  it("an API descriptor needs no browser-auth fields to be valid", () => {
    const [c] = parseOrThrow(JSON.stringify([{ connectionId: "a1", channel: "CAFE24" }]));
    expect(c).toMatchObject({ channel: "CAFE24", strategy: "API", browserConnection: null });
  });

  it("rejects an unknown channel", () => {
    const parsed = parseConnectorConnections(JSON.stringify([{ connectionId: "x", channel: "MYSTERY" }]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.rejectedEntryIndexes).toEqual([0]);
    expect(parsed.value.connections).toEqual([]);
  });

  it("surfaces a duplicate connection id (first kept, later dropped)", () => {
    const raw = JSON.stringify([browserDescriptor("dup", "ESM"), { connectionId: "dup", channel: "CAFE24" }]);
    const parsed = parseConnectorConnections(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.duplicateConnectionIds).toEqual(["dup"]);
    expect(parsed.value.connections.map((c) => c.channel)).toEqual(["ESM"]); // the first entry won
  });

  it("fails closed with a sanitized category on structurally unusable input", () => {
    expect(parseConnectorConnections("{not json").ok).toBe(false);
    expect(parseConnectorConnections("{not json")).toMatchObject({ ok: false, errorCategory: "invalid-json" });
    expect(parseConnectorConnections(JSON.stringify({}))).toMatchObject({ ok: false, errorCategory: "not-an-array" });
    expect(parseConnectorConnections(JSON.stringify([]))).toMatchObject({ ok: false, errorCategory: "empty" });
  });
});

// ── Handle building through the registry ───────────────────────────────────────────────────────

describe("buildConnectorHandles", () => {
  it("wires a browser connection to the shared service and SKIPs API + discovery-required, in order", () => {
    const svc = new FakeProgressiveService();
    let serviceBuilds = 0;
    const connections = parseOrThrow(
      JSON.stringify([browserDescriptor("b", "ESM"), { connectionId: "a", channel: "CAFE24" }, { connectionId: "d", channel: "SSG" }]),
    );
    const handles = buildConnectorHandles(connections, { browserService: () => (serviceBuilds++, svc) });
    expect(handles.map((h) => h.status)).toEqual(["READY_TO_START", "SKIPPED", "SKIPPED"]);
    // Cafe24 is NOT implemented → an honest SKIP, not a fake connector.
    expect(handles[1]).toMatchObject({ status: "SKIPPED", implementationStatus: "NOT_IMPLEMENTED" });
    expect(handles[2]).toMatchObject({ status: "SKIPPED", implementationStatus: "DISCOVERY_REQUIRED" });
    expect(serviceBuilds).toBe(1); // realized once, for the single runnable browser connection
  });

  it("does NOT construct the browser service when no runnable browser connection exists (API + discovery only)", () => {
    let serviceBuilds = 0;
    const connections = parseOrThrow(
      JSON.stringify([{ connectionId: "a", channel: "CAFE24" }, { connectionId: "d", channel: "COUPANG" }]),
    );
    const handles = buildConnectorHandles(connections, {
      browserService: () => {
        serviceBuilds++;
        throw new Error("browser service must never be constructed here");
      },
    });
    expect(handles.map((h) => h.status)).toEqual(["SKIPPED", "SKIPPED"]);
    expect(serviceBuilds).toBe(0); // the lazy provider is never invoked — no browser service built
  });
});

// ── Booting the composition root ───────────────────────────────────────────────────────────────

describe("LocalAgentConnectorStartup.boot (mixed)", () => {
  it("boots browser (READY) + Cafe24 (SKIPPED) + discovery (SKIPPED), surfacing intents only where eligible", async () => {
    const svc = new FakeProgressiveService();
    svc.script("b-esm", READY_SNAPSHOT);
    const connections = parseOrThrow(
      JSON.stringify([browserDescriptor("b-esm", "ESM"), { connectionId: "a-cafe24", channel: "CAFE24" }, { connectionId: "d-coupang", channel: "COUPANG" }]),
    );

    const startup = new LocalAgentConnectorStartup(() => svc);
    const results = await startup.boot(connections);

    expect(results.map((r) => r.connectionId)).toEqual(["b-esm", "a-cafe24", "d-coupang"]);
    expect(results.map((r) => r.outcome)).toEqual(["READY", "SKIPPED", "SKIPPED"]);
    expect(results.map((r) => r.strategy)).toEqual(["BROWSER", null, null]);
    expect(results.map((r) => r.implementationStatus)).toEqual(["AVAILABLE", "NOT_IMPLEMENTED", "DISCOVERY_REQUIRED"]);
    // A sync intent is GENERATED only for the READY + AVAILABLE browser connection — never executed.
    expect(results.map((r) => r.syncIntent !== null)).toEqual([true, false, false]);
    expect(resultById(results, "b-esm").syncIntent).toMatchObject({ mechanism: "BROWSER_EXPORT" });
    // Only the browser connection ran ensureReady exactly once; Cafe24/discovery never touched the service.
    expect(svc.startCalls.get("b-esm")).toBe(1);
    // Only the started browser connection is held for shutdown; skipped handles are never held.
    expect(startup.managedConnectionIds()).toEqual(["b-esm"]);
  });

  it("surfaces NEEDS_USER_ACTION from the browser subcomponent with no sync intent", async () => {
    const svc = new FakeProgressiveService();
    svc.script(
      "b-user",
      { localAgentState: "WAITING_FOR_CREDENTIAL_SELECTION", reconnectPath: "ASSISTED_CREDENTIAL_SELECTION", pendingUserAction: "SELECT_SAVED_CREDENTIAL", pendingCatchUp: false },
      ["SELECT_SAVED_CREDENTIAL"],
    );
    const [r] = await new LocalAgentConnectorStartup(() => svc).boot(parseOrThrow(JSON.stringify([browserDescriptor("b-user", "ESM")])));
    expect(r!.outcome).toBe("NEEDS_USER_ACTION");
    expect(r!.pendingUserAction).toBe("SELECT_SAVED_CREDENTIAL");
    expect(r!.syncIntent).toBeNull();
  });

  it("SKIPs a browser connection whose auto-reconnect consent was withheld, without launching", async () => {
    const svc = new FakeProgressiveService();
    const [r] = await new LocalAgentConnectorStartup(() => svc).boot(
      parseOrThrow(JSON.stringify([browserDescriptor("b-noconsent", "NAVER", { autoReconnectConsent: false })])),
    );
    expect(r!.outcome).toBe("SKIPPED");
    expect(r!.pendingUserAction).toBe("COMPLETE_MANUAL_LOGIN");
    expect(svc.startCalls.get("b-noconsent")).toBeUndefined(); // never launched
  });

  it("isolates a throwing browser connection (FAILED) — the others still boot", async () => {
    const svc = new FakeProgressiveService();
    svc.script("b1", READY_SNAPSHOT);
    svc.script("b2", READY_SNAPSHOT);
    svc.failStart("b1");

    const startup = new LocalAgentConnectorStartup(() => svc);
    const results = await startup.boot(
      parseOrThrow(JSON.stringify([browserDescriptor("b1", "ESM"), browserDescriptor("b2", "NAVER")])),
    );
    expect(resultById(results, "b1").outcome).toBe("FAILED");
    expect(resultById(results, "b1").syncIntent).toBeNull();
    expect(resultById(results, "b2").outcome).toBe("READY");
    // Both held so shutdown releases anything partially opened.
    expect(startup.managedConnectionIds()).toEqual(["b1", "b2"]);
  });

  it("shuts down every started connection exactly once and is idempotent", async () => {
    const svc = new FakeProgressiveService();
    svc.script("b-esm", READY_SNAPSHOT);
    const startup = new LocalAgentConnectorStartup(() => svc);
    await startup.boot(
      parseOrThrow(JSON.stringify([browserDescriptor("b-esm", "ESM"), { connectionId: "a-cafe24", channel: "CAFE24" }])),
    );

    const report1 = await startup.shutdown();
    expect(report1.stoppedConnectionIds).toEqual(["b-esm"]); // only the browser connection was ever started
    expect(svc.stopCalls.get("b-esm")).toBe(1);
    const report2 = await startup.shutdown();
    expect(report2.stoppedConnectionIds).toEqual([]); // idempotent
    expect(svc.stopCalls.get("b-esm")).toBe(1);
  });

  it("reports each settled connection to an observer (sanitized fields only)", async () => {
    const svc = new FakeProgressiveService();
    svc.script("b-esm", READY_SNAPSHOT);
    const seen: ConnectorStartupResult[] = [];
    const observer: ConnectorOrchestratorObserver = { onConnectionSettled: (r) => seen.push(r) };
    await new LocalAgentConnectorStartup(() => svc, observer).boot(parseOrThrow(JSON.stringify([browserDescriptor("b-esm", "ESM")])));
    expect(seen.map((r) => r.outcome)).toEqual(["READY"]);
    expect(seen[0]!.channel).toBe("ESM");
  });

  it("booting an API-only + discovery-only set never realizes the browser service, and holds nothing", async () => {
    let serviceBuilds = 0;
    const startup = new LocalAgentConnectorStartup(() => {
      serviceBuilds++;
      throw new Error("browser service must never be constructed for an API-only / discovery-only boot");
    });
    const results = await startup.boot(
      parseOrThrow(JSON.stringify([{ connectionId: "a-cafe24", channel: "CAFE24" }, { connectionId: "d-ssg", channel: "SSG" }])),
    );
    expect(results.map((r) => r.outcome)).toEqual(["SKIPPED", "SKIPPED"]);
    expect(results.map((r) => r.syncIntent !== null)).toEqual([false, false]);
    expect(serviceBuilds).toBe(0); // no runnable browser connection → no browser service constructed
    expect(startup.managedConnectionIds()).toEqual([]); // nothing held for shutdown
  });
});
