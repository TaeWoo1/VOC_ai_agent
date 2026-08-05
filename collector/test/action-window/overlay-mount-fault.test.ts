/**
 * Pure unit coverage for the overlay-MOUNT fault helpers that the `Overlay Mount Fault Identification` unit added
 * to `overlay.ts`: the code-based fingerprint ({@link fingerprintMountFault}) and the diagnostic-only sanitized
 * message ({@link sanitizeMountMessage}). No browser, no page — these are pure functions over a thrown value.
 *
 * The contract they exist to enforce: a mount fault is classified to a FIXED reason enum FIRST (so the raw
 * message never needs to leave), and ONLY a genuinely unrecognized cause (`UNKNOWN`) may render a scrubbed
 * framework message — from which every URL, quoted span, and digit run has been removed.
 */
import { describe, expect, it } from "vitest";
import { fingerprintMountFault, sanitizeMountMessage } from "../../src/action-window/overlay";

const err = (message: string, name = "Error"): Error => Object.assign(new Error(message), { name });

describe("fingerprintMountFault — a mount fault maps to a fixed reason enum (message never emitted)", () => {
  it.each([
    ["Execution context was destroyed, most likely because of a navigation", "CONTEXT_DESTROYED"],
    ["context was destroyed", "CONTEXT_DESTROYED"],
    ["frame was detached", "FRAME_DETACHED"],
    ["Frame was detached from the page", "FRAME_DETACHED"],
    ["Target closed", "TARGET_CLOSED"],
    ["Target page, context or browser has been closed", "TARGET_CLOSED"],
    ["__name is not defined", "SYMBOL_NOT_DEFINED"],
    ["ReferenceError: foo is not defined", "SYMBOL_NOT_DEFINED"],
    ["Cannot read properties of null (reading 'appendChild')", "NULL_PROPERTY_ACCESS"],
    ["Cannot read property 'style' of undefined", "NULL_PROPERTY_ACCESS"],
    ["target.scrollIntoView is not a function", "NOT_A_FUNCTION"],
    ["Failed to execute 'appendChild': HierarchyRequestError", "DOM_EXCEPTION"],
    ["SecurityError: blocked a frame", "DOM_EXCEPTION"],
    ["some entirely novel failure with no known shape", "UNKNOWN"],
  ])("classifies %j → %s", (message, expected) => {
    expect(fingerprintMountFault(err(message))).toBe(expected);
  });

  it("recognizes a DOMException by NAME even when the message is generic", () => {
    expect(fingerprintMountFault(err("boom", "DOMException"))).toBe("DOM_EXCEPTION");
  });

  it("classifies a bare TypeError (no specific shape) as TYPE_ERROR, not UNKNOWN", () => {
    expect(fingerprintMountFault(err("weird", "TypeError"))).toBe("TYPE_ERROR");
  });

  it("a non-Error thrown value is UNKNOWN (never throws while classifying)", () => {
    expect(fingerprintMountFault("a plain string")).toBe("UNKNOWN");
    expect(fingerprintMountFault(undefined)).toBe("UNKNOWN");
  });
});

describe("sanitizeMountMessage — diagnostic-only, scrubbed of URL / quotes / digits, length-capped", () => {
  it("removes any URL", () => {
    const s = sanitizeMountMessage(err("failed loading https://apicenter.commerce.naver.com/app/x now"));
    expect(s).not.toContain("http");
    expect(s).not.toContain("apicenter");
    expect(s).not.toContain("naver");
    expect(s).toContain("<url>");
  });

  it("removes any quoted span (which could carry a selector or page text)", () => {
    const s = sanitizeMountMessage(err("reading 'div.super-secret-value' failed"));
    expect(s).not.toContain("super-secret-value");
    expect(s).toContain("<q>");
  });

  it("removes digit runs (counts / ids / coordinates)", () => {
    const s = sanitizeMountMessage(err("failed at line 4213 col 77"));
    expect(s).not.toMatch(/\d/);
  });

  it("keeps the framework SHAPE so the diagnostic stays useful", () => {
    expect(sanitizeMountMessage(err("__name is not defined"))).toContain("is not defined");
  });

  it("caps length (long messages are truncated with an ellipsis)", () => {
    const long = "x".repeat(500);
    const s = sanitizeMountMessage(err(long));
    expect(s.length).toBeLessThanOrEqual(121);
    expect(s.endsWith("…")).toBe(true);
  });

  it("a non-Error thrown value renders to an empty string (never leaks a coerced object)", () => {
    expect(sanitizeMountMessage({ secret: "x" })).toBe("");
    expect(sanitizeMountMessage(undefined)).toBe("");
  });
});
