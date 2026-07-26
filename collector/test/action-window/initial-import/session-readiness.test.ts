import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearLogSink, getLogSink } from "../../../src/log";
import type { SessionVerdict, SessionVerdictInput } from "../../../src/naver/session-verdict";
import type { SessionReadinessState } from "../../../../contracts/session-readiness/v1/index";
import { JourneyShadow } from "../../../src/action-window/initial-import/journey-shadow";
import type { JourneyObservation } from "../../../src/action-window/initial-import/journey-projection";
import type { JourneyProjectionPort } from "../../../src/action-window/initial-import/journey-ports";
import {
  NAVER_CHANNEL_CODE,
  SessionReadinessProbe,
  SessionReadinessProjector,
  naverVerdictToReadiness,
} from "../../../src/action-window/initial-import/session-readiness";

/** A capture port so a test can watch exactly what a probe projects. */
function capturePort(): { port: JourneyProjectionPort; seen: JourneyObservation[] } {
  const seen: JourneyObservation[] = [];
  return { port: { observe: (o) => void seen.push(o as JourneyObservation) }, seen };
}

/** Sanitized signals a live probe would derive; here handcrafted per verdict. `LOGGED_IN` shape by default. */
function signals(over: Partial<SessionVerdictInput> = {}): SessionVerdictInput {
  return {
    isSellerCenterUrl: true,
    passwordFieldPresent: false,
    authChallengePresent: false,
    menuOrGnbPresent: true,
    logoutAffordancePresent: false,
    exportCandidatesPresent: false,
    accountReconnectAffordancePresent: false,
    ...over,
  };
}

describe("naverVerdictToReadiness — the NAVER verdict → neutral readiness map", () => {
  it("is a faithful, total rename of every verdict", () => {
    const table: Array<[SessionVerdict, SessionReadinessState]> = [
      ["LOGGED_IN", "READY"],
      ["ACCOUNT_LOGIN_REQUIRED", "LOGIN_REQUIRED"],
      ["AUTH_CHALLENGE_REQUIRED", "TWO_FACTOR_REQUIRED"],
      ["RECONNECT_REQUIRED", "ACCOUNT_AMBIGUOUS"],
      ["UNKNOWN", "EXPIRED"],
    ];
    for (const [verdict, state] of table) expect(naverVerdictToReadiness(verdict)).toBe(state);
  });
});

