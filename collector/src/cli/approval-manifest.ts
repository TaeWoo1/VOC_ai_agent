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
 *    controls and observes the operator's own click / navigation. It requires `SELECTORS_CALIBRATED` (now
 *    `true`): the three highlighted controls (create_app/api_group/credentials) are live-proven
 *    `matchCount===1`. **Same-page checkpoint model:** `OBSERVE_USER_CLICK_TRANSITION` is used for `open_app`
 *    ONLY — the one genuine `app_list → app_detail` navigation the runtime watches. Once on the detail page, the
 *    API group and Application ID are SAME-PAGE viewport checkpoints: the driver stabilizes, locates the section,
 *    `REVEAL_SECTION_IN_VIEWPORT` (scrolls it into view), and overlays a pointer — it arms NO click observer and
 *    waits for NO NAVER click; the operator advances each checkpoint with SellerOps's own "다음". Both branches
 *    are provable: the NEW-app (create) branch points at the register control (a checkpoint), the EXISTING-app
 *    branch guides the operator to open their app by TEXT and observes the transition, then both reach the same
 *    api_group/credentials checkpoints. The empty-app (create) branch remains provable only on a store with no
 *    application; the existing-app branch on a store that already has one.
 *  - `API_ISSUANCE_SELECTOR_PROBE` (Phase-B calibration) — a READ-ONLY run of the SAME `NaverIssuanceDriver`
 *    that only COUNTS how many candidates each highlight target's calibrated fixed-label locator matches (a
 *    value-free integer + a highlightable boolean); it never highlights, tags, clicks, or reads a value. It is
 *    the step that VALIDATES the driver's own locate mechanism live, so it does NOT itself require
 *    `SELECTORS_CALIBRATED` — confirming it is what later justifies flipping that flag.
 *
 * Pure: no I/O, no browser, no network. The CLI wrapper (`approval-manifest-cli.ts`) adds the fs dry-check
 * (the CLI entrypoint file exists) and env reads; `preflight.sh` calls it.
 */
import { SELECTORS_CALIBRATED } from "../action-window/api-issuance/api-center-adapter";
import { VISUAL_RECON_SCREENS, isCanonicalVisualReconSubset } from "../action-window/api-issuance-calibration/visual-recon";
import { screenApiCenterUrl } from "./observe-api-center";
// Pure leaf (zero imports): the Coupang WING host screen for the WING selector-probe phase. Screening the
// entry URL to the WING host (not the NAVER API-center host) is the ONLY channel-specific step in this gate.
import { screenWingUrl, isCanonicalWingProbeSubset, WING_PROBE_TARGET_NAMES } from "./coupang-wing-classifier";

/**
 * The calibration phases. Their driver capabilities differ, so their manifests/approvals are separate:
 *  - `API_CENTER_STRUCTURE_OBSERVATION` — hotkey calibrator (hover+hotkey).
 *  - `API_ISSUANCE_HIGHLIGHT_PROOF` — highlight/observe Action Window (needs calibrated selectors).
 *  - `API_CENTER_VISUAL_RECON` — the redacted-screenshot recon (`capture-api-center-visual`): NO hotkey, NO
 *    highlight; it redacts every sensitive region, verifies coverage, then screenshots the redacted viewport
 *    and writes a sanitized closed-vocabulary summary into the gitignored `.calibration/visual/` sink.
 */
export const CALIBRATION_PHASES = [
  "API_CENTER_STRUCTURE_OBSERVATION",
  "API_ISSUANCE_HIGHLIGHT_PROOF",
  "API_CENTER_VISUAL_RECON",
  "API_ISSUANCE_SELECTOR_PROBE",
  // The Coupang WING analog of `API_ISSUANCE_SELECTOR_PROBE`: a READ-ONLY run of the CoupangWingIssuanceDriver's
  // OWN fixed-label matchCount probe against the real WING open-API issuance page. It COUNTS how many candidates
  // each highlight target's fixed WING label matches (value-free integer + a highlightable boolean + an opaque
  // structural sig) and NEVER highlights, tags, clicks, types, or reads a value. It is the step that MEASURES
  // WING selector uniqueness (always `LIVE_DOM_CALIBRATION_PENDING`) so a later live run can flip calibration —
  // so it does NOT itself require calibrated selectors. Its entry URL is screened to the WING host (§ step 4).
  "COUPANG_WING_SELECTOR_PROBE",
  // The Coupang WING key-DELETION destructive phase. The AGENT stays READ_ONLY (it highlights the 삭제 control
  // and rests at a checkpoint; it NEVER clicks/deletes); the DESTRUCTIVE, IRREVERSIBLE action is the OPERATOR's
  // (deleting their WING self-developed Open API key — which immediately invalidates the existing Access/Secret
  // Key and is NOT recoverable). It highlights a real control ⇒ `allowsHighlight: true` ⇒ it FAILS CLOSED
  // (`SELECTORS_NOT_CALIBRATED`) unless the caller states the 삭제 calibration (live-confirmed since 2026-08-07;
  // this module never assumes it — see § step 7); and it also requires the immutable
  // operator-destructive-action contract (§ steps 7 + destructive-action check). Its scope is a marketplace
  // mutation the operator performs, so it is the FIRST phase to carry an `operatorDestructiveAction` descriptor.
  "COUPANG_WING_KEY_DELETION",
  // Not a calibration phase — the FE-run-host live proof of the existing-app guided issuance tutorial. It is
  // listed here because this is the set of phases the approval gate can emit + prerequisite-check. Unlike the
  // four calibration phases (CLI-launched dedicated window), its OPERATOR entrypoint is the bound FE URL: the
  // SellerOps FE (`/connect/naver`) is the SOLE run client and sends START_RUN exactly once; the CLI-launched
  // Local Agent host provides the dedicated Chrome + bridge carrier but sends NO START_RUN, and no standalone
  // proof client may run. READ-ONLY (zero credential/test/sync). See PHASE_SPECS + FE_LIVE_PROOF_* below.
  "API_ISSUANCE_FE_LIVE_PROOF",
] as const;
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
  // Phase-B same-page checkpoint: SCROLL a located section (API group / Application ID) into the viewport centre
  // so the operator can see it. Value-free (reads nothing); it moves the viewport, never clicks/types/reads.
  "REVEAL_SECTION_IN_VIEWPORT",
  "REDACT_SENSITIVE_REGIONS",
  "CAPTURE_REDACTED_VIEWPORT",
  // Read-only Phase-B selector probe: count how many candidates a target's FIXED-LABEL locator matches
  // (value-free integer + a highlightable boolean). It NEVER highlights, tags, clicks, or reads a value.
  "PROBE_TARGET_MATCHCOUNT",
] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

