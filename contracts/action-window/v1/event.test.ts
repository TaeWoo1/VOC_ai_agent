import { describe, it, expect } from "vitest";
import { parseEvent, isDuplicateEvent, isSequenceRegression, shouldApplyEvent } from "./event";
import { SAMPLE_DOWNLOAD_EVENT } from "./fixtures";

const valid = SAMPLE_DOWNLOAD_EVENT; // sequence === 6

describe("event envelope", () => {
  it("parses a valid event", () => {
    expect(parseEvent(valid).ok).toBe(true);
  });

  it("identifies duplicate event ids", () => {
    expect(isDuplicateEvent(valid, new Set([valid.eventId]))).toBe(true);
    expect(isDuplicateEvent(valid, new Set())).toBe(false);
  });

  it("treats equal or lower sequence as a regression (cannot advance)", () => {
    expect(isSequenceRegression(6, valid)).toBe(true); // equal
    expect(isSequenceRegression(7, valid)).toBe(true); // lower
    expect(isSequenceRegression(5, valid)).toBe(false); // strictly newer
  });

  it("applies only strictly-newer, non-duplicate events", () => {
    expect(shouldApplyEvent(valid, 5, new Set())).toBe(true);
    expect(shouldApplyEvent(valid, 6, new Set())).toBe(false);
    expect(shouldApplyEvent(valid, 5, new Set([valid.eventId]))).toBe(false);
  });

  it("fails closed on unknown type and unsupported version", () => {
    expect(parseEvent({ ...valid, type: "NOPE" }).ok).toBe(false);
    expect(parseEvent({ ...valid, protocolVersion: "9.9.9" }).ok).toBe(false);
  });
});
