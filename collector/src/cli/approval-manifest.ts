/**
 * **Approval Manifest prerequisites + calibration phase specs (pure, testable).**
 *
 * The canonical live-run approval contract (`docs/sellerops_live_approval_contract.md`) says a manifest may
 * only reach **PREPARED** when the approved run is **immediately executable with no further operator input**.
 * This module is where that is enforced: `validateApprovalPrerequisites` refuses to build a manifest unless
 * every execution value the run needs is present, host-screened, phase-consistent, and matches the driver's
 * real capability. If any is missing, `bootstrap`/`preflight` must **not** emit a manifest and must **not**
 * ask for approval — they exit `PREFLIGHT FAIL: approval_prerequisite` (see the CLI wrapper).
 *
 * It also splits API-center calibration into two phases whose TOOLS differ, so a single manifest can never
 * promise an action its driver cannot perform:
 *  - `API_CENTER_STRUCTURE_OBSERVATION` (Phase A) — the audited read-only `calibrate-api-center` multi-checkpoint
 *    calibrator. It classifies the sanitized page category, reads a structural census, and calibrates each
 *    surface's control from the operator's hover+hotkey — read-only; it does NOT highlight or click. A Phase-A
 *    manifest that declares `HIGHLIGHT_REAL_CONTROL` is a phase/capability mismatch and is refused. It also
 *    requires a defined capture hotkey and a gitignored raw-artifact path (`ARTIFACT_PATH_UNSAFE` otherwise).
 *  - `API_ISSUANCE_HIGHLIGHT_PROOF` (Phase B) — the `NaverIssuanceDriver` Action Window that highlights real
 *    controls and observes the operator's own click. It is refused until the control selectors have actually
 *    been calibrated against the live API center (`SELECTORS_CALIBRATED`), because the fixture markers park
 *    every highlight `target_not_found`.
 *
 * Pure: no I/O, no browser, no network. The CLI wrapper (`approval-manifest-cli.ts`) adds the fs dry-check
 * (the CLI entrypoint file exists) and env reads; `preflight.sh` calls it.
 */
import { SELECTORS_CALIBRATED } from "../action-window/api-issuance/api-center-adapter";
import { VISUAL_RECON_SCREENS } from "../action-window/api-issuance-calibration/visual-recon";
import { screenApiCenterUrl } from "./observe-api-center";

/**
 * The calibration phases. Their driver capabilities differ, so their manifests/approvals are separate:
 *  - `API_CENTER_STRUCTURE_OBSERVATION` — hotkey calibrator (hover+hotkey).
 *  - `API_ISSUANCE_HIGHLIGHT_PROOF` — highlight/observe Action Window (needs calibrated selectors).
 *  - `API_CENTER_VISUAL_RECON` — the redacted-screenshot recon (`capture-api-center-visual`): NO hotkey, NO
 *    highlight; it redacts every sensitive region, verifies coverage, then screenshots the redacted viewport
 *    and writes a sanitized closed-vocabulary summary into the gitignored `.calibration/visual/` sink.
 */
export const CALIBRATION_PHASES = ["API_CENTER_STRUCTURE_OBSERVATION", "API_ISSUANCE_HIGHLIGHT_PROOF", "API_CENTER_VISUAL_RECON"] as const;
export type CalibrationPhase = (typeof CALIBRATION_PHASES)[number];

/**
 * Sanitized action codes a manifest may declare. `HIGHLIGHT_REAL_CONTROL` is Phase-B-only;
 * `REDACT_SENSITIVE_REGIONS` / `CAPTURE_REDACTED_VIEWPORT` are visual-recon-only.
 */
export const APPROVAL_ACTIONS = [
  "OPEN_DEDICATED_WINDOW",
  "WAIT_OPERATOR_LOGIN_NAV",
  "CLASSIFY_SANITIZED_PAGE_CATEGORY",
  "STRUCTURAL_CENSUS",
  "STRUCTURAL_CONTROL_HINTS",
  "HIGHLIGHT_REAL_CONTROL",
  "OBSERVE_USER_CLICK_TRANSITION",
  "REDACT_SENSITIVE_REGIONS",
  "CAPTURE_REDACTED_VIEWPORT",
] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

