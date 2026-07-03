import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalAgentStartup,
  parseProgressiveConnections,
  type LocalAgentStartupResult,
  type ProgressiveSnapshot,
} from "../../src/agent/local-agent-startup";
import { decideRun, resolveStartupConfig, createSignalShutdown, LOCAL_AGENT_APPROVAL_FLAG } from "../../src/cli/local-agent";
import {
  LocalAgentProgressiveService,
  type ProgressiveReconnectRuntimeLike,
  type ProgressiveReconnectRuntimeFactory,
} from "../../src/agent/local-agent-progressive-service";
import {
  dedicatedProfileIdFor,
  initialFormStrategyForMode,
  initialProgressiveState,
  type ProgressiveReconnectConnection,
  type ProgressiveReconnectState,
  type UserActionCategory,
  type LoginMode,
} from "../../src/agent/progressive-reconnect";
import type { ProgressiveReconnectSink } from "../../src/agent/progressive-reconnect-runtime";
import type { SanitizedAccountRef } from "../../src/agent/local-agent-state";

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
function acct(connectionId: string): SanitizedAccountRef {
  return { connectionId, boundStoreFingerprintHash: null, fingerprintSourceCategory: null };
}
function conn(connectionId: string, loginMode: LoginMode = "GMARKET"): ProgressiveReconnectConnection {
  const account = acct(connectionId);
  return {
    account,
    loginMode,
    dedicatedProfileId: dedicatedProfileIdFor(account),
    initialFormStrategy: initialFormStrategyForMode(loginMode),
    autoReconnectCapability: "CONDITIONAL",
    autoReconnectConsent: true,
    autoSubmitConsent: true,
    assistedReconnectConsent: true,
  };
}
function stateWith(over: Partial<ProgressiveReconnectState>): ProgressiveReconnectState {
  return { ...initialProgressiveState, ...over };
}
const READY = stateWith({ phase: "READY", path: "EXISTING_SESSION" });
const WAITING = stateWith({
  phase: "WAITING_FOR_CREDENTIAL_SELECTION",
  path: "ASSISTED_CREDENTIAL_SELECTION",
  pendingUserAction: "SELECT_SAVED_CREDENTIAL",
});

/** Per-connection scripted runtime behavior. Each callback may emit sink intents + returns a state. */
interface Behavior {
  onStart?: (sink: ProgressiveReconnectSink, account: SanitizedAccountRef) => ProgressiveReconnectState;
  onSessionLost?: (sink: ProgressiveReconnectSink, account: SanitizedAccountRef) => ProgressiveReconnectState;
  onHumanCompleted?: (sink: ProgressiveReconnectSink, account: SanitizedAccountRef, action: UserActionCategory) => ProgressiveReconnectState;
  startThrows?: boolean;
  stopThrows?: boolean;
}

class FakeRuntime implements ProgressiveReconnectRuntimeLike {
  state: ProgressiveReconnectState = initialProgressiveState;
  startCalls = 0;
  sessionLostCalls = 0;
  humanCompletedCalls = 0;
  stopCalls = 0;
  closeCalls = 0;
  lastHumanAction: UserActionCategory | null = null;
  constructor(
    private readonly connection: ProgressiveReconnectConnection,
    private readonly sink: ProgressiveReconnectSink,
    private readonly behavior: Behavior,
  ) {}
  async start(): Promise<ProgressiveReconnectState> {
    this.startCalls++;
    if (this.behavior.startThrows) throw new Error("start failed");
    this.state = this.behavior.onStart?.(this.sink, this.connection.account) ?? READY;
    return this.state;
  }
  async sessionLost(): Promise<ProgressiveReconnectState> {
    this.sessionLostCalls++;
    this.state = this.behavior.onSessionLost?.(this.sink, this.connection.account) ?? this.state;
    return this.state;
  }
  async humanCompleted(action: UserActionCategory): Promise<ProgressiveReconnectState> {
    this.humanCompletedCalls++;
    this.lastHumanAction = action;
    this.state = this.behavior.onHumanCompleted?.(this.sink, this.connection.account, action) ?? this.state;
    return this.state;
  }
  async stop(): Promise<ProgressiveReconnectState> {
    this.stopCalls++;
    if (this.behavior.stopThrows) throw new Error("stop failed");
    this.state = stateWith({ phase: "STOPPED" });
    return this.state;
  }
  async close(): Promise<void> {
    this.closeCalls++;
  }
  getState(): ProgressiveReconnectState {
    return this.state;
  }
}

