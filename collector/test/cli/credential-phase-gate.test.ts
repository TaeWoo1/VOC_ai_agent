/**
 * **The credential interlock in the approval gate.**
 *
 * Every phase before this one promised, in the list the gate validates, that no value crosses the boundary. The
 * handoff phase does not, and the manifest has to say so in a way a caller cannot soften — because the operator's
 * grant is given against those words.
 *
 * Two directions, and the second is the one that matters:
 *
 *  - a READ_ONLY phase may not declare an action that touches a credential value
 *  - a CREDENTIAL_READ phase MUST declare both of them, so a run cannot carry the alarming mode and a
 *    reassuring action list
 */
import { describe, expect, it } from "vitest";
import {
  CALIBRATION_PHASES,
  CREDENTIAL_VALUE_ACTIONS,
  PHASE_ENTRYPOINTS,
  PHASE_SPECS,
  WING_PHASES,
  isWingCalibrationPhase,
  validateApprovalPrerequisites,
  type ApprovalAction,
  type ApprovalPrereqInput,
} from "../../src/cli/approval-manifest";
import { WING_DEFAULT_URL } from "../../src/cli/coupang-wing-classifier";
import { WING_CREDENTIAL_CELLS_CALIBRATED } from "../../src/action-window/coupang-wing-credential-cells";

const HANDOFF = PHASE_SPECS.COUPANG_WING_CREDENTIAL_HANDOFF;
const CALIBRATION = PHASE_SPECS.COUPANG_WING_CREDENTIAL_CELL_CALIBRATION;

function baseFor(spec: typeof HANDOFF): ApprovalPrereqInput {
  return {
    // A handoff manifest cannot be PREPARED until a real calibration has measured the cells; every case that is
    // not ABOUT that gate states it, so the gate has exactly one test and does not silently pass the others.
    ...(spec.mode === "CREDENTIAL_READ" ? { credentialCellsCalibrated: true } : {}),
    phase: spec.phase,
    channel: "COUPANG",
    accountBinding: "operator-owned test account",
    mode: spec.mode,
    apiCenterUrl: WING_DEFAULT_URL,
    cli: spec.cli,
    driver: spec.driver,
    declaredActions: spec.capableActions,
    runId: "wt-testrun0001",
    approvalId: "apr-testappr01",
    gitSha: "abc1234",
    maxActions: "one credential read",
    surface: "Coupang WING Open API",
    operation: "credential handoff",
  };
}

describe("the two new phases are wired like every other WING phase", () => {
  it("both are calibration phases and both are WING phases", () => {
    for (const p of ["COUPANG_WING_CREDENTIAL_CELL_CALIBRATION", "COUPANG_WING_CREDENTIAL_HANDOFF"] as const) {
      expect(CALIBRATION_PHASES).toContain(p);
      expect(WING_PHASES).toContain(p);
      // Without this the entry URL would be screened against the NAVER API-center host and refused as
      // INVALID_HOST — a failure whose cause names the wrong thing entirely.
      expect(isWingCalibrationPhase(p)).toBe(true);
      expect(PHASE_ENTRYPOINTS[p]).toBeDefined();
    }
  });

  it("neither highlights — a ring on a credential cell points the seller at what we promise not to read", () => {
    expect(CALIBRATION.allowsHighlight).toBe(false);
    expect(HANDOFF.allowsHighlight).toBe(false);
  });

  it("prepare cleanly as shipped", () => {
    expect(validateApprovalPrerequisites(baseFor(CALIBRATION)).ok).toBe(true);
    expect(validateApprovalPrerequisites(baseFor(HANDOFF)).ok).toBe(true);
  });
});

describe("the mode says what the run does with a value", () => {
  it("the handoff is the ONLY phase whose mode is not READ_ONLY", () => {
    const nonReadOnly = CALIBRATION_PHASES.filter((p) => PHASE_SPECS[p].mode !== "READ_ONLY");
    expect(nonReadOnly).toEqual(["COUPANG_WING_CREDENTIAL_HANDOFF"]);
  });

  it("the calibration stays READ_ONLY — it measures where a value sits and reads none", () => {
    expect(CALIBRATION.mode).toBe("READ_ONLY");
    for (const a of CREDENTIAL_VALUE_ACTIONS) expect(CALIBRATION.capableActions).not.toContain(a);
  });
});

