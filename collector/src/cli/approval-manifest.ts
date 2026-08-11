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
import {
  WING_RECON_APPROVED_SCOPE,
  WING_STAGE2_RECON_TARGETS,
  resolveWingStage2ReconScope,
} from "../action-window/coupang-wing-label-recon";
// Pure leaf constants (no Playwright): the two operator actions the WING issuance flow must keep separate.
import { WING_KEY_CREATION_ACTION, WING_REVEAL_OPERATOR_ACTION } from "./coupang-wing-classifier";

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
  // The same read-only recorder, sweeping CANDIDATE labels instead of the shipped ones. It is a separate phase
  // rather than a flag because the manifest is what the operator reads: "measure the 3 shipped labels" and
  // "measure 12 hypotheses for those 3 labels" are different work, and the second must not be able to happen
  // under approval granted for the first. Same capabilities, same READ_ONLY mode, same no-highlight guarantee;
  // its probe scope is additionally confined to the unresolved recon targets (§ step 7d).
  "COUPANG_WING_LABEL_RECON",
  // The STAGE-2 recon phase. Same read-only recorder again, but on a screen the operator reaches by pressing
  // 발급 themselves first — so the manifest describes a surface from which the final, key-creating 확인 is
  // reachable, which the two phases above never are. That difference is the whole reason it is separately
  // approvable; the agent's capability is if anything narrower (no highlight, no shipped-label baseline).
  "COUPANG_WING_STAGE2_RECON",
  // The STAGE-2 LABEL CALIBRATION phase. Same surface and same operator flow as the Stage-2 recon, and still
  // no highlight/click/selection — but two measurements the recon does not take: a per-candidate CONTAINMENT
  // probe (is a label absent, or present in a form whole-text matching cannot see?) and a LABEL-ASSOCIATION
  // census over the visible choice controls (how each is labelled, whether the association resolves, and which
  // radio-name group it belongs to). Separately approvable because the manifest is what the operator reads
  // before granting, and "count these labels" is not "derive each control's name and compare it to a list".
  "COUPANG_WING_STAGE2_LABEL_CALIBRATION",
  // The ISSUANCE-FLOW DISCOVERY phase. The same eight agent reads as the calibration, taken at each of several
  // checkpoints while the OPERATOR advances the real flow: select a purpose option, then — only if the reading
  // permits — press 확인. The agent's click/type/submit/selection budget is still 0; the widening is entirely in
  // what the human is invited to do, which a capability list cannot express and a manifest must.
  "COUPANG_WING_ISSUANCE_FLOW_DISCOVERY",
  // The GUIDED ISSUANCE WALK. The product path, run live end-to-end for the first time: the WING-resident
  // tutorial guides the seller from the open-API page to the terms screen, and RESTS in front of the control
  // that creates the key. Two of its eight steps highlight a live-calibrated control; the four added by the
  // 2026-08-10 redesign are TEXT-GUIDED, because nothing was promoted for them and drawing a ring somewhere
  // plausible would be an invention. The agent clicks, types, submits and navigates NOTHING.
  "COUPANG_WING_GUIDED_ISSUANCE_WALK",
  // The WING issuance-form REVEAL phase. The agent highlights the live-calibrated 발급 control and RESTS; the
  // OPERATOR presses it. It is a real marketplace action, so it needs its own grant — but it is deliberately NOT
  // declared as key creation: on the official Coupang flow 발급 opens the configuration step and the key is
  // created only by a later 확인. Separating the two is the whole point of the phase, because the shipped guided
  // runtime conflates them (`checkpoint_before_issue` → `guiding_copy_keys`), which live evidence falsified.
  "COUPANG_WING_ISSUANCE_FORM_REVEAL",
  // The Coupang WING key-DELETION destructive phase. The AGENT stays READ_ONLY (it highlights the 삭제 control
  // and rests at a checkpoint; it NEVER clicks/deletes); the DESTRUCTIVE, IRREVERSIBLE action is the OPERATOR's
  // (deleting their WING self-developed Open API key — which immediately invalidates the existing Access/Secret
  // Key and is NOT recoverable). It highlights a real control ⇒ `allowsHighlight: true` ⇒ it FAILS CLOSED
  // (`SELECTORS_NOT_CALIBRATED`) unless the caller states the 삭제 calibration — WITHDRAWN 2026-08-09, so in
  // practice this phase currently cannot reach PREPARED at all; this module never assumes it — see § step 7);
  // and it also requires the immutable
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
  // Read-only Stage-2 shape census: how many painting, enabled choice controls there are and what CATEGORY each
  // is (closed-vocabulary tag / input-type / ARIA role + counts). It reads no text, no attribute values, no
  // element identity, and no geometry — and it never clicks, selects, or highlights.
  "CHOICE_CONTROL_SHAPE_CENSUS",
  // Read-only CONTAINMENT probe: for one of OUR fixed candidate labels, how many elements carry it as their whole
  // text and how many innermost elements merely contain it, each split by whether they paint. Four integers and a
  // truncation flag. Element text is read solely to compare against a label we wrote; none of it is returned.
  "FIXED_LABEL_CONTAINMENT_PROBE",
  // Read-only LABEL-ASSOCIATION census: for each painting, enabled choice control, how its name is derived
  // (a closed source enum), a coarse length bucket, whether a `label[for]` / ancestor `<label>` /
  // `aria-labelledby` association resolves, which radio-name group it is in (an ORDINAL, never the name), and
  // which of OUR candidate strings the derived name matches (an INDEX, never the name). It selects nothing,
  // clicks nothing, and does not read `checked`.
  "CHOICE_CONTROL_LABEL_ASSOCIATION_CENSUS",
  // Read-only CONSENT-BLOCK census: for each painting checkbox, walk UP to the nearest ancestor whose text
  // holds exactly one of OUR consent sentences, and report which one (an INDEX), how many levels up, and how
  // many painting checkboxes that same block contains. Two of its three verdicts are refusals — a block holding
  // several consents identifies nothing and says so rather than picking the first. It exists because the terms
  // checkboxes have no accessible name at all, so the alternative to measuring the pairing is inventing it.
  // Reads no `checked`: which box the seller ticked is not a thing this records.
  "CONSENT_BLOCK_CENSUS",
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
 * **The immutable OPERATOR-REVEAL action contract** (`COUPANG_WING_ISSUANCE_FORM_REVEAL`). A sibling of
 * {@link OperatorDestructiveAction}, kept as a SEPARATE interface so the destructive machinery is not loosened to
 * accommodate a non-destructive action.
 *
 * Two fields look contradictory and are not. They are the two different claims this whole unit exists to keep
 * apart:
 *
 *  - `createsKeyMaterial: false` — the OPERATION being approved is not the key-creating one. The key-creating
 *    press is {@link WING_KEY_CREATION_ACTION} (the later 확인), which has no tooling at all and no phase.
 *  - `keyCreationRuledOut: false` — and this run cannot PROVE nothing was created. Every sanitized signal is
 *    identical between a real issued page and a real no-key form (`wingIssuedStateFrom` ⇒
 *    `NO_DISCRIMINATING_SIGNAL`), so the runtime is structurally unable to certify non-issuance. Only the
 *    operator, looking at the screen, can say.
 *
 * Collapsing those into one optimistic boolean is exactly how a manifest would come to over-claim. The manifest
 * carries both, so the operator approves a run that says what it does not know.
 */
