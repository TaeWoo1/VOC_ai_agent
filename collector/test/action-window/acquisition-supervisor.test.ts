import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { clearLogSink, getLogSink } from "../../src/log";
import type { SessionVerdictInput } from "../../src/naver/session-verdict";
import { SessionReadinessProbe, SessionReadinessProjector } from "../../src/action-window/initial-import/session-readiness";
import {
  ACQUISITION_MATRIX,
  AcquisitionSupervisor,
  selectAdapterId,
} from "../../src/action-window/acquisition-supervisor";

/** Sanitized signals a live probe would derive. `LOGGED_IN` shape by default; overrides flip a verdict. */
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

const LOGIN_REQUIRED = signals({ passwordFieldPresent: true, menuOrGnbPresent: false });

describe("AcquisitionSupervisor — the (channel × capability) → mode matrix reflects §4.1", () => {
  const supervisor = new AcquisitionSupervisor(new SessionReadinessProjector());

  it("NAVER REVIEW resolves to the Action Window import the collector already drives", () => {
    expect(supervisor.plan("naver", "REVIEW")).toMatchObject({ mode: "ACTION_WINDOW", checkpoint: "MARKETPLACE_ACTION" });
  });

  it("NAVER ORDER_SUMMARY resolves to the official-API mode with PULL delivery", () => {
    expect(supervisor.plan("naver", "ORDER_SUMMARY")).toMatchObject({
      mode: "AUTOMATIC_OPERATION",
      delivery: "PULL",
      checkpoint: "APPROVAL",
    });
  });

  it("an unverified (channel, capability) fails closed to INTEGRATION_PENDING — the matrix never guesses", () => {
    expect(supervisor.plan("coupang", "REVIEW").mode).toBe("INTEGRATION_PENDING");
    expect(supervisor.plan("naver", "REPLY_SUBMISSION").mode).toBe("INTEGRATION_PENDING");
    expect(supervisor.plan("naver", "INQUIRY").mode).toBe("INTEGRATION_PENDING");
  });

  it("the shipped matrix carries only rows §4.1 has verified (nothing speculative)", () => {
    expect(ACQUISITION_MATRIX.map((r) => `${r.channelCode}/${r.capability}`).sort()).toEqual([
      "naver/ORDER_SUMMARY",
      "naver/REVIEW",
    ]);
  });
});

describe("AcquisitionSupervisor — readiness gate", () => {
  beforeEach(() => clearLogSink());
  afterEach(() => clearLogSink());

  function supervisorSeeing(observe: (probe: (channel: string) => SessionReadinessProbe) => void): AcquisitionSupervisor {
    const projector = new SessionReadinessProjector();
    observe((channel) => new SessionReadinessProbe(projector, channel));
    return new AcquisitionSupervisor(projector);
  }

  it("dispatches an integrated capability only when the session is READY", () => {
    const sup = supervisorSeeing((probe) => probe("naver").probeNaver(signals(), "AGENT_START"));
    expect(sup.decide("naver", "REVIEW")).toMatchObject({ kind: "DISPATCH" });
  });

  it("asks the seller for exactly one thing when the session is not READY, and does not dispatch", () => {
    const sup = supervisorSeeing((probe) => probe("naver").probeNaver(LOGIN_REQUIRED, "BEFORE_WORK"));
    expect(sup.decide("naver", "REVIEW")).toMatchObject({ kind: "ASK_SELLER", action: "LOG_IN" });
  });

  it("holds an unobserved channel — never inferred as ready", () => {
    const sup = new AcquisitionSupervisor(new SessionReadinessProjector());
    expect(sup.decide("naver", "REVIEW")).toMatchObject({ kind: "HOLD_UNOBSERVED" });
  });

  it("holds an un-integrated capability as UNSUPPORTED even when the session is READY (fail closed first)", () => {
    const sup = supervisorSeeing((probe) => probe("coupang").probeNaver(signals(), "AGENT_START"));
    expect(sup.decide("coupang", "REVIEW")).toMatchObject({ kind: "HOLD_UNSUPPORTED" });
  });

  it("keeps two accounts on one channel apart — one slot ready, one not, decided independently", () => {
    const projector = new SessionReadinessProjector();
    new SessionReadinessProbe(projector, "naver", "slot-a").probeNaver(signals(), "AGENT_START");
    new SessionReadinessProbe(projector, "naver", "slot-b").probeNaver(LOGIN_REQUIRED, "AGENT_START");
    const sup = new AcquisitionSupervisor(projector);
    expect(sup.decide("naver", "REVIEW", "slot-a")).toMatchObject({ kind: "DISPATCH" });
    expect(sup.decide("naver", "REVIEW", "slot-b")).toMatchObject({ kind: "ASK_SELLER", action: "LOG_IN" });
  });

  it("logs only sanitized enums — no account slot, token, cookie, id, or URL", () => {
    const projector = new SessionReadinessProjector();
    new SessionReadinessProbe(projector, "naver", "slot-a").probeNaver(signals(), "AGENT_START");
    new AcquisitionSupervisor(projector).decide("naver", "REVIEW", "slot-a");
    const entries = getLogSink().filter((e) => e.event === "acquisition_decision");
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0]!.meta).sort()).toEqual(["capability", "channelCode", "decision", "mode"]);
    expect(entries[0]!.meta).toEqual({ channelCode: "naver", capability: "REVIEW", mode: "ACTION_WINDOW", decision: "DISPATCH" });
  });
});

describe("AcquisitionSupervisor — adapter selection", () => {
  it("selects the existing NAVER Action Window import engine for NAVER REVIEW, and NONE for everything else", () => {
    const sup = new AcquisitionSupervisor(new SessionReadinessProjector());
    expect(sup.selectAdapterId("naver", "REVIEW")).toBe("NAVER_ACTION_WINDOW_IMPORT");
    expect(sup.selectAdapterId("naver", "ORDER_SUMMARY")).toBe("NONE"); // API adapter not built — no fake capability
    expect(sup.selectAdapterId("coupang", "REVIEW")).toBe("NONE");
  });

  it("selectAdapterId is pure over a plan", () => {
    expect(selectAdapterId({ channelCode: "naver", capability: "REVIEW", mode: "ACTION_WINDOW", checkpoint: "MARKETPLACE_ACTION" })).toBe(
      "NAVER_ACTION_WINDOW_IMPORT",
    );
  });
});

describe("naver-acquisition-adapter — composes the existing engine, never re-derives it", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../../src/action-window/naver-acquisition-adapter.ts"), "utf8");
  const codeLines = src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("/*"))
    .join("\n");

  it("imports the existing NaverLiveImportDriver (the preserved engine) rather than defining a new one", () => {
    expect(codeLines).toMatch(/import\s*\{[^}]*NaverLiveImportDriver[^}]*\}\s*from\s*["'][^"']*naver-live-import-driver["']/);
    expect(codeLines).not.toMatch(/class\s+Naver\w*Driver/); // it declares no driver class of its own
  });

  it("holds no engine constants or DOM logic — the wording/consent/frame logic stays in the engine", () => {
    // Any of these leaking into the adapter would mean it re-derived what a live run proved.
    expect(codeLines).not.toMatch(/EXPORT_TARGET_KEYWORDS|EXPORT_CONTEXT_KEYWORDS|ASYNC_JOB_MARKERS/);
    expect(codeLines).not.toMatch(/\.click\(|waitForEvent|querySelector|page\.|\.frames\(/);
  });

  it("is FE-free", () => {
    expect(codeLines).not.toMatch(/from ["']react/i);
    expect(codeLines).not.toMatch(/useState|useEffect|from ["'][^"']*components/i);
  });
});
