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
  validateEntrypointContract,
  VISUAL_RECON_ARTIFACT_CATEGORY,
  type ApprovalPrereqInput,
  type EntrypointSpec,
} from "../../src/cli/approval-manifest";
import { VISUAL_RECON_SCREENS } from "../../src/action-window/api-issuance-calibration/visual-recon";

const OBS = PHASE_SPECS.API_CENTER_STRUCTURE_OBSERVATION;
const HL = PHASE_SPECS.API_ISSUANCE_HIGHLIGHT_PROOF;
const VR = PHASE_SPECS.API_CENTER_VISUAL_RECON;

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

  it("ONLY the guided-connection phase emits a bound frontend URL; both calibration phases do not", () => {
    expect(PHASE_ENTRYPOINTS.NAVER_GUIDED_CONNECTION.entrypointType).toBe("FRONTEND_URL");
    expect(PHASE_ENTRYPOINTS.NAVER_GUIDED_CONNECTION.emitsFrontendUrl).toBe(true);
    expect(PHASE_ENTRYPOINTS.API_CENTER_STRUCTURE_OBSERVATION.emitsFrontendUrl).toBe(false);
    expect(PHASE_ENTRYPOINTS.API_ISSUANCE_HIGHLIGHT_PROOF.emitsFrontendUrl).toBe(false);
    // Exactly one entrypoint phase emits a frontend URL.
    const urlPhases = ENTRYPOINT_PHASES.filter((p) => PHASE_ENTRYPOINTS[p].emitsFrontendUrl);
    expect(urlPhases).toEqual(["NAVER_GUIDED_CONNECTION"]);
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
