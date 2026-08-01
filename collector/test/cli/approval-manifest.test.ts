/**
 * Approval-prerequisite + calibration-phase gate (`src/cli/approval-manifest.ts`).
 *
 * These lock the canonical contract's PREPARED rule: a manifest is built ONLY when the run is immediately
 * executable (URL present + host-screened, exact CLI/driver confirmed, actions within driver capability,
 * env present), and the two calibration phases are separate (observation cannot highlight; the highlight
 * proof needs calibrated selectors). A refusal means: no manifest, no approval request.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  PHASE_SPECS,
  validateApprovalPrerequisites,
  NAVER_API_CENTER_BASE_URL,
  type ApprovalPrereqInput,
} from "../../src/cli/approval-manifest";

const OBS = PHASE_SPECS.API_CENTER_STRUCTURE_OBSERVATION;
const HL = PHASE_SPECS.API_ISSUANCE_HIGHLIGHT_PROOF;

/** A fully-valid Phase-A (observation) input; individual tests override one field to prove a refusal. */
function baseObservation(): ApprovalPrereqInput {
  return {
    phase: OBS.phase,
    channel: "NAVER",
    accountBinding: "operator-owned test store",
    mode: "READ_ONLY",
    apiCenterUrl: NAVER_API_CENTER_BASE_URL,
    cli: OBS.cli,
    driver: OBS.driver,
    declaredActions: OBS.capableActions,
    runId: "wt-testrun0001",
    approvalId: "apr-testappr01",
    gitSha: "abc1234",
    maxActions: "observation only",
    surface: "Commerce API Center",
    operation: "API Center structure observation",
  };
}

function baseHighlight(selectorsCalibrated: boolean): ApprovalPrereqInput {
  return {
    ...baseObservation(),
    phase: HL.phase,
    cli: HL.cli,
    driver: HL.driver,
    declaredActions: HL.capableActions,
    selectorsCalibrated,
    operation: "API issuance highlight proof",
  };
}

