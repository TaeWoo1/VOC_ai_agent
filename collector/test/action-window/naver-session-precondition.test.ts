/**
 * Unit tests for the pure NAVER session-precondition mapping. Offline, hermetic — no browser,
 * no backend. Locks the READY-vs-fail-closed-blocker contract shared by the fixture driver and the
 * read-only §8-4 live probe entrypoint.
 */
import { describe, it, expect } from "vitest";
import {
  naverSessionPrecondition,
  naverSurfaceBlockerFor,
} from "../../src/action-window/naver-session-precondition";
import type { SessionVerdict } from "../../src/naver/session-verdict";

describe("naverSessionPrecondition — READY vs fail-closed blocker mapping", () => {
  it("LOGGED_IN → ready, no blocker", () => {
    expect(naverSessionPrecondition("LOGGED_IN")).toEqual({ ready: true, verdict: "LOGGED_IN" });
  });

  it("RECONNECT_REQUIRED → not ready, SESSION_EXPIRED", () => {
    expect(naverSessionPrecondition("RECONNECT_REQUIRED")).toEqual({
      ready: false,
      verdict: "RECONNECT_REQUIRED",
      blockerCode: "SESSION_EXPIRED",
    });
  });

  it("ACCOUNT_LOGIN_REQUIRED → not ready, LOGIN_REQUIRED", () => {
    expect(naverSessionPrecondition("ACCOUNT_LOGIN_REQUIRED")).toEqual({
      ready: false,
      verdict: "ACCOUNT_LOGIN_REQUIRED",
      blockerCode: "LOGIN_REQUIRED",
    });
  });

  it("AUTH_CHALLENGE_REQUIRED → not ready, LOGIN_REQUIRED", () => {
    expect(naverSessionPrecondition("AUTH_CHALLENGE_REQUIRED")).toEqual({
      ready: false,
      verdict: "AUTH_CHALLENGE_REQUIRED",
      blockerCode: "LOGIN_REQUIRED",
    });
  });

  it("UNKNOWN → not ready, UNSUPPORTED_STATE", () => {
    expect(naverSessionPrecondition("UNKNOWN")).toEqual({
      ready: false,
      verdict: "UNKNOWN",
      blockerCode: "UNSUPPORTED_STATE",
    });
  });

  it("only LOGGED_IN is ready — every other verdict fails closed with a reserved code", () => {
    const verdicts: SessionVerdict[] = [
      "LOGGED_IN",
      "RECONNECT_REQUIRED",
      "ACCOUNT_LOGIN_REQUIRED",
      "AUTH_CHALLENGE_REQUIRED",
      "UNKNOWN",
    ];
    for (const v of verdicts) {
      const p = naverSessionPrecondition(v);
      expect(p.ready).toBe(v === "LOGGED_IN");
      if (!p.ready) {
        expect(["SESSION_EXPIRED", "LOGIN_REQUIRED", "UNSUPPORTED_STATE"]).toContain(p.blockerCode);
      }
    }
  });
});

describe("naverSurfaceBlockerFor — the reserved-code half of the mapping", () => {
  it("maps each non-logged-in verdict to its reserved SurfaceBlockerCode", () => {
    expect(naverSurfaceBlockerFor("RECONNECT_REQUIRED")).toBe("SESSION_EXPIRED");
    expect(naverSurfaceBlockerFor("ACCOUNT_LOGIN_REQUIRED")).toBe("LOGIN_REQUIRED");
    expect(naverSurfaceBlockerFor("AUTH_CHALLENGE_REQUIRED")).toBe("LOGIN_REQUIRED");
    expect(naverSurfaceBlockerFor("UNKNOWN")).toBe("UNSUPPORTED_STATE");
  });

  it("defensively maps LOGGED_IN to UNSUPPORTED_STATE (never invoked on the ready branch)", () => {
    expect(naverSurfaceBlockerFor("LOGGED_IN")).toBe("UNSUPPORTED_STATE");
  });
});