export interface OperatorRevealAction {
  /** The operator action being approved. NOT key creation. */
  operation: typeof WING_REVEAL_OPERATOR_ACTION;
  /** The operation this phase must never prepare, named so the separation is machine-checkable. */
  forbiddenFollowOnAction: typeof WING_KEY_CREATION_ACTION;
  /** The press being approved is not the one that creates key material. */
  createsKeyMaterial: false;
  /** …and the runtime cannot demonstrate that none was created. See the interface docstring. */
  keyCreationRuledOut: false;
  /** Opening a configuration step is not destructive; nothing existing is invalidated. */
  irreversible: false;
  /** The agent highlights only; it never clicks/types/submits — the operator presses 발급. */
  agentPerformsAction: false;
  /** A mandatory operator checkpoint (the expectation copy) precedes the press. */
  explicitCheckpointRequired: true;
  /** Zero credential-value reads during the run. */
  credentialValueReadBudget: 0;
  /** What we EXPECT the press to produce — an expectation, flagged as unconfirmed below. */
  expectedOutcome: "CONFIGURATION_SURFACE";
  /** No live run has confirmed the expectation, so the runtime fails closed on an unrecognized outcome. */
  expectedOutcomeConfirmed: false;
  /** The run stops after one observation; it never advances into the configuration step. */
  autoAdvanceAfterReveal: false;
}

/**
 * **The GUIDED WALK's boundary descriptor** — its own shape, not the reveal's, because the two runs stop for
 * different reasons and a shared descriptor would blur which.
 *
 * The reveal stops after one observation of an unconfirmed outcome. The walk runs the whole product tutorial
 * and stops because the NEXT control creates a key. Every field here is machine-checkable by the harness, so
 * the separation cannot be softened in prose alone.
 */
export interface GuidedWalkBoundary {
  /** The operator action being approved: walking the tutorial, not issuing anything. */
  operation: "WALK_WING_GUIDED_ISSUANCE_TUTORIAL";
  /** The operation this phase must never perform or prepare. */
  forbiddenFollowOnAction: typeof WING_KEY_CREATION_ACTION;
  /** The control the walk rests in front of and never presses. */
  restsBeforeControl: "약관 동의 및 Key 발급받기";
  createsKeyMaterial: false;
  /** …and the runtime still cannot demonstrate that none was created. Only the seller sees the screen. */
  keyCreationRuledOut: false;
  /** The agent clicks, types, submits — and NAVIGATES — nothing. The last one is new to this entrypoint. */
  agentPerformsAction: false;
  /** ONE: the landing the window opens on. The walk never navigates again — every screen after it is the seller's. */
  agentNavigations: 1;
  credentialValueReadBudget: 0;
  /** No connect-test, no sync, no upload: guidance finishing is not a connection. */
  performsConnectOrSync: false;
  /** How many of the walk's guided controls carry a live-calibrated locator and may be highlighted. */
  highlightedControlCount: 3;
  /** …and how many are guided by TEXT because nothing was promoted for them. */
  textGuidedControlCount: 2;
  /**
   * How many steps the runtime advances by OBSERVING WING rather than by the seller pressing "다음".
   *
   * This replaced `explicitCheckpointRequired`, which asserted that "a mandatory operator checkpoint precedes
   * every step; none auto-advances". That stopped being true on 2026-08-10 and a field that quietly keeps
   * saying it is worse than no field: the operator grants against this descriptor.
   */
  autoAdvancingStepCount: 4;
  /** The key-creation step is NOT one of them, and never becomes one. */
  keyCreationAutoAdvances: false;
  /**
   * Whether the runtime looks at the consent checkboxes' state. **True** — deliberately, to advance without
   * asking the seller to report what the page already shows. It never ticks a box, never reads the terms, and
   * the reading is a page-side conjunction that is never stored, transmitted, or logged.
   */
  sellerConsentObserved: true;
}

export const COUPANG_WING_GUIDED_WALK_BOUNDARY: GuidedWalkBoundary = {
  operation: "WALK_WING_GUIDED_ISSUANCE_TUTORIAL",
  forbiddenFollowOnAction: WING_KEY_CREATION_ACTION,
  restsBeforeControl: "약관 동의 및 Key 발급받기",
  createsKeyMaterial: false,
  keyCreationRuledOut: false,
  agentPerformsAction: false,
  agentNavigations: 1,
  credentialValueReadBudget: 0,
  performsConnectOrSync: false,
  highlightedControlCount: 3,
  textGuidedControlCount: 2,
  autoAdvancingStepCount: 4,
  keyCreationAutoAdvances: false,
  sellerConsentObserved: true,
};