describe("approval prerequisites — refuse before a manifest exists", () => {
  it("URL missing → FAIL (no manifest)", () => {
    const r = validateApprovalPrerequisites({ ...baseObservation(), apiCenterUrl: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("MISSING_URL");
  });

  it("invalid host → FAIL (no manifest)", () => {
    const r = validateApprovalPrerequisites({ ...baseObservation(), apiCenterUrl: "https://evil.example.com/api" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("INVALID_HOST");
  });

  it("CLI/driver unconfirmed → FAIL", () => {
    expect(validateApprovalPrerequisites({ ...baseObservation(), cli: undefined }).ok).toBe(false);
    const r = validateApprovalPrerequisites({ ...baseObservation(), driver: "some-other-driver" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("CLI_DRIVER_UNCONFIRMED");
  });

  it("missing required env → FAIL", () => {
    const r = validateApprovalPrerequisites({ ...baseObservation(), missingEnv: ["NAVER_API_CENTER_URL"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("MISSING_ENV");
  });

  it("unknown phase → FAIL", () => {
    const r = validateApprovalPrerequisites({ ...baseObservation(), phase: "NOT_A_PHASE" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("UNKNOWN_PHASE");
  });

  it("mode not matching the phase → FAIL", () => {
    const r = validateApprovalPrerequisites({ ...baseObservation(), mode: "WRITE" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("MODE_MISMATCH");
  });

  it("a declared action beyond the phase's capability → FAIL", () => {
    // OBSERVE_USER_CLICK_TRANSITION is a real action but NOT in the observer phase's capability.
    const r = validateApprovalPrerequisites({
      ...baseObservation(),
      declaredActions: [...OBS.capableActions, "OBSERVE_USER_CLICK_TRANSITION"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("ACTION_CAPABILITY_MISMATCH");
  });

  it("a raw-id-shaped account binding → FAIL (sanitized description only) — guarded in the gate itself", () => {
    for (const raw of ["12345678", "a1b2c3d4e5f60718", "A1B2C3D4E5F60718AB"]) {
      const r = validateApprovalPrerequisites({ ...baseObservation(), accountBinding: raw });
      expect(r.ok, raw).toBe(false);
      if (!r.ok) expect(r.cause).toBe("RAW_ACCOUNT_ID");
    }
    // A store display name / phrase passes.
    expect(validateApprovalPrerequisites({ ...baseObservation(), accountBinding: "전선몰딩 (test)" }).ok).toBe(true);
  });

  it('unbound identity (empty / "unknown" runId/approvalId/gitSha) → FAIL (not immediately executable)', () => {
    for (const patch of [{ approvalId: "unknown" }, { runId: "" }, { gitSha: "unknown" }]) {
      const r = validateApprovalPrerequisites({ ...baseObservation(), ...patch });
      expect(r.ok, JSON.stringify(patch)).toBe(false);
      if (!r.ok) expect(r.cause).toBe("UNBOUND_IDENTITY");
    }
  });
});

describe("calibration phase separation", () => {
  it("Phase A (observation) declaring a highlight action → FAIL", () => {
    const r = validateApprovalPrerequisites({
      ...baseObservation(),
      declaredActions: [...OBS.capableActions, "HIGHLIGHT_REAL_CONTROL"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("HIGHLIGHT_ACTION_IN_OBSERVATION_PHASE");
  });

  it("Phase A observer manifest is generated normally (no highlight, read-only)", () => {
    const r = validateApprovalPrerequisites(baseObservation());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.phase).toBe("API_CENTER_STRUCTURE_OBSERVATION");
      expect(r.manifest.cli).toBe(OBS.cli);
      expect(r.manifest.mode).toBe("READ_ONLY");
      expect(r.manifest.allowedActions).not.toContain("HIGHLIGHT_REAL_CONTROL");
    }
  });

  it("Phase B highlight manifest is REFUSED until selectors are calibrated", () => {
    const r = validateApprovalPrerequisites(baseHighlight(false));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("SELECTORS_NOT_CALIBRATED");
  });

  it("Phase B highlight manifest is generated ONLY after selector calibration", () => {
    const r = validateApprovalPrerequisites(baseHighlight(true));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.phase).toBe("API_ISSUANCE_HIGHLIGHT_PROOF");
      expect(r.manifest.allowedActions).toContain("HIGHLIGHT_REAL_CONTROL");
      expect(r.manifest.selectorsCalibrated).toBe(true);
    }
  });
});

describe("PREPARED means immediately executable — no further operator input", () => {
  it("a PREPARED manifest is self-contained (every execution value present, raw URL absent)", () => {
    const r = validateApprovalPrerequisites(baseObservation());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = r.manifest;
      // Every value the run needs to execute is on the manifest — so nothing more can be asked after PREPARED.
      for (const v of [m.approvalId, m.walkthroughRunId, m.channel, m.surface, m.operation, m.phase, m.cli, m.driver, m.mode, m.accountBinding, m.apiCenterHost, m.maxActions, m.gitSha]) {
        expect(typeof v === "string" && v.length > 0).toBe(true);
      }
      expect(m.allowedActions.length).toBeGreaterThan(0);
      expect(m.operatorPresenceRequired).toBe(true);
      // Sanitized: the raw URL never enters the manifest — only a host CATEGORY.
      expect(m.apiCenterHost).toBe("api_center_host");
      expect(JSON.stringify(m)).not.toContain("apicenter.commerce.naver.com");
    }
  });
});

describe("no NAVER access to prepare a manifest (pure, offline)", () => {
  it("the module reaches no browser/network — a manifest is built from pure logic", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, "../../src/cli/approval-manifest.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");
    // Network/browser access tokens. (Bare "http" is intentionally NOT listed — the public base-URL constant
    // legitimately contains "https://"; we forbid the IMPORTS/calls that would reach a network or a browser.)
    for (const tok of ["playwright", "launchNaverContext", 'from "node:http', 'from "http', "fetch(", "page.goto", ".evaluate("]) {
      expect(src).not.toContain(tok);
    }
    // And building a manifest is a synchronous pure call (no await / promise) that touches no network.
    const r = validateApprovalPrerequisites(baseObservation());
    expect(r.ok).toBe(true);
  });

  it("the verified public base URL passes host screening (no per-run input needed)", () => {
    const r = validateApprovalPrerequisites({ ...baseObservation(), apiCenterUrl: NAVER_API_CENTER_BASE_URL });
    expect(r.ok).toBe(true);
  });
});
