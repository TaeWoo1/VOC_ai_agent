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

  // Only the hotkey calibrator phase (Phase A) captures from a keypress + writes a per-run RAW selector artifact.
  // The visual-recon phase has no hotkey and writes its redacted PNG + sanitized summary under the gitignored
  // `.calibration/visual/` sink. The read-only selector probe has NEITHER — it emits only sanitized integers to
  // the console, so it carries no hotkey and no raw-artifact path (a misleading one would over-claim capability).
  const isVisualRecon = phase === "API_CENTER_VISUAL_RECON";
  const isSelectorProbe = phase === "API_ISSUANCE_SELECTOR_PROBE";
  const hotkey = isVisualRecon || isSelectorProbe ? undefined : (env("SELLEROPS_CALIBRATION_HOTKEY") ?? "Ctrl+Shift+K");
  const artifactPath = isVisualRecon
    ? VISUAL_RECON_ARTIFACT_CATEGORY
    : isSelectorProbe
      ? undefined
      : (env("SELLEROPS_CALIBRATION_ARTIFACT") ?? `.calibration/api-center-${env("WALKTHROUGH_RUN_ID") ?? "unknown"}.json`);
  const defaultOperation = isVisualRecon
    ? "API Center redacted visual recon"
    : isSelectorProbe
      ? "API issuance read-only selector probe"
      : phase === "API_CENTER_STRUCTURE_OBSERVATION"
        ? "API Center structure observation"
        : "API issuance highlight proof";
  const defaultMaxActions = isVisualRecon
    ? "1 redacted visual recon session"
    : isSelectorProbe
      ? "1 read-only selector probe session"
      : "1 calibration session";

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