/** A harness building the REAL composition service over scripted fake runtimes (per connection). */
class Harness {
  readonly runtimes = new Map<string, FakeRuntime>();
  readonly behaviors = new Map<string, Behavior>();
  readonly factory: ProgressiveReconnectRuntimeFactory = {
    create: (connection, sink) => {
      const rt = new FakeRuntime(connection, sink, this.behaviors.get(connection.account.connectionId) ?? {});
      this.runtimes.set(connection.account.connectionId, rt);
      return rt;
    },
  };
  behave(connectionId: string, behavior: Behavior): void {
    this.behaviors.set(connectionId, behavior);
  }
  service(): LocalAgentProgressiveService {
    return new LocalAgentProgressiveService(this.factory);
  }
  runtime(connectionId: string): FakeRuntime {
    const rt = this.runtimes.get(connectionId);
    if (!rt) throw new Error(`no runtime for ${connectionId}`);
    return rt;
  }
}

function collector(): { observer: { onConnectionSettled(r: LocalAgentStartupResult): void }; settled: LocalAgentStartupResult[] } {
  const settled: LocalAgentStartupResult[] = [];
  return { observer: { onConnectionSettled: (r) => void settled.push(r) }, settled };
}

// ── boot / startup ─────────────────────────────────────────────────────────────────────────────────
describe("LocalAgentStartup.boot", () => {
  it("starts every configured connection once, in order, and reports the mapped state", async () => {
    const h = new Harness();
    const c = collector();
    const startup = new LocalAgentStartup(h.service(), c.observer);
    const results = await startup.boot([conn("A"), conn("B")]);

    expect(results.map((r) => r.connectionId)).toEqual(["A", "B"]);
    expect(results.every((r) => r.started && r.localAgentState === "READY")).toBe(true);
    expect(h.runtime("A").startCalls).toBe(1);
    expect(h.runtime("B").startCalls).toBe(1);
    expect(startup.managedConnectionIds()).toEqual(["A", "B"]);
    expect(c.settled.map((r) => r.connectionId)).toEqual(["A", "B"]);
  });

  it("a second boot throws (construct a fresh root to boot again)", async () => {
    const h = new Harness();
    const startup = new LocalAgentStartup(h.service());
    await startup.boot([conn("A")]);
    await expect(startup.boot([conn("A")])).rejects.toThrow(/already booted/);
  });
});

// ── user-action drain (one-shot) ─────────────────────────────────────────────────────────────────
describe("LocalAgentStartup user-action handling", () => {
  it("drains a surfaced user-action exactly once (a later drain is empty)", async () => {
    const h = new Harness();
    h.behave("A", { onStart: (sink, account) => (sink.emitUserAction(account, "SELECT_SAVED_CREDENTIAL"), WAITING) });
    const service = h.service();
    const startup = new LocalAgentStartup(service);
    const [result] = await startup.boot([conn("A")]);

    expect(result!.userActions).toEqual(["SELECT_SAVED_CREDENTIAL"]);
    expect(result!.pendingUserAction).toBe("SELECT_SAVED_CREDENTIAL");
    // The root already surfaced+drained the intent — a second drain on the service is empty.
    expect(service.drainUserActionRequests("A")).toEqual([]);
  });
});

