import { describe, it, expect } from "vitest";
import {
  parseCommand,
  isDuplicateCommand,
  isStaleCommand,
  isApplicableCommand,
} from "./command";
import { CommandType } from "./enums";
import { SAMPLE_RECHECK_COMMAND } from "./fixtures";

const valid = SAMPLE_RECHECK_COMMAND; // expectedRevision === 3

describe("command envelope", () => {
  it("parses a valid command", () => {
    expect(parseCommand(valid).ok).toBe(true);
  });

  it("REQUEST_STEP_RECHECK is a real command that does not imply completion", () => {
    expect(valid.type).toBe(CommandType.REQUEST_STEP_RECHECK);
    // The protocol has no command that completes a step (see enums.test).
  });

  it("identifies duplicate command ids (idempotency key)", () => {
    expect(isDuplicateCommand(valid, new Set([valid.commandId]))).toBe(true);
    expect(isDuplicateCommand(valid, new Set())).toBe(false);
  });

  it("rejects stale expectedRevision, accepts the current one", () => {
    expect(isStaleCommand(valid, 4)).toBe(true);
    expect(isStaleCommand(valid, 3)).toBe(false);
    expect(isApplicableCommand(valid, 3)).toBe(true);
    expect(isApplicableCommand(valid, 4)).toBe(false);
  });

  it("fails closed on an unknown command type", () => {
    expect(parseCommand({ ...valid, type: "CONFIRM_STEP_COMPLETED", payload: undefined }).ok).toBe(false);
  });

  it("fails closed on an unsupported protocol version", () => {
    expect(parseCommand({ ...valid, protocolVersion: "2.0.0" }).ok).toBe(false);
  });

  it("validates payload shape per command type", () => {
    expect(
      parseCommand({ ...valid, type: CommandType.SET_GUIDANCE_ENABLED, payload: { enabled: "yes" } }).ok,
    ).toBe(false);
    expect(
      parseCommand({ ...valid, type: CommandType.SET_GUIDANCE_ENABLED, payload: { enabled: true } }).ok,
    ).toBe(true);
  });

  it("accepts START_RUN with channelCode and rejects unknown payload keys", () => {
    expect(parseCommand({ ...valid, type: CommandType.START_RUN, payload: { channelCode: "esm" } }).ok).toBe(true);
    expect(
      parseCommand({ ...valid, type: CommandType.START_RUN, payload: { channelCode: "esm", extra: 1 } }).ok,
    ).toBe(false);
  });

  it("rejects forbidden (non-sanitized) fields in the payload", () => {
    expect(
      parseCommand({ ...valid, type: CommandType.START_RUN, payload: { channelCode: "esm", cookie: "x" } }).ok,
    ).toBe(false);
  });

  it("rejects unknown envelope keys (exact schema, fail-closed)", () => {
    expect(parseCommand({ ...valid, displayText: "arbitrary prose" }).ok).toBe(false);
  });
});
