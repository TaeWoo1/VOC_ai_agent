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
  PHASE_ENTRYPOINTS,
  ENTRYPOINT_PHASES,
  CALIBRATION_PHASES,
  WING_PHASES,
  isWingCalibrationPhase,
  validateEntrypointContract,
  VISUAL_RECON_ARTIFACT_CATEGORY,
  FE_LIVE_PROOF_SUPPORTING_SURFACE,
  FE_LIVE_PROOF_START_RUN_OWNER,
  FE_LIVE_PROOF_MAX_START_RUN,
  COUPANG_WING_KEY_DELETION_DESTRUCTIVE_ACTION,
  COUPANG_WING_KEY_DELETION_OPERATION,
  COUPANG_WING_KEY_DELETION_SCOPE,
  COUPANG_WING_ISSUANCE_REVEAL_ACTION,
  type ApprovalPrereqInput,
  type EntrypointSpec,
  type OperatorDestructiveAction,
} from "../../src/cli/approval-manifest";
import { VISUAL_RECON_SCREENS } from "../../src/action-window/api-issuance-calibration/visual-recon";
import { WING_DELETION_SELECTORS_CALIBRATED } from "../../src/action-window/coupang-wing-issuance-driver";
import { WING_DEFAULT_URL, WING_PROBE_TARGET_NAMES } from "../../src/cli/coupang-wing-classifier";

const OBS = PHASE_SPECS.API_CENTER_STRUCTURE_OBSERVATION;
const HL = PHASE_SPECS.API_ISSUANCE_HIGHLIGHT_PROOF;
const VR = PHASE_SPECS.API_CENTER_VISUAL_RECON;
const WSP = PHASE_SPECS.COUPANG_WING_SELECTOR_PROBE;
const WKD = PHASE_SPECS.COUPANG_WING_KEY_DELETION;
const WLR = PHASE_SPECS.COUPANG_WING_LABEL_RECON;
const WFR = PHASE_SPECS.COUPANG_WING_ISSUANCE_FORM_REVEAL;

/** A fully-valid visual-recon input; individual tests override one field to prove a refusal. */
function baseVisualRecon(): ApprovalPrereqInput {
  return {
    ...baseObservation(),
    phase: VR.phase,
    cli: VR.cli,
    driver: VR.driver,
    declaredActions: VR.capableActions,
    // Visual recon has NO hotkey and writes only under the gitignored `.calibration/visual/` sink.
    hotkey: undefined,
    artifactPath: VISUAL_RECON_ARTIFACT_CATEGORY,
    maxActions: "1 redacted visual recon session",
    operation: "API Center redacted visual recon",
  };
}

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
    hotkey: "Ctrl+Shift+K",
    artifactPath: ".calibration/api-center-wt-testrun0001.json",
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

const FE = PHASE_SPECS.API_ISSUANCE_FE_LIVE_PROOF;

/** A fully-valid FE-run-host live-proof input; individual tests override one field to prove a refusal. */
function baseFeLiveProof(): ApprovalPrereqInput {
  const runId = baseObservation().runId;
  return {
    ...baseObservation(),
    phase: FE.phase,
    cli: FE.cli,
    driver: FE.driver,
    declaredActions: FE.capableActions,
    selectorsCalibrated: true,
    operation: "existing-app guided issuance tutorial — FE-run-host READ-only live proof",
    maxActions: "1 READ-only FE-run-host session",
    startRunContract: {
      soleStartRunOwner: FE_LIVE_PROOF_START_RUN_OWNER,
      maxStartRun: FE_LIVE_PROOF_MAX_START_RUN,
      credential: 0,
      test: 0,
      sync: 0,
      supportingSurface: [...FE_LIVE_PROOF_SUPPORTING_SURFACE],
      hostSendsStartRun: false,
      forbidStandaloneProofClient: true,
      boundFrontendPath: `/connect/naver?walkthroughRun=${runId}`,
    },
  };
}

/** A fully-valid Coupang WING selector-probe input; individual tests override one field to prove a refusal. */
function baseWingSelectorProbe(): ApprovalPrereqInput {
  return {
    ...baseObservation(),
    phase: WSP.phase,
    channel: "COUPANG",
    accountBinding: "operator-owned Coupang WING test account",
    apiCenterUrl: WING_DEFAULT_URL,
    cli: WSP.cli,
    driver: WSP.driver,
    declaredActions: WSP.capableActions,
    // The WING probe carries NO hotkey and writes NO raw artifact (like the NAVER selector probe).
    hotkey: undefined,
    artifactPath: undefined,
    surface: "Coupang WING Open API",
    operation: "WING open-API read-only selector probe",
    maxActions: "1 read-only WING selector probe session",
  };
}

/** The candidate-label recon phase — same CLI and window as the probe, different measurement. */
function baseWingLabelRecon(): ApprovalPrereqInput {
  return {
    ...baseWingSelectorProbe(),
    phase: WLR.phase,
    driver: WLR.driver,
    declaredActions: WLR.capableActions,
    operation: "WING open-API read-only CANDIDATE-LABEL recon (measure only; no selector is changed by this run)",
    maxActions: "1 read-only WING candidate-label recon session",
  };
}

/**
 * The WING key-deletion destructive phase. It HIGHLIGHTS the 삭제 control ⇒ requires calibrated WING selectors.
 * The 삭제 control IS live-calibrated now, but this module never assumes a WING calibration — the caller must
 * state it — so the base input (which omits the field) still fails closed. Tests that want the calibrated path
 * pass the real `WING_DELETION_SELECTORS_CALIBRATED`, exactly as `run-coupang-wing-deletion-live.ts` does.
 * Carries the immutable operator-destructive-action descriptor.
 */