const HIGHLIGHT_ACTIONS: readonly ApprovalAction[] = ["HIGHLIGHT_REAL_CONTROL"];

export interface PhaseSpec {
  phase: CalibrationPhase;
  /** The EXACT CLI entrypoint (repo-relative) this phase runs. */
  cli: string;
  /** The EXACT driver this phase uses. */
  driver: string;
  /** The closed set of actions this phase's driver can actually perform. A manifest may declare a subset. */
  capableActions: readonly ApprovalAction[];
  /** Whether this phase highlights a real control (⇒ requires calibrated selectors). */
  allowsHighlight: boolean;
  mode: "READ_ONLY";
  /** Visual-recon only: the fixed, closed set of API-center screens the redacted-screenshot recon may capture. */
  captureScreens?: readonly string[];
  /** Visual-recon only: the gitignored sink category the redacted PNG + sanitized JSON summary land in. */
  artifactCategory?: string;
  /** Visual-recon only: the screenshot policy — a redacted viewport only, never a raw screen. */
  screenshotPolicy?: string;
  /** Visual-recon only: the structural summary policy — sanitized closed-vocabulary only, never raw text/values. */
  structuralSummaryPolicy?: string;
}

/** The gitignored artifact category for the redacted-screenshot recon (a `.calibration/` sub-sink). */
export const VISUAL_RECON_ARTIFACT_CATEGORY = ".calibration/visual/";
const VISUAL_RECON_SCREENSHOT_POLICY = "redacted viewport only";
const VISUAL_RECON_SUMMARY_POLICY = "sanitized closed-vocabulary only";

export const PHASE_SPECS: Readonly<Record<CalibrationPhase, PhaseSpec>> = {
  API_CENTER_STRUCTURE_OBSERVATION: {
    phase: "API_CENTER_STRUCTURE_OBSERVATION",
    cli: "src/cli/calibrate-api-center.ts",
    driver: "calibrate-api-center (multi-checkpoint read-only calibrator)",
    capableActions: [
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "STRUCTURAL_CENSUS",
      "STRUCTURAL_CONTROL_HINTS",
    ],
    allowsHighlight: false,
    mode: "READ_ONLY",
  },
  API_ISSUANCE_HIGHLIGHT_PROOF: {
    phase: "API_ISSUANCE_HIGHLIGHT_PROOF",
    cli: "src/cli/run-api-issuance-live-naver.ts",
    driver: "NaverIssuanceDriver (Action Window highlight/observe)",
    capableActions: [
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "HIGHLIGHT_REAL_CONTROL",
      "OBSERVE_USER_CLICK_TRANSITION",
    ],
    allowsHighlight: true,
    mode: "READ_ONLY",
  },
  API_CENTER_VISUAL_RECON: {
    phase: "API_CENTER_VISUAL_RECON",
    cli: "src/cli/capture-api-center-visual.ts",
    driver: "capture-api-center-visual (redacted-screenshot visual recon)",
    // Read-only: open window, wait for the operator to navigate, classify + census the sanitized page, then
    // redact every sensitive region and (only after coverage verifies) screenshot the redacted viewport. It
    // NEVER highlights, clicks, or observes a click — the redact + capture pair is its whole added capability.
    capableActions: [
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "STRUCTURAL_CENSUS",
      "REDACT_SENSITIVE_REGIONS",
      "CAPTURE_REDACTED_VIEWPORT",
    ],
    allowsHighlight: false,
    mode: "READ_ONLY",
    captureScreens: VISUAL_RECON_SCREENS,
    artifactCategory: VISUAL_RECON_ARTIFACT_CATEGORY,
    screenshotPolicy: VISUAL_RECON_SCREENSHOT_POLICY,
    structuralSummaryPolicy: VISUAL_RECON_SUMMARY_POLICY,
  },
};

