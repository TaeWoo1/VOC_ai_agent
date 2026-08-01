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
 *  - `API_CENTER_STRUCTURE_OBSERVATION` (Phase A) — the audited read-only `observe-api-center` observer. It
 *    classifies the sanitized page category and reads a structural census; it does NOT highlight or click.
 *    A Phase-A manifest that declares `HIGHLIGHT_REAL_CONTROL` is a phase/capability mismatch and is refused.
 *  - `API_ISSUANCE_HIGHLIGHT_PROOF` (Phase B) — the `NaverIssuanceDriver` Action Window that highlights real
 *    controls and observes the operator's own click. It is refused until the control selectors have actually
 *    been calibrated against the live API center (`SELECTORS_CALIBRATED`), because the fixture markers park
 *    every highlight `target_not_found`.
 *
 * Pure: no I/O, no browser, no network. The CLI wrapper (`approval-manifest-cli.ts`) adds the fs dry-check
 * (the CLI entrypoint file exists) and env reads; `preflight.sh` calls it.
 */
import { SELECTORS_CALIBRATED } from "../action-window/api-issuance/api-center-adapter";
import { screenApiCenterUrl } from "./observe-api-center";

/** The two calibration phases. Their driver capabilities differ, so their manifests/approvals are separate. */
export const CALIBRATION_PHASES = ["API_CENTER_STRUCTURE_OBSERVATION", "API_ISSUANCE_HIGHLIGHT_PROOF"] as const;
export type CalibrationPhase = (typeof CALIBRATION_PHASES)[number];

/** Sanitized action codes a manifest may declare. `HIGHLIGHT_REAL_CONTROL` is Phase-B-only. */
export const APPROVAL_ACTIONS = [
  "OPEN_DEDICATED_WINDOW",
  "WAIT_OPERATOR_LOGIN_NAV",
  "CLASSIFY_SANITIZED_PAGE_CATEGORY",
  "STRUCTURAL_CENSUS",
  "STRUCTURAL_CONTROL_HINTS",
  "HIGHLIGHT_REAL_CONTROL",
  "OBSERVE_USER_CLICK_TRANSITION",
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
}

export const PHASE_SPECS: Readonly<Record<CalibrationPhase, PhaseSpec>> = {
  API_CENTER_STRUCTURE_OBSERVATION: {
    phase: "API_CENTER_STRUCTURE_OBSERVATION",
    cli: "src/cli/observe-api-center.ts",
    driver: "observe-api-center (read-only census/observer)",
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
] as const;
export type ApprovalPrereqCause = (typeof APPROVAL_PREREQ_CAUSES)[number];

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
  expiresAt: "process-lifetime";
  gitSha: string;
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
