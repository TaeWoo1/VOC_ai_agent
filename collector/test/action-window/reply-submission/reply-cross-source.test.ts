/**
 * Cross-source equality (pure) — the checkpoint preflight that pins the ONE calibrated target: the live in-page
 * fingerprint must equal the backend bundle fingerprint, else fail closed BEFORE any run is assembled.
 */
import { describe, it, expect } from "vitest";
import { compareCrossSource, crossSourceRefusalMessage } from "../../../src/action-window/reply-submission/reply-cross-source";

const FP = "a".repeat(64);

describe("compareCrossSource", () => {
  it("passes only when a non-null live fingerprint equals the backend fingerprint", () => {
    expect(compareCrossSource(FP, FP)).toEqual({ ok: true });
  });
  it("fails closed MISMATCH when the fingerprints differ (wrong/truncated row)", () => {
    expect(compareCrossSource("b".repeat(64), FP)).toEqual({ ok: false, code: "MISMATCH" });
  });
  it("fails closed NO_LIVE_FINGERPRINT when the row/body could not be read in-page", () => {
    expect(compareCrossSource(null, FP)).toEqual({ ok: false, code: "NO_LIVE_FINGERPRINT" });
  });
});

describe("crossSourceRefusalMessage", () => {
  it("explains each failure and never prints a fingerprint value", () => {
    for (const code of ["NO_LIVE_FINGERPRINT", "MISMATCH"] as const) {
      const msg = crossSourceRefusalMessage(code);
      expect(msg).toContain("Refusing to start the reply run");
      expect(msg).not.toContain(FP);
    }
  });
});