/** Why the prerequisites were not met. Each maps to a `PREFLIGHT FAIL: approval_prerequisite (<cause>)`. */
export const APPROVAL_PREREQ_CAUSES = [
  "UNKNOWN_PHASE",
  "MISSING_URL",
  "INVALID_HOST",
  "CLI_DRIVER_UNCONFIRMED",
  "HIGHLIGHT_ACTION_IN_OBSERVATION_PHASE",
  "SELECTORS_NOT_CALIBRATED",
  "ACTION_CAPABILITY_MISMATCH",
  "MISSING_ENV",
  "MODE_MISMATCH",
  "RAW_ACCOUNT_ID",
  "UNBOUND_IDENTITY",
  "MISSING_HOTKEY",
  "ARTIFACT_PATH_UNSAFE",
  // Visual-recon: the captured screens declared by the phase must be exactly the driver's fixed screen set.
  "VISUAL_SCREENS_MISMATCH",
  // Operator-entrypoint contract (the phase's ONE true operator action must match its entrypoint type).
  "ENTRYPOINT_TYPE_MISMATCH",
  "ENTRYPOINT_CLI_MISMATCH",
  "FRONTEND_URL_IN_CLI_ENTRYPOINT",
  "CLI_DESC_IN_FRONTEND_ENTRYPOINT",
] as const;
export type ApprovalPrereqCause = (typeof APPROVAL_PREREQ_CAUSES)[number];

/**
 * Per-phase OPERATOR ENTRYPOINT contract. The defect this closes: `preflight.sh` printed the order-connection
 * frontend URL (`/connect/naver?walkthroughRun=…`) as THE operator action for EVERY phase — but a calibration
 * phase's real operator action is the CLI-launched dedicated Chrome window, never a frontend URL. Each phase
 * declares exactly ONE entrypoint so the operator is told the single true action and nothing else.
 */
export const ENTRYPOINT_TYPES = ["CLI_LAUNCHED_DEDICATED_WINDOW", "FRONTEND_URL"] as const;
export type EntrypointType = (typeof ENTRYPOINT_TYPES)[number];

/** The phases that carry an operator entrypoint: the three calibration phases + the guided order connection. */
export const ENTRYPOINT_PHASES = [
  "API_CENTER_STRUCTURE_OBSERVATION",
  "API_ISSUANCE_HIGHLIGHT_PROOF",
  "API_CENTER_VISUAL_RECON",
  "NAVER_GUIDED_CONNECTION",
] as const;
export type EntrypointPhase = (typeof ENTRYPOINT_PHASES)[number];

export interface EntrypointSpec {
  entrypointType: EntrypointType;
  /** The EXACT CLI entrypoint (repo-relative) for a CLI_LAUNCHED_DEDICATED_WINDOW; "" for a FRONTEND_URL phase. */
  cli: string;
  /** A stable, sanitized command id — never a raw command line, flags, or URL. */
  entrypointCommandId: string;
  /** One line naming the SINGLE action the operator performs — no raw command, no frontend URL for CLI phases. */
  operatorActionSummary: string;
  /** Whether the operator's action is opening a bound frontend URL (true ONLY for the guided-connection phase). */
  emitsFrontendUrl: boolean;
}

/**
 * The one true entrypoint per phase. Calibration phases open a CLI-launched dedicated Chrome (no frontend URL);
 * only the guided-connection phase hands the operator a bound frontend URL. `operatorActionSummary` is
 * hotkey-agnostic (the concrete capture hotkey rides the manifest's own `hotkey` field).
 */
export const PHASE_ENTRYPOINTS: Readonly<Record<EntrypointPhase, EntrypointSpec>> = {
  API_CENTER_STRUCTURE_OBSERVATION: {
    entrypointType: "CLI_LAUNCHED_DEDICATED_WINDOW",
    cli: "src/cli/calibrate-api-center.ts",
    entrypointCommandId: "calibrate-api-center",
    operatorActionSummary:
      "승인 후 SellerOps가 전용 Chrome 창을 엽니다. 열린 창에서 직접 로그인·이동한 뒤 캡처 단축키로 대상을 확정하세요.",
    emitsFrontendUrl: false,
  },
  API_ISSUANCE_HIGHLIGHT_PROOF: {
    entrypointType: "CLI_LAUNCHED_DEDICATED_WINDOW",
    cli: "src/cli/run-api-issuance-live-naver.ts",
    entrypointCommandId: "run-api-issuance-live-naver",
    operatorActionSummary:
      "승인 후 SellerOps가 전용 Chrome 창을 엽니다. 강조된 실제 컨트롤을 직접 클릭하면 SellerOps가 관찰합니다.",
    emitsFrontendUrl: false,
  },
  API_CENTER_VISUAL_RECON: {
    entrypointType: "CLI_LAUNCHED_DEDICATED_WINDOW",
    cli: "src/cli/capture-api-center-visual.ts",
    entrypointCommandId: "capture-api-center-visual",
    operatorActionSummary:
      "승인 후 SellerOps가 전용 Chrome 창을 엽니다. 직접 로그인·이동한 뒤 각 화면에서 준비되면 ready 를 보내세요. SellerOps는 민감 영역을 가린 뒤에만 화면을 캡처합니다.",
    emitsFrontendUrl: false,
  },
  NAVER_GUIDED_CONNECTION: {
    entrypointType: "FRONTEND_URL",
    cli: "",
    entrypointCommandId: "frontend-connect-naver",
    operatorActionSummary: "브라우저 새 창에서 아래 연결 마법사 주소를 여세요.",
    emitsFrontendUrl: true,
  },
};