// ── catch-up stays pending (execution out of scope) ──────────────────────────────────────────────
describe("LocalAgentStartup catch-up remains pending (never acknowledged)", () => {
  it("reports pendingCatchUp true and never acknowledges — the intent stays queued", async () => {
    const h = new Harness();
    h.behave("A", { onStart: (sink, account) => (sink.requestCatchUp(account), READY) });
    const service = h.service();
    const startup = new LocalAgentStartup(service);
    const [result] = await startup.boot([conn("A")]);

    expect(result!.pendingCatchUp).toBe(true);
    expect(result!.userActions).toEqual([]);
    // The root never called acknowledgeCatchUp, so exactly ONE catch-up is still queued: a manual
    // acknowledge now returns true once (proving it was retained, not consumed and not duplicated).
    expect(service.acknowledgeCatchUp("A")).toBe(true);
    expect(service.acknowledgeCatchUp("A")).toBe(false);
  });

  it("repeated snapshot reads never duplicate or consume the pending catch-up", async () => {
    const h = new Harness();
    h.behave("A", { onStart: (sink, account) => (sink.requestCatchUp(account), READY) });
    const service = h.service();
    const startup = new LocalAgentStartup(service);
    await startup.boot([conn("A")]);

    // Multiple pure reads stay true and never consume.
    expect(service.getSnapshot("A")?.pendingCatchUp).toBe(true);
    expect(service.getSnapshot("A")?.pendingCatchUp).toBe(true);
    expect(service.getSnapshot("A")?.pendingCatchUp).toBe(true);
    // Still exactly one queued after all those reads.
    expect(service.acknowledgeCatchUp("A")).toBe(true);
    expect(service.acknowledgeCatchUp("A")).toBe(false);
  });

  it("shutdown surfaces a still-pending catch-up instead of silently discarding it as completed", async () => {
    const h = new Harness();
    h.behave("A", { onStart: (sink, account) => (sink.requestCatchUp(account), READY) });
    h.behave("B", { onStart: () => READY });
    const startup = new LocalAgentStartup(h.service());
    await startup.boot([conn("A"), conn("B")]);

    const report = await startup.shutdown();
    expect(report.pendingCatchUpConnectionIds).toEqual(["A"]);
    expect(report.stoppedConnectionIds).toEqual(["A", "B"]);
  });
});

// ── connection isolation ─────────────────────────────────────────────────────────────────────────
describe("LocalAgentStartup connection isolation", () => {
  it("a connection whose start throws is isolated — the others still start", async () => {
    const h = new Harness();
    h.behave("A", { startThrows: true });
    const startup = new LocalAgentStartup(h.service());
    const results = await startup.boot([conn("A"), conn("B")]);

    const a = results.find((r) => r.connectionId === "A")!;
    const b = results.find((r) => r.connectionId === "B")!;
    expect(a.started).toBe(false);
    expect(a.localAgentState).toBeNull();
    expect(b.started).toBe(true);
    expect(b.localAgentState).toBe("READY");
    // A failed connection is still owned so its (partial) browser is torn down on shutdown.
    expect(startup.managedConnectionIds()).toEqual(["A", "B"]);
  });

  it("a malformed configured entry is skipped so the other connections still boot", async () => {
    const h = new Harness();
    // The parser drops the malformed middle entry (index 1) and keeps the two valid ones.
    const raw = JSON.stringify([
      { connectionId: "good-1", loginMode: "GMARKET", autoReconnectConsent: true, autoSubmitConsent: true, assistedReconnectConsent: true },
      { connectionId: "bad", loginMode: "FACEBOOK", autoReconnectConsent: true, autoSubmitConsent: true, assistedReconnectConsent: true },
      { connectionId: "good-2", loginMode: "ESM_PLUS", autoReconnectConsent: true, autoSubmitConsent: true, assistedReconnectConsent: true },
    ]);
    const parsed = parseProgressiveConnections(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.rejectedEntryIndexes).toEqual([1]);

    const startup = new LocalAgentStartup(h.service());
    const results = await startup.boot(parsed.value.connections);
    expect(results.map((r) => r.connectionId)).toEqual(["good-1", "good-2"]);
    expect(results.every((r) => r.started)).toBe(true);
  });

  it("draining one connection's intents never touches another's", async () => {
    const h = new Harness();
    h.behave("A", { onStart: (sink, account) => (sink.emitUserAction(account, "SELECT_SAVED_CREDENTIAL"), WAITING) });
    h.behave("B", { onStart: (sink, account) => (sink.requestCatchUp(account), READY) });
    const startup = new LocalAgentStartup(h.service());
    const results = await startup.boot([conn("A"), conn("B")]);

    const a = results.find((r) => r.connectionId === "A")!;
    const b = results.find((r) => r.connectionId === "B")!;
    expect(a.userActions).toEqual(["SELECT_SAVED_CREDENTIAL"]);
    expect(a.pendingCatchUp).toBe(false);
    expect(b.userActions).toEqual([]);
    expect(b.pendingCatchUp).toBe(true);
  });
});

