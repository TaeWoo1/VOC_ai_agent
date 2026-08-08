/**
 * Live, GATED, human-attended Coupang WING open-API **key-DELETION** entrypoint (ISOLATED — DESTRUCTIVE-SCOPE).
 *
 *   set -a && . ./.env && set +a          # COUPANG_WING_URL + WALKTHROUGH_* identity (operator-owned; never logged)
 *   npx tsx src/cli/run-coupang-wing-deletion-live.ts -- --i-understand-this-opens-live-coupang-wing
 *
 * The gated live surface for the {@link CoupangWingDeletionDriver}. It guides an operator to DELETE their existing
 * WING self-developed Open API key: the SELLER logs in + reaches the already-issued page themselves, SellerOps
 * highlights ONLY the 삭제 control and rests at an IRREVERSIBLE-WARNING checkpoint, and the SELLER presses 삭제
 * THEMSELVES. SellerOps never logs in, clicks, types, submits, deletes, or reads a value — it reads only a
 * sanitized page category to confirm the page changed.
 *
 * **Fails closed in FOUR layers.** The 삭제 selector is now live-calibrated
 * (`WING_DELETION_CALIBRATION_EVIDENCE`), so layers 3–4 no longer refuse on calibration and this entrypoint is
 * EXECUTABLE — but only under all four, and it still deletes nothing itself:
 *   1. refuses without `--i-understand-this-opens-live-coupang-wing` (`hasCoupangWingRunApproval` — a NAVER grant
 *      never opens WING);
 *   2. `screenWingUrl`-fail-closed BEFORE Chrome launches (only the WING / auth host);
 *   3. the approval gate: {@link validateApprovalPrerequisites} for `COUPANG_WING_KEY_DELETION` must return a
 *      PREPARED manifest — so a MISSING/MODIFIED operator-destructive descriptor, an UNBOUND identity
 *      (`WALKTHROUGH_*`), or an off-target host all refuse; and it refuses with `SELECTORS_NOT_CALIBRATED`
 *      whenever the calibration flag is withdrawn;
 *   4. the driver additionally refuses to highlight while {@link WING_DELETION_SELECTORS_CALIBRATED} is false,
 *      refuses a non-unique 삭제 match, and refuses the operator-action step before the irreversible checkpoint.
 *
 * A calibrated selector is NOT an approval. Running this requires a fresh, single-use operator grant against a
 * displayed destructive Approval Manifest (`docs/sellerops_live_approval_contract.md`).
 *
 * The seller navigates themselves (this CLI never `.goto`s), signals readiness + completion via sentinel files, and
 * the context is always closed. `main()` runs ONLY when invoked directly (inert on import) so tests launch nothing.
 */
