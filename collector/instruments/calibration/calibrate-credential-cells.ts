/**
 * **Live, GATED, human-attended Coupang WING credential-CELL calibration
 * (`COUPANG_WING_CREDENTIAL_CELL_CALIBRATION`, READ_ONLY).**
 *
 *   npx tsx instruments/calibration/calibrate-credential-cells.ts -- --i-understand-this-opens-live-coupang-wing
 *
 * It answers one question, on a screen where the seller's keys are already showing: **which cell holds each
 * value.** `WING_CREDENTIAL_REGION_EVIDENCE` measured the LABELS (three `<th>` in one header row) and recorded
 * `WHERE_THE_CREDENTIAL_VALUES_SIT` as explicitly not established — so a value-reading locator written from that
 * table would be a guess about where a secret lives. This measures it instead.
 *
 * **It reads no value.** Per label it reports which association answered, the cell's tag, how many candidate
 * cells resolved, how many fields the cell holds, and ONE bit: whether the cell is non-empty. That bit is the
 * only thing here derived from a credential, and it is required — a locator that resolves to an empty cell has
 * not found the key, and a calibration that cannot tell those apart would certify a locator that reads nothing.
 *
 * It never clicks, types, submits, navigates, highlights, tags, or mounts an overlay on the WING page.
 *
 * `main()` runs ONLY when invoked directly, so an offline build or import launches nothing.
 */