describe("SessionReadinessProbe — observe-only classification + projection", () => {
  beforeEach(() => clearLogSink());
  afterEach(() => clearLogSink());

  it("classifies a usable session as READY and projects a sanitized readiness observation", () => {
    const { port, seen } = capturePort();
    const state = new SessionReadinessProbe(port).probeNaver(signals(), "AGENT_START");
    expect(state).toBe("READY");
    expect(seen).toEqual([
      { kind: "session_readiness", channelCode: "naver", state: "READY", reason: "AGENT_START" },
    ]);
  });

  it("maps a real login form → LOGIN_REQUIRED and an auth challenge → TWO_FACTOR_REQUIRED", () => {
    const { port, seen } = capturePort();
    const probe = new SessionReadinessProbe(port);
    expect(probe.probeNaver(signals({ passwordFieldPresent: true, menuOrGnbPresent: false }), "BEFORE_WORK")).toBe(
      "LOGIN_REQUIRED",
    );
    expect(probe.probeNaver(signals({ authChallengePresent: true }), "SESSION_FAILURE")).toBe(
      "TWO_FACTOR_REQUIRED",
    );
    expect(seen.map((o) => (o as { state: string }).state)).toEqual(["LOGIN_REQUIRED", "TWO_FACTOR_REQUIRED"]);
  });

  it("maps a Commerce reconnect interstitial → ACCOUNT_AMBIGUOUS and an unconfirmed page → EXPIRED", () => {
    const { port } = capturePort();
    const probe = new SessionReadinessProbe(port);
    expect(
      probe.probeNaver(signals({ isSellerCenterUrl: false, menuOrGnbPresent: false, accountReconnectAffordancePresent: true }), "MANUAL_RECHECK"),
    ).toBe("ACCOUNT_AMBIGUOUS");
    expect(probe.probeNaver(signals({ isSellerCenterUrl: false, menuOrGnbPresent: false }), "MANUAL_RECHECK")).toBe(
      "EXPIRED",
    );
  });

  it("projects UNOBSERVED_EXTERNAL for a channel it did not observe — never inferred as ready", () => {
    const { port, seen } = capturePort();
    new SessionReadinessProbe(port, "coupang").probeUnobserved("AGENT_START");
    expect(seen).toEqual([
      { kind: "session_readiness", channelCode: "coupang", state: "UNOBSERVED_EXTERNAL", reason: "AGENT_START" },
    ]);
  });

  it("logs only sanitized enums — no token, cookie, seller id, URL, or page text", () => {
    const { port } = capturePort();
    new SessionReadinessProbe(port).probeNaver(signals({ passwordFieldPresent: true, menuOrGnbPresent: false }), "BEFORE_WORK");
    const entries = getLogSink().filter((e) => e.event === "readiness_probe");
    expect(entries).toHaveLength(1);
    // The logger drops secret-ish keys; assert positively that only the whitelist survived.
    expect(Object.keys(entries[0]!.meta).sort()).toEqual(["channelCode", "readiness", "reason"]);
    expect(entries[0]!.meta).toEqual({ channelCode: "naver", readiness: "LOGIN_REQUIRED", reason: "BEFORE_WORK" });
  });
});

describe("SessionReadinessProjector — headless projection through the port", () => {
  it("records the latest readiness per channel and offers the single action, with no FE", () => {
    const projector = new SessionReadinessProjector();
    const naver = new SessionReadinessProbe(projector, NAVER_CHANNEL_CODE);
    const coupang = new SessionReadinessProbe(projector, "coupang");

    naver.probeNaver(signals(), "AGENT_START"); // READY
    coupang.probeUnobserved("AGENT_START"); // UNOBSERVED_EXTERNAL
    naver.probeNaver(signals({ passwordFieldPresent: true, menuOrGnbPresent: false }), "SESSION_FAILURE"); // latest wins

    expect(projector.current("naver").state).toBe("LOGIN_REQUIRED");
    expect(projector.singleAction("naver")).toBe("LOG_IN");
    expect(projector.current("coupang").state).toBe("UNOBSERVED_EXTERNAL");
    expect(projector.singleAction("coupang")).toBe("NONE");
    expect(projector.snapshot().map((o) => o.channelCode).sort()).toEqual(["coupang", "naver"]);
  });

  it("defaults an unseen channel to UNOBSERVED_EXTERNAL — a not-seen, never a guessed READY", () => {
    const projector = new SessionReadinessProjector();
    expect(projector.current("cafe24").state).toBe("UNOBSERVED_EXTERNAL");
    expect(projector.singleAction("cafe24")).toBe("NONE");
  });

  it("ignores non-readiness signals on the shared stream", () => {
    const projector = new SessionReadinessProjector();
    projector.observe({ kind: "run_status", status: "RUNNING" });
    projector.observe({ kind: "auth", orgExists: true });
    expect(projector.snapshot()).toHaveLength(0);
  });
});

describe("readiness rides the port without disturbing the journey shadow", () => {
  it("a readiness observation is dropped by the journey shadow — it never moves the phase or diverges", async () => {
    const shadow = new JourneyShadow("readiness-coexist", "UNOBSERVED_EXTERNAL");
    await shadow.observe({ kind: "session_readiness", channelCode: "naver", state: "LOGIN_REQUIRED", reason: "AGENT_START" });
    await shadow.whenIdle();
    expect(shadow.currentPhase()).toBe("UNOBSERVED_EXTERNAL");
    expect(shadow.divergenceCount()).toBe(0);
  });
});