// ── shutdown ─────────────────────────────────────────────────────────────────────────────────────
describe("LocalAgentStartup.shutdown", () => {
  it("stops and closes every managed connection exactly once, then forgets them", async () => {
    const h = new Harness();
    const startup = new LocalAgentStartup(h.service());
    await startup.boot([conn("A"), conn("B")]);

    const report = await startup.shutdown();
    expect(report.stoppedConnectionIds).toEqual(["A", "B"]);
    expect(h.runtime("A").stopCalls).toBe(1);
    expect(h.runtime("A").closeCalls).toBe(1);
    expect(h.runtime("B").stopCalls).toBe(1);
    expect(h.runtime("B").closeCalls).toBe(1);
    expect(startup.managedConnectionIds()).toEqual([]);
  });

  it("is idempotent — a second shutdown closes nothing further", async () => {
    const h = new Harness();
    const startup = new LocalAgentStartup(h.service());
    await startup.boot([conn("A")]);
    await startup.shutdown();
    await startup.shutdown();
    expect(h.runtime("A").closeCalls).toBe(1);
  });

  it("one connection's teardown failure never blocks the rest", async () => {
    const h = new Harness();
    h.behave("A", { stopThrows: true });
    const startup = new LocalAgentStartup(h.service());
    await startup.boot([conn("A"), conn("B")]);

    const report = await startup.shutdown();
    // A's stop threw (not in stoppedConnectionIds) but the service still closed it in its `finally`,
    // and B is fully torn down.
    expect(report.stoppedConnectionIds).toEqual(["B"]);
    expect(h.runtime("A").closeCalls).toBe(1);
    expect(h.runtime("B").stopCalls).toBe(1);
    expect(h.runtime("B").closeCalls).toBe(1);
  });
});

// ── signal-triggered shutdown idempotency (SIGINT/SIGTERM) ────────────────────────────────────────
describe("createSignalShutdown", () => {
  it("runs the shutdown once even when triggered twice (SIGINT then SIGTERM)", async () => {
    let calls = 0;
    const guarded = createSignalShutdown(async () => void calls++);
    await guarded(); // SIGINT
    await guarded(); // SIGTERM
    expect(calls).toBe(1);
  });

  it("a concurrent double trigger still runs the shutdown once", async () => {
    let calls = 0;
    const guarded = createSignalShutdown(async () => {
      calls++;
      await Promise.resolve();
    });
    await Promise.all([guarded(), guarded()]);
    expect(calls).toBe(1);
  });
});