describe("a READ_ONLY phase cannot declare a credential action", () => {
  for (const action of CREDENTIAL_VALUE_ACTIONS) {
    it(`refuses ${action} on the calibration phase`, () => {
      const r = validateApprovalPrerequisites({
        ...baseFor(CALIBRATION),
        declaredActions: [...CALIBRATION.capableActions, action],
      });
      expect(r.ok).toBe(false);
      // It fails on capability first (the calibration driver cannot do it) — which is the stricter refusal, and
      // the one that matters. The mode check below covers the case where a spec is edited to allow it.
      expect(r.ok === false && r.cause).toMatch(/ACTION_CAPABILITY_MISMATCH|CREDENTIAL_ACTION_IN_READ_ONLY_PHASE/);
    });
  }

  it("refuses even when the phase spec would permit the capability — the MODE decides", () => {
    // Simulate the edit that would otherwise slip through: a READ_ONLY phase whose capability list grew.
    const spec = { ...CALIBRATION, capableActions: [...CALIBRATION.capableActions, ...CREDENTIAL_VALUE_ACTIONS] };
    const patched = PHASE_SPECS as unknown as Record<string, typeof spec>;
    const original = patched["COUPANG_WING_CREDENTIAL_CELL_CALIBRATION"]!;
    patched["COUPANG_WING_CREDENTIAL_CELL_CALIBRATION"] = spec;
    try {
      const r = validateApprovalPrerequisites({
        ...baseFor(CALIBRATION),
        declaredActions: spec.capableActions as readonly ApprovalAction[],
      });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.cause).toBe("CREDENTIAL_ACTION_IN_READ_ONLY_PHASE");
    } finally {
      patched["COUPANG_WING_CREDENTIAL_CELL_CALIBRATION"] = original;
    }
  });
});

describe("a CREDENTIAL_READ phase cannot run on an unmeasured screen", () => {
  it("**the handoff does not reach PREPARED as shipped** — the cells have never been measured", () => {
    // The contract orders the calibration before the handoff (§11). Until this gate, nothing enforced it: the
    // handoff could have taken three secrets out of a shape no human had inspected. The shipped constant is
    // `false`, so the path is closed until a real sitting flips it.
    expect(WING_CREDENTIAL_CELLS_CALIBRATED).toBe(false);
    const r = validateApprovalPrerequisites({ ...baseFor(HANDOFF), credentialCellsCalibrated: undefined });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.cause).toBe("CREDENTIAL_CELLS_NOT_CALIBRATED");
  });

  it("an explicit false is refused too — the default is not the only path to the refusal", () => {
    const r = validateApprovalPrerequisites({ ...baseFor(HANDOFF), credentialCellsCalibrated: false });
    expect(r.ok === false && r.cause).toBe("CREDENTIAL_CELLS_NOT_CALIBRATED");
  });

  it("the calibration phase is NOT gated on itself — that would be unreachable by construction", () => {
    expect(validateApprovalPrerequisites({ ...baseFor(CALIBRATION), credentialCellsCalibrated: undefined }).ok).toBe(true);
  });
});

describe("a CREDENTIAL_READ phase cannot under-declare", () => {
  for (const dropped of CREDENTIAL_VALUE_ACTIONS) {
    it(`refuses a handoff manifest that omits ${dropped}`, () => {
      const r = validateApprovalPrerequisites({
        ...baseFor(HANDOFF),
        declaredActions: HANDOFF.capableActions.filter((a) => a !== dropped),
      });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.cause).toBe("CREDENTIAL_MODE_UNDERDECLARED");
    });
  }

  it("refuses a handoff manifest that declares only the harmless observations", () => {
    const r = validateApprovalPrerequisites({
      ...baseFor(HANDOFF),
      declaredActions: ["OPEN_DEDICATED_WINDOW", "WAIT_OPERATOR_LOGIN_NAV", "CLASSIFY_SANITIZED_PAGE_CATEGORY"],
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.cause).toBe("CREDENTIAL_MODE_UNDERDECLARED");
  });
});

describe("the emitted manifest carries the posture, not a paraphrase of it", () => {
  it("names the mode and both credential actions", () => {
    const r = validateApprovalPrerequisites(baseFor(HANDOFF));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.mode).toBe("CREDENTIAL_READ");
    for (const a of CREDENTIAL_VALUE_ACTIONS) expect(r.manifest.allowedActions).toContain(a);
  });

  it("the operator's entrypoint summary says the values are read and where they go", () => {
    const summary = PHASE_ENTRYPOINTS.COUPANG_WING_CREDENTIAL_HANDOFF.operatorActionSummary;
    expect(summary).toContain("한 번만 읽어");
    expect(summary).toContain("연결 정보 저장소");
    expect(summary).toContain("읽기 전용");
  });

  it("the calibration's summary promises the opposite, and says so", () => {
    const summary = PHASE_ENTRYPOINTS.COUPANG_WING_CREDENTIAL_CELL_CALIBRATION.operatorActionSummary;
    expect(summary).toContain("값은 읽지 않고");
  });
});