export const COUPANG_WING_ISSUANCE_REVEAL_ACTION: OperatorRevealAction = {
  operation: WING_REVEAL_OPERATOR_ACTION,
  forbiddenFollowOnAction: WING_KEY_CREATION_ACTION,
  createsKeyMaterial: false,
  keyCreationRuledOut: false,
  irreversible: false,
  agentPerformsAction: false,
  explicitCheckpointRequired: true,
  credentialValueReadBudget: 0,
  expectedOutcome: "CONFIGURATION_SURFACE",
  expectedOutcomeConfirmed: false,
  autoAdvanceAfterReveal: false,
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
  readonly accountBinding: string;
  readonly surface: string;
  readonly operation: string;
  readonly maxActions: string;
}
/** Frozen: the pinned scope must not be reassignable at runtime, or the gate below would validate against it. */
export const COUPANG_WING_KEY_DELETION_SCOPE: DestructiveRunScope = Object.freeze({
  channel: "COUPANG",
  accountBinding: "operator-owned Coupang WING test account",
  surface: "Coupang WING Open API",
  operation: "WING open-API key deletion (operator-performed, irreversible; agent highlights only)",
  maxActions:
    "1 highlight-only session: SellerOps highlights the 삭제 control + rests at the irreversible-delete " +
    "checkpoint; the OPERATOR deletes; 0 agent click/type/value read",
});

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
  /**
   * Set ONLY by the WING issuance-form reveal phase. The gate enforces the immutable
   * {@link OperatorRevealAction} contract, so a caller cannot soften "this is not key creation" or "the runtime
   * cannot rule key creation out" into something more reassuring than the evidence supports.
   */
  requiresOperatorRevealAction?: boolean;
  /** The guided walk's boundary descriptor. Present only on that phase; the harness verifies every field. */
  guidedWalkBoundary?: GuidedWalkBoundary;
  /** The canonical reveal-action descriptor emitted into the manifest (present iff the flag above is set). */
  operatorRevealAction?: OperatorRevealAction;
  /** The canonical destructive-action descriptor emitted into the manifest (present iff the flag above is set). */
  operatorDestructiveAction?: OperatorDestructiveAction;
  /**
   * The immutable run scope a destructive phase's grant binds to; any caller deviation is refused. `readonly`
   * so no code path can clear it and silently skip the scope gate.
   */
  readonly destructiveScope?: DestructiveRunScope;
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
  COUPANG_WING_LABEL_RECON: {
    phase: "COUPANG_WING_LABEL_RECON",
    cli: "src/cli/probe-wing-issuance-selectors.ts",
    driver: "CoupangWingIssuanceDriver (read-only fixed-label matchCount probe, candidate-label sweep)",
    // Identical capability to the selector probe — the sweep is N invocations of the SAME read-only
    // `probeFixedLabelMatch` seam, differing only in which fixed label each one counts. It therefore adds no
    // action code: still no highlight, no tag, no click, no value read. What differs is WHAT is measured
    // (unvalidated candidate hypotheses, not the shipped locators), which is why it is separately approvable.
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
  COUPANG_WING_STAGE2_RECON: {
    phase: "COUPANG_WING_STAGE2_RECON",
    cli: "src/cli/probe-wing-issuance-selectors.ts",
    driver: "CoupangWingIssuanceDriver (read-only Stage-2 candidate sweep + choice-control shape census)",
    // Same read-only capability as the label recon, plus ONE new measurement: the choice-control shape census
    // (closed-vocabulary tag/type/role categories and counts — no text, no attributes, no values). What makes
    // it separately approvable is not a stronger action but a different SURFACE: the operator has already
    // pressed 발급, so this runs on a screen from which the final 확인 is reachable. The agent still highlights
    // nothing, tags nothing, clicks nothing, selects no purpose, and reads no value.
    capableActions: [
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "STRUCTURAL_CENSUS",
      "PROBE_TARGET_MATCHCOUNT",
      "CHOICE_CONTROL_SHAPE_CENSUS",
    ],
    allowsHighlight: false,
    mode: "READ_ONLY",
  },
  COUPANG_WING_STAGE2_LABEL_CALIBRATION: {
    phase: "COUPANG_WING_STAGE2_LABEL_CALIBRATION",
    cli: "src/cli/probe-wing-issuance-selectors.ts",
    driver: "CoupangWingIssuanceDriver (read-only Stage-2 sweep + containment probe + label-association census)",
    // Everything the Stage-2 recon can do, plus the two measurements that read HOW a control is labelled rather
    // than how many elements carry a label. Still no highlight, no tag, no click, no selection, no value read —
    // and explicitly no `checked`, so the instrument cannot report a purpose even if one were selected. What is
    // separately approvable is the reading, not a stronger action: the operator is consenting to a run that
    // derives each visible control's accessible name and compares it against a fixed candidate list.
    capableActions: [
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "STRUCTURAL_CENSUS",
      "PROBE_TARGET_MATCHCOUNT",
      "CHOICE_CONTROL_SHAPE_CENSUS",
      "FIXED_LABEL_CONTAINMENT_PROBE",
      "CHOICE_CONTROL_LABEL_ASSOCIATION_CENSUS",
    ],
    allowsHighlight: false,
    mode: "READ_ONLY",
  },
  COUPANG_WING_ISSUANCE_FLOW_DISCOVERY: {
    phase: "COUPANG_WING_ISSUANCE_FLOW_DISCOVERY",
    cli: "src/cli/probe-wing-issuance-selectors.ts",
    driver: "CoupangWingIssuanceDriver (the calibration reads plus a consent-block census, at each checkpoint the OPERATOR advances)",
    // The calibration's eight reads plus ONE: the consent-BLOCK census, which exists only because the terms
    // checkboxes have no accessible name and the pairing must be established structurally or not at all. It is
    // listed because it is a real additional read; a phase quietly taking a ninth measurement under a manifest
    // naming eight is the failure this list exists to prevent.
    //
    // The other widening is what the OPERATOR is invited to do — select a purpose option, and conditionally
    // press 확인 — which a capability list cannot express, so the operation text and the operator summary carry
    // it. `wingConfirmAdvisory` keeps the second invitation from ever being printed blind.
    capableActions: [
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "STRUCTURAL_CENSUS",
      "PROBE_TARGET_MATCHCOUNT",
      "CHOICE_CONTROL_SHAPE_CENSUS",
      "FIXED_LABEL_CONTAINMENT_PROBE",
      "CHOICE_CONTROL_LABEL_ASSOCIATION_CENSUS",
      "CONSENT_BLOCK_CENSUS",
    ],
    allowsHighlight: false,
    mode: "READ_ONLY",
  },
  COUPANG_WING_GUIDED_ISSUANCE_WALK: {
    phase: "COUPANG_WING_GUIDED_ISSUANCE_WALK",
    // The operator's command INSTALLS the service; the agent it installs (`src/cli/local-agent.ts`) is then a
    // launchd job they never invoke. Naming the agent here would print an on-approval line the product path
    // does not use — and the whole point of this phase is that no one types that line.
    cli: "src/cli/local-agent-service.ts",
    driver: "launchd service → src/cli/local-agent.ts → LazyCoupangIssuanceDriver → CoupangWingIssuanceDriver (WING-resident guided walk; the window opens on the run's first call, never at agent boot)",
    // It HIGHLIGHTS two live-calibrated controls ⇒ `allowsHighlight: true` ⇒ it fails closed
    // (`SELECTORS_NOT_CALIBRATED`) unless the caller states the `issue` calibration. The other guided steps are
    // text-only and claim no locator.
    //
    // There is no action here for pressing anything: every marketplace act is the seller's. The one that
    // creates the key — `약관 동의 및 Key 발급받기` — is the last checkpoint's subject and is never pressed by
    // this run, which is stated in the operation text because a capability list cannot express a refusal.
    capableActions: [
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "HIGHLIGHT_REAL_CONTROL",
      "OBSERVE_USER_CLICK_TRANSITION",
    ],
    allowsHighlight: true,
    mode: "READ_ONLY",
    guidedWalkBoundary: COUPANG_WING_GUIDED_WALK_BOUNDARY,
  },
  COUPANG_WING_ISSUANCE_FORM_REVEAL: {
    phase: "COUPANG_WING_ISSUANCE_FORM_REVEAL",
    cli: "src/cli/run-coupang-wing-reveal-live.ts",
    driver: "CoupangWingRevealDriver (highlight 발급 + rest; the operator presses it; one sanitized observation)",
    // AGENT capability is highlight + observe. It HIGHLIGHTS a real control ⇒ `allowsHighlight: true` ⇒ it fails
    // closed (`SELECTORS_NOT_CALIBRATED`) unless the caller states the `issue` calibration
    // (`WING_ISSUE_SELECTOR_CALIBRATED`, live-confirmed on ONE read-only probe of the no-key surface — see
    // `WING_ISSUE_CALIBRATION_EVIDENCE`, whose predecessor claimed four captures and was refuted). This module
    // never assumes a WING calibration — a caller who omits it is refused.
    capableActions: [
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "STRUCTURAL_CENSUS",
      "HIGHLIGHT_REAL_CONTROL",
      "OBSERVE_USER_CLICK_TRANSITION",
    ],
    allowsHighlight: true,
    mode: "READ_ONLY", // AGENT mode — the 발급 press is the OPERATOR's (see operatorRevealAction)
    requiresOperatorRevealAction: true,
    operatorRevealAction: COUPANG_WING_ISSUANCE_REVEAL_ACTION,
  },
  COUPANG_WING_KEY_DELETION: {
    phase: "COUPANG_WING_KEY_DELETION",
    // The driver + CLI are built, but the 삭제 calibration was WITHDRAWN on 2026-08-09
    // (`WING_DELETION_CALIBRATION_EVIDENCE`), so no caller currently passes `selectorsCalibrated: true` and this
    // phase does not reach PREPARED. The shape is unchanged for when it does: a PREPARED destructive manifest
    // needs the CALLER to state the calibration (this module still defaults every WING phase to `false`, so a
    // caller who omits it fails closed), the destructive descriptor to match the immutable canonical values
    // exactly, and the `WALKTHROUGH_*` identity to be bound. PREPARED is still not APPROVED.
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

/**
 * The Coupang WING phases. Kept as ONE list because three separate `phase === … || phase === …` chains had
 * already accumulated (host screening, calibration defaulting, remediation wording), and a fourth WING phase
 * that was added to two of the three would screen its entry URL against the NAVER API-center host and be
 * refused as `INVALID_HOST` — a failure whose cause names the wrong thing entirely.
 */
export const WING_PHASES: readonly CalibrationPhase[] = [
  "COUPANG_WING_SELECTOR_PROBE",
  "COUPANG_WING_LABEL_RECON",
  "COUPANG_WING_STAGE2_RECON",
  "COUPANG_WING_STAGE2_LABEL_CALIBRATION",
  "COUPANG_WING_ISSUANCE_FLOW_DISCOVERY",
  "COUPANG_WING_GUIDED_ISSUANCE_WALK",
  "COUPANG_WING_ISSUANCE_FORM_REVEAL",
  "COUPANG_WING_KEY_DELETION",
];
export function isWingCalibrationPhase(phase: CalibrationPhase): boolean {
  return WING_PHASES.includes(phase);
}

/**
 * The two Stage-2 phases — the recon and the label calibration. They share the operator flow, the surface and
 * the candidate-scope vocabulary, and differ only in what is measured, so every rule keyed on "this is a Stage-2
 * run" must name both. Kept as one predicate because the WING phase list already learned this lesson: three
 * separate `phase === … ||` chains had accumulated, and a fourth phase added to two of the three was screened
 * against the wrong host.
 */
export const WING_STAGE2_MANIFEST_PHASES: readonly CalibrationPhase[] = [
  "COUPANG_WING_STAGE2_RECON",
  "COUPANG_WING_STAGE2_LABEL_CALIBRATION",
  "COUPANG_WING_ISSUANCE_FLOW_DISCOVERY",
];
export function isWingStage2Phase(phase: CalibrationPhase): boolean {
  return WING_STAGE2_MANIFEST_PHASES.includes(phase);
}

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
  "WING_RECON_TARGETS_MISMATCH",
  "WING_STAGE2_TARGETS_MISMATCH",
  // The WING issuance-form REVEAL phase requires its immutable operator-reveal descriptor, exactly.
  "MISSING_REVEAL_ACTION_CONTRACT",
  "REVEAL_ACTION_CONTRACT_MISMATCH",
  // A service-hosted phase's operator action must state where the pairing code actually appears. The whole claim
  // of a product-path run is that it is terminal-free; a summary that omits the OS approval dialog is describing
  // a different run from the one that executes.
  "MISSING_SERVICE_PAIRING_CHANNEL",
] as const;
export type ApprovalPrereqCause = (typeof APPROVAL_PREREQ_CAUSES)[number];

/**
 * Per-phase OPERATOR ENTRYPOINT contract. The defect this closes: `preflight.sh` printed the order-connection
 * frontend URL (`/connect/naver?walkthroughRun=…`) as THE operator action for EVERY phase — but a calibration
 * phase's real operator action is the CLI-launched dedicated Chrome window, never a frontend URL. Each phase
 * declares exactly ONE entrypoint so the operator is told the single true action and nothing else.
 */
/**
 * `INSTALLED_LOCAL_AGENT_SERVICE` is the PRODUCT path and is deliberately its own type rather than a variant of
 * the CLI one. The operator's action is not "run the agent" — it is "install the service, then open SellerOps":
 * the agent is a launchd background job with no terminal, the marketplace window opens only when the run's
 * first call needs it, and the pairing code is presented by the OS approval dialog and confirmed in the product
 * UI. Calling that `CLI_LAUNCHED_DEDICATED_WINDOW` would tell the operator to expect a window at boot and a
 * code in a console, neither of which happens.
 */
export const ENTRYPOINT_TYPES = [
  "CLI_LAUNCHED_DEDICATED_WINDOW",
  "INSTALLED_LOCAL_AGENT_SERVICE",
  "FRONTEND_URL",
] as const;
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
  "COUPANG_WING_LABEL_RECON",
  "COUPANG_WING_STAGE2_RECON",
  "COUPANG_WING_STAGE2_LABEL_CALIBRATION",
  "COUPANG_WING_ISSUANCE_FLOW_DISCOVERY",
  "COUPANG_WING_GUIDED_ISSUANCE_WALK",
  "COUPANG_WING_ISSUANCE_FORM_REVEAL",
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
/**
 * The terms-checkpoint sentence of the discovery summary, kept separate so a NARROWED run can drop it.
 *
 * A phase-level constant describes the longest possible run; a manifest must describe the one about to happen.
 * A narrowed run that still told the operator to tick consent boxes would be promising a step it never reaches
 * — the same defect as omitting one, and the harness has now produced it in both directions.
 */
export const WING_DISCOVERY_TERMS_STEP_SUMMARY =
  " ④ 약관 화면에서 내용을 직접 읽고 판단하신 뒤 동의 체크박스 2개를 직접 선택하고 ready. 여기서 실행이 끝납니다.";

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
  // The candidate-label recon: the SAME CLI and the same dedicated Chrome, so the entrypoint contract is
  // identical. Only the operator-facing summary differs, because what gets measured differs — the operator
  // should read "여러 후보 라벨", not "각 대상", before granting.
  COUPANG_WING_LABEL_RECON: {
    entrypointType: "CLI_LAUNCHED_DEDICATED_WINDOW",
    cli: "src/cli/probe-wing-issuance-selectors.ts",
    entrypointCommandId: "probe-wing-issuance-selectors",
    operatorActionSummary:
      "승인 후 SellerOps가 전용 Chrome 창을 엽니다. 쿠팡(윙)에 직접 로그인·이동해 오픈API 발급 화면에서 준비되면 ready 를 보내세요. SellerOps는 아직 확정되지 않은 대상들의 여러 후보 라벨에 대해 일치 수만 읽습니다(강조·클릭·입력·값 읽기 없음). 후보가 하나로 좁혀져도 이 실행은 선택자를 바꾸지 않습니다.",
    emitsFrontendUrl: false,
  },
  // The STAGE-2 recon: the same CLI and the same dedicated Chrome again, so the entrypoint contract is
  // identical. The summary is the one thing that must differ, and materially: the operator is being asked to
  // press 발급 THEMSELVES before signalling ready, so it has to say both that SellerOps will not press it and
  // that they must stop at the purpose screen without choosing anything or pressing 확인.
  COUPANG_WING_STAGE2_RECON: {
    entrypointType: "CLI_LAUNCHED_DEDICATED_WINDOW",
    cli: "src/cli/probe-wing-issuance-selectors.ts",
    entrypointCommandId: "probe-wing-issuance-selectors",
    operatorActionSummary:
      "승인 후 SellerOps가 전용 Chrome 창을 엽니다. 쿠팡(윙)에 직접 로그인·이동한 뒤, 오픈API 화면에서 'API Key 발급 받기'를 " +
      "직접 눌러 사용 목적 선택 화면을 여세요(SellerOps는 누르지 않습니다). 그 화면이 그대로 떠 있는 상태에서 ready 를 보내세요. " +
      "SellerOps는 선택 항목의 개수와 종류, 그리고 미리 정해 둔 후보 라벨의 일치 수만 읽습니다. 목적을 선택하지 않고, " +
      "업체명/URL/IP를 입력하지 않으며, '확인'(최종 발급)은 절대 누르지 않습니다(강조·클릭·입력·값 읽기 없음).",
    emitsFrontendUrl: false,
  },
  // The STAGE-2 LABEL CALIBRATION: same CLI, same dedicated Chrome, same operator flow as the Stage-2 recon —
  // so the entrypoint contract is identical again and only the summary differs. It must say what is additionally
  // read (how each choice is labelled) and, just as importantly, what is still not done: no option is selected,
  // because the point of the run is to learn what the options are BEFORE anyone picks one.
  COUPANG_WING_STAGE2_LABEL_CALIBRATION: {
    entrypointType: "CLI_LAUNCHED_DEDICATED_WINDOW",
    cli: "src/cli/probe-wing-issuance-selectors.ts",
    entrypointCommandId: "probe-wing-issuance-selectors",
    operatorActionSummary:
      "승인 후 SellerOps가 전용 Chrome 창을 엽니다. 쿠팡(윙)에 직접 로그인·이동한 뒤, 오픈API 화면에서 'API Key 발급 받기'를 " +
      "직접 눌러 사용 목적 선택 화면을 여세요(SellerOps는 누르지 않습니다). 그 화면이 그대로 떠 있는 상태에서 ready 를 보내세요. " +
      "SellerOps는 각 선택 항목이 '어떻게 라벨링되어 있는지'(라벨 연결 방식·연결 성공 여부·라디오 그룹 번호·길이 구간)와, " +
      "미리 정해 둔 후보 문구와의 일치 여부만 번호로 읽습니다. 화면의 문구 자체는 기록되지 않습니다. 목적을 선택하지 않고, " +
      "업체명/URL/IP를 입력하지 않으며, '확인'(최종 발급)은 절대 누르지 않습니다(강조·클릭·입력·값 읽기 없음).",
    emitsFrontendUrl: false,
  },
  // The ISSUANCE-FLOW DISCOVERY phase: same CLI and same dedicated Chrome again. The summary has to carry what
  // no capability list can — that the OPERATOR takes two real marketplace actions, that the second one is
  // CONDITIONAL on what the run measures after the first, and that the run ends at the screen 확인 opens rather
  // than filling anything in. It must not promise what 확인 does: no run has ever pressed it.
  COUPANG_WING_ISSUANCE_FLOW_DISCOVERY: {
    entrypointType: "CLI_LAUNCHED_DEDICATED_WINDOW",
    cli: "src/cli/probe-wing-issuance-selectors.ts",
    entrypointCommandId: "probe-wing-issuance-selectors",
    operatorActionSummary:
      "승인 후 SellerOps가 전용 Chrome 창을 엽니다. 이 단계에서는 판매자가 화면을 직접 진행합니다(SellerOps는 클릭·선택·입력을 " +
      "일절 하지 않습니다). ① 쿠팡(윙)에 직접 로그인·이동해 'API Key 발급 받기'를 직접 누르고 사용 목적 화면에서 멈춘 뒤 ready. " +
      "② 'OPEN API'를 직접 선택하고, '확인'은 누르지 말고 ready. 여기서 SellerOps가 업체명/URL/IP 입력란이 이미 화면에 " +
      "나타났는지 읽습니다. 이미 나타났다면 '확인'은 최종 제출일 수 있으므로 실행은 그 자리에서 중단되고, 누르라는 안내 자체를 " +
      "하지 않습니다. ③ 중단되지 않은 경우에만 '확인'을 직접 누르고, 다음 화면이 뜨면 아무것도 누르지 말고 ready." +
      WING_DISCOVERY_TERMS_STEP_SUMMARY +
      " ⚠ 약관 화면의 '약관 동의 및 Key 발급받기' 버튼은 실제로 키를 생성하는 control이며, 이번 단계에서는 절대 누르지 " +
      "않습니다. SellerOps는 그 버튼의 위치만 측정하고, 그 다음 단계 자체가 존재하지 않습니다(키 발급은 별도 승인·별도 " +
      "manifest). SellerOps는 약관을 읽거나 판단하거나 대신 동의하지 않습니다. 각 시점마다 라벨 매칭 수·표시 여부·" +
      "라벨 연결 방식만 번호로 읽으며, 화면 문구·입력값·키 값은 기록하지 않습니다.",
    emitsFrontendUrl: false,
  },
  // The GUIDED ISSUANCE WALK: the product path itself, live. The summary has to carry what the walk does NOT
  // do as precisely as what it does — the four text-guided steps are not highlighted, and the last checkpoint
  // stands in front of a control this run never presses.
  COUPANG_WING_GUIDED_ISSUANCE_WALK: {
    entrypointType: "INSTALLED_LOCAL_AGENT_SERVICE",
    cli: "src/cli/local-agent-service.ts",
    entrypointCommandId: "local-agent-service",
    operatorActionSummary:
      "승인 후 Local Agent를 백그라운드 서비스로 설치합니다(launchd, 1회). 이후 터미널은 쓰지 않습니다 — " +
      "에이전트는 로그인 세션에 상주하고, SellerOps 화면이 loopback에서 이를 찾습니다. " +
      "연결 승인 코드는 macOS 승인 대화상자가 표시하고, 승인은 SellerOps 제품 화면에서 진행합니다" +
      "(에이전트 터미널의 코드를 읽지 않습니다). " +
      "SellerOps 화면에서 안내를 시작하면 그때 전용 Chrome 창이 열립니다" +
      "(에이전트가 켜져 있다는 이유만으로는 창이 열리지 않습니다). " +
      "그 창은 셀러 본인의 WING 판매정보 페이지로 한 번만 이동해 열립니다(빈 창 대신). 이후 화면 이동은 전부 셀러가 직접 합니다. " +
      "안내는 WING 화면 위에 표시되고, 한 번 WING으로 넘어간 뒤에는 SellerOps 탭으로 돌아올 필요가 없습니다 " +
      "(SellerOps는 클릭·입력·제출을 하지 않고, 페이지를 대신 이동하지도 않습니다): " +
      "① 오픈API 키 발급 페이지로 직접 이동(도착하면 자동 진행) → ② 'API Key 발급 받기'(강조 표시됨)를 직접 누름" +
      "(사용 목적 화면이 뜨면 자동 진행) → ③ 사용 목적이 'OPEN API'인지 보고 '확인'을 직접 누름" +
      "(약관 화면이 뜨면 자동 진행) → ④ 약관 2개를 직접 읽고 판단한 뒤 동의 체크(2개가 모두 체크되면 자동 진행) → " +
      "⑤ 여기서 멈춥니다. " +
      "⚠ ③ 사용 목적/확인 단계와 체크박스에는 강조 표시가 없습니다. 해당 control은 측정만 되었고 selector로 승격되지 않았기 때문이며, " +
      "SellerOps는 위치를 아는 척하지 않고 글로만 안내합니다. " +
      "⚠ 체크박스는 SellerOps가 대신 누르지 않습니다. 다만 2개가 모두 선택됐는지는 화면에서 확인해 자동으로 넘어갑니다 " +
      "(선택 여부는 저장·전송·기록하지 않습니다). SellerOps는 약관을 읽거나 판단하거나 대신 동의하지 않습니다. " +
      "⚠ 마지막 '약관 동의 및 Key 발급받기'는 강조 표시됩니다(2026-08-11 측정 승격). 실제로 키를 생성하는 control이며, 자동으로 넘어가지 않고 " +
      "이번 proof에서는 절대 누르지 않습니다. 키 발급·credential 읽기·연결·동기화는 이번 run의 범위가 아닙니다.",
    emitsFrontendUrl: false,
  },
  // The WING issuance-form REVEAL phase: a CLI-launched dedicated Chrome. The operator presses 발급 themselves
  // after reading the expectation copy; the summary must not promise what the press produces, because no live run
  // has confirmed it, and must state that key creation is not part of this step.
  COUPANG_WING_ISSUANCE_FORM_REVEAL: {
    entrypointType: "CLI_LAUNCHED_DEDICATED_WINDOW",
    cli: "src/cli/run-coupang-wing-reveal-live.ts",
    entrypointCommandId: "run-coupang-wing-reveal-live",
    operatorActionSummary:
      "승인 후 SellerOps가 전용 Chrome 창을 엽니다. 쿠팡(윙)에 직접 로그인·이동해 오픈API 화면에서 준비되면 ready 를 보내세요. SellerOps는 '발급' 버튼을 강조 표시만 하고 멈춥니다(클릭·입력 없음). 발급은 판매자가 직접 누릅니다. 연동 방식 설정 화면이 열릴 것으로 예상되지만 확인된 사실은 아니며, 실제 키 발급/최종 '확인'은 이번 단계에서 수행하지 않습니다. 화면이 열리면 더 진행하지 마세요. SellerOps는 화면 종류만 한 번 확인하고 종료하며, 키 생성 여부는 판단할 수 없습니다.",
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
/** Both halves of the terminal-free pairing claim: where the code appears, and where it is confirmed. */
const SERVICE_PAIRING_CHANNEL_MARKERS: readonly string[] = ["macOS 승인 대화상자", "제품 화면"];

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
  } else if (spec.entrypointType === "INSTALLED_LOCAL_AGENT_SERVICE") {
    // A service-hosted phase names the INSTALL command (not the agent it installs) and, like a CLI phase,
    // surfaces no bound frontend URL — the operator opens SellerOps normally, with no run token in the address.
    if (!spec.cli || spec.cli !== canonical.cli) {
      return { ok: false, cause: "ENTRYPOINT_CLI_MISMATCH", reason: `${phase} entrypoint cli must be exactly "${canonical.cli}"` };
    }
    if (spec.emitsFrontendUrl || FRONTEND_URL_MARKERS.some((m) => summary.includes(m))) {
      return { ok: false, cause: "FRONTEND_URL_IN_CLI_ENTRYPOINT", reason: `${phase} installs a service — its operator action must carry no bound frontend URL` };
    }
    // The positive requirement, and the reason this type exists at all: the operator must be told that the
    // pairing code comes from the OS approval dialog. Drop that sentence and the manifest silently reverts to
    // promising a terminal-free run while describing nothing that makes it one.
    if (!SERVICE_PAIRING_CHANNEL_MARKERS.every((m) => summary.includes(m))) {
      return { ok: false, cause: "MISSING_SERVICE_PAIRING_CHANNEL", reason: `${phase} runs as an installed service — its operator action must state that the pairing code is shown by the macOS approval dialog and confirmed in the SellerOps UI` };
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
  /**
   * Stage-2 recon scope, in its own field for the same reason it has its own namespace: a caller that meant to
   * narrow a selector probe must not be able to narrow a Stage-2 sweep by accident, or vice versa.
   */
  requestedStage2Targets?: readonly string[];
  /** Narrow the phase's operator copy to THIS run. Discovery only, and only ever to drop an unreachable step. */
  operatorActionSummaryOverride?: string;
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
  /**
   * Operator-performed REVEAL action descriptor (required ONLY for `COUPANG_WING_ISSUANCE_FORM_REVEAL`; ignored
   * otherwise). Validated field-by-field against the immutable {@link OperatorRevealAction} constant, so a caller
   * cannot flip `createsKeyMaterial` or `keyCreationRuledOut` into a claim the runtime cannot support, nor drop
   * the checkpoint, nor turn on auto-advance.
   */
  operatorRevealAction?: OperatorRevealAction;
  /** The guided walk's own boundary descriptor. Present only on that phase. */
  guidedWalkBoundary?: GuidedWalkBoundary;
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
  /**
   * Stage-2 phases only: the RESOLVED Stage-2 candidate scope. Its OWN field, never `probeTargets` — the names
   * come from a different namespace, and a reader (or a shell harness) matching on `probeTargets` must never
   * pick up a Stage-2 scope it cannot validate.
   *
   * It was emitted before it was declared here, so the preflight read it through a JSON path while the type
   * denied it existed. Declared now: a field the harness depends on should not be invisible to the compiler.
   */
  stage2Targets?: readonly string[];
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
  /**
   * The operator-performed REVEAL action this run is scoped around (present ONLY on the reveal phase). It makes
   * the 발급 press explicit in what the operator approves — including the two claims it does NOT make: that this
   * press is not key creation, and that the runtime cannot prove no key was created.
   */
  operatorRevealAction?: OperatorRevealAction;
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
  const screen = isWingCalibrationPhase(spec.phase)
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
  // calibration is currently WITHDRAWN, so no caller states it and the deletion phase does not reach PREPARED at
  // all — the whole destructive path is closed. The read-only WING selector probe never highlights, so the gate
  // below is skipped for it regardless.
  const isWingPhase = isWingCalibrationPhase(spec.phase);
  const calibrated = input.selectorsCalibrated ?? (isWingPhase ? false : SELECTORS_CALIBRATED);
  if (spec.allowsHighlight && !calibrated) {
    // Name the remediation for THIS surface: a WING phase is not fixed by a NAVER API-center observation.
    const remediation = isWingPhase
      ? `run ${PHASE_SPECS.COUPANG_WING_SELECTOR_PROBE.phase} (READ-ONLY) and land the real selectors`
      : `run ${PHASE_SPECS.API_CENTER_STRUCTURE_OBSERVATION.phase} first and land the real selectors`;
    return fail("SELECTORS_NOT_CALIBRATED", `${spec.phase} needs calibrated control selectors; ${remediation}`);
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
  if (spec.phase === "COUPANG_WING_SELECTOR_PROBE" || spec.phase === "COUPANG_WING_LABEL_RECON") {
    const isRecon = spec.phase === "COUPANG_WING_LABEL_RECON";
    // The recon phase does NOT default to every target. Its whole scope must be sweepable, and the runner
    // refuses a mixed scope anyway — so defaulting to the full set here would only produce manifests that can
    // never run. It defaults to the recon set; narrowing within that set stays allowed.
    wingProbeTargets = input.requestedProbeTargets ?? (isRecon ? [...WING_RECON_APPROVED_SCOPE] : [...WING_PROBE_TARGET_NAMES]);
    if (!isCanonicalWingProbeSubset(wingProbeTargets)) {
      return fail("WING_PROBE_TARGETS_MISMATCH", `WING probe target scope must be a non-empty canonical subset of ${WING_PROBE_TARGET_NAMES.join(", ")}`);
    }
    // A manifest the runner would REFUSE must never be displayed: the operator would grant a run that then dies
    // at the gate, and the natural next move when that happens is to widen the scope until it starts. Refusing
    // here keeps the failure on the preparation side, where widening is a reviewed edit rather than a reflex.
    if (isRecon && !wingProbeTargets.every((t) => (WING_RECON_APPROVED_SCOPE as readonly string[]).includes(t))) {
      return fail(
        "WING_RECON_TARGETS_MISMATCH",
        `the candidate-label recon scope must be a non-empty subset of ${WING_RECON_APPROVED_SCOPE.join(", ")} — the other targets have no candidate sets to sweep`,
      );
    }
  }

  // 7e) The Stage-2 recon resolves its scope from its OWN namespace. `purpose` / `vendor_url` / `confirm` are
  // not canonical probe targets and never become them: widening `WING_PROBE_TARGET_NAMES` so one parser could
  // be shared would let an ordinary selector probe be pointed at them too, which is a larger blast radius than
  // this unit needs. Defaults to the full Stage-2 set; narrowing within it stays allowed; anything else refuses.
  let wingStage2Targets: readonly string[] | undefined;
  // BOTH Stage-2 phases: they share the scope vocabulary, so a calibration manifest that skipped this would
  // display no scope at all while the run resolved one from the same env var — the manifest under-describing the
  // run is the exact failure the Stage-2 narrowing gap already produced once.
  if (isWingStage2Phase(spec.phase)) {
    const requested = input.requestedStage2Targets;
    const resolved = resolveWingStage2ReconScope(requested === undefined ? undefined : requested.join(","));
    if (!resolved.ok) {
      return fail("WING_STAGE2_TARGETS_MISMATCH", `the Stage-2 recon scope must be a non-empty subset of ${WING_STAGE2_RECON_TARGETS.join(", ")}`);
    }
    if (resolved.targets.length === 0) {
      return fail("WING_STAGE2_TARGETS_MISMATCH", "the Stage-2 recon scope resolved to no targets");
    }
    wingStage2Targets = resolved.targets;
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
  // 11b) Operator-performed REVEAL action. The same discipline as the destructive contract below, for the
  // opposite risk: not a caller understating danger, but a caller OVERSTATING safety. `createsKeyMaterial: false`
  // and `keyCreationRuledOut: false` must both survive exactly — the first says the approved press is not the
  // key-creating one; the second admits the runtime cannot prove none was created. Flipping the second to `true`
  // would print a manifest asserting a guarantee no sanitized signal can support, which is precisely what the
  // `NO_DISCRIMINATING_SIGNAL` verdict exists to prevent. Runs AFTER the selectors gate, so an uncalibrated
  // reveal phase reports `SELECTORS_NOT_CALIBRATED` first.
  if (spec.requiresOperatorRevealAction) {
    const r = input.operatorRevealAction;
    if (!r) {
      return fail("MISSING_REVEAL_ACTION_CONTRACT", `${spec.phase} requires the operator-reveal-action descriptor`);
    }
    const canon = spec.operatorRevealAction ?? COUPANG_WING_ISSUANCE_REVEAL_ACTION;
    if (
      r.operation !== canon.operation ||
      r.forbiddenFollowOnAction !== canon.forbiddenFollowOnAction ||
      r.createsKeyMaterial !== false ||
      r.keyCreationRuledOut !== false ||
      r.irreversible !== false ||
      r.agentPerformsAction !== false ||
      r.explicitCheckpointRequired !== true ||
      r.credentialValueReadBudget !== 0 ||
      r.expectedOutcome !== canon.expectedOutcome ||
      r.expectedOutcomeConfirmed !== false ||
      r.autoAdvanceAfterReveal !== false
    ) {
      return fail(
        "REVEAL_ACTION_CONTRACT_MISMATCH",
        `the reveal-action descriptor must be exactly {operation:${canon.operation}, forbiddenFollowOnAction:${canon.forbiddenFollowOnAction}, createsKeyMaterial:false, keyCreationRuledOut:false, irreversible:false, agentPerformsAction:false, explicitCheckpointRequired:true, credentialValueReadBudget:0, expectedOutcome:${canon.expectedOutcome}, expectedOutcomeConfirmed:false, autoAdvanceAfterReveal:false}`,
      );
    }
    // "The reveal action and the key-creation action are distinct" needs no runtime check: both are literal types
    // (`typeof WING_REVEAL_OPERATOR_ACTION` / `typeof WING_KEY_CREATION_ACTION`), so `tsc` rejects the comparison
    // as having no overlap. A future edit that made them the same string would fail to compile — a stronger
    // guarantee than a refusal at runtime, which is why there is no branch here.
  }

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
        // `account` is one of the six fields the root CLAUDE.md names as the grant's binding — pinned for the
        // same reason as the rest: a stale env must not print a destructive manifest naming another account.
        ["accountBinding", scope.accountBinding, input.accountBinding],
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
    // The phase's canonical copy, unless this RUN is narrower than the phase. Only the discovery route
    // supplies an override, and only to REMOVE a step it cannot reach — never to add or soften one.
    operatorActionSummary: input.operatorActionSummaryOverride ?? entrypoint.operatorActionSummary,
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
    ...(spec.phase === "COUPANG_WING_SELECTOR_PROBE" || spec.phase === "COUPANG_WING_LABEL_RECON"
      ? { probeTargets: wingProbeTargets ?? [...WING_PROBE_TARGET_NAMES] }
      : {}),
    // Stage-2 recon only: the resolved candidate-target scope, in its own field. Deliberately NOT reusing
    // `probeTargets` — these names come from a different namespace, and a reader (or a shell harness) matching
    // on `probeTargets` must never silently pick up a Stage-2 scope it cannot validate.
    ...(isWingStage2Phase(spec.phase)
      ? { stage2Targets: wingStage2Targets ?? [...WING_STAGE2_RECON_TARGETS] }
      : {}),
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
    // Emit the CONSTANT, not the input — validation forced them equal, so the manifest cannot carry a softened
    // reveal contract even if a future edit reorders the checks.
    ...(spec.guidedWalkBoundary ? { guidedWalkBoundary: spec.guidedWalkBoundary } : {}),
    ...(spec.requiresOperatorRevealAction && spec.operatorRevealAction
      ? { operatorRevealAction: spec.operatorRevealAction }
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
