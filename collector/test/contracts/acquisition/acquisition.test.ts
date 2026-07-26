import { describe, expect, it } from "vitest";
import {
  ACQUISITION_CAPABILITIES,
  EXECUTION_MODES,
  checkpointShapeForMode,
  decideAcquisition,
  resolveAcquisition,
  type AcquisitionPlan,
  type AcquisitionResolutionRow,
  type CheckpointShape,
  type ExecutionMode,
} from "../../../../contracts/acquisition/v1/index";
import type { SessionReadinessState } from "../../../../contracts/session-readiness/v1/index";

const ALL_READINESS: SessionReadinessState[] = [
  "READY",
  "LOGIN_REQUIRED",
  "TWO_FACTOR_REQUIRED",
  "ACCOUNT_AMBIGUOUS",
  "EXPIRED",
  "UNOBSERVED_EXTERNAL",
];

/** A small self-contained matrix so the contract test never depends on the collector's real §4.1 rows. */
const MATRIX: readonly AcquisitionResolutionRow[] = [
  { channelCode: "naver", capability: "REVIEW", mode: "ACTION_WINDOW" },
  { channelCode: "naver", capability: "ORDER_SUMMARY", mode: "AUTOMATIC_OPERATION", delivery: "PULL" },
  { channelCode: "acme", capability: "ORDER_SUMMARY", mode: "AUTOMATIC_OPERATION", delivery: "PUSH" },
];

describe("acquisition contract — capability + checkpoint vocabulary", () => {
  it("checkpointShapeForMode is total over every ExecutionMode and never a menu", () => {
    const expected: Record<ExecutionMode, CheckpointShape> = {
      AUTOMATIC_OPERATION: "APPROVAL",
      ACTION_WINDOW: "MARKETPLACE_ACTION",
      FILE_IMPORT: "FILE_SELECTION",
      INTEGRATION_PENDING: "NONE",
    };
    for (const mode of EXECUTION_MODES) {
      expect(checkpointShapeForMode(mode)).toBe(expected[mode]);
    }
  });

  it("declares exactly the four capabilities", () => {
    expect([...ACQUISITION_CAPABILITIES].sort()).toEqual(["INQUIRY", "ORDER_SUMMARY", "REPLY_SUBMISSION", "REVIEW"]);
  });
});

describe("acquisition contract — resolveAcquisition", () => {
  it("resolves a matched row to its mode and the canonical checkpoint", () => {
    const plan = resolveAcquisition("naver", "REVIEW", MATRIX);
    expect(plan).toEqual({
      channelCode: "naver",
      capability: "REVIEW",
      mode: "ACTION_WINDOW",
      checkpoint: "MARKETPLACE_ACTION",
    });
  });

  it("carries delivery only on AUTOMATIC_OPERATION (PULL = API, PUSH = webhook)", () => {
    const pull = resolveAcquisition("naver", "ORDER_SUMMARY", MATRIX);
    expect(pull).toEqual({
      channelCode: "naver",
      capability: "ORDER_SUMMARY",
      mode: "AUTOMATIC_OPERATION",
      delivery: "PULL",
      checkpoint: "APPROVAL",
    });
    const push = resolveAcquisition("acme", "ORDER_SUMMARY", MATRIX);
    expect(push.delivery).toBe("PUSH");
    expect(push.mode).toBe("AUTOMATIC_OPERATION");
  });

  it("fails closed to INTEGRATION_PENDING for any unresolved (channel, capability) — never a guessed mode", () => {
    const plan = resolveAcquisition("coupang", "REVIEW", MATRIX);
    expect(plan).toEqual({
      channelCode: "coupang",
      capability: "REVIEW",
      mode: "INTEGRATION_PENDING",
      checkpoint: "NONE",
    });
    expect("delivery" in plan).toBe(false);
    // A known channel with an unlisted capability also fails closed — omission, not inference.
    expect(resolveAcquisition("naver", "INQUIRY", MATRIX).mode).toBe("INTEGRATION_PENDING");
  });

  it("a plan carries only sanitized enums — nowhere for a token, id, URL, or ref", () => {
    const plan = resolveAcquisition("naver", "ORDER_SUMMARY", MATRIX);
    expect(Object.keys(plan).sort()).toEqual(["capability", "channelCode", "checkpoint", "delivery", "mode"]);
  });
});

describe("acquisition contract — decideAcquisition", () => {
  const integrated: AcquisitionPlan = resolveAcquisition("naver", "REVIEW", MATRIX);

  it("READY dispatches an integrated plan", () => {
    expect(decideAcquisition("READY", integrated)).toEqual({ kind: "DISPATCH", plan: integrated });
  });

  it("an unobserved session holds, never infers", () => {
    expect(decideAcquisition("UNOBSERVED_EXTERNAL", integrated)).toEqual({ kind: "HOLD_UNOBSERVED", plan: integrated });
  });

  it("every not-ready session asks the seller for the readiness contract's exactly-one action", () => {
    expect(decideAcquisition("LOGIN_REQUIRED", integrated)).toMatchObject({ kind: "ASK_SELLER", action: "LOG_IN" });
    expect(decideAcquisition("EXPIRED", integrated)).toMatchObject({ kind: "ASK_SELLER", action: "LOG_IN" });
    expect(decideAcquisition("TWO_FACTOR_REQUIRED", integrated)).toMatchObject({
      kind: "ASK_SELLER",
      action: "COMPLETE_AUTH_CHALLENGE",
    });
    expect(decideAcquisition("ACCOUNT_AMBIGUOUS", integrated)).toMatchObject({
      kind: "ASK_SELLER",
      action: "SELECT_ACCOUNT",
    });
  });

  it("an INTEGRATION_PENDING plan holds as UNSUPPORTED for EVERY readiness — even READY (fail closed first)", () => {
    const pending = resolveAcquisition("coupang", "REVIEW", MATRIX);
    for (const readiness of ALL_READINESS) {
      expect(decideAcquisition(readiness, pending)).toEqual({ kind: "HOLD_UNSUPPORTED", plan: pending });
    }
  });

  it("Webhook is not a distinct branch — AUTOMATIC_OPERATION/PUSH routes exactly like /PULL", () => {
    const pull = resolveAcquisition("naver", "ORDER_SUMMARY", MATRIX);
    const push = resolveAcquisition("acme", "ORDER_SUMMARY", MATRIX);
    for (const readiness of ALL_READINESS) {
      expect(decideAcquisition(readiness, push).kind).toBe(decideAcquisition(readiness, pull).kind);
    }
    expect(decideAcquisition("READY", push)).toEqual({ kind: "DISPATCH", plan: push });
  });
});