import type { BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import {
  CoupangWingDeletionDriver,
  WING_DELETION_WARNING_LABEL,
} from "../action-window/coupang-wing-deletion-driver";
import { WING_DELETION_SELECTORS_CALIBRATED } from "../action-window/coupang-wing-issuance-driver";
import {
  PHASE_SPECS,
  COUPANG_WING_KEY_DELETION_DESTRUCTIVE_ACTION,
  COUPANG_WING_KEY_DELETION_SCOPE,
  validateApprovalPrerequisites,
  type ApprovalPrereqInput,
} from "./approval-manifest";
import { resolveWingUrl, screenWingUrl, type WingPageCategory } from "./coupang-wing-classifier";
import { verifyRepoIdentity } from "./repo-identity";
import { coupangWingApprovalRequiredMessage, hasCoupangWingRunApproval } from "./live-run-approval";

const WKD = PHASE_SPECS.COUPANG_WING_KEY_DELETION;
/** The repository this run must be reading — derived from this file's location, never from the environment. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function env(name: string): string | undefined {
  const v = process.env[name];
  return v !== undefined && v.length > 0 ? v : undefined;
}

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE Coupang WING open-API KEY DELETION — explicit per-run approval required (DESTRUCTIVE).");
  console.error(" Read-only guidance: the SELLER logs in, reaches the already-issued open-API page, and presses");
  console.error(" 삭제 THEMSELVES after reading the irreversible warning. This tool never logs in, clicks, types,");
  console.error(" submits, deletes, or reads any value — it highlights the 삭제 control read-only and reads only a");
  console.error(" SANITIZED page category to confirm the deletion. Deletion is IRREVERSIBLE and immediately");
  console.error(" invalidates the existing Access/Secret Key.");
  console.error(line);
}

/**
 * Build the deletion-phase approval input from the bootstrapped identity + the immutable destructive descriptor,
 * and run it through the gate. Returns the sanitized refusal cause (or null when PREPARED). This is the single
 * choke point: unbound identity, a softened/missing descriptor, an off-target host, or an uncalibrated selector
 * all refuse HERE, before any browser opens.
 */
export function gateRefusalCause(
  apiCenterUrl: string,
  /**
   * Repository-identity verifier seam. Production uses the real check against this checkout; tests inject a
   * stub so the composition (gate first, then identity) is asserted on BEHAVIOUR rather than by grepping the
   * source. The DEFAULT is the real check — a caller that forgets to inject gets the strict behaviour.
   */
  verifyIdentity: typeof verifyRepoIdentity = verifyRepoIdentity,
): string | null {
  // The four scope fields come from the phase spec, NOT the environment: the operator's grant binds to them, so
  // a stale `.env` must never be able to make a destructive manifest describe a different run. The gate pins
  // them too (`DESTRUCTIVE_SCOPE_MISMATCH`) — this side just stops feeding it anything else.
  const scope = WKD.destructiveScope ?? COUPANG_WING_KEY_DELETION_SCOPE;
  const input: ApprovalPrereqInput = {
    phase: WKD.phase,
    channel: scope.channel,
    accountBinding: scope.accountBinding,
    mode: WKD.mode,
    apiCenterUrl,
    cli: WKD.cli,
    driver: WKD.driver,
    declaredActions: WKD.capableActions,
    selectorsCalibrated: WING_DELETION_SELECTORS_CALIBRATED,
    runId: env("WALKTHROUGH_RUN_ID") ?? "unknown",
    approvalId: env("WALKTHROUGH_APPROVAL_ID") ?? "unknown",
    gitSha: env("WALKTHROUGH_GIT_COMMIT") ?? "unknown",
    maxActions: scope.maxActions,
    surface: scope.surface,
    operation: scope.operation,
    operatorDestructiveAction: COUPANG_WING_KEY_DELETION_DESTRUCTIVE_ACTION,
  };
  const res = validateApprovalPrerequisites(input);
  if (!res.ok) return res.cause;
  // The gate is pure and only proves the identity is BOUND. Prove it is also TRUE: HEAD must be the commit the
  // bootstrap pinned, in this repository, with a clean tree. Without this a leftover `.env` from a consumed
  // approval reaches PREPARED carrying a SHA that does not describe the running code — `REVOKED` by contract
  // §1.6. The display CLI performs the identical check, so the manifest the operator approved and the run they
  // approved it for cannot describe different code.
  const identity = verifyIdentity({ expectedSha: input.gitSha, repoRoot: REPO_ROOT });
  return identity.ok ? null : `${identity.cause}: ${identity.reason}`;
}

/* ────────────────────────────── sentinels (operator readiness + completion) ────────────────────────────── */

export const DELETION_READY_FILENAME = "run-coupang-wing-deletion-live.ready";
export const DELETION_DONE_FILENAME = "run-coupang-wing-deletion-live.deleted";
export const DELETION_ABORT_FILENAME = "run-coupang-wing-deletion-live.abort";

const SENTINEL_POLL_MS = 1_000;
const WAIT_TIMEOUT_MS = 20 * 60_000; // generous budget for a manual login + navigate + read the warning + delete

function sentinelPath(statusFile: string, filename: string): string {
  return resolve(dirname(resolve(statusFile)), filename);
}
function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll a readiness/abort pair until one appears (or timeout). Returns which fired. */
async function waitForSignal(readyPath: string, abortPath: string, abortFlag: { v: boolean }): Promise<"ready" | "abort" | "timeout"> {
  const maxTicks = Math.ceil(WAIT_TIMEOUT_MS / SENTINEL_POLL_MS);
  for (let i = 0; i < maxTicks; i++) {
    if (abortFlag.v || existsSync(abortPath)) return "abort";
    if (existsSync(readyPath)) return "ready";
    await sleep(SENTINEL_POLL_MS);
  }
  return "timeout";
}

/** How the operator-action wait ended. */
export type DeletionCompletionSignal = "ready" | "abort" | "timeout";

/** The minimal driver surface {@link finishDeletionRun} needs, so the sequence is testable over a fake. */
export interface DeletionRunDriver {
  clearHighlight(): Promise<void>;
  verifyDeletion(): Promise<{ deleted: boolean; pageCategory: WingPageCategory }>;
}

/**
 * End the guided deletion run: **retire the checkpoint FIRST**, then (only for a completion signal) read the
 * sanitized page category.
 *
 * The defect this fixes, reported by the operator on the first live run: the ring and the irreversible-warning
 * panel stayed up after they pressed 삭제 — through the verify poll and until the `finally` cleanup. On a
 * destructive surface that is not cosmetic. The ring points at a control that may no longer exist, while the
 * panel still reads "press 삭제" — instructing the operator to repeat an action they have already taken, on a
 * page that may now offer 발급 in a similar position. Stale destructive guidance invites a second attempt.
 *
 * The driver cannot detect the click itself (it deliberately attaches no listeners to marketplace controls), so
 * the operator's completion signal is the earliest possible moment — but it is much earlier than the old
 * behaviour, and it happens on EVERY signal, including abort and timeout.
 *
 * Clearing removes DOM the agent itself added; it never clicks, confirms, or re-triggers anything. A clear that
 * FAILS is recorded as `checkpointCleared: false` and nothing else: it must not block the outcome, must not
 * retry the destructive action, and must not be reported as success. Clearing also does NOT reset the driver's
 * phase, so the checkpoint-before-operator-action invariant is untouched by removing the checkpoint's pixels.
 */
export async function finishDeletionRun(
  driver: DeletionRunDriver,
  signal: DeletionCompletionSignal,
): Promise<Record<string, unknown>> {
  let checkpointCleared = true;
  try {
    await driver.clearHighlight();
  } catch {
    checkpointCleared = false;
  }
  if (signal !== "ready") {
    return { event: "COUPANG_DELETION", outcome: signal === "abort" ? "ABORTED" : "TIMEOUT", checkpointCleared };
  }
  const verified = await driver.verifyDeletion();
  // SANITIZED only — a boolean + a page category enum. No value, selector, PII, raw DOM, or URL.
  return {
    event: "COUPANG_DELETION",
    outcome: "COMPLETED",
    deleted: verified.deleted,
    pageCategory: verified.pageCategory,
    checkpointCleared,
  };
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
      `Refusing to launch: COUPANG_WING_URL failed screening (reason=${screen.reason}). It must be the ` +
        "Coupang WING or auth host and not a placeholder. No browser launched.",
    );
    process.exit(2);
    return;
  }

  // Approval gate + repository identity — the destructive run must reach a PREPARED manifest for THIS
  // bootstrapped identity, AND the running code must be the commit that identity pins. A missing/softened
  // destructive descriptor, an unbound identity, an off-target host, a withdrawn calibration flag
  // (SELECTORS_NOT_CALIBRATED), a re-described scope (DESTRUCTIVE_SCOPE_MISMATCH), a drifted HEAD, or a dirty
  // tree all refuse here. NOTHING launches on refusal.
  const refusal = gateRefusalCause(url);
  if (refusal) {
    console.error(`Refusing to start the WING key-DELETION run: approval_prerequisite (${refusal}). No browser launched.`);
    console.error(
      refusal === "SELECTORS_NOT_CALIBRATED"
        ? "  The 삭제 selector calibration is withdrawn. Restore it only from a fresh READ-ONLY delete selector probe."
        : refusal.startsWith("HEAD_DRIFT") || refusal.startsWith("DIRTY_TREE")
          ? "  The running code is not the commit this approval names — the grant is REVOKED (contract §1.6). Commit or stash, then re-bootstrap."
          : refusal.startsWith("WRONG_REPOSITORY") || refusal.startsWith("GIT_UNREADABLE")
            ? "  Repository state could not be verified — refusing rather than assuming the code is unchanged."
            : "  Re-bootstrap a valid identity + destructive Approval Manifest, then retry.",
    );
    process.exit(4);
    return;
  }

  // Past the gate: a PREPARED destructive manifest exists for this identity and the 삭제 selector is calibrated.
  // This drives the guided deletion — the SELLER navigates + presses 삭제; SellerOps highlights the control, rests
  // at the irreversible-warning checkpoint, and reads a sanitized page category only.
  const cfg = loadConfig();
  const readyPath = sentinelPath(cfg.statusFile, DELETION_READY_FILENAME);
  const donePath = sentinelPath(cfg.statusFile, DELETION_DONE_FILENAME);
  const abortPath = sentinelPath(cfg.statusFile, DELETION_ABORT_FILENAME);
  mkdirSync(dirname(readyPath), { recursive: true });
  for (const p of [readyPath, donePath, abortPath]) removeSentinel(p);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const entry = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  const driver = new CoupangWingDeletionDriver(entry, { context: ctx });
  try {
    console.error("");
    console.error("WING key-deletion: log in and reach your ALREADY-ISSUED open-API 키 page yourself.");
    console.error(`  1) When you are on the already-issued page, create: ${readyPath}   (or ${abortPath} to abort)`);
    const first = await waitForSignal(readyPath, abortPath, abortFlag);
    if (first !== "ready") {
      console.log(JSON.stringify({ event: "COUPANG_DELETION", outcome: first === "abort" ? "ABORTED" : "TIMEOUT" }));
      return;
    }
    const classified = await driver.classifyAlreadyIssued();
    if (!classified.ok) {
      console.log(JSON.stringify({ event: "COUPANG_DELETION", outcome: "WRONG_PAGE", pageCategory: classified.pageCategory }));
      return;
    }
    const highlight = await driver.highlightDeleteCheckpoint();
    if (highlight.count !== 1) {
      // Two distinct fail-closed causes share `count: 0` — the 삭제 control had no unique match, or it did and
      // the irreversible-warning checkpoint failed to paint. Report them apart so the operator is not told the
      // control is missing when it was found. Clear immediately either way: a partially-painted ring must not
      // outlive the refusal and point at a control this run has decided not to guide.
      const outcome = driver.didCheckpointFailToPaint() ? "CHECKPOINT_NOT_PAINTED" : "DELETE_TARGET_NOT_FOUND";
      await driver.clearHighlight().catch(() => undefined);
      console.log(JSON.stringify({ event: "COUPANG_DELETION", outcome, matchCount: highlight.count }));
      return;
    }
    console.error("");
    console.error(`  ⚠ ${WING_DELETION_WARNING_LABEL}`);
    console.error(`  2) After you delete the key yourself, create: ${donePath}   (or ${abortPath} to abort)`);
    removeSentinel(readyPath);
    const second = await waitForSignal(donePath, abortPath, abortFlag);
    // The checkpoint is retired HERE — before the verify poll, on every signal — so no stale "press 삭제"
    // guidance outlives the operator's action. See `finishDeletionRun`.
    const outcome = await finishDeletionRun(driver, second);
    console.log(JSON.stringify(outcome));
    log("aw_coupang_deletion_done", {
      outcome: outcome.outcome,
      deleted: outcome.deleted,
      pageCategory: outcome.pageCategory,
      checkpointCleared: outcome.checkpointCleared,
    });
  } finally {
    for (const p of [readyPath, donePath, abortPath]) removeSentinel(p);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await driver.cleanup().catch(() => undefined);
    await ctx.close();
  }
}

// Run the live path ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    log("aw_coupang_deletion_fatal", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
    process.exit(1);
  });
}