// ── explicit session-loss / human-completion routing ─────────────────────────────────────────────
describe("LocalAgentStartup routing", () => {
  it("routeSessionLost drives exactly the addressed connection and surfaces its intents", async () => {
    const h = new Harness();
    h.behave("A", { onSessionLost: (sink, account) => (sink.requestCatchUp(account), READY) });
    const startup = new LocalAgentStartup(h.service());
    await startup.boot([conn("A"), conn("B")]);

    const result = await startup.routeSessionLost("A");
    expect(result!.localAgentState).toBe("READY");
    expect(result!.pendingCatchUp).toBe(true);
    expect(h.runtime("A").sessionLostCalls).toBe(1);
    expect(h.runtime("B").sessionLostCalls).toBe(0);
  });

  it("routeHumanCompleted forwards the action and surfaces intents", async () => {
    const h = new Harness();
    h.behave("A", { onHumanCompleted: (sink, account) => (sink.requestCatchUp(account), READY) });
    const startup = new LocalAgentStartup(h.service());
    await startup.boot([conn("A")]);

    const result = await startup.routeHumanCompleted("A", "SELECT_SAVED_CREDENTIAL");
    expect(result!.localAgentState).toBe("READY");
    expect(h.runtime("A").lastHumanAction).toBe("SELECT_SAVED_CREDENTIAL");
    expect(result!.pendingCatchUp).toBe(true);
  });

  it("routing an unmanaged connection returns null (no throw)", async () => {
    const h = new Harness();
    const startup = new LocalAgentStartup(h.service());
    await startup.boot([conn("A")]);
    expect(await startup.routeSessionLost("UNKNOWN")).toBeNull();
    expect(await startup.routeHumanCompleted("UNKNOWN", "COMPLETE_MANUAL_LOGIN")).toBeNull();
  });
});

// ── configured-connection parsing (resilient) ────────────────────────────────────────────────────
describe("parseProgressiveConnections", () => {
  const valid = JSON.stringify([
    { connectionId: "conn-A", loginMode: "GMARKET", autoReconnectConsent: true, autoSubmitConsent: true, assistedReconnectConsent: true },
    { connectionId: "conn-B", loginMode: "ESM_PLUS", autoReconnectConsent: false, autoSubmitConsent: false, assistedReconnectConsent: true, autoReconnectCapability: "ASSISTED_ONLY" },
  ]);

  it("parses valid descriptors and derives account / profile / strategy", () => {
    const r = parseProgressiveConnections(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.connections).toHaveLength(2);
    expect(r.value.rejectedEntryIndexes).toEqual([]);
    const a = r.value.connections[0]!;
    expect(a.account.connectionId).toBe("conn-A");
    expect(a.account.boundStoreFingerprintHash).toBeNull();
    expect(a.initialFormStrategy).toBe("DOCUMENT_START_BOOTSTRAP"); // GMARKET
    expect(a.dedicatedProfileId).toBe(dedicatedProfileIdFor(acct("conn-A")));
    expect(a.autoReconnectCapability).toBe("UNKNOWN"); // defaulted
    const b = r.value.connections[1]!;
    expect(b.initialFormStrategy).toBe("DIRECT"); // ESM_PLUS
    expect(b.autoReconnectCapability).toBe("ASSISTED_ONLY");
  });

  it("fails closed only on structurally unusable input (malformed JSON / non-array / empty)", () => {
    expect((parseProgressiveConnections("{") as { errorCategory: string }).errorCategory).toBe("invalid-json");
    expect((parseProgressiveConnections('{"a":1}') as { errorCategory: string }).errorCategory).toBe("not-an-array");
    expect((parseProgressiveConnections("[]") as { errorCategory: string }).errorCategory).toBe("empty");
  });

  it("skips (surfaces) invalid entries rather than failing the whole file", () => {
    const raw = JSON.stringify([
      { connectionId: "ok", loginMode: "GMARKET", autoReconnectConsent: true, autoSubmitConsent: true, assistedReconnectConsent: true },
      { connectionId: "x", loginMode: "FACEBOOK", autoReconnectConsent: true, autoSubmitConsent: true, assistedReconnectConsent: true },
      { connectionId: "y", loginMode: "GMARKET", autoSubmitConsent: true, assistedReconnectConsent: true }, // missing consent
      { connectionId: "z", loginMode: "GMARKET", autoReconnectConsent: true, autoSubmitConsent: true, assistedReconnectConsent: true, autoReconnectCapability: "MAYBE" },
    ]);
    const r = parseProgressiveConnections(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.connections.map((c) => c.account.connectionId)).toEqual(["ok"]);
    expect(r.value.rejectedEntryIndexes).toEqual([1, 2, 3]);
  });

  it("keeps the first of a duplicate connection id and surfaces the duplicate", () => {
    const dup = JSON.stringify([
      { connectionId: "same", loginMode: "GMARKET", autoReconnectConsent: true, autoSubmitConsent: true, assistedReconnectConsent: true },
      { connectionId: "same", loginMode: "AUCTION", autoReconnectConsent: true, autoSubmitConsent: true, assistedReconnectConsent: true },
    ]);
    const r = parseProgressiveConnections(dup);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.connections).toHaveLength(1);
    expect(r.value.connections[0]!.loginMode).toBe("GMARKET"); // first kept
    expect(r.value.duplicateConnectionIds).toEqual(["same"]);
  });
});