import type { BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { launchNaverContext } from "../../src/profile";
import { CoupangWingCredentialDriver } from "../../src/action-window/coupang-wing-credential-driver";
import {
  COUPANG_CREDENTIAL_FIELD_IDS,
  chooseCredentialRegion,
  credentialCellsResolved,
} from "../../src/action-window/coupang-wing-credential-cells";
import { CREDENTIAL_REGION_MAX_DEPTH, CREDENTIAL_REGION_VENDOR_LABELS } from "../../src/action-window/coupang-wing-issuance-driver";
import type { OperatorConfirmAsk } from "../../src/cli/operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "../../src/cli/operator-confirm-host";
import { confirmRunGrant, runGrantRefusalMessage, type RunGrantBinding } from "../../src/cli/operator-run-grant";
import {
  COUPANG_WING_CREDENTIAL_CALIBRATION_SCOPE,
  PHASE_SPECS,
  WING_DEFAULT_ACCOUNT_BINDING,
  validateApprovalPrerequisites,
  type ApprovalPrereqInput,
} from "../../src/cli/approval-manifest";
import { resolveWingActionPhase, resolveWingUrl, screenWingUrl } from "../../src/cli/coupang-wing-classifier";
import { verifyRepoIdentity } from "../../src/cli/repo-identity";
import { coupangWingApprovalRequiredMessage, hasCoupangWingRunApproval } from "../../src/cli/live-run-approval";

const CALIBRATION = PHASE_SPECS.COUPANG_WING_CREDENTIAL_CELL_CALIBRATION;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The operation sentence and the budget, from the CONTRACT module's own scope — not a second copy of them. The
 * manifest CLI pins the same constants, so the screen the operator presses and the manifest they grant against
 * cannot say different things.
 */
export const CREDENTIAL_CELL_CALIBRATION_OPERATION = COUPANG_WING_CREDENTIAL_CALIBRATION_SCOPE.operation;

const MAX_ACTIONS = COUPANG_WING_CREDENTIAL_CALIBRATION_SCOPE.maxActions;

function env(k: string): string | undefined {
  const v = process.env[k];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** Run the phase's prerequisites through the gate. Returns the sanitized refusal cause, or null when PREPARED. */
export function gateRefusalCause(
  apiCenterUrl: string,
  verifyIdentity: typeof verifyRepoIdentity = verifyRepoIdentity,
): string | null {
  // The PHASE this run is authorized for, before anything else — the WING identity variables are byte-identical
  // across phases, so without this an approval granted for another WING action reaches PREPARED here.
  const phaseBinding = resolveWingActionPhase(process.env, "COUPANG_WING_CREDENTIAL_CELL_CALIBRATION");
  if (!phaseBinding.ok) return `${phaseBinding.refusal}: ${phaseBinding.reason}`;

  const input: ApprovalPrereqInput = {
    phase: CALIBRATION.phase,
    channel: "COUPANG",
    accountBinding: WING_DEFAULT_ACCOUNT_BINDING,
    mode: CALIBRATION.mode,
    apiCenterUrl,
    cli: CALIBRATION.cli,
    driver: CALIBRATION.driver,
    declaredActions: CALIBRATION.capableActions,
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    maxActions: MAX_ACTIONS,
    surface: "Coupang WING Open API",
    operation: CREDENTIAL_CELL_CALIBRATION_OPERATION,
  };
  const res = validateApprovalPrerequisites(input);
  if (!res.ok) return res.cause;
  const identity = verifyIdentity({ expectedSha: input.gitSha, repoRoot: REPO_ROOT });
  return identity.ok ? null : `${identity.cause}: ${identity.reason}`;
}

/** The manifest fields this run holds, for the run-level grant press. */
export function calibrationRunGrantBinding(): RunGrantBinding {
  return {
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    channel: "COUPANG",
    account: WING_DEFAULT_ACCOUNT_BINDING,
    surface: "Coupang WING Open API",
    operation: CREDENTIAL_CELL_CALIBRATION_OPERATION,
    mode: CALIBRATION.mode,
    maxActions: MAX_ACTIONS,
    agentDoesNot:
      "Access Key · Secret Key · 업체코드의 값을 읽지 않습니다. 화면의 어떤 칸이 그 값을 담고 있는지 구조만 " +
      "확인하고, 그 칸이 비어 있는지 여부(예/아니오) 하나만 봅니다. 클릭·입력·발급·삭제·전송 없음.",
  };
}

export const CALIBRATION_ABORT_FILENAME = "calibrate-credential-cells.abort";

export function sentinelPath(statusFile: string, filename: string): string {
  return resolve(dirname(resolve(statusFile)), filename);
}

function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

/** The one checkpoint. It asks the operator to be ON the screen — it cannot verify that itself beyond a category. */
export function calibrationAsk(): OperatorConfirmAsk {
  return {
    title: "WING 자격증명 칸 구조 측정",
    headline: "발급된 키가 보이는 WING 화면에 직접 도착하신 뒤 눌러 주세요.",
    lines: [
      "SellerOps는 이 창을 조작하지 않습니다 — 로그인 · 이동은 모두 직접 하세요.",
      "누르시면 SellerOps가 업체코드 / Access Key / Secret Key 라벨이 어떤 칸과 연결되어 있는지 한 번 측정합니다.",
      "값은 읽지 않습니다. 그 칸이 비어 있는지 여부만 확인합니다.",
      "아무것도 눌리거나 입력되지 않고, 어디로도 전송되지 않습니다.",
    ],
  };
}

/** Where the calibration stopped. Only `MEASURED` produced a reading. */
export const CALIBRATION_STOPS = ["ABORTED_BEFORE_CHECKPOINT", "NOT_CREDENTIAL_SURFACE", "MEASURED"] as const;
export type CalibrationStop = (typeof CALIBRATION_STOPS)[number];

/**
 * 0 = measured and every cell resolved unambiguously (the locator is calibrated)
 * 5 = measured, but the cells did NOT resolve — a real result, and the one that must not be rounded up
 * 7 = nothing was measured (refused, aborted, or timed out)
 */
export function calibrationExitCode(stop: CalibrationStop, resolved: boolean): number {
  if (stop !== "MEASURED") return 7;
  return resolved ? 0 : 5;
}

export const CALIBRATION_BANNER_LINES: readonly string[] = [
  " LIVE Coupang WING credential-CELL calibration — explicit per-run approval required.",
  " SellerOps measures WHICH CELL holds each of 업체코드 / Access Key / Secret Key, and whether",
  " that cell is non-empty. It reads NO VALUE, and sends nothing anywhere.",
  " It never clicks, types, submits, navigates, highlights, or tags the WING page.",
];

export function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  for (const l of CALIBRATION_BANNER_LINES) console.error(l);
  console.error(line);
}

async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasCoupangWingRunApproval(args)) {
    console.error(coupangWingApprovalRequiredMessage());
    process.exit(3);
    return;
  }
  const url = resolveWingUrl(args, process.env);
  const screen = screenWingUrl(url);
  if (!screen.ok) {
    console.error(
      `Refusing to launch: COUPANG_WING_URL failed screening (reason=${screen.reason}). No browser launched.`,
    );
    process.exit(2);
    return;
  }
  const refusal = gateRefusalCause(url);
  if (refusal) {
    console.error(`Refusing to start the credential-cell calibration: approval_prerequisite (${refusal}). No browser launched.`);
    process.exit(4);
    return;
  }

  const cfg = loadConfig();
  const abortPath = sentinelPath(cfg.statusFile, CALIBRATION_ABORT_FILENAME);
  mkdirSync(dirname(abortPath), { recursive: true });
  removeSentinel(abortPath);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, {
    aborted: () => abortFlag.v || existsSync(abortPath),
    abortPath,
  });
  const driver = new CoupangWingCredentialDriver(confirmHost.entryPage as unknown as Page, {
    context: confirmHost.contextLike as unknown as BrowserContext,
  });
  try {
    // THE RUN-LEVEL GRANT. The approval flag is a statement of intent; this press is the authorization.
    const grant = await confirmRunGrant(confirmHost, calibrationRunGrantBinding());
    log("aw_coupang_credential_calibration_run_grant", { outcome: grant });
    if (grant !== "GRANTED") {
      console.error(runGrantRefusalMessage(grant));
      process.exitCode = 7;
      return;
    }

    const ask = calibrationAsk();
    confirmHost.announce(ask);
    const confirmation = await confirmHost.confirm(ask);
    log("aw_coupang_credential_calibration_confirm", {
      checkpoint: ask.title,
      signal: confirmation.signal,
      provenance: confirmation.provenance ?? "none",
    });
    if (confirmation.signal !== "ready") {
      console.error("Aborted or timed out before the checkpoint. Nothing was measured.");
      process.exitCode = calibrationExitCode("ABORTED_BEFORE_CHECKPOINT", false);
      return;
    }

    const surface = await driver.classifyInitialSurface();
    if (!surface.ok) {
      console.error(
        `Refusing to measure: not the issued open-API surface (pageCategory=${surface.observation.pageCategory}).`,
      );
      process.exitCode = calibrationExitCode("NOT_CREDENTIAL_SURFACE", false);
      return;
    }

    const census = await driver.censusCredentialCells();
    const verdict = credentialCellsResolved(census, COUPANG_CREDENTIAL_FIELD_IDS);
    // The account's key state, from the SAME census — no second reading, and no value.
    const state = await driver.classifyCredentialState(census);
    // …and the region the ⑧ ring has to enclose. Anchored on the value cell; `null` is a real answer.
    const scope = await driver.measureCredentialRegionScope(CREDENTIAL_REGION_VENDOR_LABELS, CREDENTIAL_REGION_MAX_DEPTH);
    const cleanRegion = chooseCredentialRegion(scope, COUPANG_CREDENTIAL_FIELD_IDS.length);
    // SANITIZED record → stdout. Enums, tag names, integers and one boolean per cell. No value, no selector, no
    // raw URL (the URL is reduced to a host category).
    console.log(
      JSON.stringify(
        {
          urlCategory: screen.urlCategory,
          phase: CALIBRATION.phase,
          pageCategory: surface.observation.pageCategory,
          resolved: verdict.ok,
          refusal: verdict.reason,
          ...(verdict.id ? { refusalField: verdict.id } : {}),
          credentialState: state,
          readings: census.readings,
          regionScope: scope,
          // `null` means NO level holds the three keys without the seller's 연동 정보 block. That is a real
          // answer and the ring stays a blocker on it — it is never rounded up to the closest near-miss.
          cleanRingRegion: cleanRegion,
        },
        null,
        2,
      ),
    );
    if (!verdict.ok) {
      console.error("");
      console.error(`⚠ The credential cells did NOT resolve (${verdict.reason}${verdict.id ? ` on ${verdict.id}` : ""}).`);
      console.error("  That is the measurement, not a failure to retry away. The handoff stays closed until a");
      console.error("  reading resolves all three — do not hand-write a locator from this output.");
    }
    if (!cleanRegion) {
      console.error("");
      console.error("⚠ No ancestor level holds the three credential values WITHOUT the vendor 연동 정보 block.");
      console.error("  The ⑧ ring stays a blocker. Do not pick an anchor from this output.");
    }
    process.exitCode = calibrationExitCode("MEASURED", verdict.ok);
  } finally {
    removeSentinel(abortPath);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await ctx.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    log("aw_coupang_credential_calibration_fatal", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
    process.exit(1);
  });
}
