/**
 * Conformance tests for the normative Action Window protocol v1 (`contracts/action-window/v1`).
 *
 * The collector consumes the neutral contract here; it does NOT own it. These tests exercise the
 * single normative TypeScript surface AND assert it stays consistent with the language-neutral
 * `schema.json` (the future-Java source), so the two representations cannot drift.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  RUN_STATUSES,
  STEP_STATUSES,
  EXECUTION_MODES,
  BLOCKER_CODES,
  COMMAND_TYPES,
  EVENT_TYPES,
  validateRunView,
  validateEventEnvelope,
  validateCommandEnvelope,
  findProhibitedFields,
  isActionWindowProtocolCompatible,
  isStaleCommand,
  isDuplicateCommand,
  isDuplicateEvent,
  isOutOfOrderEvent,
  type ValidationResult,
} from "../../../../contracts/action-window/v1/index";

const V1 = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../contracts/action-window/v1");
const FIX = join(V1, "fixtures");
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));
const listJson = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f)).sort();

function errorCodes(r: ValidationResult): string[] {
  return r.ok ? [] : r.errors.map((e) => e.code);
}

describe("Action Window v1 — valid fixtures", () => {
  it.each(listJson(join(FIX, "valid/run-view")))("run-view %s is valid", (p) => {
    expect(validateRunView(readJson(p))).toEqual({ ok: true });
  });
  it.each(listJson(join(FIX, "valid/event")))("event %s is valid", (p) => {
    expect(validateEventEnvelope(readJson(p))).toEqual({ ok: true });
  });
  it.each(listJson(join(FIX, "valid/command")))("command %s is valid", (p) => {
    expect(validateCommandEnvelope(readJson(p))).toEqual({ ok: true });
  });

  it("covers all 12 required run scenarios", () => {
    const files = [
      ...listJson(join(FIX, "valid/run-view")),
      ...listJson(join(FIX, "valid/event")),
    ].map((p) => p.replace(V1, ""));
    const needed = [
      "01-automatic-preparing", "02-human-action-required", "05-target-highlighted",
      "04-waiting-for-user", "05-observing-after-recheck", "07-download-detected",
      "07-processing", "08-completed", "09-paused",
      "10-blocked-login-recoverable", "09-run-blocked-ui-drift", "12-failed",
    ];
    for (const n of needed) expect(files.some((f) => f.includes(n))).toBe(true);
  });
});

describe("Action Window v1 — negative fixtures", () => {
  const invalidFiles = listJson(join(FIX, "invalid"));
  it.each(invalidFiles)("%s is rejected with the expected reason", (p) => {
    const fx = readJson(p) as { target: string; expect: string; data: unknown; context?: { currentRevision?: number; lastSequence?: number } };
    if (fx.target === "runView") {
      expect(errorCodes(validateRunView(fx.data))).toContain(fx.expect);
    } else if (fx.target === "event") {
      expect(errorCodes(validateEventEnvelope(fx.data))).toContain(fx.expect);
    } else if (fx.target === "command") {
      expect(errorCodes(validateCommandEnvelope(fx.data))).toContain(fx.expect);
    } else if (fx.target === "command-ordering") {
      const d = fx.data as { expectedRevision: number };
      expect(isStaleCommand(d.expectedRevision, fx.context!.currentRevision!)).toBe(true);
      expect(fx.expect).toBe("STALE_REVISION");
    } else if (fx.target === "event-ordering") {
      const d = fx.data as { sequence: number };
      expect(isOutOfOrderEvent(d.sequence, fx.context!.lastSequence!)).toBe(true);
      expect(fx.expect).toBe("OUT_OF_ORDER");
    } else {
      throw new Error(`unknown fixture target: ${fx.target}`);
    }
  });
});

describe("Action Window v1 — enum completeness & no duplicates", () => {
  const enums: Record<string, readonly string[]> = {
    RunStatus: RUN_STATUSES, StepStatus: STEP_STATUSES, ExecutionMode: EXECUTION_MODES,
    BlockerCode: BLOCKER_CODES, CommandType: COMMAND_TYPES, EventType: EVENT_TYPES,
  };
  it("has no duplicate members", () => {
    for (const [name, arr] of Object.entries(enums)) {
      expect(new Set(arr).size, name).toBe(arr.length);
    }
  });
  it("RunStatus does not contain UI-only or event-only values", () => {
    for (const forbidden of ["IDLE", "DOWNLOAD_DETECTED", "LOGIN_REQUIRED", "UI_DRIFT"]) {
      expect((RUN_STATUSES as readonly string[]).includes(forbidden)).toBe(false);
    }
  });
  it("has no CONFIRM_STEP_COMPLETED command", () => {
    expect((COMMAND_TYPES as readonly string[]).includes("CONFIRM_STEP_COMPLETED")).toBe(false);
  });
});

describe("Action Window v1 — schema ↔ TypeScript consistency (mechanical)", () => {
  const schema = readJson(join(V1, "schema.json")) as { "x-protocolVersion": number; $defs: Record<string, { enum?: string[] }> };
  const pairs: Array<[string, readonly string[]]> = [
    ["RunStatus", RUN_STATUSES], ["StepStatus", STEP_STATUSES], ["ExecutionMode", EXECUTION_MODES],
    ["BlockerCode", BLOCKER_CODES], ["CommandType", COMMAND_TYPES], ["EventType", EVENT_TYPES],
  ];
  it.each(pairs)("schema $defs.%s.enum equals the TS const array", (name, tsArr) => {
    expect(schema.$defs[name]?.enum).toEqual([...tsArr]);
  });
  it("protocol version agrees across schema and TS", () => {
    expect(schema["x-protocolVersion"]).toBe(ACTION_WINDOW_PROTOCOL_VERSION);
  });
});

describe("Action Window v1 — idempotency & ordering semantics", () => {
  it("duplicate commandId is idempotent", () => {
    const applied = new Set(["cmd_a"]);
    expect(isDuplicateCommand("cmd_a", applied)).toBe(true);
    expect(isDuplicateCommand("cmd_b", applied)).toBe(false);
  });
  it("stale expectedRevision is rejected", () => {
    expect(isStaleCommand(3, 5)).toBe(true);
    expect(isStaleCommand(5, 5)).toBe(false);
  });
  it("event sequence must strictly increase within a run", () => {
    expect(isOutOfOrderEvent(4, 4)).toBe(true);
    expect(isOutOfOrderEvent(3, 4)).toBe(true);
    expect(isOutOfOrderEvent(5, 4)).toBe(false);
  });
  it("duplicate eventId is ignorable", () => {
    const seen = new Set(["evt_1"]);
    expect(isDuplicateEvent("evt_1", seen)).toBe(true);
    expect(isDuplicateEvent("evt_2", seen)).toBe(false);
  });
});

describe("Action Window v1 — privacy boundary", () => {
  it("all valid fixtures carry no prohibited fields", () => {
    for (const sub of ["valid/run-view", "valid/event", "valid/command"]) {
      for (const p of listJson(join(FIX, sub))) {
        expect(findProhibitedFields(readJson(p)), p).toEqual([]);
      }
    }
  });
  it("rejects selectors, URLs, and absolute paths", () => {
    expect(findProhibitedFields({ payload: { selector: "#x" } }).length).toBeGreaterThan(0);
    expect(findProhibitedFields({ instruction: "go to https://x.example/login" }).length).toBeGreaterThan(0);
    expect(findProhibitedFields({ note: "/Users/seller/Downloads/a.xlsx" }).length).toBeGreaterThan(0);
    expect(findProhibitedFields({ frameUrl: "wss://x" }).length).toBeGreaterThan(0);
  });
  it("rejects a non-opaque *Ref value", () => {
    expect(findProhibitedFields({ targetRef: "#export-button" }).length).toBeGreaterThan(0);
    expect(findProhibitedFields({ targetRef: "a1b2c3d4e5f60718" })).toEqual([]);
  });
});

describe("Action Window v1 — protocol version & round trip", () => {
  it("rejects unknown protocol versions (fail closed)", () => {
    expect(isActionWindowProtocolCompatible(2, ACTION_WINDOW_PROTOCOL_VERSION)).toBe(false);
    const v2cmd = { protocolVersion: 2, commandId: "c", runId: "r", expectedRevision: 0, type: "PAUSE_RUN" };
    expect(errorCodes(validateCommandEnvelope(v2cmd))).toContain("UNSUPPORTED_PROTOCOL_VERSION");
  });
  it("valid fixtures survive a JSON serialize/deserialize round trip", () => {
    for (const p of listJson(join(FIX, "valid/run-view"))) {
      const original = readJson(p);
      const round = JSON.parse(JSON.stringify(original));
      expect(round).toEqual(original);
      expect(validateRunView(round)).toEqual({ ok: true });
    }
  });
});