const HIGHLIGHT_ACTIONS: readonly ApprovalAction[] = ["HIGHLIGHT_REAL_CONTROL"];

/**
 * The immutable FE-run-host issuance-proof contract (`API_ISSUANCE_FE_LIVE_PROOF`). The SellerOps FE is the
 * SOLE run client: the CLI-launched Local Agent host opens the dedicated NAVER Chrome + bridge carrier but
 * sends NO START_RUN, and no standalone `issuance-live-proof.ts` client may run. READ-ONLY — START_RUN fires
 * exactly once from the FE, and there is zero credential / test / sync. These constants are the ONLY accepted
 * values; the gate refuses any manifest whose declared contract diverges (so the invariants cannot be softened
 * by a caller).
 */
export const FE_LIVE_PROOF_START_RUN_OWNER = "FRONTEND" as const;
export const FE_LIVE_PROOF_MAX_START_RUN = 1 as const;
export const FE_LIVE_PROOF_SUPPORTING_SURFACE = [
  "Local Agent host",
  "dedicated NAVER Chrome",
  "bridge carrier",
] as const;

/**
 * **The operator-performed DESTRUCTIVE marketplace action a phase is scoped around** (first used by
 * `COUPANG_WING_KEY_DELETION`). The distinction this encodes: the AGENT never mutates the marketplace — its
 * `mode` stays `READ_ONLY` (it highlights the control and rests at a checkpoint). The destructive, IRREVERSIBLE
 * change is the OPERATOR's own click, and the run's SCOPE authorizes exactly that. This mirrors how the
 * coupang-local harness's `mode: WRITE` names writes to *our* system while marketplace calls stay read-only —
 * here the marketplace-destructive action is named explicitly, as the operator's, with a mandatory checkpoint and
 * a zero credential-value-read budget. Every field is an immutable literal; the gate refuses any manifest whose
 * declared contract diverges, so a caller can never soften the invariant.
 */
export const COUPANG_WING_KEY_DELETION_OPERATION = "DELETE_WING_OPEN_API_KEY" as const;
export interface OperatorDestructiveAction {
  /** The destructive operation the OPERATOR performs (never the agent). */
  operation: typeof COUPANG_WING_KEY_DELETION_OPERATION;
  /** The deleted key cannot be restored — a NEW key must be issued to recover. */
  irreversible: true;
  /** Deleting immediately invalidates the existing Access/Secret Key (every signed call auth-fails). */
  invalidatesExistingCredentialImmediately: true;
  /** The agent highlights the control only; it never clicks/deletes — the operator does. */
  agentPerformsAction: false;
  /** A mandatory operator checkpoint (irreversibility warning) precedes the destructive action. */
  explicitCheckpointRequired: true;
  /** Zero credential-value reads (Access Key / Secret Key / 업체코드) during the run. */
  credentialValueReadBudget: 0;
}
export const COUPANG_WING_KEY_DELETION_DESTRUCTIVE_ACTION: OperatorDestructiveAction = {
  operation: COUPANG_WING_KEY_DELETION_OPERATION,
  irreversible: true,
  invalidatesExistingCredentialImmediately: true,
  agentPerformsAction: false,
  explicitCheckpointRequired: true,
  credentialValueReadBudget: 0,
};

/**
 * **The immutable run SCOPE a destructive phase's grant binds to.** The descriptor above pins *what* the
 * operator does; this pins *what run they are approving*. Both matter, because the operator's one-line
 * `Seated and ready.` binds to the manifest's channel / surface / operation / action budget
 * (`docs/sellerops_live_approval_contract.md` §2–3).
 *
 * The gap this closes: those four fields reached the manifest as unvalidated caller/env passthrough, so a stale
 * `SELLEROPS_APPROVAL_CHANNEL=NAVER` (left over from another run) would print a destructive manifest reading
 * "NAVER · read-only probe" while the run it authorizes is an irreversible Coupang WING key deletion — the
 * operator would grant against a description the run does not honor. Latent before the 삭제 calibration landed
 * (the phase could never reach PREPARED), live the moment it did. A destructive phase now refuses any deviation
 * instead of displaying it. It also forces the runtime CLI and the display CLI to declare the SAME budget
 * string; they had drifted apart.
 */
