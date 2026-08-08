/**
 * **Live, GATED, human-attended Coupang WING issuance-form REVEAL run
 * (`COUPANG_WING_ISSUANCE_FORM_REVEAL` / `REVEAL_WING_ISSUANCE_CONFIGURATION`).**
 *
 *   npx tsx src/cli/run-coupang-wing-reveal-live.ts -- --i-understand-this-opens-live-coupang-wing
 *
 * One WING-resident Action Window step. SellerOps highlights the live-calibrated `발급` control on the real
 * open-API surface, mounts the expectation checkpoint, and RESTS. The OPERATOR presses 발급 themselves. Then
 * SellerOps clears its overlay, takes ONE sanitized observation of whatever surface appeared, prints it, and
 * exits. It never clicks, types, submits, selects 자체개발, fills 업체명/URL/IP, presses the final 확인, issues a
 * key, or reads any value.
 *
 * **The press is NOT declared as key creation.** On the official Coupang flow 발급 opens the 연동 방식 /
 * configuration step and the key is created by a later `확인`. That is the expectation this run is built around —
 * and it is NOT live-confirmed, so the runtime fails closed: an outcome it does not recognize is reported as
 * such and stops, never as success, and it never advances into the configuration step.
 *
 * **It cannot certify that no key was created.** Every sanitized signal is identical between a real issued page
 * and a real no-key form (`wingIssuedStateFrom` ⇒ `NO_DISCRIMINATING_SIGNAL`), so the printed record carries
 * `keyCreationRuledOut: false` with the classifier's own reason. Only the operator, looking at the screen, can
 * say what happened. A record that omitted this would read as an implicit all-clear.
 *
 * Gating mirrors `run-coupang-wing-deletion-live`: refuses without `--i-understand-this-opens-live-coupang-wing`
 * (a NAVER grant never opens WING); `screenWingUrl` fail-closed BEFORE Chrome launches; a PREPARED manifest for
 * THIS bootstrapped identity, with the immutable reveal descriptor and the `issue` calibration, plus a repo
 * identity check (HEAD is the pinned commit, this repository, clean tree). It NEVER navigates — the operator
 * does. `main()` runs ONLY when invoked directly, so offline build/verify launches nothing.
 */
