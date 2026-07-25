/**
 * Conformance tests for the normative Action Window protocol v2 (`contracts/action-window/v2`).
 *
 * v2 is a side-by-side successor to v1 that adds a guided, human-performed reply SUBMISSION. These
 * tests exercise the single normative TypeScript surface AND assert it stays consistent with the
 * language-neutral `schema.json`, exactly as the v1 suite does — plus the v2-only invariants:
 * outcome and verification are SEPARATE fields, a reply terminal is `OPERATOR_REPORTED` (never
 * `COMPLETED`), and `submissionRef` is an opaque ref that never carries text.
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
  RUN_INTENTS,
  INTENT_REQUIRED_REF,
  OPERATOR_OUTCOMES,
  VERIFICATION_STATES,
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
} from "../../../../contracts/action-window/v2/index";
import {
  AW_CARRIER_EXPORT,
  AW_CARRIER_REPLY,
  AW_CARRIER_IMPORT,
  parseAwCarrierKind,
} from "../../../../contracts/action-window/aw-carrier-kind";

const V2 = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../contracts/action-window/v2");
const FIX = join(V2, "fixtures");
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));
const listJson = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f)).sort();

function errorCodes(r: ValidationResult): string[] {
  return r.ok ? [] : r.errors.map((e) => e.code);
}

describe("Action Window v2 — valid fixtures", () => {
  it.each(listJson(join(FIX, "valid/run-view")))("run-view %s is valid", (p) => {
    expect(validateRunView(readJson(p))).toEqual({ ok: true });
  });
  it.each(listJson(join(FIX, "valid/event")))("event %s is valid", (p) => {
    expect(validateEventEnvelope(readJson(p))).toEqual({ ok: true });
  });
  it.each(listJson(join(FIX, "valid/command")))("command %s is valid", (p) => {
    expect(validateCommandEnvelope(readJson(p))).toEqual({ ok: true });
  });
});

describe("Action Window v2 — negative fixtures", () => {
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

describe("Action Window v2 — enum completeness & no duplicates", () => {
  const enums: Record<string, readonly string[]> = {
    RunStatus: RUN_STATUSES, StepStatus: STEP_STATUSES, ExecutionMode: EXECUTION_MODES,
    BlockerCode: BLOCKER_CODES, CommandType: COMMAND_TYPES, EventType: EVENT_TYPES,
    RunIntent: RUN_INTENTS, OperatorOutcome: OPERATOR_OUTCOMES, VerificationState: VERIFICATION_STATES,
  };
  it("has no duplicate members", () => {
    for (const [name, arr] of Object.entries(enums)) {
      expect(new Set(arr).size, name).toBe(arr.length);
    }
  });
  it("keeps the operator-reported terminal distinct from COMPLETED", () => {
    expect((RUN_STATUSES as readonly string[]).includes("OPERATOR_REPORTED")).toBe(true);
    expect((RUN_STATUSES as readonly string[]).includes("COMPLETED")).toBe(true);
    expect((STEP_STATUSES as readonly string[]).includes("OPERATOR_REPORTED")).toBe(true);
  });
  it("verification has no VERIFIED value — a reply post cannot be verified", () => {
    expect((VERIFICATION_STATES as readonly string[]).includes("VERIFIED")).toBe(false);
    expect([...VERIFICATION_STATES]).toEqual(["UNVERIFIED"]);
  });
  it("SUBMISSION_ABORTED is an operator outcome, not a blocker code", () => {
    expect((OPERATOR_OUTCOMES as readonly string[]).includes("SUBMISSION_ABORTED")).toBe(true);
    expect((BLOCKER_CODES as readonly string[]).includes("SUBMISSION_ABORTED")).toBe(false);
  });
  it("has no CONFIRM_STEP_COMPLETED command (v1 guarantee preserved)", () => {
    expect((COMMAND_TYPES as readonly string[]).includes("CONFIRM_STEP_COMPLETED")).toBe(false);
  });
});

describe("Action Window v2 — reply-submission command & event rules", () => {
  const base = { protocolVersion: 2, commandId: "c", runId: "r", expectedRevision: 0, type: "START_RUN" as const };

  it("REPLY_SUBMISSION requires an opaque submissionRef", () => {
    const missing = { ...base, payload: { channelCode: "naver", intent: "REPLY_SUBMISSION" } };
    expect(errorCodes(validateCommandEnvelope(missing))).toContain("CONSTRAINT_VIOLATION");
    const nonOpaque = { ...base, payload: { channelCode: "naver", intent: "REPLY_SUBMISSION", submissionRef: "#reply-box" } };
    // a non-opaque submissionRef is rejected both by the payload rule and by findProhibitedFields
    expect(validateCommandEnvelope(nonOpaque).ok).toBe(false);
    const ok = { ...base, payload: { channelCode: "naver", intent: "REPLY_SUBMISSION", submissionRef: "a1b2c3d4e5f60718" } };
    expect(validateCommandEnvelope(ok)).toEqual({ ok: true });
  });

  it("an EXPORT run must NOT carry a submissionRef", () => {
    const bad = { ...base, payload: { channelCode: "naver", intent: "EXPORT", submissionRef: "a1b2c3d4e5f60718" } };
    expect(errorCodes(validateCommandEnvelope(bad))).toContain("CONSTRAINT_VIOLATION");
  });

  it("absent intent is EXPORT-compatible (v1 shape still valid)", () => {
    const v1shape = { ...base, payload: { channelCode: "esm_plus" } };
    expect(validateCommandEnvelope(v1shape)).toEqual({ ok: true });
  });

  it("SUBMISSION_REPORTED requires operatorOutcome AND verification (separate fields)", () => {
    const missingVerification = {
      protocolVersion: 2, eventId: "e", runId: "r", sequence: 1, revision: 1,
      type: "SUBMISSION_REPORTED", occurredAt: "2026-07-18T09:12:00Z",
      payload: { stepId: "aw.user_reply_submit", operatorOutcome: "OPERATOR_REPORTED_SUBMITTED" },
    };
    expect(errorCodes(validateEventEnvelope(missingVerification))).toContain("MISSING_FIELD");
  });

  it("RUN_OPERATOR_REPORTED must carry status OPERATOR_REPORTED, never COMPLETED", () => {
    const wrongStatus = {
      protocolVersion: 2, eventId: "e", runId: "r", sequence: 1, revision: 1,
      type: "RUN_OPERATOR_REPORTED", occurredAt: "2026-07-18T09:12:00Z",
      payload: { status: "COMPLETED", operatorOutcome: "OPERATOR_REPORTED_SUBMITTED", verification: "UNVERIFIED" },
    };
    expect(errorCodes(validateEventEnvelope(wrongStatus))).toContain("CONSTRAINT_VIOLATION");
  });

  it("an OPERATOR_REPORTED run cannot expose an active blocker", () => {
    const view = readJson(join(FIX, "valid/run-view/13-operator-reported.json")) as Record<string, unknown>;
    const withBlocker = { ...view, blocker: { code: "UI_DRIFT", recoverable: true } };
    expect(errorCodes(validateRunView(withBlocker))).toContain("CONSTRAINT_VIOLATION");
  });
});

describe("Action Window v2 — initial-review-import binding rules", () => {
  const base = { protocolVersion: 2, commandId: "c", runId: "r", expectedRevision: 0, type: "START_RUN" as const };
  const DISCOVERY = "0f1e2d3c4b5a6978";
  const IMPORT = "9a8b7c6d5e4f3021";
  const SUBMISSION = "a1b2c3d4e5f60718";

  it("every intent declares which ref it requires (exhaustive, so a new intent cannot be unbound by omission)", () => {
    for (const intent of RUN_INTENTS) {
      expect(Object.prototype.hasOwnProperty.call(INTENT_REQUIRED_REF, intent)).toBe(true);
    }
    expect(INTENT_REQUIRED_REF.EXPORT).toBeNull();
    expect(INTENT_REQUIRED_REF.INITIAL_REVIEW_IMPORT_DISCOVERY).toBe("discoveryRef");
    expect(INTENT_REQUIRED_REF.INITIAL_REVIEW_IMPORT_SEGMENT).toBe("importRef");
  });

  it("discovery requires an opaque discoveryRef", () => {
    expect(errorCodes(validateCommandEnvelope({ ...base, payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_DISCOVERY" } })))
      .toContain("CONSTRAINT_VIOLATION");
    // a date is exactly what must never ride here — and is not 16-hex, so it is refused
    expect(validateCommandEnvelope({ ...base, payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_DISCOVERY", discoveryRef: "2026-06-01" } }).ok).toBe(false);
    expect(validateCommandEnvelope({ ...base, payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_DISCOVERY", discoveryRef: DISCOVERY } })).toEqual({ ok: true });
  });

  it("a segment import requires an opaque importRef", () => {
    expect(errorCodes(validateCommandEnvelope({ ...base, payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT" } })))
      .toContain("CONSTRAINT_VIOLATION");
    expect(validateCommandEnvelope({ ...base, payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef: IMPORT } })).toEqual({ ok: true });
  });

  // The whole point of one-ref-per-intent: a run bound to the wrong kind of approved work is the bug
  // this rule exists to make unrepresentable, in BOTH directions.
  it.each([
    ["discovery carrying an importRef", { intent: "INITIAL_REVIEW_IMPORT_DISCOVERY", discoveryRef: DISCOVERY, importRef: IMPORT }],
    ["discovery carrying a submissionRef", { intent: "INITIAL_REVIEW_IMPORT_DISCOVERY", discoveryRef: DISCOVERY, submissionRef: SUBMISSION }],
    ["a segment import carrying a discoveryRef", { intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef: IMPORT, discoveryRef: DISCOVERY }],
    ["a segment import carrying a submissionRef", { intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef: IMPORT, submissionRef: SUBMISSION }],
    ["a reply carrying an importRef", { intent: "REPLY_SUBMISSION", submissionRef: SUBMISSION, importRef: IMPORT }],
    ["an export carrying an importRef", { intent: "EXPORT", importRef: IMPORT }],
    ["an export carrying a discoveryRef", { intent: "EXPORT", discoveryRef: DISCOVERY }],
  ])("rejects %s", (_label, payload) => {
    expect(errorCodes(validateCommandEnvelope({ ...base, payload: { channelCode: "naver", ...payload } }))).toContain("CONSTRAINT_VIOLATION");
  });

  it("an unknown intent cannot smuggle a binding through", () => {
    const bad = { ...base, payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT", importRef: IMPORT } };
    const codes = errorCodes(validateCommandEnvelope(bad));
    expect(codes).toContain("UNKNOWN_ENUM"); // the intent itself
    expect(codes).toContain("CONSTRAINT_VIOLATION"); // ...and the ref it tried to carry
  });

  it("treats discoveryRef and importRef as opaque refs (no path, selector, or date)", () => {
    expect(findProhibitedFields({ discoveryRef: "/Users/seller/export.xlsx" }).length).toBeGreaterThan(0);
    expect(findProhibitedFields({ importRef: "#segment-1" }).length).toBeGreaterThan(0);
    expect(findProhibitedFields({ discoveryRef: DISCOVERY, importRef: IMPORT })).toEqual([]);
  });

  // An import run is read-only export choreography, so it must reach the ordinary COMPLETED terminal —
  // NOT the reply world's OPERATOR_REPORTED, which exists only because a post has no read-back oracle.
  it("an import run reaches COMPLETED (it is not the unverifiable reply terminal)", () => {
    const view = {
      protocolVersion: 2, runId: "r", revision: 3, channelCode: "naver",
      runCopyKey: "actionWindow.import.segment", status: "COMPLETED", executionMode: "AUTOMATIC_OPERATION",
      intent: "INITIAL_REVIEW_IMPORT_SEGMENT", guidanceEnabled: true, allowedCommands: [],
      progress: { completedSteps: 3, totalSteps: 3 }, updatedAt: "2026-07-25T00:00:00Z",
    };
    expect(validateRunView(view)).toEqual({ ok: true });
  });

  it("the import carrier is its own announceable kind — export/reply/import cannot cross-attach", () => {
    expect(parseAwCarrierKind("import")).toBe("import");
    expect(new Set([AW_CARRIER_EXPORT, AW_CARRIER_REPLY, AW_CARRIER_IMPORT]).size).toBe(3);
    expect(parseAwCarrierKind("initial-import")).toBeNull(); // fail closed on anything unrecognised
  });
});

describe("Action Window v2 — schema ↔ TypeScript consistency (mechanical)", () => {
  const schema = readJson(join(V2, "schema.json")) as { "x-protocolVersion": number; $defs: Record<string, { enum?: string[] }> };
  const pairs: Array<[string, readonly string[]]> = [
    ["RunStatus", RUN_STATUSES], ["StepStatus", STEP_STATUSES], ["ExecutionMode", EXECUTION_MODES],
    ["BlockerCode", BLOCKER_CODES], ["CommandType", COMMAND_TYPES], ["EventType", EVENT_TYPES],
    ["RunIntent", RUN_INTENTS], ["OperatorOutcome", OPERATOR_OUTCOMES], ["VerificationState", VERIFICATION_STATES],
  ];
  it.each(pairs)("schema $defs.%s.enum equals the TS const array", (name, tsArr) => {
    expect(schema.$defs[name]?.enum).toEqual([...tsArr]);
  });
  it("protocol version is 2 across schema and TS", () => {
    expect(ACTION_WINDOW_PROTOCOL_VERSION).toBe(2);
    expect(schema["x-protocolVersion"]).toBe(ACTION_WINDOW_PROTOCOL_VERSION);
  });
});

describe("Action Window v2 — privacy boundary", () => {
  it("all valid fixtures carry no prohibited fields", () => {
    for (const sub of ["valid/run-view", "valid/event", "valid/command"]) {
      for (const p of listJson(join(FIX, sub))) {
        expect(findProhibitedFields(readJson(p)), p).toEqual([]);
      }
    }
  });
  it("treats submissionRef as an opaque ref — rejects a non-opaque value", () => {
    expect(findProhibitedFields({ submissionRef: "#reply-box" }).length).toBeGreaterThan(0);
    expect(findProhibitedFields({ submissionRef: "a1b2c3d4e5f60718" })).toEqual([]);
  });
  it("still rejects selectors, URLs, and absolute paths", () => {
    expect(findProhibitedFields({ payload: { selector: "#x" } }).length).toBeGreaterThan(0);
    expect(findProhibitedFields({ note: "/Users/seller/Downloads/a.xlsx" }).length).toBeGreaterThan(0);
  });
});

describe("Action Window v2 — protocol version negotiation (fail closed)", () => {
  it("rejects a v1 message reaching the v2 validator", () => {
    expect(isActionWindowProtocolCompatible(1, ACTION_WINDOW_PROTOCOL_VERSION)).toBe(false);
    const v1cmd = { protocolVersion: 1, commandId: "c", runId: "r", expectedRevision: 0, type: "PAUSE_RUN" };
    expect(errorCodes(validateCommandEnvelope(v1cmd))).toContain("UNSUPPORTED_PROTOCOL_VERSION");
  });
});

describe("Action Window v2 — idempotency & ordering semantics (unchanged from v1)", () => {
  it("duplicate commandId is idempotent", () => {
    expect(isDuplicateCommand("cmd_a", new Set(["cmd_a"]))).toBe(true);
    expect(isDuplicateCommand("cmd_b", new Set(["cmd_a"]))).toBe(false);
  });
  it("event sequence must strictly increase within a run", () => {
    expect(isOutOfOrderEvent(4, 4)).toBe(true);
    expect(isOutOfOrderEvent(5, 4)).toBe(false);
  });
  it("duplicate eventId is ignorable", () => {
    expect(isDuplicateEvent("evt_1", new Set(["evt_1"]))).toBe(true);
  });
});