function baseWingKeyDeletion(): ApprovalPrereqInput {
  return {
    ...baseObservation(),
    phase: WKD.phase,
    accountBinding: COUPANG_WING_KEY_DELETION_SCOPE.accountBinding,
    apiCenterUrl: WING_DEFAULT_URL,
    cli: WKD.cli,
    driver: WKD.driver,
    declaredActions: WKD.capableActions,
    hotkey: undefined,
    artifactPath: undefined,
    // The destructive run scope is PINNED to the phase — the operator's grant binds to these four fields, so the
    // gate refuses any deviation rather than displaying a manifest that describes a different run.
    channel: COUPANG_WING_KEY_DELETION_SCOPE.channel,
    surface: COUPANG_WING_KEY_DELETION_SCOPE.surface,
    operation: COUPANG_WING_KEY_DELETION_SCOPE.operation,
    maxActions: COUPANG_WING_KEY_DELETION_SCOPE.maxActions,
    operatorDestructiveAction: COUPANG_WING_KEY_DELETION_DESTRUCTIVE_ACTION,
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

  it("missing calibration hotkey → FAIL (Phase A cannot arm capture)", () => {
    for (const hotkey of [undefined, "", "   "]) {
      const r = validateApprovalPrerequisites({ ...baseObservation(), hotkey });
      expect(r.ok, String(hotkey)).toBe(false);
      if (!r.ok) expect(r.cause).toBe("MISSING_HOTKEY");
    }
  });

  it("raw-artifact path not under the gitignored .calibration/ dir → FAIL (ARTIFACT_PATH_UNSAFE)", () => {
    for (const artifactPath of [undefined, "", "/tmp/api-center.json", "docs/api-center.json", ".calibration/../secrets.json", "C:\\calibration\\x.json"]) {
      const r = validateApprovalPrerequisites({ ...baseObservation(), artifactPath });
      expect(r.ok, String(artifactPath)).toBe(false);
      if (!r.ok) expect(r.cause).toBe("ARTIFACT_PATH_UNSAFE");
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

  it("Phase A is now the multi-checkpoint calibrator, and its manifest surfaces the hotkey + gitignored artifact path", () => {
    expect(OBS.cli).toBe("src/cli/calibrate-api-center.ts");
    expect(OBS.driver).toContain("calibrate-api-center");
    const r = validateApprovalPrerequisites(baseObservation());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.hotkey).toBe("Ctrl+Shift+K");
      expect(r.manifest.artifactPath.startsWith(".calibration/")).toBe(true);
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

/** The WING issuance-form reveal phase — highlights 발급, the operator presses it, one observation, STOP. */
function baseWingReveal(): ApprovalPrereqInput {
  return {
    ...baseWingSelectorProbe(),
    phase: WFR.phase,
    cli: WFR.cli,
    driver: WFR.driver,
    declaredActions: WFR.capableActions,
    selectorsCalibrated: true,
    operation: "WING issuance-form reveal (operator presses 발급; no key issuance, no input, no value read)",
    maxActions: "1 operator-performed 발급 press + 1 sanitized observation",
    operatorRevealAction: COUPANG_WING_ISSUANCE_REVEAL_ACTION,
  };
}

describe("Coupang WING issuance-form reveal phase (COUPANG_WING_ISSUANCE_FORM_REVEAL)", () => {
  it("PREPARED manifest: agent READ_ONLY, highlights, and carries the reveal descriptor", () => {
    const r = validateApprovalPrerequisites(baseWingReveal());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = r.manifest;
      expect(m.phase).toBe("COUPANG_WING_ISSUANCE_FORM_REVEAL");
      expect(m.mode).toBe("READ_ONLY");
      expect(m.allowedActions).toContain("HIGHLIGHT_REAL_CONTROL");
      expect(m.apiCenterHost).toBe("wing_host");
      expect(m.operatorRevealAction).toEqual(COUPANG_WING_ISSUANCE_REVEAL_ACTION);
      // The manifest must never carry the DESTRUCTIVE descriptor — this phase is not that.
      expect(m.operatorDestructiveAction).toBeUndefined();
    }
  });

  it("the manifest states BOTH claims: not key creation, AND not proven safe", () => {
    // The pair is the point. `createsKeyMaterial: false` is what the operator is approving; `keyCreationRuledOut:
    // false` admits the runtime cannot prove nothing was issued. Collapsing them would be an over-claim.
    const r = validateApprovalPrerequisites(baseWingReveal());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.operatorRevealAction!.createsKeyMaterial).toBe(false);
      expect(r.manifest.operatorRevealAction!.keyCreationRuledOut).toBe(false);
      expect(r.manifest.operatorRevealAction!.expectedOutcomeConfirmed).toBe(false);
      expect(r.manifest.operatorRevealAction!.autoAdvanceAfterReveal).toBe(false);
      expect(r.manifest.operatorRevealAction!.forbiddenFollowOnAction).toBe("COMPLETE_WING_KEY_ISSUANCE");
    }
  });

  it("HIGHLIGHTS a real control ⇒ an uncalibrated caller fails closed", () => {
    const r = validateApprovalPrerequisites({ ...baseWingReveal(), selectorsCalibrated: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("SELECTORS_NOT_CALIBRATED");
  });

  it("a MISSING reveal descriptor refuses before a manifest exists", () => {
    const { operatorRevealAction: _drop, ...noDescriptor } = baseWingReveal();
    const r = validateApprovalPrerequisites(noDescriptor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("MISSING_REVEAL_ACTION_CONTRACT");
  });

  it("every softening of the descriptor is refused, field by field", () => {
    // The risk here is the opposite of the destructive phase's: a caller OVERSTATING safety. Each of these would
    // print a manifest promising more than the evidence supports.
    const softenings: Partial<Record<string, unknown>>[] = [
      { keyCreationRuledOut: true },
      { createsKeyMaterial: true },
      { expectedOutcomeConfirmed: true },
      { autoAdvanceAfterReveal: true },
      { explicitCheckpointRequired: false },
      { agentPerformsAction: true },
      { credentialValueReadBudget: 1 },
      { irreversible: true },
      { operation: "COMPLETE_WING_KEY_ISSUANCE" },
      { forbiddenFollowOnAction: "REVEAL_WING_ISSUANCE_CONFIGURATION" },
      { expectedOutcome: "CREDENTIAL_SHOWN" },
    ];
    for (const patch of softenings) {
      const r = validateApprovalPrerequisites({
        ...baseWingReveal(),
        operatorRevealAction: { ...COUPANG_WING_ISSUANCE_REVEAL_ACTION, ...patch } as never,
      });
      expect(r.ok, JSON.stringify(patch)).toBe(false);
      if (!r.ok) expect(r.cause, JSON.stringify(patch)).toBe("REVEAL_ACTION_CONTRACT_MISMATCH");
    }
  });

  it("an uncalibrated run reports the CALIBRATION cause first — the descriptor cannot mask it", () => {
    const { operatorRevealAction: _drop, ...noDescriptor } = baseWingReveal();
    const r = validateApprovalPrerequisites({ ...noDescriptor, selectorsCalibrated: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("SELECTORS_NOT_CALIBRATED");
  });

  it("an UNBOUND identity fails closed", () => {
    for (const field of ["runId", "approvalId", "gitSha"] as const) {
      const r = validateApprovalPrerequisites({ ...baseWingReveal(), [field]: "unknown" });
      expect(r.ok, field).toBe(false);
      if (!r.ok) expect(r.cause, field).toBe("UNBOUND_IDENTITY");
    }
  });

  it("it CANNOT prepare deletion, renewal, or actual key issuance", () => {
    // Capability containment: the reveal phase declares no destructive action and no credential-shown/copy step,
    // and it cannot borrow another phase's actions.
    expect(WFR.requiresOperatorDestructiveAction).toBeUndefined();
    expect(WFR.operatorDestructiveAction).toBeUndefined();
    expect(WFR.destructiveScope).toBeUndefined();
    expect(WFR.capableActions).not.toContain("REDACT_SENSITIVE_REGIONS");
    expect(WFR.capableActions).not.toContain("CAPTURE_REDACTED_VIEWPORT");
    // Declaring an action beyond the phase's capability is refused.
    const r = validateApprovalPrerequisites({
      ...baseWingReveal(),
      declaredActions: [...WFR.capableActions, "CAPTURE_REDACTED_VIEWPORT"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("ACTION_CAPABILITY_MISMATCH");
  });

  it("the EMITTED descriptor is the phase CONSTANT, not the caller's input", () => {
    // Review: replacing the emission with `input.operatorRevealAction` left all 93 tests green, and a probe then
    // produced a DESTRUCTIVE manifest carrying `keyCreationRuledOut: true` — the exact over-claim this unit
    // exists to prevent. The field-by-field gate is not what protects that; this one line is.
    //
    // Extra fields survive the field-by-field comparison by design (it checks the 11 it knows), so an input
    // carrying one is the cleanest way to prove the emitted object came from the constant.
    const withExtra = { ...COUPANG_WING_ISSUANCE_REVEAL_ACTION, sneakyExtraField: "should not survive" };
    const r = validateApprovalPrerequisites({ ...baseWingReveal(), operatorRevealAction: withExtra as never });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.operatorRevealAction).toBe(COUPANG_WING_ISSUANCE_REVEAL_ACTION);
      expect(JSON.stringify(r.manifest)).not.toContain("sneakyExtraField");
    }
  });

  it("a prototype-inherited descriptor cannot smuggle a softened field into the manifest", () => {
    const hostile = Object.create({ keyCreationRuledOut: true }) as Record<string, unknown>;
    for (const [k, v] of Object.entries(COUPANG_WING_ISSUANCE_REVEAL_ACTION)) hostile[k] = v;
    const r = validateApprovalPrerequisites({ ...baseWingReveal(), operatorRevealAction: hostile as never });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.operatorRevealAction!.keyCreationRuledOut).toBe(false);
  });

  it("no OTHER phase may carry a reveal descriptor", () => {
    for (const phase of CALIBRATION_PHASES) {
      if (phase === "COUPANG_WING_ISSUANCE_FORM_REVEAL") continue;
      expect(PHASE_SPECS[phase].requiresOperatorRevealAction, phase).toBeFalsy();
      expect(PHASE_SPECS[phase].operatorRevealAction, phase).toBeUndefined();
    }
  });

  it("its operator summary states the expectation is unconfirmed and excludes key issuance", () => {
    const summary = PHASE_ENTRYPOINTS.COUPANG_WING_ISSUANCE_FORM_REVEAL.operatorActionSummary;
    expect(summary).toContain("예상");
    expect(summary).toContain("확인된 사실은 아니며");
    expect(summary).toContain("수행하지 않습니다");
    expect(validateEntrypointContract("COUPANG_WING_ISSUANCE_FORM_REVEAL", PHASE_ENTRYPOINTS.COUPANG_WING_ISSUANCE_FORM_REVEAL).ok).toBe(true);
  });
});

describe("Coupang WING candidate-label recon phase (COUPANG_WING_LABEL_RECON)", () => {
  it("PREPARED manifest: READ-only, no highlight, same CLI and window as the probe", () => {
    const r = validateApprovalPrerequisites(baseWingLabelRecon());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = r.manifest;
      expect(m.phase).toBe("COUPANG_WING_LABEL_RECON");
      expect(m.mode).toBe("READ_ONLY");
      expect(m.allowedActions).not.toContain("HIGHLIGHT_REAL_CONTROL");
      expect(m.allowedActions).toContain("PROBE_TARGET_MATCHCOUNT");
      expect(m.cli).toBe("src/cli/probe-wing-issuance-selectors.ts");
      expect(m.apiCenterHost).toBe("wing_host");
      expect(m.entrypointType).toBe("CLI_LAUNCHED_DEDICATED_WINDOW");
    }
  });

  it("its capability is EXACTLY the selector probe's — the sweep adds no action, only different labels", () => {
    // If recon ever needs a new action code, that is a real capability change and must not arrive silently.
    expect([...WLR.capableActions]).toEqual([...WSP.capableActions]);
    expect(WLR.allowsHighlight).toBe(false);
    expect(WLR.mode).toBe("READ_ONLY");
  });

  it("defaults to the RECON scope, not to every WING target", () => {
    // The probe phase defaults to the full fixed set; recon must not inherit that, because a full-set recon
    // manifest describes a run the live gate would refuse — and the reflex when a run refuses is to widen.
    const r = validateApprovalPrerequisites(baseWingLabelRecon());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.probeTargets).toEqual(["self_dev", "vendor_info", "call_ip"]);
  });

  it("narrowing WITHIN the recon set is allowed", () => {
    const r = validateApprovalPrerequisites({ ...baseWingLabelRecon(), requestedProbeTargets: ["call_ip"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.probeTargets).toEqual(["call_ip"]);
  });

  it("a non-sweepable target refuses BEFORE a manifest exists", () => {
    for (const scope of [["delete"], ["self_dev", "issue"], ["credentials"]]) {
      const r = validateApprovalPrerequisites({ ...baseWingLabelRecon(), requestedProbeTargets: scope });
      expect(r.ok, scope.join(",")).toBe(false);
      if (!r.ok) expect(r.cause).toBe("WING_RECON_TARGETS_MISMATCH");
    }
  });

  it("the selector-probe phase is UNAFFECTED — it still defaults to the full fixed set and accepts delete", () => {
    // The regression that matters: adding recon must not narrow the phase that ships today.
    const full = validateApprovalPrerequisites(baseWingSelectorProbe());
    expect(full.ok).toBe(true);
    if (full.ok) expect(full.manifest.probeTargets).toEqual([...WING_PROBE_TARGET_NAMES]);
    const del = validateApprovalPrerequisites({ ...baseWingSelectorProbe(), requestedProbeTargets: ["delete"] });
    expect(del.ok).toBe(true);
  });

  it("every COUPANG_WING phase is in WING_PHASES — the drift that screened recon against the NAVER host", () => {
    // Found by this unit: the recon phase was added to the probe-target and manifest-emission branches but not
    // to the host-screening chain, so a perfectly valid WING URL came back `INVALID_HOST`. One list now.
    const wingByName = CALIBRATION_PHASES.filter((p) => p.startsWith("COUPANG_WING"));
    expect([...WING_PHASES].sort()).toEqual([...wingByName].sort());
    for (const p of wingByName) expect(isWingCalibrationPhase(p), p).toBe(true);
    expect(isWingCalibrationPhase("API_ISSUANCE_HIGHLIGHT_PROOF")).toBe(false);
  });

  it("its operator summary tells the operator that candidates are swept and nothing is promoted", () => {
    const summary = PHASE_ENTRYPOINTS.COUPANG_WING_LABEL_RECON.operatorActionSummary;
    expect(summary).toContain("후보");
    expect(summary).toContain("선택자를 바꾸지 않습니다");
    expect(validateEntrypointContract("COUPANG_WING_LABEL_RECON", PHASE_ENTRYPOINTS.COUPANG_WING_LABEL_RECON).ok).toBe(true);
  });
});

describe("Coupang WING selector-probe phase (COUPANG_WING_SELECTOR_PROBE)", () => {
  it("PREPARED manifest: READ-only, no highlight, WING host category, CLI-launched window", () => {
    const r = validateApprovalPrerequisites(baseWingSelectorProbe());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = r.manifest;
      expect(m.phase).toBe("COUPANG_WING_SELECTOR_PROBE");
      expect(m.channel).toBe("COUPANG");
      expect(m.cli).toBe("src/cli/probe-wing-issuance-selectors.ts");
      expect(m.driver).toBe(WSP.driver);
      expect(m.mode).toBe("READ_ONLY");
      expect(m.selectorsCalibrated).toBe(false); // WING is LIVE_DOM_CALIBRATION_PENDING; the probe does not need it
      expect(m.allowedActions).not.toContain("HIGHLIGHT_REAL_CONTROL");
      expect(m.allowedActions).toContain("PROBE_TARGET_MATCHCOUNT");
      // Entry URL is reduced to a WING host CATEGORY — the raw WING URL never enters the manifest.
      expect(m.apiCenterHost).toBe("wing_host");
      expect(JSON.stringify(m)).not.toContain("wing.coupang.com");
      // CLI-launched dedicated window — never a frontend URL.
      expect(m.entrypointType).toBe("CLI_LAUNCHED_DEDICATED_WINDOW");
      expect(m.entrypointCommandId).toBe("probe-wing-issuance-selectors");
    }
  });

  it("does NOT require calibrated selectors (it is what measures uniqueness)", () => {
    // Unlike the NAVER highlight proof, the WING probe never highlights, so a false selectorsCalibrated is fine.
    const r = validateApprovalPrerequisites({ ...baseWingSelectorProbe(), selectorsCalibrated: false });
    expect(r.ok).toBe(true);
  });

  it("declaring a highlight action → FAIL (the probe's driver only counts, never highlights)", () => {
    const r = validateApprovalPrerequisites({
      ...baseWingSelectorProbe(),
      declaredActions: [...WSP.capableActions, "HIGHLIGHT_REAL_CONTROL"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("HIGHLIGHT_ACTION_IN_OBSERVATION_PHASE");
  });

  it("a non-WING (NAVER API-center) URL → FAIL (INVALID_HOST): a NAVER host never screens for the WING probe", () => {
    const r = validateApprovalPrerequisites({ ...baseWingSelectorProbe(), apiCenterUrl: NAVER_API_CENTER_BASE_URL });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("INVALID_HOST");
  });

  it("an off-target / missing URL → FAIL", () => {
    expect(validateApprovalPrerequisites({ ...baseWingSelectorProbe(), apiCenterUrl: "https://evil.example.com/x" }).ok).toBe(false);
    const r = validateApprovalPrerequisites({ ...baseWingSelectorProbe(), apiCenterUrl: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("MISSING_URL");
  });

  it("wrong cli/driver (e.g. the NAVER probe) → FAIL (CLI_DRIVER_UNCONFIRMED)", () => {
    const r = validateApprovalPrerequisites({ ...baseWingSelectorProbe(), cli: "src/cli/probe-issuance-selectors.ts" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("CLI_DRIVER_UNCONFIRMED");
  });

  it("the WING probe entrypoint is a CLI-launched window and carries no frontend URL", () => {
    const FRONTEND_URL_TOKENS = ["/connect/naver", "?walkthroughRun=", "http://", "https://"];
    expect(PHASE_ENTRYPOINTS.COUPANG_WING_SELECTOR_PROBE.entrypointType).toBe("CLI_LAUNCHED_DEDICATED_WINDOW");
    expect(PHASE_ENTRYPOINTS.COUPANG_WING_SELECTOR_PROBE.emitsFrontendUrl).toBe(false);
    expect(validateEntrypointContract("COUPANG_WING_SELECTOR_PROBE", PHASE_ENTRYPOINTS.COUPANG_WING_SELECTOR_PROBE).ok).toBe(true);
    const r = validateApprovalPrerequisites(baseWingSelectorProbe());
    expect(r.ok).toBe(true);
    if (r.ok) {
      for (const tok of FRONTEND_URL_TOKENS) {
        expect(JSON.stringify(r.manifest).includes(tok), `WING probe manifest must not contain "${tok}"`).toBe(false);
      }
    }
  });
});

describe("Coupang WING selector-probe target scope (probeTargets)", () => {
  it("defaults to the full fixed target set when no scope is requested", () => {
    const r = validateApprovalPrerequisites(baseWingSelectorProbe());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.probeTargets).toEqual([...WING_PROBE_TARGET_NAMES]);
  });

  it("narrows to a canonical subset — the delete-only calibration scope surfaces probeTargets = [delete]", () => {
    const r = validateApprovalPrerequisites({ ...baseWingSelectorProbe(), requestedProbeTargets: ["delete"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.probeTargets).toEqual(["delete"]);
  });

  it("rejects an unknown / empty / non-canonical scope (WING_PROBE_TARGETS_MISMATCH)", () => {
    for (const scope of [["nope"], [], ["delete", "delete"], ["issue", "self_dev"] /* wrong order */]) {
      const r = validateApprovalPrerequisites({ ...baseWingSelectorProbe(), requestedProbeTargets: scope });
      expect(r.ok, JSON.stringify(scope)).toBe(false);
      if (!r.ok) expect(r.cause).toBe("WING_PROBE_TARGETS_MISMATCH");
    }
  });
});

describe("Coupang WING key-deletion destructive phase (COUPANG_WING_KEY_DELETION)", () => {
  it("FAILS CLOSED by default (SELECTORS_NOT_CALIBRATED): a destructive highlight cannot PREPARE while WING is uncalibrated", () => {
    // The headline fail-closed proof: the phase highlights the 삭제 control, WING is LIVE_DOM_CALIBRATION_PENDING,
    // so with no explicit override the gate refuses — a PREPARED destructive manifest is IMPOSSIBLE today.
    const r = validateApprovalPrerequisites(baseWingKeyDeletion());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("SELECTORS_NOT_CALIBRATED");
  });

  it("the destructive descriptor does NOT mask the calibration requirement (selectors gate runs first)", () => {
    // Even with a perfectly-formed destructive contract, an uncalibrated WING deletion phase still fails at the
    // selectors gate — the descriptor can never buy past the calibration requirement.
    const r = validateApprovalPrerequisites({
      ...baseWingKeyDeletion(),
      operatorDestructiveAction: COUPANG_WING_KEY_DELETION_DESTRUCTIVE_ACTION,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("SELECTORS_NOT_CALIBRATED");
  });

  it("fed exactly what the runtime CLI feeds, the gate emits what the calibration flag implies", () => {
    // This is the calibration landing: fed exactly what `run-coupang-wing-deletion-live.ts` feeds, the gate emits
    // a PREPARED destructive manifest. PREPARED is still not APPROVED — the operator's single-use grant against
    // the displayed manifest is a separate step, and the agent deletes nothing either way. Branching on the
    // constant keeps the emergency-withdrawal lever from turning this red (see the driver suite's intent marker).
    const r = validateApprovalPrerequisites({
      ...baseWingKeyDeletion(),
      selectorsCalibrated: WING_DELETION_SELECTORS_CALIBRATED,
    });
    if (!WING_DELETION_SELECTORS_CALIBRATED) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.cause).toBe("SELECTORS_NOT_CALIBRATED");
      return;
    }
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.selectorsCalibrated).toBe(true);
      expect(r.manifest.mode).toBe("READ_ONLY"); // the AGENT never mutates the marketplace
      expect(r.manifest.operatorDestructiveAction?.agentPerformsAction).toBe(false);
      // The manifest describes the run the grant authorizes — pinned, never env-supplied.
      expect(r.manifest.channel).toBe(COUPANG_WING_KEY_DELETION_SCOPE.channel);
      expect(r.manifest.maxActions).toBe(COUPANG_WING_KEY_DELETION_SCOPE.maxActions);
    }
  });

  it("WITHDRAWING the calibration closes the destructive path again (SELECTORS_NOT_CALIBRATED)", () => {
    // The flip must be reversible in one place: set the flag false and the phase cannot reach PREPARED at all.
    const r = validateApprovalPrerequisites({ ...baseWingKeyDeletion(), selectorsCalibrated: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("SELECTORS_NOT_CALIBRATED");
  });

  it("the gate never INHERITS a calibration — omitting the field fails closed despite the flag being true", () => {
    // `approval-manifest.ts` deliberately does not import the WING driver flag. A caller that forgets to state
    // the calibration gets a refusal, not another surface's calibration.
    const r = validateApprovalPrerequisites(baseWingKeyDeletion());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("SELECTORS_NOT_CALIBRATED");
  });

  it("PREPARED destructive manifest shape once 삭제 is calibrated: agent READ_ONLY + operator irreversible action", () => {
    // The manifest then carries the exact
    // destructive descriptor: agent performs nothing, irreversible, immediate invalidation, mandatory checkpoint,
    // zero value read — and the AGENT mode stays READ_ONLY (the destructive click is the operator's).
    const r = validateApprovalPrerequisites({ ...baseWingKeyDeletion(), selectorsCalibrated: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = r.manifest;
      expect(m.phase).toBe("COUPANG_WING_KEY_DELETION");
      expect(m.channel).toBe("COUPANG");
      expect(m.mode).toBe("READ_ONLY"); // AGENT mode — never a marketplace WRITE by the agent
      expect(m.allowedActions).toContain("HIGHLIGHT_REAL_CONTROL");
      expect(m.apiCenterHost).toBe("wing_host");
      expect(m.selectorsCalibrated).toBe(true);
      expect(m.entrypointType).toBe("CLI_LAUNCHED_DEDICATED_WINDOW");
      expect(m.entrypointCommandId).toBe("run-coupang-wing-deletion-live");
      // The operator-performed destructive descriptor, exactly the immutable canonical values.
      expect(m.operatorDestructiveAction).toEqual({
        operation: COUPANG_WING_KEY_DELETION_OPERATION,
        irreversible: true,
        invalidatesExistingCredentialImmediately: true,
        agentPerformsAction: false,
        explicitCheckpointRequired: true,
        credentialValueReadBudget: 0,
      });
      // The manifest never leaks the raw WING URL.
      expect(JSON.stringify(m)).not.toContain("wing.coupang.com");
    }
  });

  it("a destructive manifest may NOT describe a different run (DESTRUCTIVE_SCOPE_MISMATCH)", () => {
    // The operator's one-line grant binds to channel / surface / operation / maxActions. A stale
    // `SELLEROPS_APPROVAL_CHANNEL=NAVER` from another run previously produced a PREPARED destructive manifest
    // reading "NAVER · read-only probe" for a run that guides an irreversible Coupang WING key deletion — the
    // grant would bind to a description the run does not honor. Every deviation now refuses.
    const deviations: Array<Partial<ApprovalPrereqInput>> = [
      { channel: "NAVER" },
      { accountBinding: "operator-owned NAVER SmartStore test store" },
      { surface: "Commerce API Center" },
      { operation: "WING open-API read-only selector probe" },
      { maxActions: "0 actions" },
      { maxActions: "1 highlight-only session; the OPERATOR deletes; 0 agent click/type/value read" }, // near-miss
    ];
    for (const dev of deviations) {
      const r = validateApprovalPrerequisites({
        ...baseWingKeyDeletion(),
        selectorsCalibrated: true, // stated explicitly: this asserts the SCOPE gate, not the calibration gate
        ...dev,
      });
      expect(r.ok, `deviation ${JSON.stringify(dev)} must be refused`).toBe(false);
      if (!r.ok) expect(r.cause).toBe("DESTRUCTIVE_SCOPE_MISMATCH");
    }
  });

  it("the pinned scope cannot be reassigned or cleared at runtime", () => {
    // A frozen constant and a readonly spec field: otherwise `PHASE_SPECS.…destructiveScope = undefined` would
    // typecheck and silently skip the whole scope gate (`if (scope)`), and mutating the constant would make the
    // gate validate against the attacker's values.
    expect(Object.isFrozen(COUPANG_WING_KEY_DELETION_SCOPE)).toBe(true);
    expect(() => {
      "use strict";
      (COUPANG_WING_KEY_DELETION_SCOPE as { channel: string }).channel = "NAVER";
    }).toThrow();
    expect(COUPANG_WING_KEY_DELETION_SCOPE.channel).toBe("COUPANG");
    // The spec still carries the scope, so the gate above is reached rather than skipped.
    expect(PHASE_SPECS.COUPANG_WING_KEY_DELETION.destructiveScope).toBe(COUPANG_WING_KEY_DELETION_SCOPE);
  });

  it("an uncalibrated WING phase names the WING probe as the remediation, never a NAVER phase", () => {
    const r = validateApprovalPrerequisites({ ...baseWingKeyDeletion(), selectorsCalibrated: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cause).toBe("SELECTORS_NOT_CALIBRATED");
      expect(r.reason).toContain("COUPANG_WING_SELECTOR_PROBE");
      expect(r.reason).not.toContain("API_CENTER");
    }
  });

  it("the calibration gate runs BEFORE the scope gate — a withdrawn calibration is the reported cause", () => {
    // Order stability: whichever field is wrong, an uncalibrated destructive run must report the calibration
    // refusal, so the operator is never told "scope mismatch" for a phase that could not run at all.
    const r = validateApprovalPrerequisites({
      ...baseWingKeyDeletion(),
      selectorsCalibrated: false,
      channel: "NAVER",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("SELECTORS_NOT_CALIBRATED");
  });

  it("MISSING the destructive descriptor → FAIL (MISSING_DESTRUCTIVE_ACTION_CONTRACT) even when calibrated", () => {
    const r = validateApprovalPrerequisites({
      ...baseWingKeyDeletion(),
      selectorsCalibrated: true,
      operatorDestructiveAction: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("MISSING_DESTRUCTIVE_ACTION_CONTRACT");
  });

  it("a SOFTENED destructive descriptor → FAIL (DESTRUCTIVE_ACTION_CONTRACT_MISMATCH)", () => {
    // Each divergence from the immutable contract is refused — a caller cannot claim the agent deletes, deny
    // irreversibility, drop the checkpoint, or open a value-read budget.
    const softenings: Array<Partial<OperatorDestructiveAction>> = [
      { agentPerformsAction: true as unknown as false },
      { irreversible: false as unknown as true },
      { invalidatesExistingCredentialImmediately: false as unknown as true },
      { explicitCheckpointRequired: false as unknown as true },
      { credentialValueReadBudget: 1 as unknown as 0 },
      { operation: "DELETE_SOMETHING_ELSE" as unknown as typeof COUPANG_WING_KEY_DELETION_OPERATION },
    ];
    for (const soft of softenings) {
      const r = validateApprovalPrerequisites({
        ...baseWingKeyDeletion(),
        selectorsCalibrated: true,
        operatorDestructiveAction: { ...COUPANG_WING_KEY_DELETION_DESTRUCTIVE_ACTION, ...soft },
      });
      expect(r.ok, `softening ${JSON.stringify(soft)} must be refused`).toBe(false);
      if (!r.ok) expect(r.cause).toBe("DESTRUCTIVE_ACTION_CONTRACT_MISMATCH");
    }
  });

  it("a non-WING (NAVER API-center) URL → FAIL (INVALID_HOST)", () => {
    const r = validateApprovalPrerequisites({
      ...baseWingKeyDeletion(),
      selectorsCalibrated: true,
      apiCenterUrl: NAVER_API_CENTER_BASE_URL,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("INVALID_HOST");
  });

  it("wrong cli/driver → FAIL (CLI_DRIVER_UNCONFIRMED)", () => {
    const r = validateApprovalPrerequisites({
      ...baseWingKeyDeletion(),
      selectorsCalibrated: true,
      cli: "src/cli/probe-wing-issuance-selectors.ts",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("CLI_DRIVER_UNCONFIRMED");
  });

  it("a stale / unbound identity (unknown approvalId / runId / gitSha) → FAIL (UNBOUND_IDENTITY)", () => {
    for (const key of ["approvalId", "runId", "gitSha"] as const) {
      const r = validateApprovalPrerequisites({ ...baseWingKeyDeletion(), selectorsCalibrated: true, [key]: "unknown" });
      expect(r.ok, key).toBe(false);
      if (!r.ok) expect(r.cause).toBe("UNBOUND_IDENTITY");
    }
  });

  it("the deletion entrypoint is a CLI-launched window (never a frontend URL) and validates", () => {
    expect(ENTRYPOINT_PHASES).toContain("COUPANG_WING_KEY_DELETION");
    expect(PHASE_ENTRYPOINTS.COUPANG_WING_KEY_DELETION.entrypointType).toBe("CLI_LAUNCHED_DEDICATED_WINDOW");
    expect(PHASE_ENTRYPOINTS.COUPANG_WING_KEY_DELETION.emitsFrontendUrl).toBe(false);
    expect(validateEntrypointContract("COUPANG_WING_KEY_DELETION", PHASE_ENTRYPOINTS.COUPANG_WING_KEY_DELETION).ok).toBe(true);
  });

  it("the phase spec models the operator action, not an agent write: mode READ_ONLY, allowsHighlight, destructive contract", () => {
    expect(WKD.mode).toBe("READ_ONLY");
    expect(WKD.allowsHighlight).toBe(true);
    expect(WKD.requiresOperatorDestructiveAction).toBe(true);
    expect(WKD.operatorDestructiveAction).toEqual(COUPANG_WING_KEY_DELETION_DESTRUCTIVE_ACTION);
    // The planned deletion driver/CLI is deliberately not yet built — the real CLI wrapper double-fails-closed.
    expect(WKD.cli).toBe("src/cli/run-coupang-wing-deletion-live.ts");
  });
});

describe("visual-recon phase — redacted-screenshot recon manifest", () => {
  it("the phase spec is the redacted-screenshot recon: read-only, no highlight, capture screens = the driver's fixed set", () => {
    expect(VR.cli).toBe("src/cli/capture-api-center-visual.ts");
    expect(VR.driver).toContain("capture-api-center-visual");
    expect(VR.allowsHighlight).toBe(false);
    expect(VR.mode).toBe("READ_ONLY");
    // Single source of truth: the phase declares EXACTLY the driver's fixed screen set (drift guard).
    expect(VR.captureScreens).toEqual([...VISUAL_RECON_SCREENS]);
    expect(VR.artifactCategory).toBe(VISUAL_RECON_ARTIFACT_CATEGORY);
    // It can never declare a highlight or click-observe action.
    expect(VR.capableActions).not.toContain("HIGHLIGHT_REAL_CONTROL");
    expect(VR.capableActions).not.toContain("OBSERVE_USER_CLICK_TRANSITION");
  });

  it("a PREPARED visual-recon manifest carries the screens/sink/policies and NO hotkey", () => {
    const r = validateApprovalPrerequisites(baseVisualRecon());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = r.manifest;
      expect(m.phase).toBe("API_CENTER_VISUAL_RECON");
      expect(m.cli).toBe("src/cli/capture-api-center-visual.ts");
      expect(m.driver).toContain("capture-api-center-visual");
      expect(m.mode).toBe("READ_ONLY");
      expect(m.entrypointType).toBe("CLI_LAUNCHED_DEDICATED_WINDOW");
      expect(m.entrypointCommandId).toBe("capture-api-center-visual");
      expect(m.captureScreens).toEqual([...VISUAL_RECON_SCREENS]);
      expect(m.artifactCategory).toBe(VISUAL_RECON_ARTIFACT_CATEGORY);
      expect(m.screenshotPolicy).toBe("redacted viewport only");
      expect(m.structuralSummaryPolicy).toBe("sanitized closed-vocabulary only");
      expect(m.allowedActions).toContain("REDACT_SENSITIVE_REGIONS");
      expect(m.allowedActions).toContain("CAPTURE_REDACTED_VIEWPORT");
      expect(m.allowedActions).not.toContain("HIGHLIGHT_REAL_CONTROL");
      // No hotkey (it never calibrates a control from a keypress).
      expect(m.hotkey).toBe("");
      expect(m.operatorPresenceRequired).toBe(true);
      expect(m.expiresAt).toBe("process-lifetime");
    }
  });

  it("a per-run capture SCOPE narrows the manifest to a canonical subset (app_list + app_detail)", () => {
    const r = validateApprovalPrerequisites({ ...baseVisualRecon(), requestedCaptureScreens: ["app_list", "app_detail"] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The manifest declares exactly the narrowed set — the api_group / credentials screens are NOT captured.
      expect(r.manifest.captureScreens).toEqual(["app_list", "app_detail"]);
      expect(r.manifest.captureScreens).not.toContain("api_group");
      expect(r.manifest.captureScreens).not.toContain("credentials");
    }
  });

  it("an out-of-order scope is normalized to canonical registry order", () => {
    const r = validateApprovalPrerequisites({ ...baseVisualRecon(), requestedCaptureScreens: ["app_detail", "app_list"] });
    // The gate accepts only a canonical-ordered subset; the CLI resolver normalizes order, but a hand-built
    // out-of-order input must be rejected here so the manifest can never disagree with the resolver.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("VISUAL_SCREENS_MISMATCH");
  });

  it("absent scope keeps the full fixed set (backward-compatible)", () => {
    const r = validateApprovalPrerequisites({ ...baseVisualRecon(), requestedCaptureScreens: undefined });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.captureScreens).toEqual([...VISUAL_RECON_SCREENS]);
  });

  it("a scope with an unknown / duplicate / empty screen set → FAIL (VISUAL_SCREENS_MISMATCH)", () => {
    for (const requestedCaptureScreens of [["app_list", "nope"], ["app_list", "app_list"], [] as string[]]) {
      const r = validateApprovalPrerequisites({ ...baseVisualRecon(), requestedCaptureScreens });
      expect(r.ok, JSON.stringify(requestedCaptureScreens)).toBe(false);
      if (!r.ok) expect(r.cause).toBe("VISUAL_SCREENS_MISMATCH");
    }
  });

  it("declaring a highlight action in the visual-recon phase → FAIL (its driver only observes/redacts)", () => {
    const r = validateApprovalPrerequisites({
      ...baseVisualRecon(),
      declaredActions: [...VR.capableActions, "HIGHLIGHT_REAL_CONTROL"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("HIGHLIGHT_ACTION_IN_OBSERVATION_PHASE");
  });

  it("an artifact path outside the gitignored .calibration/visual/ sink → FAIL (ARTIFACT_PATH_UNSAFE)", () => {
    for (const artifactPath of [undefined, "", ".calibration/api-center-x.json", ".calibration/visual/../escape.png", "/tmp/visual/x.png", "docs/visual.png"]) {
      const r = validateApprovalPrerequisites({ ...baseVisualRecon(), artifactPath });
      expect(r.ok, String(artifactPath)).toBe(false);
      if (!r.ok) expect(r.cause).toBe("ARTIFACT_PATH_UNSAFE");
    }
  });

  it("the visual-recon CLI/driver must be confirmed exactly (a wrong driver → FAIL)", () => {
    const r = validateApprovalPrerequisites({ ...baseVisualRecon(), driver: "calibrate-api-center (multi-checkpoint read-only calibrator)" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("CLI_DRIVER_UNCONFIRMED");
  });

  it("the visual-recon manifest is a CLI-launched dedicated window — NO frontend URL, NO raw API-center URL", () => {
    const r = validateApprovalPrerequisites(baseVisualRecon());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = r.manifest;
      for (const tok of ["/connect/naver", "?walkthroughRun=", "http://", "https://", "apicenter.commerce.naver.com"]) {
        expect(JSON.stringify(m).includes(tok), `visual-recon manifest must not contain "${tok}"`).toBe(false);
      }
      expect(m.apiCenterHost).toBe("api_center_host");
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
      // The entrypoint trio is included: after PREPARED the operator picks/enters NOTHING to reach the run.
      for (const v of [m.approvalId, m.walkthroughRunId, m.channel, m.surface, m.operation, m.phase, m.cli, m.driver, m.mode, m.accountBinding, m.apiCenterHost, m.maxActions, m.gitSha, m.entrypointType, m.entrypointCommandId, m.operatorActionSummary]) {
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

describe("per-phase operator ENTRYPOINT contract — one true action, never a wrong URL", () => {
  // The order-connection URL shape — NOT the bare `walkthroughRunId` field, which the manifest legitimately carries.
  const FRONTEND_URL_TOKENS = ["/connect/naver", "?walkthroughRun=", "http://", "https://"];

  it("Phase A (observation) manifest is a CLI-launched dedicated window — NO frontend URL anywhere", () => {
    const r = validateApprovalPrerequisites(baseObservation());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = r.manifest;
      expect(m.entrypointType).toBe("CLI_LAUNCHED_DEDICATED_WINDOW");
      expect(m.entrypointCommandId).toBe("calibrate-api-center");
      expect(m.operatorActionSummary.length).toBeGreaterThan(0);
      // The exact defect regression: a calibration manifest must never carry the order-connection frontend URL.
      for (const tok of FRONTEND_URL_TOKENS) {
        expect(JSON.stringify(m).includes(tok), `Phase A manifest must not contain "${tok}"`).toBe(false);
      }
    }
  });

  it("Phase B (highlight, calibrated) manifest is also a CLI-launched dedicated window — NO frontend URL", () => {
    const r = validateApprovalPrerequisites(baseHighlight(true));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = r.manifest;
      expect(m.entrypointType).toBe("CLI_LAUNCHED_DEDICATED_WINDOW");
      expect(m.entrypointCommandId).toBe("run-api-issuance-live-naver");
      for (const tok of FRONTEND_URL_TOKENS) {
        expect(JSON.stringify(m).includes(tok), `Phase B manifest must not contain "${tok}"`).toBe(false);
      }
    }
  });

  it("only the guided-connection + FE-run-host issuance proof emit a bound frontend URL; calibration phases do not", () => {
    expect(PHASE_ENTRYPOINTS.NAVER_GUIDED_CONNECTION.entrypointType).toBe("FRONTEND_URL");
    expect(PHASE_ENTRYPOINTS.NAVER_GUIDED_CONNECTION.emitsFrontendUrl).toBe(true);
    expect(PHASE_ENTRYPOINTS.API_ISSUANCE_FE_LIVE_PROOF.entrypointType).toBe("FRONTEND_URL");
    expect(PHASE_ENTRYPOINTS.API_ISSUANCE_FE_LIVE_PROOF.emitsFrontendUrl).toBe(true);
    // The four calibration phases stay CLI-launched — no frontend URL.
    expect(PHASE_ENTRYPOINTS.API_CENTER_STRUCTURE_OBSERVATION.emitsFrontendUrl).toBe(false);
    expect(PHASE_ENTRYPOINTS.API_ISSUANCE_HIGHLIGHT_PROOF.emitsFrontendUrl).toBe(false);
    expect(PHASE_ENTRYPOINTS.API_CENTER_VISUAL_RECON.emitsFrontendUrl).toBe(false);
    expect(PHASE_ENTRYPOINTS.API_ISSUANCE_SELECTOR_PROBE.emitsFrontendUrl).toBe(false);
    // Exactly these two entrypoint phases emit a frontend URL.
    const urlPhases = ENTRYPOINT_PHASES.filter((p) => PHASE_ENTRYPOINTS[p].emitsFrontendUrl);
    expect(urlPhases).toEqual(["API_ISSUANCE_FE_LIVE_PROOF", "NAVER_GUIDED_CONNECTION"]);
  });

  it("every canonical phase entrypoint passes its own contract (no drift in the table)", () => {
    for (const p of ENTRYPOINT_PHASES) {
      expect(validateEntrypointContract(p, PHASE_ENTRYPOINTS[p]).ok, p).toBe(true);
    }
  });

  it("a CLI phase whose action carries a frontend URL → FAIL (FRONTEND_URL_IN_CLI_ENTRYPOINT)", () => {
    const bad: EntrypointSpec = {
      ...PHASE_ENTRYPOINTS.API_CENTER_STRUCTURE_OBSERVATION,
      operatorActionSummary: "http://localhost:5173/connect/naver?walkthroughRun=x 를 여세요.",
    };
    const r = validateEntrypointContract("API_CENTER_STRUCTURE_OBSERVATION", bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("FRONTEND_URL_IN_CLI_ENTRYPOINT");

    const bad2: EntrypointSpec = { ...PHASE_ENTRYPOINTS.API_CENTER_STRUCTURE_OBSERVATION, emitsFrontendUrl: true };
    const r2 = validateEntrypointContract("API_CENTER_STRUCTURE_OBSERVATION", bad2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.cause).toBe("FRONTEND_URL_IN_CLI_ENTRYPOINT");
  });

  it("a frontend phase that names a CLI or describes a CLI-only action → FAIL (CLI_DESC_IN_FRONTEND_ENTRYPOINT)", () => {
    const withCli: EntrypointSpec = { ...PHASE_ENTRYPOINTS.NAVER_GUIDED_CONNECTION, cli: "src/cli/calibrate-api-center.ts" };
    const r = validateEntrypointContract("NAVER_GUIDED_CONNECTION", withCli);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("CLI_DESC_IN_FRONTEND_ENTRYPOINT");

    const cliDesc: EntrypointSpec = {
      ...PHASE_ENTRYPOINTS.NAVER_GUIDED_CONNECTION,
      operatorActionSummary: "승인 후 SellerOps가 전용 Chrome 창을 엽니다.",
    };
    const r2 = validateEntrypointContract("NAVER_GUIDED_CONNECTION", cliDesc);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.cause).toBe("CLI_DESC_IN_FRONTEND_ENTRYPOINT");
  });

  it("entrypoint type / cli that disagree with the canonical phase → FAIL before a manifest", () => {
    const wrongType: EntrypointSpec = { ...PHASE_ENTRYPOINTS.API_CENTER_STRUCTURE_OBSERVATION, entrypointType: "FRONTEND_URL" };
    const r = validateEntrypointContract("API_CENTER_STRUCTURE_OBSERVATION", wrongType);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("ENTRYPOINT_TYPE_MISMATCH");

    const wrongCli: EntrypointSpec = { ...PHASE_ENTRYPOINTS.API_CENTER_STRUCTURE_OBSERVATION, cli: "src/cli/some-other.ts" };
    const r2 = validateEntrypointContract("API_CENTER_STRUCTURE_OBSERVATION", wrongCli);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.cause).toBe("ENTRYPOINT_CLI_MISMATCH");
  });
});

describe("FE-run-host issuance live proof (API_ISSUANCE_FE_LIVE_PROOF)", () => {
  it("a PREPARED manifest is a bound-FE-URL entrypoint with the host as a SUPPORTING surface (FE = sole run client)", () => {
    const r = validateApprovalPrerequisites(baseFeLiveProof());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = r.manifest;
      expect(m.phase).toBe("API_ISSUANCE_FE_LIVE_PROOF");
      expect(m.mode).toBe("READ_ONLY");
      // Entrypoint is the bound FE URL (NOT a CLI-launched dedicated window).
      expect(m.entrypointType).toBe("FRONTEND_URL");
      expect(m.entrypointCommandId).toBe("frontend-connect-naver-issuance");
      // The FE is the sole START_RUN owner; the CLI host is a supporting surface only.
      expect(m.soleStartRunOwner).toBe("FRONTEND");
      expect(m.maxStartRun).toBe(1);
      expect(m.writeBudget).toEqual({ credential: 0, test: 0, sync: 0 });
      expect(m.supportingSurface).toEqual(["Local Agent host", "dedicated NAVER Chrome", "bridge carrier"]);
      // The bound FE URL carries THIS run's id.
      expect(m.boundFrontendPath).toBe("/connect/naver?walkthroughRun=wt-testrun0001");
      // Same live capability as the highlight proof (existing-app branch), and selectors must be calibrated.
      expect(m.allowedActions).toContain("HIGHLIGHT_REAL_CONTROL");
      expect(m.allowedActions).toContain("OBSERVE_USER_CLICK_TRANSITION");
      expect(m.allowedActions).toContain("REVEAL_SECTION_IN_VIEWPORT");
      expect(m.selectorsCalibrated).toBe(true);
      // The supporting host tool is disclosed as the cli, but it is never the operator entrypoint.
      expect(m.cli).toBe("src/cli/run-api-issuance-live-naver.ts");
      // Sanitized: the raw API-center URL never enters the manifest.
      expect(JSON.stringify(m)).not.toContain("apicenter.commerce.naver.com");
      expect(m.apiCenterHost).toBe("api_center_host");
    }
  });

  it("is REFUSED until selectors are calibrated (it highlights real controls)", () => {
    const r = validateApprovalPrerequisites({ ...baseFeLiveProof(), selectorsCalibrated: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("SELECTORS_NOT_CALIBRATED");
  });

  it("the START_RUN contract is missing entirely → FAIL", () => {
    const r = validateApprovalPrerequisites({ ...baseFeLiveProof(), startRunContract: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("MISSING_FE_RUN_HOST_CONTRACT");
  });

  it("a non-FRONTEND START_RUN owner → FAIL", () => {
    const b = baseFeLiveProof();
    const r = validateApprovalPrerequisites({ ...b, startRunContract: { ...b.startRunContract!, soleStartRunOwner: "CLI" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("START_RUN_OWNER_NOT_FRONTEND");
  });

  it("a START_RUN cap other than 1 → FAIL", () => {
    const b = baseFeLiveProof();
    for (const maxStartRun of [0, 2, 5]) {
      const r = validateApprovalPrerequisites({ ...b, startRunContract: { ...b.startRunContract!, maxStartRun } });
      expect(r.ok, String(maxStartRun)).toBe(false);
      if (!r.ok) expect(r.cause).toBe("START_RUN_CAP_NOT_ONE");
    }
  });

  it("any non-zero credential/test/sync budget → FAIL (READ-only)", () => {
    const b = baseFeLiveProof();
    for (const patch of [{ credential: 1 }, { test: 1 }, { sync: 1 }]) {
      const r = validateApprovalPrerequisites({ ...b, startRunContract: { ...b.startRunContract!, ...patch } });
      expect(r.ok, JSON.stringify(patch)).toBe(false);
      if (!r.ok) expect(r.cause).toBe("WRITE_ACTIONS_NOT_ZERO");
    }
  });

  it("a host that sends START_RUN → FAIL (the FE is the sole run client)", () => {
    const b = baseFeLiveProof();
    const r = validateApprovalPrerequisites({ ...b, startRunContract: { ...b.startRunContract!, hostSendsStartRun: true } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("HOST_SENDS_START_RUN");
  });

  it("a contract that does not forbid the standalone proof client → FAIL", () => {
    const b = baseFeLiveProof();
    const r = validateApprovalPrerequisites({ ...b, startRunContract: { ...b.startRunContract!, forbidStandaloneProofClient: false } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("PROOF_CLIENT_NOT_FORBIDDEN");
  });

  it("a supporting surface that is not EXACTLY host + Chrome + bridge → FAIL (missing OR extra)", () => {
    const b = baseFeLiveProof();
    const cases = [
      [],
      ["Local Agent host"],
      ["Local Agent host", "dedicated NAVER Chrome"],
      // An EXTRA caller-supplied entry (potential free-text leak) is refused — the set must be exact.
      ["Local Agent host", "dedicated NAVER Chrome", "bridge carrier", "acc-4451190 leaked id"],
    ];
    for (const surface of cases) {
      const r = validateApprovalPrerequisites({ ...b, startRunContract: { ...b.startRunContract!, supportingSurface: surface } });
      expect(r.ok, JSON.stringify(surface)).toBe(false);
      if (!r.ok) expect(r.cause).toBe("MISSING_SUPPORTING_SURFACE");
    }
  });

  it("a bound FE URL whose walkthroughRun is not EXACTLY the runId → FAIL (prefix collision, decoy param, wrong path)", () => {
    const b = baseFeLiveProof();
    const paths = [
      "/connect/naver?walkthroughRun=wt-someoneelse",
      "/connect/naver", // no param
      "", // empty
      // Prefix collision: substring-contains the runId but the exact param value differs.
      "/connect/naver?walkthroughRun=wt-testrun0001999",
      // Decoy: the FIRST walkthroughRun (what the FE parses) is a DIFFERENT run; the real id is only a later decoy key.
      "/connect/naver?walkthroughRun=wt-other&x=walkthroughRun=wt-testrun0001",
      // Right param, wrong path — not the order-connection wizard.
      "/evil/phish?walkthroughRun=wt-testrun0001",
      // Lookalike path prefix (must be exactly /connect/naver?…, not /connect/naver-evil).
      "/connect/naver-evil?walkthroughRun=wt-testrun0001",
    ];
    for (const path of paths) {
      const r = validateApprovalPrerequisites({ ...b, startRunContract: { ...b.startRunContract!, boundFrontendPath: path } });
      expect(r.ok, path).toBe(false);
      if (!r.ok) expect(r.cause).toBe("RUNID_URL_MISMATCH");
    }
    // The exact, correct path passes.
    const ok = validateApprovalPrerequisites(b);
    expect(ok.ok).toBe(true);
  });

  it("entrypoint cross-combos fail closed: FE proof with a CLI entrypoint, and the highlight proof with a frontend URL", () => {
    // The FE-run-host proof forced onto a CLI-launched dedicated window → mismatch.
    const feAsCli: EntrypointSpec = {
      ...PHASE_ENTRYPOINTS.API_ISSUANCE_FE_LIVE_PROOF,
      entrypointType: "CLI_LAUNCHED_DEDICATED_WINDOW",
      emitsFrontendUrl: false,
    };
    const r = validateEntrypointContract("API_ISSUANCE_FE_LIVE_PROOF", feAsCli);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("ENTRYPOINT_TYPE_MISMATCH");

    // The CLI-driver highlight proof forced onto a bound frontend URL → still refused (guard unchanged).
    const hlAsFrontend: EntrypointSpec = {
      ...PHASE_ENTRYPOINTS.API_ISSUANCE_HIGHLIGHT_PROOF,
      entrypointType: "FRONTEND_URL",
      cli: "",
      emitsFrontendUrl: true,
    };
    const r2 = validateEntrypointContract("API_ISSUANCE_HIGHLIGHT_PROOF", hlAsFrontend);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.cause).toBe("ENTRYPOINT_TYPE_MISMATCH");
  });

  it("the CLI-driver highlight proof is UNCHANGED — still CLI-launched, no frontend URL, no FE-proof fields", () => {
    const r = validateApprovalPrerequisites(baseHighlight(true));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const m = r.manifest;
      expect(m.entrypointType).toBe("CLI_LAUNCHED_DEDICATED_WINDOW");
      expect(m.entrypointCommandId).toBe("run-api-issuance-live-naver");
      // The FE-proof-only fields never leak onto the highlight manifest.
      expect(m.soleStartRunOwner).toBeUndefined();
      expect(m.maxStartRun).toBeUndefined();
      expect(m.writeBudget).toBeUndefined();
      expect(m.supportingSurface).toBeUndefined();
      expect(m.boundFrontendPath).toBeUndefined();
      for (const tok of ["/connect/naver", "?walkthroughRun="]) {
        expect(JSON.stringify(m).includes(tok), `highlight manifest must not contain "${tok}"`).toBe(false);
      }
    }
  });
});

/**
 * The GUIDED ISSUANCE WALK's entrypoint is the product path: an INSTALLED launchd service, not a CLI the
 * operator runs and not a bound frontend URL. These lock the three claims a manifest makes about it, because
 * each one is a promise the operator grants against — and the phase's whole premise is that the run needs no
 * terminal after the install.
 */
describe("the guided walk's installed-service entrypoint", () => {
  const WALK = PHASE_ENTRYPOINTS.COUPANG_WING_GUIDED_ISSUANCE_WALK;

  it("is its own entrypoint type — never the CLI-launched-window one", () => {
    expect(WALK.entrypointType).toBe("INSTALLED_LOCAL_AGENT_SERVICE");
    expect(WALK.emitsFrontendUrl).toBe(false);
  });

  it("names the INSTALLER as the operator's command, not the agent it installs", () => {
    // Naming `local-agent.ts` here is exactly the regression this pins: it would print an on-approval line that
    // starts the agent by hand, which is the non-product path.
    expect(WALK.cli).toBe("src/cli/local-agent-service.ts");
    expect(WALK.entrypointCommandId).toBe("local-agent-service");
    expect(PHASE_SPECS.COUPANG_WING_GUIDED_ISSUANCE_WALK.cli).toBe("src/cli/local-agent-service.ts");
  });

  it("states where the pairing code appears and where it is confirmed", () => {
    expect(WALK.operatorActionSummary).toContain("macOS 승인 대화상자");
    expect(WALK.operatorActionSummary).toContain("제품 화면");
    expect(validateEntrypointContract("COUPANG_WING_GUIDED_ISSUANCE_WALK", WALK)).toEqual({ ok: true });
  });

  it("refuses a summary that drops the pairing channel — a terminal-free claim with nothing behind it", () => {
    const stripped: EntrypointSpec = {
      ...WALK,
      operatorActionSummary: "승인 후 Local Agent를 백그라운드 서비스로 설치합니다. 안내가 시작됩니다.",
    };
    const res = validateEntrypointContract("COUPANG_WING_GUIDED_ISSUANCE_WALK", stripped);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.cause).toBe("MISSING_SERVICE_PAIRING_CHANNEL");
  });

  it("refuses a bound frontend URL — the operator opens SellerOps normally, with no run token in the address", () => {
    const withUrl: EntrypointSpec = { ...WALK, emitsFrontendUrl: true };
    const res = validateEntrypointContract("COUPANG_WING_GUIDED_ISSUANCE_WALK", withUrl);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.cause).toBe("FRONTEND_URL_IN_CLI_ENTRYPOINT");
  });

  it("refuses the agent entrypoint substituted for the installer", () => {
    const handRun: EntrypointSpec = { ...WALK, cli: "src/cli/local-agent.ts" };
    const res = validateEntrypointContract("COUPANG_WING_GUIDED_ISSUANCE_WALK", handRun);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.cause).toBe("ENTRYPOINT_CLI_MISMATCH");
  });

  it("refuses the wrong entrypoint type, so the type cannot be widened by accident", () => {
    const asCli: EntrypointSpec = { ...WALK, entrypointType: "CLI_LAUNCHED_DEDICATED_WINDOW" };
    const res = validateEntrypointContract("COUPANG_WING_GUIDED_ISSUANCE_WALK", asCli);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.cause).toBe("ENTRYPOINT_TYPE_MISMATCH");
  });

  /**
   * **`capableActions` has to cover what the run DOES.** The operator's one-line grant binds to this manifest,
   * and this list is the machine-checkable half of it. The walk gained two behaviours and declared neither: it
   * navigates once to the seller's WING landing at window open, and it reads the aggregate "both consent boxes
   * ticked" boolean to advance step 4. Both were disclosed in prose — `agentNavigations: 1`,
   * `sellerConsentObserved: true` — while this list still described a strictly narrower run.
   */
  describe("…and its capability list matches the run", () => {
    const SPEC = PHASE_SPECS.COUPANG_WING_GUIDED_ISSUANCE_WALK;
    const BOUNDARY = SPEC.guidedWalkBoundary!;

    it("declares BOTH navigations the boundary descriptor claims", () => {
      // Two since 2026-08-12: the landing, and the return to SellerOps the seller asks for on the last step.
      // The second one is why that step's button finally does what its label says.
      expect(BOUNDARY.agentNavigations).toBe(2);
      expect(SPEC.capableActions).toContain("NAVIGATE_TO_SELLER_LANDING_ONCE");
      expect(SPEC.capableActions).toContain("RETURN_TO_SELLEROPS_ON_SELLER_REQUEST");
    });

    it("declares the consent-state read the boundary descriptor claims", () => {
      expect(BOUNDARY.sellerConsentObserved).toBe(true);
      expect(SPEC.capableActions).toContain("OBSERVE_CONSENT_COMPLETE_AGGREGATE");
    });

    it("**a prose-only disclosure is not enough — every claim in the boundary has a capability**", () => {
      // The general form, so the next widening cannot be shipped as prose either. If a descriptor says the run
      // navigates or reads consent, the validated list must say so too.
      if (BOUNDARY.agentNavigations > 0) expect(SPEC.capableActions).toContain("NAVIGATE_TO_SELLER_LANDING_ONCE");
      // A SECOND navigation is a second capability, not a bigger number beside the first one.
      if (BOUNDARY.agentNavigations > 1) expect(SPEC.capableActions).toContain("RETURN_TO_SELLEROPS_ON_SELLER_REQUEST");
      if (BOUNDARY.sellerConsentObserved) expect(SPEC.capableActions).toContain("OBSERVE_CONSENT_COMPLETE_AGGREGATE");
    });

    it("no OTHER phase claims either — they are this walk's, and no census reads `checked`", () => {
      for (const [phase, spec] of Object.entries(PHASE_SPECS)) {
        if (phase === "COUPANG_WING_GUIDED_ISSUANCE_WALK") continue;
        expect(spec.capableActions, phase).not.toContain("NAVIGATE_TO_SELLER_LANDING_ONCE");
        expect(spec.capableActions, phase).not.toContain("RETURN_TO_SELLEROPS_ON_SELLER_REQUEST");
        expect(spec.capableActions, phase).not.toContain("OBSERVE_CONSENT_COMPLETE_AGGREGATE");
      }
    });

    it("still claims nothing that presses, types, or reads a value", () => {
      for (const forbidden of ["CLICK", "SUBMIT", "TYPE", "READ_CREDENTIAL_VALUE", "CREATE_KEY"]) {
        expect(SPEC.capableActions).not.toContain(forbidden as never);
      }
      expect(BOUNDARY.agentPerformsAction).toBe(false);
      expect(BOUNDARY.credentialValueReadBudget).toBe(0);
      // The PRESS is never automatic. Renamed from `keyCreationAutoAdvances` on 2026-08-12, when the key-issuing
      // step gained an observed advance and one field could no longer say both things — and the one that could
      // be misread is the one guarding the irreversible act.
      expect(BOUNDARY.keyCreationPressAutoPerformed).toBe(false);
      expect(BOUNDARY.agentCreatesKeyMaterial).toBe(false);
    });

    it("**declares that the OPERATOR ends this run holding a real key** — the agent's budget is not the whole story", () => {
      // Until 2026-08-12 the walk stopped one screen short of any key existing, so `createsKeyMaterial: false`
      // read as both "the agent makes none" and "none is made". Only the first was ever asserted. The second is
      // now untrue, and this pair is what stops them being read as one claim.
      expect(BOUNDARY.operatorIssuesRealKey).toBe(true);
      expect(BOUNDARY.restsBeforeControl).toBe("확인 (vendor-method screen)");
      // The advance AFTER the press is an observation of the RESULT — the credential label cannot paint before
      // a credential exists. (It said "the page category cannot become `credential_shown`" until 2026-08-12,
      // which named a transition that is unreachable on this surface and therefore never fired.)
      expect(BOUNDARY.keyIssuanceAdvancesOnObservedResult).toBe(true);
      // The method the walk names is a PRODUCT decision, and the descriptor says whose.
      expect(BOUNDARY.vendorMethodGuided).toBe("자체개발(직접입력)");
      expect(BOUNDARY.vendorMethodDecidedBy).toBe("PRODUCT_OWNER");
      expect(BOUNDARY.highlightedControlCount).toBe(9);
      expect(BOUNDARY.ringedInputControlCount).toBe(0);
    });
  });
});
