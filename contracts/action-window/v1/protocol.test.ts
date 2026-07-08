import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  isSupportedProtocolVersion,
  isCompatibleProtocolVersion,
  assertProtocolVersion,
  parseVersion,
} from "./protocol";

describe("protocol identity & compatibility", () => {
  it("starts at 1.0.0", () => {
    expect(PROTOCOL_VERSION).toBe("1.0.0");
  });

  it("recognizes only the exact supported version string", () => {
    expect(isSupportedProtocolVersion("1.0.0")).toBe(true);
    expect(isSupportedProtocolVersion("1.1.0")).toBe(false);
  });

  it("is compatible on major-match, minor-not-newer; fails closed otherwise", () => {
    expect(isCompatibleProtocolVersion("1.0.0")).toBe(true);
    expect(isCompatibleProtocolVersion("1.0.9")).toBe(true); // patch ignored
    expect(isCompatibleProtocolVersion("1.1.0")).toBe(false); // newer minor
    expect(isCompatibleProtocolVersion("2.0.0")).toBe(false); // different major
    expect(isCompatibleProtocolVersion("0.9.0")).toBe(false);
    expect(isCompatibleProtocolVersion("garbage")).toBe(false);
  });

  it("assertProtocolVersion throws on unsupported (fail-closed)", () => {
    expect(() => assertProtocolVersion("2.0.0")).toThrow();
    expect(() => assertProtocolVersion("1.0.0")).not.toThrow();
  });

  it("parseVersion parses or rejects", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("nope")).toBeNull();
  });
});