export interface DestructiveRunScope {
  readonly channel: string;
  readonly surface: string;
  readonly operation: string;
  readonly maxActions: string;
}
export const COUPANG_WING_KEY_DELETION_SCOPE: DestructiveRunScope = {
  channel: "COUPANG",
  surface: "Coupang WING Open API",
  operation: "WING open-API key deletion (operator-performed, irreversible; agent highlights only)",
  maxActions:
    "1 highlight-only session: SellerOps highlights the 삭제 control + rests at the irreversible-delete " +
    "checkpoint; the OPERATOR deletes; 0 agent click/type/value read",
};

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
  /**
   * Whether this phase is the FE-run-host issuance live proof — the FE is the sole run client (START_RUN once),
   * the CLI-launched host is a SUPPORTING surface only. When true the gate additionally enforces the immutable
   * FE_LIVE_PROOF_* contract (owner=FRONTEND, maxStartRun=1, zero credential/test/sync, supporting surface
   * present, host sends no START_RUN, no standalone proof client, FE URL bound to this run id).
   */
  requiresFeRunHostContract?: boolean;
  /**
   * Whether this phase's run is scoped around an operator-performed DESTRUCTIVE marketplace action. When true the
   * gate additionally enforces the immutable {@link OperatorDestructiveAction} contract (operation, irreversible,
   * immediate credential invalidation, agent-performs-nothing, mandatory checkpoint, zero value read).
   */
  requiresOperatorDestructiveAction?: boolean;
  /** The canonical destructive-action descriptor emitted into the manifest (present iff the flag above is set). */
  operatorDestructiveAction?: OperatorDestructiveAction;
  /** The immutable run scope a destructive phase's grant binds to; any caller deviation is refused. */
  destructiveScope?: DestructiveRunScope;
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
      // Same-page viewport checkpoint: scroll a located section into view (value-free) before overlaying it.
      "REVEAL_SECTION_IN_VIEWPORT",
      // open_app ONLY: the one genuine app_list → app_detail navigation the runtime observes.
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
  API_ISSUANCE_FE_LIVE_PROOF: {
    phase: "API_ISSUANCE_FE_LIVE_PROOF",
    // The SUPPORTING host: it opens the dedicated NAVER Chrome + `/bridge/ws` carrier so the FE can attach and
    // drive. It sends NO START_RUN (verified: the CLI carries no START_RUN / issuance-live-proof / spawn path).
    cli: "src/cli/run-api-issuance-live-naver.ts",
    driver: "NaverIssuanceDriver (Action Window highlight/observe) — hosted; the SellerOps FE run-host is the sole run client",
    // Same live capability as the highlight proof (existing-app branch): observe the app_list→detail
    // transition (open_app), then reveal + highlight the order API group and the Application ID/Secret section.
    capableActions: [
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "HIGHLIGHT_REAL_CONTROL",
      "REVEAL_SECTION_IN_VIEWPORT",
      "OBSERVE_USER_CLICK_TRANSITION",
    ],
    allowsHighlight: true, // ⇒ requires SELECTORS_CALIBRATED (selector readiness)
    mode: "READ_ONLY",
    requiresFeRunHostContract: true,
  },
  API_ISSUANCE_SELECTOR_PROBE: {
    phase: "API_ISSUANCE_SELECTOR_PROBE",
    cli: "src/cli/probe-issuance-selectors.ts",
    driver: "NaverIssuanceDriver (read-only fixed-label matchCount probe)",
    // Read-only: open window, wait for the operator to navigate each screen, classify + census the sanitized
    // page, then COUNT how many candidates each highlight target's calibrated fixed-label locator matches
    // (a value-free integer + a highlightable boolean). It NEVER highlights, tags, clicks, or reads a value —
    // it validates the DRIVER's own locate mechanism before `SELECTORS_CALIBRATED` may ever flip.
    capableActions: [
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "STRUCTURAL_CENSUS",
      "PROBE_TARGET_MATCHCOUNT",
    ],
    allowsHighlight: false,
    mode: "READ_ONLY",
  },
  COUPANG_WING_SELECTOR_PROBE: {
    phase: "COUPANG_WING_SELECTOR_PROBE",
    cli: "src/cli/probe-wing-issuance-selectors.ts",
    driver: "CoupangWingIssuanceDriver (read-only fixed-label matchCount probe)",
    // Read-only: open the dedicated window, wait for the operator to log in + navigate to the WING open-API
    // issuance page, classify + census the sanitized page, then COUNT how many candidates each highlight
    // target's fixed WING label matches (a value-free integer + a highlightable boolean). It NEVER highlights,
    // tags, clicks, or reads a value — it validates the WING driver's own locate mechanism so a later live run
    // can flip `LIVE_DOM_CALIBRATION_PENDING`; it therefore does NOT itself require calibrated selectors.
    capableActions: [
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "STRUCTURAL_CENSUS",
      "PROBE_TARGET_MATCHCOUNT",
    ],
    allowsHighlight: false,
    mode: "READ_ONLY",
  },
  COUPANG_WING_KEY_DELETION: {
    phase: "COUPANG_WING_KEY_DELETION",
    // Both original blockers are now resolved: the driver + CLI are built, and the 삭제 control is live-calibrated
    // (`WING_DELETION_CALIBRATION_EVIDENCE`). A PREPARED destructive manifest is therefore emittable — but only
    // when the CALLER passes `selectorsCalibrated: true` (see below: this module still defaults every WING phase
    // to `false`, so a caller who omits it fails closed), the destructive descriptor matches the immutable
    // canonical values exactly, and the `WALKTHROUGH_*` identity is bound. PREPARED is still not APPROVED.
    cli: "src/cli/run-coupang-wing-deletion-live.ts",
    driver: "CoupangWingDeletionDriver (Action Window highlight/observe — the operator deletes; the agent never clicks)",
    // AGENT capability is READ_ONLY highlight/observe: open the window, wait for the operator to reach the
    // already-issued page, classify it, reveal + highlight the 삭제 control, and rest at the checkpoint. It NEVER
    // clicks/deletes and reads no value — the destructive click is the operator's (see operatorDestructiveAction).
    capableActions: [
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "REVEAL_SECTION_IN_VIEWPORT",
      "HIGHLIGHT_REAL_CONTROL",
    ],
    allowsHighlight: true, // ⇒ requires calibrated WING selectors (LIVE_DOM_CALIBRATION_PENDING ⇒ fails closed)
    mode: "READ_ONLY", // AGENT mode — the destructive marketplace action is the OPERATOR's (operatorDestructiveAction)
    requiresOperatorDestructiveAction: true,
    operatorDestructiveAction: COUPANG_WING_KEY_DELETION_DESTRUCTIVE_ACTION,
    destructiveScope: COUPANG_WING_KEY_DELETION_SCOPE,
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
  // FE-run-host issuance live proof (`API_ISSUANCE_FE_LIVE_PROOF`): the FE is the sole START_RUN owner and the
  // run is strictly READ-only over a supporting (never-START_RUN) host.
  "MISSING_FE_RUN_HOST_CONTRACT",
  "START_RUN_OWNER_NOT_FRONTEND",
  "START_RUN_CAP_NOT_ONE",
  "WRITE_ACTIONS_NOT_ZERO",
  "MISSING_SUPPORTING_SURFACE",
  "HOST_SENDS_START_RUN",
  "PROOF_CLIENT_NOT_FORBIDDEN",
  "RUNID_URL_MISMATCH",
  // Operator-performed DESTRUCTIVE marketplace action (`COUPANG_WING_KEY_DELETION`): the run is scoped around an
  // irreversible operator deletion, so its immutable descriptor must be present and exactly the canonical values.
  "MISSING_DESTRUCTIVE_ACTION_CONTRACT",
  "DESTRUCTIVE_ACTION_CONTRACT_MISMATCH",
  // A destructive phase's manifest must describe the run it authorizes — channel / surface / operation / action
  // budget are pinned to the phase, never taken from caller env.
  "DESTRUCTIVE_SCOPE_MISMATCH",
  // The WING selector-probe per-run target scope must be a non-empty canonical subset of the fixed target set.
  "WING_PROBE_TARGETS_MISMATCH",
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

/** The phases that carry an operator entrypoint: the calibration phases, the FE-run-host issuance proof, and
 *  the guided order connection. Two of these emit a bound frontend URL (the FE-run-host proof + the guided
 *  order connection); the four calibration phases open a CLI-launched dedicated window. */
export const ENTRYPOINT_PHASES = [
  "API_CENTER_STRUCTURE_OBSERVATION",
  "API_ISSUANCE_HIGHLIGHT_PROOF",
  "API_CENTER_VISUAL_RECON",
  "API_ISSUANCE_SELECTOR_PROBE",
  "COUPANG_WING_SELECTOR_PROBE",
  "COUPANG_WING_KEY_DELETION",
  "API_ISSUANCE_FE_LIVE_PROOF",
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
      "승인 후 SellerOps가 전용 Chrome 창을 엽니다. 강조된 실제 컨트롤을 직접 클릭하면 SellerOps가 관찰합니다. " +
      "(신규 앱은 생성, 기존 앱은 직접 열면 — SellerOps가 상세 화면 진입을 관찰한 뒤 API 그룹·자격증명을 강조합니다.)",
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
  API_ISSUANCE_SELECTOR_PROBE: {
    entrypointType: "CLI_LAUNCHED_DEDICATED_WINDOW",
    cli: "src/cli/probe-issuance-selectors.ts",
    entrypointCommandId: "probe-issuance-selectors",
    operatorActionSummary:
      "승인 후 SellerOps가 전용 Chrome 창을 엽니다. 직접 로그인·이동한 뒤 각 화면에서 준비되면 ready 를 보내세요. SellerOps는 강조 없이 각 대상의 고정 라벨 일치 수만 읽습니다(클릭·입력·값 읽기 없음).",
    emitsFrontendUrl: false,
  },
  // The Coupang WING selector probe: a CLI-launched dedicated Chrome (never a frontend URL). The seller logs in
  // to WING + reaches the open-API 발급 page themselves; SellerOps reads only each target's fixed-label match
  // count — no highlight, no click, no input, no value read.
  COUPANG_WING_SELECTOR_PROBE: {
    entrypointType: "CLI_LAUNCHED_DEDICATED_WINDOW",
    cli: "src/cli/probe-wing-issuance-selectors.ts",
    entrypointCommandId: "probe-wing-issuance-selectors",
    operatorActionSummary:
      "승인 후 SellerOps가 전용 Chrome 창을 엽니다. 쿠팡(윙)에 직접 로그인·이동해 오픈API 발급 화면에서 준비되면 ready 를 보내세요. SellerOps는 강조 없이 각 대상의 고정 라벨 일치 수만 읽습니다(클릭·입력·값 읽기 없음).",
    emitsFrontendUrl: false,
  },
  // The Coupang WING key-DELETION phase: a CLI-launched dedicated Chrome (never a frontend URL). The seller logs
  // in to WING + reaches the already-issued open-API page themselves; SellerOps highlights ONLY the 삭제 control
  // location and RESTS at an explicit checkpoint that warns the deletion is irreversible and immediately
  // invalidates the existing key. The operator deletes themselves — SellerOps never clicks/deletes, and reads no
  // value (Access Key / Secret Key / 업체코드).
  COUPANG_WING_KEY_DELETION: {
    entrypointType: "CLI_LAUNCHED_DEDICATED_WINDOW",
    cli: "src/cli/run-coupang-wing-deletion-live.ts",
    entrypointCommandId: "run-coupang-wing-deletion-live",
    operatorActionSummary:
      "승인 후 SellerOps가 전용 Chrome 창을 엽니다. 쿠팡(윙)에 직접 로그인·이동해 이미 발급된 오픈API 화면에서 준비되면 ready 를 보내세요. " +
      "SellerOps는 삭제 버튼 위치만 강조하고 멈춥니다. 삭제는 되돌릴 수 없고 기존 키가 즉시 무효화됩니다 — 삭제는 직접 누르세요(클릭·입력·값 읽기 없음).",
    emitsFrontendUrl: false,
  },
  // The FE-run-host issuance live proof: the operator's ONE action is opening the bound FE wizard URL. The
  // supporting CLI-launched host (dedicated Chrome + bridge) is NOT the operator entrypoint and is declared in
  // the manifest's `supportingSurface` — so this summary carries NO CLI-only marker (it must pass the
  // FRONTEND_URL contract). The FE is the sole run client; START_RUN fires once from this screen.
  API_ISSUANCE_FE_LIVE_PROOF: {
    entrypointType: "FRONTEND_URL",
    cli: "",
    entrypointCommandId: "frontend-connect-naver-issuance",
    operatorActionSummary:
      "브라우저 새 창에서 아래 연결 마법사 주소를 여세요. 기존 앱을 선택하고 '화면을 보며 확인'을 누르면, SellerOps가 안내를 준비한 뒤 화면 안내를 시작합니다(안내 시작은 이 화면에서 한 번만).",
    emitsFrontendUrl: true,
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
  /**
   * Visual-recon ONLY (ignored otherwise): the per-run capture SCOPE — a non-empty subset of the phase's fixed
   * `captureScreens`, letting one investigation narrow the recon to just the screens it needs. Absent ⇒ the full
   * fixed set. Validated as a canonical subset (known screens only, no wider than the fixed set), so scoping can
   * only ever REDUCE what is captured.
   */
  requestedCaptureScreens?: readonly string[];
  /**
   * WING selector-probe ONLY (ignored otherwise): the per-run TARGET scope — a non-empty canonical subset of the
   * fixed WING probe target set (e.g. `["delete"]` for the delete-selector calibration). Absent ⇒ the full set.
   * Validated as a canonical subset, so scoping can only ever REDUCE what the probe measures, never widen it.
   */
  requestedProbeTargets?: readonly string[];
  runId: string;
  approvalId: string;
  gitSha: string;
  maxActions: string;
  surface: string;
  operation: string;
  /**
   * FE-run-host issuance-proof contract (required ONLY for `API_ISSUANCE_FE_LIVE_PROOF`; ignored otherwise).
   * Every field is validated against the immutable FE_LIVE_PROOF_* constants, so a caller cannot soften the
   * invariants — the gate refuses on any divergence.
   */
  startRunContract?: {
    /** Must be `FRONTEND` — the FE is the sole run client. */
    soleStartRunOwner: string;
    /** Must be 1 — START_RUN fires exactly once. */
    maxStartRun: number;
    /** Must all be 0 — READ-only proof. */
    credential: number;
    test: number;
    sync: number;
    /** Must include every FE_LIVE_PROOF_SUPPORTING_SURFACE member (host + Chrome + bridge). */
    supportingSurface: readonly string[];
    /** Must be false — the CLI-launched host never sends START_RUN. */
    hostSendsStartRun: boolean;
    /** Must be true — no standalone `issuance-live-proof.ts` client may drive the run. */
    forbidStandaloneProofClient: boolean;
    /** The bound FE wizard path; must carry `walkthroughRun=<this run id>`. */
    boundFrontendPath: string;
  };
  /**
   * Operator-performed DESTRUCTIVE marketplace action descriptor (required ONLY for a phase with
   * `requiresOperatorDestructiveAction`, e.g. `COUPANG_WING_KEY_DELETION`; ignored otherwise). Validated field-by-
   * field against the immutable {@link OperatorDestructiveAction} constant, so a caller cannot soften it.
   */
  operatorDestructiveAction?: OperatorDestructiveAction;
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
  /** WING selector probe only: the RESOLVED per-run target scope the read-only probe measures (full set or subset). */
  probeTargets?: readonly string[];
  /** Visual-recon only: the gitignored sink category for the redacted PNG + sanitized JSON summary. */
  artifactCategory?: string;
  /** Visual-recon only: the screenshot policy — a redacted viewport only. */
  screenshotPolicy?: string;
  /** Visual-recon only: the structural summary policy — sanitized closed-vocabulary only. */
  structuralSummaryPolicy?: string;
  // FE-run-host issuance proof only (`API_ISSUANCE_FE_LIVE_PROOF`): the run-client + supporting-surface facts
  // the operator approves. Absent on every other phase.
  /** The supporting surface (CLI-launched host + dedicated Chrome + bridge) — NOT the run client. */
  supportingSurface?: readonly string[];
  /** The sole run client that may send START_RUN — always `FRONTEND` here. */
  soleStartRunOwner?: string;
  /** The hard cap on START_RUN — always 1 here. */
  maxStartRun?: number;
  /** The zero write budget — credential/test/sync are all 0 on a READ-only proof. */
  writeBudget?: { credential: number; test: number; sync: number };
  /** The bound FE wizard path carrying this run's id (`/connect/naver?walkthroughRun=<runId>`). */
  boundFrontendPath?: string;
  /**
   * The operator-performed DESTRUCTIVE marketplace action this run is scoped around (present ONLY on a phase with
   * `requiresOperatorDestructiveAction`). The agent's `mode` stays `READ_ONLY`; this block is what makes the
   * irreversible operator action explicit in what the operator approves. Absent on every non-destructive phase.
   */
  operatorDestructiveAction?: OperatorDestructiveAction;
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
  // The WING selector probe screens its entry URL to the Coupang WING host; every NAVER phase screens to the
  // API-center host. Both return the same `{ ok, reason, urlCategory }` shape, so the manifest's `apiCenterHost`
  // (a host CATEGORY enum, never the raw URL) is filled uniformly below.
  const screen =
    spec.phase === "COUPANG_WING_SELECTOR_PROBE" || spec.phase === "COUPANG_WING_KEY_DELETION"
      ? screenWingUrl(input.apiCenterUrl)
      : screenApiCenterUrl(input.apiCenterUrl);
  if (!screen.ok) {
    return fail("INVALID_HOST", `entry URL failed screening (reason=${screen.reason}); must be the run's API-center / WING / auth host`);
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
  // `SELECTORS_CALIBRATED` is the NAVER API-center adapter flag; it is NOT the Coupang WING calibration status.
  // This module deliberately does NOT import the WING driver's calibration flag: WING phases default to `false`
  // and the WING calibration state must be passed IN by the caller (`run-coupang-wing-deletion-live.ts` feeds
  // `WING_DELETION_SELECTORS_CALIBRATED`). That keeps the default fail-closed — a caller who forgets the field
  // gets `SELECTORS_NOT_CALIBRATED` rather than silently inheriting another surface's calibration. The 삭제
  // control IS live-calibrated now, so the deletion phase reaches PREPARED when the caller states it; withdraw
  // the flag and the whole destructive path closes again. The read-only WING selector probe never highlights, so
  // the gate below is skipped for it regardless.
  const isWingPhase = spec.phase === "COUPANG_WING_SELECTOR_PROBE" || spec.phase === "COUPANG_WING_KEY_DELETION";
  const calibrated = input.selectorsCalibrated ?? (isWingPhase ? false : SELECTORS_CALIBRATED);
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
  // sanitized summary must land ONLY under the gitignored `.calibration/visual/` sink; its fixed screen set is a
  // self-consistency guard against contract drift, and a per-run scope may only NARROW it. The resolved capture
  // scope the manifest declares (full set, or a canonical subset) is carried here.
  let visualCaptureScreens: readonly string[] | undefined;
  if (spec.phase === "API_CENTER_VISUAL_RECON") {
    const artifact = (input.artifactPath ?? "").replace(/\\/g, "/");
    if (!artifact || !isSafeCalibrationArtifactPath(artifact) || !artifact.startsWith(VISUAL_RECON_ARTIFACT_CATEGORY)) {
      return fail("ARTIFACT_PATH_UNSAFE", `the visual-recon artifact path must be under the gitignored ${VISUAL_RECON_ARTIFACT_CATEGORY} sink`);
    }
    // Defense-in-depth: today `spec.captureScreens` IS the `VISUAL_RECON_SCREENS` reference, so this holds by
    // construction; it exists to fail closed if a future hand-edit hardcodes a different literal into the spec.
    const specScreens = spec.captureScreens ?? [];
    if (specScreens.length !== VISUAL_RECON_SCREENS.length || !VISUAL_RECON_SCREENS.every((s, i) => specScreens[i] === s)) {
      return fail("VISUAL_SCREENS_MISMATCH", `the visual-recon phase's fixed screen set must be exactly ${VISUAL_RECON_SCREENS.join(", ")}`);
    }
    // A per-run scope may NARROW the capture to a subset (e.g. app_list + app_detail for the usage-state check);
    // absent ⇒ the full fixed set. It is validated as a canonical, non-empty subset — known screens only, no
    // re-order, no duplicate — so scoping can never widen the capture beyond the fixed set, only reduce it. The
    // manifest declares (and the capture CLI honors) exactly this set.
    visualCaptureScreens = input.requestedCaptureScreens ?? specScreens;
    if (!isCanonicalVisualReconSubset(visualCaptureScreens)) {
      return fail("VISUAL_SCREENS_MISMATCH", `visual-recon capture scope must be a non-empty canonical subset of ${VISUAL_RECON_SCREENS.join(", ")}`);
    }
  }

  // 7d) The WING selector probe may carry a per-run TARGET scope (e.g. `["delete"]` for the delete-selector
  // calibration). Absent ⇒ the full fixed set; otherwise it must be a non-empty canonical subset (known targets
  // only, no re-order, no duplicate) so scoping can only NARROW the probe, never widen it. The manifest declares
  // (and the recorder honors) exactly this set.
  let wingProbeTargets: readonly string[] | undefined;
  if (spec.phase === "COUPANG_WING_SELECTOR_PROBE") {
    wingProbeTargets = input.requestedProbeTargets ?? [...WING_PROBE_TARGET_NAMES];
    if (!isCanonicalWingProbeSubset(wingProbeTargets)) {
      return fail("WING_PROBE_TARGETS_MISMATCH", `WING probe target scope must be a non-empty canonical subset of ${WING_PROBE_TARGET_NAMES.join(", ")}`);
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

  // 10) The operator entrypoint must match the phase. The four calibration phases are CLI-launched dedicated
  // windows (a calibration manifest may NEVER carry a frontend URL — that was the defect); the FE-run-host
  // issuance proof + the guided order connection are the only FRONTEND_URL entrypoints. This same guard makes
  // the cross combinations fail closed: the FE proof with a CLI entrypoint, or the highlight proof with a
  // frontend URL, both mismatch their canonical entrypoint and are refused here.
  const entrypoint = PHASE_ENTRYPOINTS[spec.phase];
  const entryCheck = validateEntrypointContract(spec.phase, entrypoint);
  if (!entryCheck.ok) return fail(entryCheck.cause, entryCheck.reason);

  // 11) FE-run-host issuance live proof: the FE is the SOLE run client. Enforce the immutable FE_LIVE_PROOF_*
  // contract so no manifest can soften it — owner=FRONTEND, exactly one START_RUN, zero credential/test/sync,
  // the supporting (host + Chrome + bridge) surface present, the host sends no START_RUN, no standalone proof
  // client, and the bound FE URL carries THIS run's id. Order-stable so the refusal cause is deterministic.
  if (spec.requiresFeRunHostContract) {
    const c = input.startRunContract;
    if (!c) return fail("MISSING_FE_RUN_HOST_CONTRACT", `${spec.phase} requires the FE-run-host START_RUN contract`);
    if (c.soleStartRunOwner !== FE_LIVE_PROOF_START_RUN_OWNER) {
      return fail("START_RUN_OWNER_NOT_FRONTEND", `the sole START_RUN owner must be ${FE_LIVE_PROOF_START_RUN_OWNER} (the FE run-host)`);
    }
    if (c.maxStartRun !== FE_LIVE_PROOF_MAX_START_RUN) {
      return fail("START_RUN_CAP_NOT_ONE", `maxStartRun must be exactly ${FE_LIVE_PROOF_MAX_START_RUN}`);
    }
    if (c.credential !== 0 || c.test !== 0 || c.sync !== 0) {
      return fail("WRITE_ACTIONS_NOT_ZERO", "credential/test/sync must all be 0 — the FE live proof is READ-only");
    }
    if (c.hostSendsStartRun !== false) {
      return fail("HOST_SENDS_START_RUN", "the CLI-launched host must send NO START_RUN — the FE is the sole run client");
    }
    if (c.forbidStandaloneProofClient !== true) {
      return fail("PROOF_CLIENT_NOT_FORBIDDEN", "a standalone issuance-live-proof client must be forbidden — the FE is the sole run client");
    }
    // EXACT set — the supporting surface is precisely the three canonical members, no more (no extra
    // caller free-text can ride into the manifest) and no fewer.
    if (
      !Array.isArray(c.supportingSurface) ||
      c.supportingSurface.length !== FE_LIVE_PROOF_SUPPORTING_SURFACE.length ||
      !FE_LIVE_PROOF_SUPPORTING_SURFACE.every((s) => c.supportingSurface.includes(s))
    ) {
      return fail(
        "MISSING_SUPPORTING_SURFACE",
        `the supporting surface must be exactly ${FE_LIVE_PROOF_SUPPORTING_SURFACE.join(", ")} (host + dedicated Chrome + bridge)`,
      );
    }
    // The bound FE URL must be the order-connection wizard path AND its walkthroughRun must EQUAL this run's
    // id — not a prefix, not a decoy param. Parse the query and compare exactly so a crafted/colliding path
    // (`…walkthroughRun=<runId>999`, or `…walkthroughRun=OTHER&x=walkthroughRun=<runId>`) fails closed.
    const path = c.boundFrontendPath ?? "";
    const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
    const runParam = query
      .split("&")
      .map((kv) => kv.split("="))
      .find(([k]) => k === "walkthroughRun")?.[1];
    if (!path.startsWith("/connect/naver?") || runParam !== input.runId) {
      return fail("RUNID_URL_MISMATCH", "the bound FE URL must be /connect/naver?… with walkthroughRun EXACTLY equal to this run's id");
    }
  }

  // 12) Operator-performed DESTRUCTIVE marketplace action. When the phase is scoped around an irreversible
  // operator action (e.g. WING key deletion), its immutable descriptor MUST be present and EXACTLY the canonical
  // values — so a caller can never soften irreversibility, claim the agent performs the action, drop the
  // mandatory checkpoint, or open a credential-value-read budget. Order-stable ⇒ deterministic refusal cause.
  // NOTE: this runs AFTER the selectors gate (step 7), so an uncalibrated WING deletion phase fails closed with
  // `SELECTORS_NOT_CALIBRATED` first — the destructive descriptor cannot mask the calibration requirement.
  if (spec.requiresOperatorDestructiveAction) {
    const d = input.operatorDestructiveAction;
    if (!d) {
      return fail("MISSING_DESTRUCTIVE_ACTION_CONTRACT", `${spec.phase} requires the operator-destructive-action descriptor`);
    }
    const canon = spec.operatorDestructiveAction ?? COUPANG_WING_KEY_DELETION_DESTRUCTIVE_ACTION;
    if (
      d.operation !== canon.operation ||
      d.irreversible !== true ||
      d.invalidatesExistingCredentialImmediately !== true ||
      d.agentPerformsAction !== false ||
      d.explicitCheckpointRequired !== true ||
      d.credentialValueReadBudget !== 0
    ) {
      return fail(
        "DESTRUCTIVE_ACTION_CONTRACT_MISMATCH",
        `the destructive-action descriptor must be exactly {operation:${canon.operation}, irreversible:true, invalidatesExistingCredentialImmediately:true, agentPerformsAction:false, explicitCheckpointRequired:true, credentialValueReadBudget:0}`,
      );
    }
    // 12b) …and the manifest must DESCRIBE that run. The operator's one-line grant binds to these four fields,
    // so a destructive phase pins them to the phase spec rather than accepting caller/env values. A stale
    // `SELLEROPS_APPROVAL_CHANNEL` from another run now refuses instead of printing a destructive manifest that
    // names the wrong channel/surface/operation/budget.
    const scope = spec.destructiveScope;
    if (scope) {
      for (const [field, expected, actual] of [
        ["channel", scope.channel, input.channel],
        ["surface", scope.surface, input.surface],
        ["operation", scope.operation, input.operation],
        ["maxActions", scope.maxActions, input.maxActions],
      ] as const) {
        if (actual !== expected) {
          return fail(
            "DESTRUCTIVE_SCOPE_MISMATCH",
            `${spec.phase} pins ${field} to the phase scope; a destructive manifest may not describe a different run`,
          );
        }
      }
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
    entrypointType: entrypoint.entrypointType,
    entrypointCommandId: entrypoint.entrypointCommandId,
    operatorActionSummary: entrypoint.operatorActionSummary,
    hotkey: input.hotkey ?? "",
    artifactPath: input.artifactPath ?? "",
    // Visual-recon only: surface the fixed screen set, the gitignored sink, and the redaction/summary policies
    // so the operator approves exactly what the recon may capture and where it lands.
    ...(spec.phase === "API_CENTER_VISUAL_RECON"
      ? {
          // The RESOLVED capture scope (full fixed set, or the narrower per-run subset) — exactly what the
          // capture CLI will honor. Validated as a canonical subset above.
          captureScreens: visualCaptureScreens ?? spec.captureScreens,
          artifactCategory: spec.artifactCategory,
          screenshotPolicy: spec.screenshotPolicy,
          structuralSummaryPolicy: spec.structuralSummaryPolicy,
        }
      : {}),
    // WING selector probe only: surface the RESOLVED per-run target scope (full set or the narrower subset, e.g.
    // just `["delete"]`) so the operator approves exactly which targets the read-only probe measures.
    ...(spec.phase === "COUPANG_WING_SELECTOR_PROBE" ? { probeTargets: wingProbeTargets ?? [...WING_PROBE_TARGET_NAMES] } : {}),
    // FE-run-host issuance proof only: surface the sole run client, the START_RUN cap, the zero write budget,
    // the supporting (never-START_RUN) surface, and the bound FE URL so the operator approves exactly this.
    // Validation above forced every field to equal the immutable FE_LIVE_PROOF_* constants (owner/cap/zero
    // budget/surface), so emit the CONSTANTS — the manifest is then structurally incapable of carrying a
    // softened value even if a future edit reorders the checks. Only the run-specific bound path is passthrough
    // (already validated to be /connect/naver with walkthroughRun === this run id).
    ...(spec.requiresFeRunHostContract && input.startRunContract
      ? {
          supportingSurface: [...FE_LIVE_PROOF_SUPPORTING_SURFACE],
          soleStartRunOwner: FE_LIVE_PROOF_START_RUN_OWNER,
          maxStartRun: FE_LIVE_PROOF_MAX_START_RUN,
          writeBudget: { credential: 0, test: 0, sync: 0 },
          boundFrontendPath: input.startRunContract.boundFrontendPath,
        }
      : {}),
    // Destructive phase only: surface the operator-performed irreversible action so the operator approves exactly
    // it. Validation above forced the input to equal the immutable constant, so emit the CONSTANT from the spec —
    // the manifest is then structurally incapable of carrying a softened value even if a future edit reorders the
    // checks.
    ...(spec.requiresOperatorDestructiveAction && spec.operatorDestructiveAction
      ? { operatorDestructiveAction: spec.operatorDestructiveAction }
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
