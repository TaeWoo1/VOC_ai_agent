/**
 * The import acquisition coordinator is the live-boot seam that puts the Acquisition Supervisor in front of the
 * import runtime. These pin the four probe moments, the probe-permissive admission, the faithful reason
 * mapping, and the sanitized surface — all offline, with no browser and no host.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearLogSink, getLogSink } from "../../../src/log";
import type { SurfaceProbeResult } from "../../../src/action-window/engine";
import {
  ImportAcquisitionCoordinator,
  surfaceReadingToReadiness,
} from "../../../src/action-window/initial-import/import-acquisition-coordinator";

const FORBIDDEN = ["token", "password", "passwd", "cookie", "authorization", "secret", "credential", "session"];
const blocked = (blockerCode?: SurfaceProbeResult["blockerCode"]): SurfaceProbeResult => ({ ok: false, ...(blockerCode ? { blockerCode } : {}) });

beforeEach(() => clearLogSink());
afterEach(() => clearLogSink());

describe("surfaceReadingToReadiness — coarse surface reading → readiness, or nothing", () => {
  it("maps a usable surface to READY", () => {
    expect(surfaceReadingToReadiness(true)).toBe("READY");
    expect(surfaceReadingToReadiness({ ok: true })).toBe("READY");
  });

  it("maps the two recoverable session blockers to their readiness states", () => {
    expect(surfaceReadingToReadiness(blocked("LOGIN_REQUIRED"))).toBe("LOGIN_REQUIRED");
    expect(surfaceReadingToReadiness(blocked("SESSION_EXPIRED"))).toBe("EXPIRED");
  });

  it("says NOTHING for a reading that is not about session usability (never guesses an auth state)", () => {
    // A bare false, an UNSUPPORTED_STATE, and a codeless block are all "not a usable review surface" — not a
    // login/2FA/account problem, so there is no single readiness action to offer and the coordinator is silent.
    expect(surfaceReadingToReadiness(false)).toBeNull();
    expect(surfaceReadingToReadiness(blocked("UNSUPPORTED_STATE"))).toBeNull();
    expect(surfaceReadingToReadiness(blocked())).toBeNull();
  });
});

describe("ImportAcquisitionCoordinator — adapter binding", () => {
  it("binds NAVER × REVIEW to the Action Window import adapter", () => {
    expect(new ImportAcquisitionCoordinator("naver").adapterId()).toBe("NAVER_ACTION_WINDOW_IMPORT");
  });

  it("binds NONE for a channel §4.1 has not integrated (fail closed by omission)", () => {
    expect(new ImportAcquisitionCoordinator("coupang").adapterId()).toBe("NONE");
  });
});

describe("ImportAcquisitionCoordinator — AGENT_START", () => {
  it("records the channel as UNOBSERVED_EXTERNAL at boot, never a guessed READY", () => {
    const coord = new ImportAcquisitionCoordinator("naver");
    coord.onAgentStart();
    expect(coord.readiness()).toBe("UNOBSERVED_EXTERNAL");
    const probe = getLogSink().find((e) => e.event === "readiness_probe");
    expect(probe?.meta).toMatchObject({ channelCode: "naver", readiness: "UNOBSERVED_EXTERNAL", reason: "AGENT_START" });
  });
});

describe("ImportAcquisitionCoordinator — BEFORE_WORK admission is probe-permissive", () => {
  it("admits a bound adapter even when readiness is still unobserved (the run's PREPARE is the real gate)", () => {
    const coord = new ImportAcquisitionCoordinator("naver");
    coord.onAgentStart(); // UNOBSERVED
    const admission = coord.admitSegment();
    expect(admission).toEqual({ admit: true, decision: "HOLD_UNOBSERVED", adapter: "NAVER_ACTION_WINDOW_IMPORT" });
  });

  it("admits (decision DISPATCH) once a run has read the session as READY", () => {
    const coord = new ImportAcquisitionCoordinator("naver");
    coord.observeSurfaceReading(true); // a run's PREPARE saw a usable session
    expect(coord.admitSegment()).toEqual({ admit: true, decision: "DISPATCH", adapter: "NAVER_ACTION_WINDOW_IMPORT" });
  });

  it("still admits after a known not-ready readiness — refusing would deadlock recovery", () => {
    const coord = new ImportAcquisitionCoordinator("naver");
    coord.observeSurfaceReading(blocked("LOGIN_REQUIRED"));
    const admission = coord.admitSegment();
    // The supervisor decision reflects the stale not-ready reading (ASK_SELLER), but the run is still admitted:
    // only the run's own PREPARE can refresh readiness, so the retry must be allowed to run and re-check.
    expect(admission.admit).toBe(true);
    expect(admission.decision).toBe("ASK_SELLER");
  });

  it("REFUSES when no adapter is bound for the channel (adapterId === NONE)", () => {
    const coord = new ImportAcquisitionCoordinator("coupang");
    coord.observeSurfaceReading(true); // even a READY session cannot make an un-integrated capability runnable
    expect(coord.admitSegment()).toEqual({ admit: false, decision: "HOLD_UNSUPPORTED", adapter: "NONE" });
  });
});

describe("ImportAcquisitionCoordinator — readiness from a run's surface reading, with the faithful reason", () => {
  it("a usable first reading is BEFORE_WORK", () => {
    const coord = new ImportAcquisitionCoordinator("naver");
    expect(coord.observeSurfaceReading(true)).toBe("READY");
    const probe = getLogSink().filter((e) => e.event === "readiness_probe").at(-1);
    expect(probe?.meta).toMatchObject({ readiness: "READY", reason: "BEFORE_WORK" });
  });

  it("a not-usable reading is SESSION_FAILURE and offers the readiness contract's single action", () => {
    const coord = new ImportAcquisitionCoordinator("naver");
    expect(coord.observeSurfaceReading(blocked("LOGIN_REQUIRED"))).toBe("LOGIN_REQUIRED");
    expect(coord.singleAction()).toBe("LOG_IN");
    const probe = getLogSink().filter((e) => e.event === "readiness_probe").at(-1);
    expect(probe?.meta).toMatchObject({ readiness: "LOGIN_REQUIRED", reason: "SESSION_FAILURE" });
  });

  it("a usable reading AFTER a prior not-ready one is MANUAL_RECHECK (the seller fixed it and retried)", () => {
    const coord = new ImportAcquisitionCoordinator("naver");
    coord.observeSurfaceReading(blocked("SESSION_EXPIRED")); // a run failed on the session
    expect(coord.observeSurfaceReading(true)).toBe("READY"); // the seller logged in, a retry re-checks
    const probe = getLogSink().filter((e) => e.event === "readiness_probe").at(-1);
    expect(probe?.meta).toMatchObject({ readiness: "READY", reason: "MANUAL_RECHECK" });
  });

  it("records nothing and leaves readiness untouched for a non-session reading", () => {
    const coord = new ImportAcquisitionCoordinator("naver");
    coord.observeSurfaceReading(true); // READY
    expect(coord.observeSurfaceReading(blocked("UNSUPPORTED_STATE"))).toBeNull();
    expect(coord.readiness()).toBe("READY"); // unchanged — the engine owns UNSUPPORTED_STATE
  });
});

describe("ImportAcquisitionCoordinator — sanitized surface", () => {
  it("logs only enums, never an account slot or a forbidden-substring key", () => {
    const coord = new ImportAcquisitionCoordinator("naver");
    coord.onAgentStart();
    coord.observeSurfaceReading(blocked("LOGIN_REQUIRED"));
    coord.admitSegment();
    const events = getLogSink();
    expect(events.some((e) => e.event === "acquisition_admit")).toBe(true);
    expect(events.some((e) => e.event === "acquisition_decision")).toBe(true);
    for (const e of events) {
      for (const key of Object.keys(e.meta)) {
        expect(FORBIDDEN.some((f) => key.toLowerCase().includes(f))).toBe(false);
        expect(key).not.toBe("accountKey");
      }
      // Every value on these lines is a scalar enum/boolean — never an object that could carry raw data.
      for (const value of Object.values(e.meta)) {
        expect(["string", "boolean", "number"]).toContain(typeof value);
      }
    }
  });
});
