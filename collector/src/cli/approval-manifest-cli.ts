/**
 * **Approval Manifest CLI — the gate `preflight.sh` calls before it will emit a manifest / request approval.**
 *
 * Reads the phase + run identity from the environment, defaults the API-center URL to the verified public
 * constant (so no per-run operator input is needed), derives the EXACT cli/driver/actions from the phase spec,
 * dry-checks that the CLI entrypoint file exists, and runs {@link validateApprovalPrerequisites}. On success it
 * prints the sanitized manifest JSON (PREPARED). On any missing prerequisite it prints
 * `PREFLIGHT FAIL: approval_prerequisite (<cause>)` and exits 1 — so `preflight.sh` never emits a manifest or
 * asks for approval when the run is not immediately executable.
 *
 * It NEVER prints the raw API-center URL (only the host category enters the manifest). Inert on import.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  NAVER_API_CENTER_BASE_URL,
  PHASE_SPECS,
  validateApprovalPrerequisites,
  VISUAL_RECON_ARTIFACT_CATEGORY,
  FE_LIVE_PROOF_SUPPORTING_SURFACE,
  FE_LIVE_PROOF_START_RUN_OWNER,
  FE_LIVE_PROOF_MAX_START_RUN,
  type CalibrationPhase,
  type ApprovalPrereqInput,
} from "./approval-manifest";
import { CALIBRATION_PHASES, isWingCalibrationPhase } from "./approval-manifest";
import { resolveVisualReconScope } from "../action-window/api-issuance-calibration/visual-recon";
// The public WING host default for the Coupang WING selector-probe phase (pure leaf; no per-run input needed).
import { WING_DEFAULT_URL, resolveWingProbeScope } from "./coupang-wing-classifier";
import { COUPANG_WING_KEY_DELETION_DESTRUCTIVE_ACTION, COUPANG_WING_KEY_DELETION_SCOPE } from "./approval-manifest";
import { verifyRepoIdentity } from "./repo-identity";
// The 삭제 selector calibration flag — the SAME constant `run-coupang-wing-deletion-live.ts` feeds the gate.
// `approval-manifest.ts` deliberately never imports it (WING phases default to uncalibrated there), so the
// display CLI must state it explicitly or the destructive phase could never produce the manifest the operator
// is supposed to approve. Binding both to ONE constant keeps the withdraw path single: set it false and the
// manifest stops being emittable at the same instant the run stops being executable.
import { WING_DELETION_SELECTORS_CALIBRATED } from "../action-window/coupang-wing-issuance-driver";

const COLLECTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** The repository a destructive run must be reading — derived from this file, never from the environment. */
const REPO_ROOT = resolve(COLLECTOR_ROOT, "..");

function env(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v.length > 0 ? v : undefined;
}

export interface ApprovalManifestCliOptions {
  /**
   * Repository-identity verifier seam. Production uses the real {@link verifyRepoIdentity} against this
   * checkout; tests inject a stub so they can exercise the destructive path without requiring the suite to run
   * from a clean tree at one specific commit. The DEFAULT is the real check — a test that forgets to inject
   * gets the strict behaviour, never a disabled one.
   */
  verifyIdentity?: typeof verifyRepoIdentity;
}