/** Tokens that must never appear in a CLI phase's operator action — a CLI phase opens a window, not a URL. */
const FRONTEND_URL_MARKERS: readonly string[] = ["http://", "https://", "/connect/naver", "?walkthroughRun="];
/** Tokens that must never appear in a FRONTEND_URL phase's operator action — it must not describe a CLI. */
const CLI_ONLY_MARKERS: readonly string[] = ["전용 Chrome", "dedicated window", "src/cli/", ".ts"];

export type EntrypointContractResult = { ok: true } | { ok: false; cause: ApprovalPrereqCause; reason: string };

/**
 * A phase's entrypoint spec must match its canonical contract AND be internally consistent, so a manifest can
 * never tell the operator to open a URL for a CLI phase (or describe a CLI for the URL phase). Pure, order-stable.
 */
export function validateEntrypointContract(phase: EntrypointPhase, spec: EntrypointSpec): EntrypointContractResult {
  const canonical = PHASE_ENTRYPOINTS[phase];
  if (spec.entrypointType !== canonical.entrypointType) {
    return { ok: false, cause: "ENTRYPOINT_TYPE_MISMATCH", reason: `${phase} entrypoint type must be ${canonical.entrypointType}` };
  }
  const summary = spec.operatorActionSummary ?? "";
  if (spec.entrypointType === "CLI_LAUNCHED_DEDICATED_WINDOW") {
    // A CLI phase must name exactly its canonical CLI, and must never surface a frontend URL as the action.
    if (!spec.cli || spec.cli !== canonical.cli) {
      return { ok: false, cause: "ENTRYPOINT_CLI_MISMATCH", reason: `${phase} entrypoint cli must be exactly "${canonical.cli}"` };
    }
    if (spec.emitsFrontendUrl || FRONTEND_URL_MARKERS.some((m) => summary.includes(m))) {
      return { ok: false, cause: "FRONTEND_URL_IN_CLI_ENTRYPOINT", reason: `${phase} is CLI-launched — its operator action must carry no frontend URL` };
    }
  } else {
    // A frontend-URL phase must name NO CLI and must not describe a CLI-only action.
    if (spec.cli || CLI_ONLY_MARKERS.some((m) => summary.includes(m))) {
      return { ok: false, cause: "CLI_DESC_IN_FRONTEND_ENTRYPOINT", reason: `${phase} is a frontend URL entrypoint — it must not name or describe a CLI` };
    }
    if (!spec.emitsFrontendUrl) {
      return { ok: false, cause: "ENTRYPOINT_TYPE_MISMATCH", reason: `${phase} is a frontend URL entrypoint and must emit a bound frontend URL` };
    }
  }
  return { ok: true };
}

/** A bare internal id/token shape — pure digits (≥4) or a long hex token (≥16). Never an accountBinding. */
const RAW_ID_SHAPE = /^[0-9]{4,}$|^[0-9a-f]{16,}$/i;

