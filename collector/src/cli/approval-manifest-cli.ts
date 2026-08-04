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
import { CALIBRATION_PHASES } from "./approval-manifest";

const COLLECTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function env(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v.length > 0 ? v : undefined;
}

export function runApprovalManifestCli(): number {
  const phase = env("SELLEROPS_APPROVAL_PHASE") ?? "";
  // Fail closed on an unknown phase before deriving anything from a missing spec.
  if (!(CALIBRATION_PHASES as readonly string[]).includes(phase)) {
    process.stderr.write(`PREFLIGHT FAIL: approval_prerequisite (UNKNOWN_PHASE): set SELLEROPS_APPROVAL_PHASE to one of ${CALIBRATION_PHASES.join(" | ")}\n`);
    return 1;
  }
  const spec = PHASE_SPECS[phase as CalibrationPhase];

  // The URL is the public base constant unless the operator preset an account deep link; screened in validate.
  const apiCenterUrl = env("NAVER_API_CENTER_URL") ?? NAVER_API_CENTER_BASE_URL;

  // Dry-validate the run command: the exact CLI entrypoint file must exist.
  const cliExists = existsSync(resolve(COLLECTOR_ROOT, spec.cli));

  // ONLY the hotkey calibrator phase (Phase A, `API_CENTER_STRUCTURE_OBSERVATION`) captures from a keypress and
  // writes a per-run RAW selector artifact. The visual-recon phase has no hotkey and writes its redacted PNG +
  // sanitized summary under the gitignored `.calibration/visual/` sink. The read-only selector probe and the
  // highlight proof have NEITHER — they carry no hotkey and no raw-artifact path (a misleading one would
  // over-claim a capability the phase's driver does not have).
  const isVisualRecon = phase === "API_CENTER_VISUAL_RECON";
  const isStructureObs = phase === "API_CENTER_STRUCTURE_OBSERVATION";
  const isFeLiveProof = phase === "API_ISSUANCE_FE_LIVE_PROOF";
  const hotkey = isStructureObs ? (env("SELLEROPS_CALIBRATION_HOTKEY") ?? "Ctrl+Shift+K") : undefined;
  const artifactPath = isVisualRecon
    ? VISUAL_RECON_ARTIFACT_CATEGORY
    : isStructureObs
      ? (env("SELLEROPS_CALIBRATION_ARTIFACT") ?? `.calibration/api-center-${env("WALKTHROUGH_RUN_ID") ?? "unknown"}.json`)
      : undefined;
  const defaultOperation = isVisualRecon
    ? "API Center redacted visual recon"
    : isStructureObs
      ? "API Center structure observation"
      : phase === "API_ISSUANCE_SELECTOR_PROBE"
        ? "API issuance read-only selector probe"
        : isFeLiveProof
          ? "existing-app guided issuance tutorial — FE-run-host READ-only live proof (open_app→api_group→credentials→return)"
          : "API issuance highlight proof (new-app or existing-app)";
  const defaultMaxActions = isVisualRecon
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
    channel: env("SELLEROPS_APPROVAL_CHANNEL") ?? "NAVER",
    accountBinding: env("SELLEROPS_APPROVAL_ACCOUNT") ?? "operator-owned test store",
    mode: spec.mode,
    apiCenterUrl,
    // Confirm the EXACT cli/driver from the spec — but only if the entrypoint really exists on disk.
    cli: cliExists ? spec.cli : undefined,
    driver: spec.driver,
    // The manifest declares exactly the phase driver's real capability (Phase A therefore never highlights).
    declaredActions: spec.capableActions,
    hotkey,
    artifactPath,
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    maxActions: env("SELLEROPS_APPROVAL_MAX") ?? defaultMaxActions,
    surface: env("SELLEROPS_APPROVAL_SURFACE") ?? "Commerce API Center",
    operation: env("SELLEROPS_APPROVAL_OPERATION") ?? defaultOperation,
    startRunContract,
  };

  const res = validateApprovalPrerequisites(input);
  if (!res.ok) {
    process.stderr.write(`PREFLIGHT FAIL: approval_prerequisite (${res.cause}): ${res.reason}\n`);
    return 1;
  }
  // PREPARED: print the sanitized manifest JSON (no raw URL). preflight displays it.
  process.stdout.write(JSON.stringify(res.manifest, null, 2) + "\n");
  return 0;
}

// Run only when invoked directly (inert on import so tests exercise the pure module).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runApprovalManifestCli());
}
