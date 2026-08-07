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
import { pathToFileURL } from "node:url";
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
import { resolveWingUrl, screenWingUrl } from "./coupang-wing-classifier";
import { coupangWingApprovalRequiredMessage, hasCoupangWingRunApproval } from "./live-run-approval";

const WKD = PHASE_SPECS.COUPANG_WING_KEY_DELETION;

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
function gateRefusalCause(apiCenterUrl: string): string | null {
  // The four scope fields come from the phase spec, NOT the environment: the operator's grant binds to them, so
  // a stale `.env` must never be able to make a destructive manifest describe a different run. The gate pins
  // them too (`DESTRUCTIVE_SCOPE_MISMATCH`) — this side just stops feeding it anything else.
  const scope = WKD.destructiveScope ?? COUPANG_WING_KEY_DELETION_SCOPE;
  const input: ApprovalPrereqInput = {
    phase: WKD.phase,
    channel: scope.channel,
    accountBinding: env("SELLEROPS_APPROVAL_ACCOUNT") ?? "operator-owned Coupang WING test account",
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
  return res.ok ? null : res.cause;
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

  // Approval gate — the destructive run must reach a PREPARED manifest for THIS bootstrapped identity. A missing/
  // softened destructive descriptor, an unbound identity, an off-target host, or a withdrawn calibration flag
  // (SELECTORS_NOT_CALIBRATED) all refuse here. NOTHING launches on refusal.
  const refusal = gateRefusalCause(url);
  if (refusal) {
    console.error(`Refusing to start the WING key-DELETION run: approval_prerequisite (${refusal}). No browser launched.`);
    console.error(
      refusal === "SELECTORS_NOT_CALIBRATED"
        ? "  The 삭제 selector calibration is withdrawn. Restore it only from a fresh READ-ONLY delete selector probe."
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
      console.log(JSON.stringify({ event: "COUPANG_DELETION", outcome: "DELETE_TARGET_NOT_FOUND", matchCount: highlight.count }));
      return;
    }
    console.error("");
    console.error(`  ⚠ ${WING_DELETION_WARNING_LABEL}`);
    console.error(`  2) After you delete the key yourself, create: ${donePath}   (or ${abortPath} to abort)`);
    removeSentinel(readyPath);
    const second = await waitForSignal(donePath, abortPath, abortFlag);
    if (second !== "ready") {
      console.log(JSON.stringify({ event: "COUPANG_DELETION", outcome: second === "abort" ? "ABORTED" : "TIMEOUT" }));
      return;
    }
    const verified = await driver.verifyDeletion();
    // SANITIZED only — a boolean + a page category enum. No value, selector, PII, raw DOM, or URL.
    console.log(JSON.stringify({ event: "COUPANG_DELETION", outcome: "COMPLETED", deleted: verified.deleted, pageCategory: verified.pageCategory }));
    log("aw_coupang_deletion_done", { deleted: verified.deleted, pageCategory: verified.pageCategory });
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