export interface ApprovalPrereqInput {
  phase: string;
  channel: string;
  /** Sanitized account description — never a raw id (guarded here in `validateApprovalPrerequisites`). */
  accountBinding: string;
  mode: string;
  /** The API-center URL the run will open (operator-owned; reduced to a host category in the manifest). */
  apiCenterUrl: string | undefined;
  /** The EXACT CLI + driver the caller intends to run — must match the phase spec (confirms them). */
  cli: string | undefined;
  driver: string | undefined;
  /** The actions the manifest declares. Must be a subset of the phase's capability. */
  declaredActions: readonly string[];
  /** Required env var names the caller found MISSING (empty ⇒ all present). */
  missingEnv?: readonly string[];
  /** Override for tests; defaults to the code-level `SELECTORS_CALIBRATED` flag. */
  selectorsCalibrated?: boolean;
  /** The calibration capture hotkey label (Phase A only) — must be defined for the calibrator to arm capture. */
  hotkey?: string;
  /** The gitignored raw-artifact path (Phase A only) — must resolve under the `.calibration/` dir. */
  artifactPath?: string;
  runId: string;
  approvalId: string;
  gitSha: string;
  maxActions: string;
  surface: string;
  operation: string;
}

/** The sanitized manifest — no raw URL (host category only), no secret, no raw account/store id. */
export interface ApprovalManifest {
  approvalId: string;
  walkthroughRunId: string;
  channel: string;
  surface: string;
  operation: string;
  phase: CalibrationPhase;
  cli: string;
  driver: string;
  mode: "READ_ONLY";
  accountBinding: string;
  apiCenterHost: string; // host CATEGORY enum, never the raw URL
  allowedActions: readonly ApprovalAction[];
  maxActions: string;
  operatorPresenceRequired: true;
  selectorsCalibrated: boolean;
  /** How the operator reaches the run — a CLI-launched dedicated window, or a bound frontend URL. */
  entrypointType: EntrypointType;
  /** Stable, sanitized entrypoint command id — never a raw command line/flags/URL. */
  entrypointCommandId: string;
  /** The single operator action for this phase (no raw command; no frontend URL for CLI phases). */
  operatorActionSummary: string;
  /** The calibration capture hotkey (Phase A); empty for phases that do not calibrate. */
  hotkey: string;
  /** The gitignored raw-artifact path (Phase A); empty for phases that write no raw artifact. */
  artifactPath: string;
  /** Visual-recon only: the fixed, closed set of screens the redacted-screenshot recon may capture. */
  captureScreens?: readonly string[];
  /** Visual-recon only: the gitignored sink category for the redacted PNG + sanitized JSON summary. */
  artifactCategory?: string;
  /** Visual-recon only: the screenshot policy — a redacted viewport only. */
  screenshotPolicy?: string;
  /** Visual-recon only: the structural summary policy — sanitized closed-vocabulary only. */
  structuralSummaryPolicy?: string;
  expiresAt: "process-lifetime";
  gitSha: string;
}

/**
 * A calibration raw-artifact path is safe ONLY when it is a repo-relative path under the gitignored
 * `.calibration/` dir with no traversal — so a manifest can never point the RAW selector sink at a committed
 * or out-of-tree location. Fail-closed: anything else is unsafe.
 */
export function isSafeCalibrationArtifactPath(p: string): boolean {
  if (!p) return false;
  const norm = p.replace(/\\/g, "/").trim();
  if (norm.length === 0) return false;
  if (norm.startsWith("/")) return false; // must be repo-relative, never absolute
  if (/^[A-Za-z]:/.test(norm)) return false; // never an absolute Windows path
  if (norm.split("/").some((seg) => seg === "..")) return false; // no traversal
  return norm.startsWith(".calibration/");
}

export type ApprovalPrereqResult =
  | { ok: true; manifest: ApprovalManifest }
  | { ok: false; cause: ApprovalPrereqCause; reason: string };

function fail(cause: ApprovalPrereqCause, reason: string): ApprovalPrereqResult {
  return { ok: false, cause, reason };
}

/**
 * Enforce the PREPARED prerequisites and build the manifest, or refuse. Pure and order-stable so the failure
 * cause is deterministic. Every refusal means: do NOT emit a manifest, do NOT request approval.
 */