import type { BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import {
  CoupangWingRevealDriver,
  WING_REVEAL_CHECKPOINT_LABEL,
  type WingRevealResult,
} from "../action-window/coupang-wing-reveal-driver";
import { WING_ISSUE_SELECTOR_CALIBRATED } from "../action-window/coupang-wing-issuance-driver";
import {
  COUPANG_WING_ISSUANCE_REVEAL_ACTION,
  PHASE_SPECS,
  validateApprovalPrerequisites,
  type ApprovalPrereqInput,
} from "./approval-manifest";
import { resolveWingUrl, screenWingUrl } from "./coupang-wing-classifier";
import { verifyRepoIdentity } from "./repo-identity";
import { coupangWingApprovalRequiredMessage, hasCoupangWingRunApproval } from "./live-run-approval";

const REVEAL = PHASE_SPECS.COUPANG_WING_ISSUANCE_FORM_REVEAL;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function env(k: string): string | undefined {
  const v = process.env[k];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Build the reveal phase's prerequisite input and run it through the gate. Returns the sanitized refusal cause
 * (or null when PREPARED). The single choke point: an unbound identity, a softened/missing reveal descriptor, an
 * off-target host, a withdrawn `issue` calibration, a drifted HEAD or a dirty tree all refuse HERE, before any
 * browser opens.
 *
 * `channel` / `accountBinding` / `surface` / `operation` / `maxActions` are pinned to constants rather than read
 * from the environment, for the reason the deletion CLI pins its scope: the operator's one-line grant binds to
 * those fields, so a stale `.env` from another run must not be able to make this manifest describe a different
 * run. This phase carries no `destructiveScope` (it is not destructive), so the pinning lives here.
 */
export function gateRefusalCause(
  apiCenterUrl: string,
  /** Repository-identity verifier seam; the DEFAULT is the real check, so a caller who forgets gets strictness. */
  verifyIdentity: typeof verifyRepoIdentity = verifyRepoIdentity,
): string | null {
  const input: ApprovalPrereqInput = {
    phase: REVEAL.phase,
    channel: "COUPANG",
    accountBinding: "operator-owned Coupang WING test account",
    mode: REVEAL.mode,
    apiCenterUrl,
    cli: REVEAL.cli,
    driver: REVEAL.driver,
    declaredActions: REVEAL.capableActions,
    // The phase HIGHLIGHTS a real control, so the gate requires a calibration. Stated from the shared constant —
    // never hardcoded `true` — so withdrawing the calibration closes this path with SELECTORS_NOT_CALIBRATED.
    selectorsCalibrated: WING_ISSUE_SELECTOR_CALIBRATED,
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    maxActions: "1 operator-performed 발급 press + 1 sanitized observation",
    surface: "Coupang WING Open API",
    operation: "WING issuance-form reveal (operator presses 발급; no key issuance, no input, no value read)",
    operatorRevealAction: COUPANG_WING_ISSUANCE_REVEAL_ACTION,
  };
  const res = validateApprovalPrerequisites(input);
  if (!res.ok) return res.cause;
  const identity = verifyIdentity({ expectedSha: input.gitSha, repoRoot: REPO_ROOT });
  return identity.ok ? null : `${identity.cause}: ${identity.reason}`;
}

/* ────────────────────────────── sentinels ────────────────────────────── */

export const REVEAL_READY_FILENAME = "run-coupang-wing-reveal-live.ready";
export const REVEAL_DONE_FILENAME = "run-coupang-wing-reveal-live.pressed";
export const REVEAL_ABORT_FILENAME = "run-coupang-wing-reveal-live.abort";

export function sentinelPath(statusFile: string, filename: string): string {
  return resolve(dirname(resolve(statusFile)), filename);
}

const POLL_MS = 1_000;
const WAIT_TIMEOUT_MS = 20 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

/** Wait for one of the operator's sentinels. Pure-ish seam so the walk order is unit-testable offline. */
export type RevealSignal = "ready" | "pressed" | "abort" | "timeout";

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE Coupang WING issuance-form REVEAL — explicit per-run approval required.");
  console.error(" SellerOps HIGHLIGHTS the 발급 control and RESTS. The OPERATOR presses it. SellerOps never");
  console.error(" clicks, types, submits, selects 자체개발, fills 업체명/URL/IP, presses 확인, issues a key, or");
  console.error(" reads any value (incl. Access Key / Secret Key / 업체코드).");
  console.error(" The press is expected to open the API configuration step — this is NOT confirmed, so an");
  console.error(" unrecognized outcome STOPS the run. It CANNOT prove no key was created; only you can see that.");
  console.error(line);
}

/**
 * Live entry (gated). Opens the operator's window ONCE, NEVER navigates it, highlights 발급, rests until the
 * operator signals they pressed it, clears the overlay, takes ONE sanitized observation, prints it, and closes.
 */
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
      `Refusing to launch: COUPANG_WING_URL failed screening (reason=${screen.reason}). It must be the ` +
        "Coupang WING or auth host and not a placeholder. No browser launched.",
    );
    process.exit(2);
    return;
  }
  const refusal = gateRefusalCause(url);
  if (refusal) {
    console.error(`Refusing to start the WING issuance-form REVEAL run: approval_prerequisite (${refusal}). No browser launched.`);
    console.error(
      refusal === "SELECTORS_NOT_CALIBRATED"
        ? "  The 발급 selector calibration is withdrawn. Restore it only from a fresh READ-ONLY selector probe."
        : refusal.startsWith("HEAD_DRIFT") || refusal.startsWith("DIRTY_TREE")
          ? "  The running code is not the commit this approval names — the grant is REVOKED (contract §1.6). Commit or stash, then re-bootstrap."
          : refusal.startsWith("WRONG_REPOSITORY") || refusal.startsWith("GIT_UNREADABLE")
            ? "  Repository state could not be verified — refusing rather than assuming the code is unchanged."
            : "  Re-bootstrap a valid identity + reveal Approval Manifest, then retry.",
    );
    process.exit(4);
    return;
  }

  const cfg = loadConfig();
  const readyPath = sentinelPath(cfg.statusFile, REVEAL_READY_FILENAME);
  const donePath = sentinelPath(cfg.statusFile, REVEAL_DONE_FILENAME);
  const abortPath = sentinelPath(cfg.statusFile, REVEAL_ABORT_FILENAME);
  mkdirSync(dirname(readyPath), { recursive: true });
  for (const p of [readyPath, donePath, abortPath]) removeSentinel(p);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const waitFor = async (target: string): Promise<RevealSignal> => {
    const maxTicks = Math.ceil(WAIT_TIMEOUT_MS / POLL_MS);
    for (let i = 0; i < maxTicks; i++) {
      if (abortFlag.v || existsSync(abortPath)) return "abort";
      if (existsSync(target)) return target === readyPath ? "ready" : "pressed";
      await sleep(POLL_MS);
    }
    return "timeout";
  };

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const entry = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  const driver = new CoupangWingRevealDriver(entry, { context: ctx });
  let result: WingRevealResult | null = null;
  try {
    console.error("");
    console.error("Navigate MANUALLY to the WING open-API screen in the opened window, then signal readiness:");
    console.error(`       ${readyPath}`);
    console.error(`     abort: ${abortPath}`);
    if ((await waitFor(readyPath)) !== "ready") {
      console.error("Aborted or timed out before the checkpoint. Nothing was highlighted.");
      return;
    }
    const classified = await driver.classifyInitialSurface();
    if (!classified.ok) {
      console.error(`Refusing to continue: not the open-API surface (pageCategory=${classified.observation.pageCategory}).`);
      return;
    }
    const probe = await driver.probeIssueMatch();
    if (probe.matchCount !== 1) {
      console.error(`Refusing to highlight: the 발급 control matched ${probe.matchCount}, not 1. Nothing was highlighted.`);
      return;
    }
    const located = await driver.highlightIssueCheckpoint();
    if (located.count !== 1) {
      console.error("The checkpoint could not be painted — refusing to hand the operator an unmarked page.");
      return;
    }
    console.error("");
    console.error(`CHECKPOINT — ${WING_REVEAL_CHECKPOINT_LABEL}`);
    console.error("  Press 발급 YOURSELF, then signal that you pressed it:");
    console.error(`       ${donePath}`);
    if ((await waitFor(donePath)) !== "pressed") {
      console.error("Aborted or timed out at the checkpoint. Clearing the overlay; no observation taken.");
      await driver.cleanup();
      return;
    }
    result = await driver.observeRevealOutcome();
    console.error("");
    console.error("Reveal observation complete. 이제 SellerOps 탭으로 직접 돌아가세요.");
    // SANITIZED record → stdout. Enums / booleans / buckets / signal NAMES only — never a selector, value, PII,
    // raw DOM/HTML, screenshot, or raw URL (the URL is reduced to a host category).
    console.log(
      JSON.stringify(
        {
          urlCategory: screen.urlCategory,
          phase: REVEAL.phase,
          operatorAction: COUPANG_WING_ISSUANCE_REVEAL_ACTION.operation,
          outcome: result.outcome,
          changedSignals: result.changedSignals,
          before: result.before,
          after: result.after,
          // Always false, with the classifier's reason. Emitted so the record cannot be read as an all-clear.
          keyCreationRuledOut: result.keyCreationRuledOut,
          keyCreationReason: result.keyCreationReason,
          overlayClearedBeforeObservation: result.overlayClearedBeforeObservation,
        },
        null,
        2,
      ),
    );
    log("aw_coupang_reveal_run_done", {
      urlCategory: screen.urlCategory,
      outcome: result.outcome,
      changedSignalCount: result.changedSignals.length,
      keyCreationRuledOut: result.keyCreationRuledOut,
    });
  } finally {
    for (const p of [readyPath, donePath, abortPath]) removeSentinel(p);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await driver.cleanup().catch(() => undefined);
    await ctx.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    log("aw_coupang_reveal_run_fatal", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
    process.exit(1);
  });
}
