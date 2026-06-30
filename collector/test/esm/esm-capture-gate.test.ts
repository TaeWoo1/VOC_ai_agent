import { describe, expect, it } from "vitest";
import {
  capturePreconditionMet,
  captureSessionGate,
  classifyFileStructure,
  classifyPostClickOutcome,
  decideApprovedCapture,
  parseApprovedIndexArg,
  postClickStop,
  type PostClickObservation,
  type SanitizedFrameCandidate,
} from "../../src/esm/esm-capture-gate";
import type { FrameAwareExportScan, ScopeCandidateBuckets } from "../../src/esm/esm-frame-scan";

// ---- helpers -------------------------------------------------------------

const buckets = (o: Partial<ScopeCandidateBuckets> = {}): ScopeCandidateBuckets => ({
  total: "none",
  visible: "none",
  enabled: "none",
  actionable: "none",
  ...o,
});

/** A run-#4-shaped scan: one actionable export control inside one allowlisted frame. */
function scan(over: Partial<FrameAwareExportScan> = {}): FrameAwareExportScan {
  return {
    frameCount: "few",
    frameUrlCategories: ["seller-center"],
    skippedFrameCount: "none",
    allowlistedFrameCount: "one",
    topDocument: buckets({ total: "few", enabled: "few" }),
    frames: [
      {
        frameUrlCategory: "seller-center",
        readResult: "read",
        allowlisted: true,
        candidates: buckets({ total: "one", visible: "one", enabled: "one", actionable: "one" }),
      },
    ],
    hasActionableExportCandidate: true,
    actionableScope: "allowlisted-frame",
    ...over,
  };
}

const cand = (o: Partial<SanitizedFrameCandidate> & { index: number }): SanitizedFrameCandidate => ({
  category: "export-like",
  visible: true,
  enabled: true,
  actionable: true,
  ...o,
});

// ---- captureSessionGate --------------------------------------------------

describe("captureSessionGate", () => {
  it("LOGGED_IN proceeds", () => {
    expect(captureSessionGate("LOGGED_IN")).toEqual({ proceed: true, stop: null });
  });
  it("ACCOUNT_LOGIN_REQUIRED → no-login", () => {
    expect(captureSessionGate("ACCOUNT_LOGIN_REQUIRED")).toEqual({ proceed: false, stop: "no-login" });
  });
  it("AUTH_CHALLENGE_REQUIRED → auth-challenge", () => {
    expect(captureSessionGate("AUTH_CHALLENGE_REQUIRED")).toEqual({ proceed: false, stop: "auth-challenge" });
  });
  it("RECONNECT_REQUIRED / UNKNOWN → session-not-usable", () => {
    expect(captureSessionGate("RECONNECT_REQUIRED").stop).toBe("session-not-usable");
    expect(captureSessionGate("UNKNOWN").stop).toBe("session-not-usable");
  });
});

// ---- capturePreconditionMet ----------------------------------------------

describe("capturePreconditionMet", () => {
  it("run-#4 shape proceeds", () => {
    expect(capturePreconditionMet(scan())).toEqual({ proceed: true, stop: null });
  });
  it("not actionable → not-actionable", () => {
    expect(capturePreconditionMet(scan({ hasActionableExportCandidate: false })).stop).toBe("not-actionable");
  });
  it("scope not allowlisted-frame → scope-not-allowlisted-frame", () => {
    expect(capturePreconditionMet(scan({ actionableScope: "top-document" })).stop).toBe("scope-not-allowlisted-frame");
    expect(capturePreconditionMet(scan({ actionableScope: "same-origin-frame" })).stop).toBe("scope-not-allowlisted-frame");
  });
  it("more than one actionable in the allowlisted frame → actionable-count-not-one", () => {
    const s = scan();
    s.frames[0]!.candidates = buckets({ total: "few", visible: "few", enabled: "few", actionable: "few" });
    expect(capturePreconditionMet(s).stop).toBe("actionable-count-not-one");
  });
  it("two allowlisted actionable frames → actionable-count-not-one", () => {
    const s = scan();
    s.frames.push({
      frameUrlCategory: "seller-center",
      readResult: "read",
      allowlisted: true,
      candidates: buckets({ total: "one", visible: "one", enabled: "one", actionable: "one" }),
    });
    expect(capturePreconditionMet(s).stop).toBe("actionable-count-not-one");
  });
});

// ---- decideApprovedCapture ----------------------------------------------