// ── CLI launch decision — dry run launches no browser and creates no profile ─────────────────────
describe("decideRun (pure launch decision)", () => {
  const oneConn = JSON.stringify([
    { connectionId: "A", loginMode: "GMARKET", autoReconnectConsent: true, autoSubmitConsent: true, assistedReconnectConsent: true },
  ]);
  const liveEnv: NodeJS.ProcessEnv = { ESM_AUTH_SURFACE_URL: "https://example.test/login", STORAGE_PROBE_SALT: "salt" };

  it("without the approval flag → DRY_RUN, no live config surfaced (main never boots)", () => {
    const d = decideRun([], oneConn, liveEnv);
    expect(d.mode).toBe("DRY_RUN");
    expect("config" in d).toBe(false); // no LIVE_BOOT config → createLocalAgentStartup is never reached
  });

  it("approved but missing live config → DRY_RUN with the missing categories (refuses to boot)", () => {
    const d = decideRun([LOCAL_AGENT_APPROVAL_FLAG], oneConn, {});
    expect(d.mode).toBe("DRY_RUN");
    if (d.mode !== "DRY_RUN") return;
    expect(d.approved).toBe(true);
    expect(d.missingConfig.sort()).toEqual(["ESM_AUTH_SURFACE_URL", "STORAGE_PROBE_SALT"]);
  });

  it("approved AND live config present → LIVE_BOOT", () => {
    const d = decideRun([LOCAL_AGENT_APPROVAL_FLAG], oneConn, liveEnv);
    expect(d.mode).toBe("LIVE_BOOT");
  });

  it("a DRY_RUN decision creates NO browser profile directory on disk", () => {
    // A real base dir the live path would derive per-connection profiles under.
    const baseDir = mkdtempSync(join(tmpdir(), "local-agent-startup-"));
    try {
      const before = readdirSync(baseDir);
      const env: NodeJS.ProcessEnv = { ...liveEnv, COLLECTOR_ESM_PROFILE_DIR: join(baseDir, "esm") };
      // No approval → DRY_RUN. decideRun is pure; nothing may touch the filesystem.
      const d = decideRun([], oneConn, env);
      expect(d.mode).toBe("DRY_RUN");
      if (d.mode === "DRY_RUN") {
        const profileId = d.parsed.connections[0]!.dedicatedProfileId;
        expect(existsSync(join(baseDir, profileId))).toBe(false); // no per-connection profile created
      }
      expect(readdirSync(baseDir)).toEqual(before); // the dir is untouched — no browser, no profile
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("resolveStartupConfig reports the two required live-config categories when absent", () => {
    const r = resolveStartupConfig({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.sort()).toEqual(["ESM_AUTH_SURFACE_URL", "STORAGE_PROBE_SALT"]);
  });
});