export function validateApprovalPrerequisites(input: ApprovalPrereqInput): ApprovalPrereqResult {
  // 1) Phase must be a known calibration phase (⇒ a confirmed CLI+driver exist for it).
  if (!(CALIBRATION_PHASES as readonly string[]).includes(input.phase)) {
    return fail("UNKNOWN_PHASE", `phase must be one of ${CALIBRATION_PHASES.join(" | ")}`);
  }
  const spec = PHASE_SPECS[input.phase as CalibrationPhase];

  // 2) The exact CLI + driver must be confirmed AND match the phase spec (no unconfirmed/ambiguous tool).
  if (!input.cli || !input.driver || input.cli !== spec.cli || input.driver !== spec.driver) {
    return fail("CLI_DRIVER_UNCONFIRMED", `phase ${spec.phase} runs cli=${spec.cli} driver=${spec.driver}; confirm exactly these`);
  }

  // 3) Mode must be the phase's mode (both calibration phases are READ_ONLY).
  if (input.mode !== spec.mode) return fail("MODE_MISMATCH", `phase ${spec.phase} is ${spec.mode}`);

  // 4) The API-center URL must be present and pass host screening BEFORE a manifest exists.
  if (!input.apiCenterUrl || input.apiCenterUrl.length === 0) {
    return fail("MISSING_URL", "the API-center URL is required and must be present before the manifest is prepared");
  }
  const screen = screenApiCenterUrl(input.apiCenterUrl);
  if (!screen.ok) {
    return fail("INVALID_HOST", `API-center URL failed screening (reason=${screen.reason}); must be the API-center/auth host`);
  }

  // 5) Required env must all be present.
  if (input.missingEnv && input.missingEnv.length > 0) {
    return fail("MISSING_ENV", `missing required env: ${input.missingEnv.join(", ")}`);
  }

  // 6) Declared actions must be within the phase's real capability.
  const declared = input.declaredActions;
  for (const a of declared) {
    if (!(APPROVAL_ACTIONS as readonly string[]).includes(a)) {
      return fail("ACTION_CAPABILITY_MISMATCH", `unknown action ${a}`);
    }
  }
  // 6a) A highlight action in the observation phase is the exact mismatch this split exists to prevent.
  if (!spec.allowsHighlight && declared.some((a) => (HIGHLIGHT_ACTIONS as readonly string[]).includes(a))) {
    return fail("HIGHLIGHT_ACTION_IN_OBSERVATION_PHASE", `${spec.phase} cannot highlight — its driver only observes`);
  }
  // 6b) Every declared action must be one the phase's driver can actually perform.
  if (!declared.every((a) => (spec.capableActions as readonly string[]).includes(a))) {
    return fail("ACTION_CAPABILITY_MISMATCH", `declared actions exceed ${spec.phase} driver capability`);
  }

  // 7) The highlight-proof phase requires the control selectors to be calibrated for real (not fixtures).
  const calibrated = input.selectorsCalibrated ?? SELECTORS_CALIBRATED;
  if (spec.allowsHighlight && !calibrated) {
    return fail(
      "SELECTORS_NOT_CALIBRATED",
      `${spec.phase} needs calibrated control selectors; run ${PHASE_SPECS.API_CENTER_STRUCTURE_OBSERVATION.phase} first and land the real selectors`,
    );
  }

  // 7b) The calibration OBSERVATION phase must carry a defined capture hotkey and a gitignored raw-artifact
  // path. The hotkey is what the operator presses to confirm a control; the raw selectors must land ONLY in
  // the gitignored `.calibration/` sink, never a committed/out-of-tree file.
  if (spec.phase === "API_CENTER_STRUCTURE_OBSERVATION") {
    if (!input.hotkey || input.hotkey.trim().length === 0) {
      return fail("MISSING_HOTKEY", "the calibration capture hotkey must be defined before the manifest is prepared");
    }
    if (!input.artifactPath || !isSafeCalibrationArtifactPath(input.artifactPath)) {
      return fail("ARTIFACT_PATH_UNSAFE", "the raw artifact path must be a repo-relative path under the gitignored .calibration/ dir");
    }
  }

  // 7c) The visual-recon phase has NO hotkey (it never calibrates a control from a keypress). Its redacted PNG +
  // sanitized summary must land ONLY under the gitignored `.calibration/visual/` sink, and the screens it
  // declares must be exactly the driver's fixed screen set (a self-consistency guard against contract drift).
  if (spec.phase === "API_CENTER_VISUAL_RECON") {
    const artifact = (input.artifactPath ?? "").replace(/\\/g, "/");
    if (!artifact || !isSafeCalibrationArtifactPath(artifact) || !artifact.startsWith(VISUAL_RECON_ARTIFACT_CATEGORY)) {
      return fail("ARTIFACT_PATH_UNSAFE", `the visual-recon artifact path must be under the gitignored ${VISUAL_RECON_ARTIFACT_CATEGORY} sink`);
    }
    // Defense-in-depth: today `spec.captureScreens` IS the `VISUAL_RECON_SCREENS` reference, so this holds by
    // construction; it exists to fail closed if a future hand-edit hardcodes a different literal into the spec.
    const screens = spec.captureScreens ?? [];
    if (screens.length !== VISUAL_RECON_SCREENS.length || !VISUAL_RECON_SCREENS.every((s, i) => screens[i] === s)) {
      return fail("VISUAL_SCREENS_MISMATCH", `visual-recon capture screens must be exactly ${VISUAL_RECON_SCREENS.join(", ")}`);
    }
  }

  // 8) The account binding must be a sanitized DESCRIPTION — never a raw internal id/token. Guarded HERE (the
  // single gate every caller — phased CLI and inline preflight alike — passes through) so no path can echo a
  // raw account/store/org id into the manifest.
  if (RAW_ID_SHAPE.test(input.accountBinding)) {
    return fail("RAW_ACCOUNT_ID", "accountBinding must be a sanitized description, never a raw account/store/org id");
  }

  // 9) Identity must be bound: a manifest bound to no real approval / run / commit is not "immediately
  // executable" and must not reach PREPARED (fails closed on the CLI's `"unknown"` defaults).
  for (const [key, value] of [
    ["approvalId", input.approvalId],
    ["runId", input.runId],
    ["gitSha", input.gitSha],
  ] as const) {
    if (!value || value === "unknown") {
      return fail("UNBOUND_IDENTITY", `${key} must be a real bootstrapped value, not empty or "unknown"`);
    }
  }

  // 10) The operator entrypoint must match the phase. Both calibration phases are CLI-launched dedicated windows,
  // so a calibration manifest may NEVER carry a frontend URL as the operator action (that was the defect).
  const entrypoint = PHASE_ENTRYPOINTS[spec.phase];
  const entryCheck = validateEntrypointContract(spec.phase, entrypoint);
  if (!entryCheck.ok) return fail(entryCheck.cause, entryCheck.reason);

  const manifest: ApprovalManifest = {
    approvalId: input.approvalId,
    walkthroughRunId: input.runId,
    channel: input.channel,
    surface: input.surface,
    operation: input.operation,
    phase: spec.phase,
    cli: spec.cli,
    driver: spec.driver,
    mode: spec.mode,
    accountBinding: input.accountBinding,
    apiCenterHost: screen.urlCategory, // host category enum only — the raw URL never enters the manifest
    allowedActions: declared as readonly ApprovalAction[],
    maxActions: input.maxActions,
    operatorPresenceRequired: true,
    selectorsCalibrated: calibrated,
    entrypointType: entrypoint.entrypointType,
    entrypointCommandId: entrypoint.entrypointCommandId,
    operatorActionSummary: entrypoint.operatorActionSummary,
    hotkey: input.hotkey ?? "",
    artifactPath: input.artifactPath ?? "",
    // Visual-recon only: surface the fixed screen set, the gitignored sink, and the redaction/summary policies
    // so the operator approves exactly what the recon may capture and where it lands.
    ...(spec.phase === "API_CENTER_VISUAL_RECON"
      ? {
          captureScreens: spec.captureScreens,
          artifactCategory: spec.artifactCategory,
          screenshotPolicy: spec.screenshotPolicy,
          structuralSummaryPolicy: spec.structuralSummaryPolicy,
        }
      : {}),
    expiresAt: "process-lifetime",
    gitSha: input.gitSha,
  };
  return { ok: true, manifest };
}

/**
 * The verified public API-center base URL — the SAME for every account, so it is a constant here (host is on
 * the screening allow-list) and never has to be typed per run. An account-specific deep link is the only case
 * that needs the operator to preset `NAVER_API_CENTER_URL` in the gitignored run config before bootstrap.
 */
export const NAVER_API_CENTER_BASE_URL = "https://apicenter.commerce.naver.com/";
