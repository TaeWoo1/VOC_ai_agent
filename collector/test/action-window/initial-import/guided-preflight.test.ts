import { describe, expect, it } from "vitest";
import {
  checkGuidedPreflight,
  originOf,
  PREFLIGHT_RECOVERY,
} from "../../../src/action-window/initial-import/guided-preflight";

describe("guided pre-flight self-check (pure)", () => {
  const ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

  it("passes when the backend is up, the allow-list is set, and the app origin is in it", () => {
    const r = checkGuidedPreflight({ appUrl: "http://localhost:5173", allowedOrigins: ORIGINS, backendReachable: true });
    expect(r).toEqual({ ok: true, issues: [] });
  });

  it("catches the :5174 vs :5173 gotcha — the app origin the bridge will reject", () => {
    const r = checkGuidedPreflight({ appUrl: "http://localhost:5174", allowedOrigins: ORIGINS, backendReachable: true });
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual(["APP_ORIGIN_NOT_ALLOWED"]);
  });

  it("reports an empty allow-list as BRIDGE_ORIGINS_EMPTY, not as an origin mismatch", () => {
    const r = checkGuidedPreflight({ appUrl: "http://localhost:5173", allowedOrigins: [], backendReachable: true });
    expect(r.issues).toEqual(["BRIDGE_ORIGINS_EMPTY"]);
  });

  it("reports an unreachable backend first, then the origin problem — connectivity before wiring", () => {
    const r = checkGuidedPreflight({ appUrl: "http://localhost:5174", allowedOrigins: ORIGINS, backendReachable: false });
    expect(r.issues).toEqual(["BACKEND_UNREACHABLE", "APP_ORIGIN_NOT_ALLOWED"]);
  });

  it("does not raise a false origin alarm for an un-parseable app URL (fails closed toward silence)", () => {
    const r = checkGuidedPreflight({ appUrl: "not a url", allowedOrigins: ORIGINS, backendReachable: true });
    expect(r.issues).not.toContain("APP_ORIGIN_NOT_ALLOWED");
    expect(r.ok).toBe(true);
  });

  it("compares by origin, so a path or trailing slash on the app URL still matches", () => {
    const r = checkGuidedPreflight({ appUrl: "http://localhost:5173/imports", allowedOrigins: ORIGINS, backendReachable: true });
    expect(r.ok).toBe(true);
  });

  it("gives every issue exactly one recovery action", () => {
    for (const issue of ["BACKEND_UNREACHABLE", "BRIDGE_ORIGINS_EMPTY", "APP_ORIGIN_NOT_ALLOWED"] as const) {
      expect(PREFLIGHT_RECOVERY[issue]).toBeTruthy();
    }
  });

  it("originOf returns null for garbage rather than throwing", () => {
    expect(originOf("http://localhost:5173")).toBe("http://localhost:5173");
    expect(originOf("::::")).toBeNull();
  });
});