export function runApprovalManifestCli(opts: ApprovalManifestCliOptions = {}): number {
  const phase = env("SELLEROPS_APPROVAL_PHASE") ?? "";
  // Fail closed on an unknown phase before deriving anything from a missing spec.
  if (!(CALIBRATION_PHASES as readonly string[]).includes(phase)) {
    process.stderr.write(`PREFLIGHT FAIL: approval_prerequisite (UNKNOWN_PHASE): set SELLEROPS_APPROVAL_PHASE to one of ${CALIBRATION_PHASES.join(" | ")}\n`);
    return 1;
  }
  const spec = PHASE_SPECS[phase as CalibrationPhase];

  // The Coupang WING selector probe screens its entry URL to the WING host; every NAVER phase screens to the
  // API-center host. Like NAVER's public base constant, the WING host defaults to the public WING root (so no
  // per-run operator input is needed to reach PREPARED) unless the operator preset a deep link; screened in
  // `validateApprovalPrerequisites`. The raw URL is never printed — only its host category enters the manifest.
  const isWingSelectorProbe = phase === "COUPANG_WING_SELECTOR_PROBE";
  // The candidate-label recon rides the SAME CLI, host screening and probe-scope plumbing as the selector
  // probe; only what it measures (and therefore what the manifest says) differs.
  const isWingLabelRecon = phase === "COUPANG_WING_LABEL_RECON";
  const isWingKeyDeletion = phase === "COUPANG_WING_KEY_DELETION";
  // The shared list, NOT a fourth hand-maintained chain. Review caught this one still spelled out by hand after
  // the other three were consolidated: it decides whether the entry URL is screened against the WING host or
  // the NAVER API-center host, so a WING phase missing from it fails as `INVALID_HOST` — a refusal whose cause
  // names the wrong thing entirely.
  const isWingPhase = isWingCalibrationPhase(phase as CalibrationPhase);
  const apiCenterUrl = isWingPhase
    ? (env("COUPANG_WING_URL") ?? WING_DEFAULT_URL)
    : (env("NAVER_API_CENTER_URL") ?? NAVER_API_CENTER_BASE_URL);

  // Dry-validate the run command: the exact CLI entrypoint file must exist.
  const cliExists = existsSync(resolve(COLLECTOR_ROOT, spec.cli));

  // ONLY the hotkey calibrator phase (Phase A, `API_CENTER_STRUCTURE_OBSERVATION`) captures from a keypress and
  // writes a per-run RAW selector artifact. The visual-recon phase has no hotkey and writes its redacted PNG +
  // sanitized summary under the gitignored `.calibration/visual/` sink. The read-only selector probe and the
  // highlight proof have NEITHER — they carry no hotkey and no raw-artifact path (a misleading one would
  // over-claim a capability the phase's driver does not have).
  const isVisualRecon = phase === "API_CENTER_VISUAL_RECON";
  // Visual-recon ONLY: an optional per-run capture SCOPE (comma list) that NARROWS the fixed screen set to just
  // the screens this investigation needs. Absent ⇒ the full fixed set. Fail closed on any unknown screen.
  let requestedCaptureScreens: readonly string[] | undefined;
  if (isVisualRecon) {
    const scope = resolveVisualReconScope(env("SELLEROPS_VISUAL_RECON_SCREENS"));
    if (!scope.ok) {
      process.stderr.write(`PREFLIGHT FAIL: approval_prerequisite (VISUAL_SCREENS_MISMATCH): ${scope.reason}\n`);
      return 1;
    }
    requestedCaptureScreens = scope.screens;
  }
  // WING selector probe ONLY: an optional per-run TARGET scope (comma list) that NARROWS the fixed WING target set
  // to just the targets this calibration needs (e.g. `delete` for the delete-selector calibration). Absent ⇒ the
  // full set. Fail closed on any unknown target.
  let requestedProbeTargets: readonly string[] | undefined;
  // An UNSET scope under the recon phase is left undefined so the gate applies the RECON default. Passing the
  // resolver output unconditionally would hand the gate the full six-target set (its "empty means all" rule),
  // which the recon gate then refuses — so the gate default was unreachable and the documented behaviour was
  // wrong. It failed closed, but on the wrong cause.
  const rawScope = env("SELLEROPS_WING_PROBE_TARGETS");
  if ((isWingSelectorProbe || isWingLabelRecon) && !(isWingLabelRecon && (rawScope ?? "").trim() === "")) {
    const scope = resolveWingProbeScope(rawScope);
    if (!scope.ok) {
      process.stderr.write(`PREFLIGHT FAIL: approval_prerequisite (WING_PROBE_TARGETS_MISMATCH): ${scope.reason}\n`);
      return 1;
    }
    requestedProbeTargets = scope.targets;
  }
  const isStructureObs = phase === "API_CENTER_STRUCTURE_OBSERVATION";
  const isFeLiveProof = phase === "API_ISSUANCE_FE_LIVE_PROOF";
  const hotkey = isStructureObs ? (env("SELLEROPS_CALIBRATION_HOTKEY") ?? "Ctrl+Shift+K") : undefined;
  const artifactPath = isVisualRecon
    ? VISUAL_RECON_ARTIFACT_CATEGORY
    : isStructureObs
      ? (env("SELLEROPS_CALIBRATION_ARTIFACT") ?? `.calibration/api-center-${env("WALKTHROUGH_RUN_ID") ?? "unknown"}.json`)
      : undefined;
  const defaultOperation = isWingKeyDeletion
    ? COUPANG_WING_KEY_DELETION_SCOPE.operation
    : isWingSelectorProbe
    ? "WING open-API read-only selector probe"
    : isWingLabelRecon
    ? "WING open-API read-only CANDIDATE-LABEL recon (measure only; no selector is changed by this run)"
    : isVisualRecon
    ? "API Center redacted visual recon"
    : isStructureObs
      ? "API Center structure observation"
      : phase === "API_ISSUANCE_SELECTOR_PROBE"
        ? "API issuance read-only selector probe"
        : isFeLiveProof
          ? "existing-app guided issuance tutorial — FE-run-host READ-only live proof (open_app→api_group→credentials→return)"
          : "API issuance highlight proof (new-app or existing-app)";
  const defaultMaxActions = isWingKeyDeletion
    ? COUPANG_WING_KEY_DELETION_SCOPE.maxActions
    : isWingSelectorProbe
    ? "1 read-only WING selector probe session"
    : isWingLabelRecon
    ? "1 read-only WING candidate-label recon session"
    : isVisualRecon
    ? "1 redacted visual recon session"
    : isStructureObs
      ? "1 calibration session"
      : phase === "API_ISSUANCE_SELECTOR_PROBE"
        ? "1 read-only selector probe session"
        : isFeLiveProof
          ? "1 READ-only FE-run-host session: FE-origin START_RUN=1; NO credential/test/sync; NO value/clipboard/screenshot read"
          : "1 highlight proof session";

  // FE-run-host issuance proof: build the immutable START_RUN contract (validated against FE_LIVE_PROOF_* in the
  // gate). The bound FE URL carries THIS run's id; the CLI-launched host is a supporting surface, not a client.
  const startRunContract = isFeLiveProof
    ? {
        soleStartRunOwner: FE_LIVE_PROOF_START_RUN_OWNER,
        maxStartRun: FE_LIVE_PROOF_MAX_START_RUN,
        credential: 0,
        test: 0,
        sync: 0,
        supportingSurface: [...FE_LIVE_PROOF_SUPPORTING_SURFACE],
        hostSendsStartRun: false,
        forbidStandaloneProofClient: true,
        boundFrontendPath: `/connect/naver?walkthroughRun=${env("WALKTHROUGH_RUN_ID") ?? "unknown"}`,
      }
    : undefined;

  const input: ApprovalPrereqInput = {
    phase,
    // The destructive phase pins channel/surface/operation/maxActions to its phase scope — the operator's grant
    // binds to exactly these, so a leftover env from another run must not be able to re-describe the run. The
    // gate refuses a deviation anyway (`DESTRUCTIVE_SCOPE_MISMATCH`); this stops feeding it one.
    channel: isWingKeyDeletion
      ? COUPANG_WING_KEY_DELETION_SCOPE.channel
      : (env("SELLEROPS_APPROVAL_CHANNEL") ?? (isWingPhase ? "COUPANG" : "NAVER")),
    accountBinding: isWingKeyDeletion
      ? COUPANG_WING_KEY_DELETION_SCOPE.accountBinding
      : (env("SELLEROPS_APPROVAL_ACCOUNT") ??
        (isWingPhase ? "operator-owned Coupang WING test account" : "operator-owned test store")),
    mode: spec.mode,
    apiCenterUrl,
    // Confirm the EXACT cli/driver from the spec — but only if the entrypoint really exists on disk.
    cli: cliExists ? spec.cli : undefined,
    driver: spec.driver,
    // The manifest declares exactly the phase driver's real capability (Phase A therefore never highlights).
    declaredActions: spec.capableActions,
    hotkey,
    artifactPath,
    requestedCaptureScreens,
    requestedProbeTargets,
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    maxActions: isWingKeyDeletion ? defaultMaxActions : (env("SELLEROPS_APPROVAL_MAX") ?? defaultMaxActions),
    surface: isWingKeyDeletion
      ? COUPANG_WING_KEY_DELETION_SCOPE.surface
      : (env("SELLEROPS_APPROVAL_SURFACE") ?? (isWingPhase ? "Coupang WING Open API" : "Commerce API Center")),
    operation: isWingKeyDeletion ? defaultOperation : (env("SELLEROPS_APPROVAL_OPERATION") ?? defaultOperation),
    startRunContract,
    // The WING key-deletion phase is scoped around an operator-performed irreversible action — carry its immutable
    // descriptor so the gate can enforce it. Both original blockers are resolved (the deletion CLI exists; the
    // 삭제 selector is live-calibrated), so this phase CAN now reach PREPARED and print a destructive manifest for
    // the operator to read. PREPARED is not APPROVED — the single-use grant is still a separate human step.
    operatorDestructiveAction: isWingKeyDeletion ? COUPANG_WING_KEY_DELETION_DESTRUCTIVE_ACTION : undefined,
    // Stated only for the WING deletion phase, from the single calibration constant. Every other phase leaves
    // this undefined so the gate applies its own default (NAVER's adapter flag; uncalibrated for WING).
    ...(isWingKeyDeletion ? { selectorsCalibrated: WING_DELETION_SELECTORS_CALIBRATED } : {}),
  };

  const res = validateApprovalPrerequisites(input);
  if (!res.ok) {
    process.stderr.write(`PREFLIGHT FAIL: approval_prerequisite (${res.cause}): ${res.reason}\n`);
    return 1;
  }

  // A DESTRUCTIVE phase additionally proves the running code IS the commit the manifest names. The gate above
  // only checks the identity is present and bound; it is pure and does no I/O, so the HEAD/clean-tree
  // comparison lives here — and in `run-coupang-wing-deletion-live.ts`, which performs the same check, so a
  // hand-typed invocation that skips the preflight script cannot skip this. Ordered AFTER the gate so a
  // wrong-phase / uncalibrated / mis-scoped run reports its own cause first, and BEFORE the manifest is
  // printed so a drifted or dirty run displays nothing to approve.
  if (spec.requiresOperatorDestructiveAction) {
    const identity = (opts.verifyIdentity ?? verifyRepoIdentity)({ expectedSha: input.gitSha, repoRoot: REPO_ROOT });
    if (!identity.ok) {
      process.stderr.write(`PREFLIGHT FAIL: repo_identity (${identity.cause}): ${identity.reason}\n`);
      return 1;
    }
  }
  // PREPARED: print the sanitized manifest JSON (no raw URL). preflight displays it.
  process.stdout.write(JSON.stringify(res.manifest, null, 2) + "\n");
  return 0;
}

// Run only when invoked directly (inert on import so tests exercise the pure module).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runApprovalManifestCli());
}