describe("decideApprovedCapture", () => {
  const one = [cand({ index: 0 })];

  it("approved index that is the single actionable export candidate → proceed", () => {
    expect(decideApprovedCapture(one, 0)).toEqual({ proceed: true, stop: null });
  });
  it("missing approved index → approved-index-missing", () => {
    expect(decideApprovedCapture(one, null).stop).toBe("approved-index-missing");
  });
  it("a consent-like candidate present (not approved) → consent-prompt-present", () => {
    const withConsent = [cand({ index: 0 }), cand({ index: 1, category: "consent-like" })];
    expect(decideApprovedCapture(withConsent, 0).stop).toBe("consent-prompt-present");
  });
  it("approved index out of range → approved-index-out-of-range", () => {
    expect(decideApprovedCapture(one, 5).stop).toBe("approved-index-out-of-range");
  });
  it("zero actionable candidates → no-actionable-candidate", () => {
    const none = [cand({ index: 0, enabled: false, actionable: false })];
    expect(decideApprovedCapture(none, 0).stop).toBe("no-actionable-candidate");
  });
  it("multiple actionable candidates → multiple-actionable-candidates", () => {
    const many = [cand({ index: 0 }), cand({ index: 1 })];
    expect(decideApprovedCapture(many, 0).stop).toBe("multiple-actionable-candidates");
  });
  it("approved index points at a non-actionable candidate → approved-index-not-actionable", () => {
    const mixed = [cand({ index: 0, visible: false, actionable: false }), cand({ index: 1 })];
    expect(decideApprovedCapture(mixed, 0).stop).toBe("approved-index-not-actionable");
  });
});

// ---- classifyPostClickOutcome + postClickStop ---------------------------

describe("classifyPostClickOutcome", () => {
  const obs = (o: Partial<PostClickObservation> = {}): PostClickObservation => ({
    downloadFired: false,
    consentOrDialogAppeared: false,
    asyncJobAppeared: false,
    timedOut: false,
    ...o,
  });

  it("a download wins over everything", () => {
    expect(classifyPostClickOutcome(obs({ downloadFired: true, consentOrDialogAppeared: true }))).toBe("download-fired");
  });
  it("consent/dialog before async/timeout", () => {
    expect(classifyPostClickOutcome(obs({ consentOrDialogAppeared: true, asyncJobAppeared: true, timedOut: true }))).toBe(
      "consent-prompt-present",
    );
  });
  it("async before timeout", () => {
    expect(classifyPostClickOutcome(obs({ asyncJobAppeared: true, timedOut: true }))).toBe("async-observed");
  });
  it("timeout when the click fired but no download arrived", () => {
    expect(classifyPostClickOutcome(obs({ timedOut: true }))).toBe("download-timeout");
  });
  it("no-download-event when nothing happened", () => {
    expect(classifyPostClickOutcome(obs())).toBe("no-download-event");
  });

  it("postClickStop maps each non-download outcome to its stop", () => {
    expect(postClickStop("consent-prompt-present")).toBe("consent-prompt-present");
    expect(postClickStop("async-observed")).toBe("async-observed");
    expect(postClickStop("download-timeout")).toBe("download-timeout");
    expect(postClickStop("no-download-event")).toBe("no-download-event");
  });
});

// ---- classifyFileStructure ----------------------------------------------

describe("classifyFileStructure (structural only — no row parsing)", () => {
  it("xlsx + magic ok → xlsx-valid", () => {
    expect(classifyFileStructure("xlsx", true)).toBe("xlsx-valid");
  });
  it("xlsx category but magic fails → unrecognized", () => {
    expect(classifyFileStructure("xlsx", false)).toBe("unrecognized");
  });
  it("csv category → csv-category (no magic exists for csv)", () => {
    expect(classifyFileStructure("csv", false)).toBe("csv-category");
  });
  it("unknown → unrecognized", () => {
    expect(classifyFileStructure("unknown", false)).toBe("unrecognized");
  });
});

// ---- parseApprovedIndexArg ----------------------------------------------

describe("parseApprovedIndexArg", () => {
  it("--approved-index 2", () => {
    expect(parseApprovedIndexArg(["--approved-index", "2"])).toBe(2);
  });
  it("--approved-index=0", () => {
    expect(parseApprovedIndexArg(["--approved-index=0"])).toBe(0);
  });
  it("absent → null", () => {
    expect(parseApprovedIndexArg(["--i-understand-this-opens-live-esm"])).toBeNull();
  });
  it("malformed / negative / non-numeric → null", () => {
    expect(parseApprovedIndexArg(["--approved-index", "two"])).toBeNull();
    expect(parseApprovedIndexArg(["--approved-index", "-1"])).toBeNull();
    expect(parseApprovedIndexArg(["--approved-index"])).toBeNull();
  });
});

// ---- sanitization: results carry no DOM text ----------------------------

describe("gate results are sanitized (no text leak)", () => {
  it("serialized decisions contain only enums / indices / booleans", () => {
    const serialized = JSON.stringify([
      captureSessionGate("LOGGED_IN"),
      capturePreconditionMet(scan()),
      decideApprovedCapture([cand({ index: 0 })], 0),
      classifyPostClickOutcome({ downloadFired: true, consentOrDialogAppeared: false, asyncJobAppeared: false, timedOut: false }),
      classifyFileStructure("xlsx", true),
    ]);
    expect(/[가-힣]/.test(serialized)).toBe(false);
    expect(serialized).not.toContain("http");
  });
});
