import { describe, it, expect } from "vitest";
import {
  buildDiagnosticBundle,
  diagnosticFileName,
  redactSensitive,
  DIAGNOSTICS_SCHEMA,
  type DiagnosticInput,
} from "../../src/runtime/diagnostics-export";
import type { LogEntry } from "../../src/log";

const entry = (event: string, meta: Record<string, unknown>): LogEntry => ({
  ts: "2026-07-28T00:00:00.000Z",
  level: "info",
  event,
  meta,
});

const baseInput = (over: Partial<DiagnosticInput> = {}): DiagnosticInput => ({
  now: "2026-07-28T01:02:03.004Z",
  agent: { version: "1.0.0", protocolVersion: 1, platform: "win32" },
  selfCheck: { ok: true, issues: [] },
  lifecycle: { lockRecovered: false, ownedProcessCount: 1 },
  bridge: { bound: true, port: 47615, originsConfigured: 1, paired: true },
  logTail: [],
  ...over,
});

describe("redactSensitive", () => {
  it("blanks URLs, paths and long tokens; keeps enums/counts as-is", () => {
    expect(redactSensitive("https://naver.com/x")).toBe("[redacted-url]");
    expect(redactSensitive("C:\\Users\\seller\\cookies")).toBe("[redacted-path]");
    expect(redactSensitive("/Users/seller/.profile/naver")).toBe("[redacted-path]");
    expect(redactSensitive("deadbeefdeadbeefdeadbeefdeadbeef00")).toBe("[redacted-token]");
    expect(redactSensitive("SURFACE_CLOSED")).toBe("SURFACE_CLOSED");
    expect(redactSensitive("42")).toBe("42");
  });
});

describe("buildDiagnosticBundle", () => {
  it("emits the schema, sanitized facts, and a scrubbed log tail", () => {
    const bundle = buildDiagnosticBundle(
      baseInput({
        logTail: [entry("aw_import_surface_opened", { accountScoped: true, note: "https://example.com/secret" })],
      }),
    );
    expect(bundle.schema).toBe(DIAGNOSTICS_SCHEMA);
    expect(bundle.agent.platform).toBe("win32");
    expect(bundle.logTail).toHaveLength(1);
    // The URL that slipped into a log meta is redacted before export.
    expect(bundle.logTail[0]!.meta.note).toBe("[redacted-url]");
    expect(bundle.logTail[0]!.meta.accountScoped).toBe(true);
  });

  it("drops secret-ish keys via safeMeta even if a caller passed one", () => {
    const bundle = buildDiagnosticBundle(
      baseInput({ logTail: [entry("x", { sessionToken: "abc", cookie: "y", ok: true })] }),
    );
    const meta = bundle.logTail[0]!.meta;
    expect(meta.sessionToken).toBeUndefined();
    expect(meta.cookie).toBeUndefined();
    expect(meta.ok).toBe(true);
  });

  it("caps the log tail to the most recent maxLogEntries", () => {
    const many = Array.from({ length: 500 }, (_v, i) => entry(`e${i}`, { i }));
    const bundle = buildDiagnosticBundle(baseInput({ logTail: many, maxLogEntries: 10 }));
    expect(bundle.logTail).toHaveLength(10);
    expect(bundle.logTail[9]!.event).toBe("e499"); // kept the most recent
  });

  it("carries no token/paired-secret — only booleans and counts", () => {
    const bundle = buildDiagnosticBundle(baseInput());
    expect(typeof bundle.bridge.paired).toBe("boolean");
    expect(typeof bundle.bridge.port).toBe("number");
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("token");
  });
});

describe("diagnosticFileName", () => {
  it("produces a Windows-safe, sortable filename (no colon)", () => {
    const name = diagnosticFileName("2026-07-28T01:02:03.004Z");
    expect(name).toBe("diagnostics-2026-07-28T01-02-03-004Z.json");
    expect(name).not.toContain(":");
  });
});
