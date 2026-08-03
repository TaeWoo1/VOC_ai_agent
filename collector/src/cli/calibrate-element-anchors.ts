/**
 * **Live, GATED, human-attended NAVER API-center ELEMENT-ANCHOR CALIBRATION — READ-ONLY, evidence via the
 * operator's own DevTools (`API_ISSUANCE_ELEMENT_CALIBRATION`).**
 *
 *   set -a && . ./.env && set +a          # NAVER_API_CENTER_URL (operator-owned; never logged)
 *   npx tsx src/cli/calibrate-element-anchors.ts -- --i-understand-this-inspects-live-naver-read-only
 *
 * WHY THIS EXISTS. Three prior existing-app highlight designs failed because their DOM anchors for the
 * `api_group` heading and the `애플리케이션 ID` label were guessed, not measured. The `API Issuance Live
 * Runtime Reset` baseline recorded the overlay throw point as UNDETERMINED and the prior diagnoses as
 * hypotheses. Before changing any selector / state machine / overlay code, we need STABLE anchors confirmed
 * from the real app-detail page — and the safest, most precise source of that evidence is the OPERATOR's own
 * DevTools Elements panel, not another automated DOM slurp against the credential surface.
 *
 * WHAT THIS RUNTIME DOES. It opens the seller's dedicated persistent-profile Chrome window ONCE, navigates
 * exactly once to the pre-screened API-center base, and then **idles** — it never clicks, types, submits,
 * navigates again, highlights, tags, or reads ANYTHING off the page (no `.evaluate`, no attribute/text/value
 * read). The operator drives to their existing app's detail page, opens DevTools, selects the two LABEL
 * elements in the Elements panel, and runs a value-scoped SellerOps snippet (provided separately, in the
 * slice doc / by the operator's SellerOps session) that emits ONLY sanitized structural metadata — tag,
 * role, class list, data-attr / aria-attr names + short structural values, a couple of ancestor levels,
 * and a top-vs-iframe flag. The snippet, and this runtime, NEVER emit the Client ID / Secret value, full
 * `outerHTML`, cookies, storage, or tokens. Collection happens in the operator's DevTools; this process only
 * keeps the correct, logged-in Chrome open so the DOM the operator inspects is EXACTLY the one the guided
 * driver will later see.
 *
 * WHY A SEPARATE, DELIBERATELY THIN CLI. "Open the right browser so a human can inspect it" must not quietly
 * become "let the tool read the credential page". Making calibration a distinct runtime that runs no page
 * evaluation at all — proven by its source guard — is what keeps the two apart. There is no selector store
 * writer, no backend client, and no state-machine/overlay import anywhere in this file's import graph; it
 * changes none of that code, per the calibration scope.
 *
 * GATING. Read-only authorization only: refuses without `--i-understand-this-inspects-live-naver-read-only`
 * and refuses every MUTATING flag (a stronger grant on a weaker probe is a mistake worth stopping for);
 * `screenApiCenterUrl` fail-closed BEFORE Chrome launches; refuses under NODE_ENV=production; navigates
 * exactly once to the screened URL; always `ctx.close()`. `main()` runs ONLY when invoked directly (inert on
 * import), so offline build/verify launches nothing.
 */
import type { BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import { screenApiCenterUrl } from "./observe-api-center";
import {
  hasLiveRunApproval,
  hasNoIngest,
  hasReplyRunApproval,
  hasReviewIdProbeApproval,
  hasSessionRecovery,
  isClassifyOnly,
  mutatingFlagOnReadOnlyProbeMessage,
  APPROVAL_FLAG,
  NO_INGEST_FLAG,
  REPLY_APPROVAL_FLAG,
  REVIEW_ID_PROBE_FLAG,
  SESSION_RECOVERY_FLAG,
} from "./live-run-approval";

/** Refusal shown under NODE_ENV=production — this never inspects live NAVER in a production process. */
export const CALIBRATION_PRODUCTION_REFUSAL =
  "Refusing to inspect live NAVER under NODE_ENV=production.";

/** Operator-facing refusal when the read-only approval flag is missing. */
export function calibrationApprovalRequiredMessage(): string {
  return [
    "Refusing to open a LIVE NAVER session without explicit read-only approval.",
    "",
    "  - This opens your dedicated Chrome window ONCE at the API-center base and then only keeps it open.",
    "  - It reads NOTHING off the page: no clicks, no typing, no navigation, no page evaluation, no value read.",
    "  - YOU navigate to your existing app's detail page and select the two LABEL elements in DevTools; a",
    "    value-scoped SellerOps snippet emits ONLY sanitized structure (tag/role/class/attr names). No Client",
    "    ID / Secret value, no full outerHTML, no cookies, no tokens.",
    "  - A human performs login / 2FA / CAPTCHA. Use only a user-owned test seller account.",
    "",
    "Re-run with the read-only approval flag:",
    `  npx tsx src/cli/calibrate-element-anchors.ts -- ${REVIEW_ID_PROBE_FLAG}`,
  ].join("\n");
}

/**
 * The gate. Mirrors the discovery/store-identity read-only probes: a MUTATING flag is a REFUSAL (not an
 * accepted stronger grant), the read-only flag is required, and production is refused. Pure — unit-tested
 * offline over `args`/`env` without launching anything.
 */
export function calibrationRefusal(
  args: string[],
  env: NodeJS.ProcessEnv,
): { reason: string; exitCode: number } | null {
  if (hasReplyRunApproval(args)) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage(REPLY_APPROVAL_FLAG), exitCode: 6 };
  }
  if (hasLiveRunApproval(args)) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage(APPROVAL_FLAG), exitCode: 6 };
  }
  if (hasNoIngest(args)) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage(NO_INGEST_FLAG), exitCode: 6 };
  }
  if (hasSessionRecovery(args)) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage(SESSION_RECOVERY_FLAG), exitCode: 6 };
  }
  if (isClassifyOnly(args)) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage("--classify-only"), exitCode: 6 };
  }
  if (!hasReviewIdProbeApproval(args)) {
    return { reason: calibrationApprovalRequiredMessage(), exitCode: 3 };
  }
  if (env.NODE_ENV === "production") {
    return { reason: CALIBRATION_PRODUCTION_REFUSAL, exitCode: 4 };
  }
  return null;
}

/* ────────────────────────────── operator-done sentinel (inert on import) ────────────────────────────── */

/** The operator signals "I have collected both elements" by creating this file (or pressing Ctrl+C). */
export const CALIBRATION_DONE_FILENAME = "element-calibration.done";

export function calibrationDonePathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), CALIBRATION_DONE_FILENAME);
}

const SENTINEL_POLL_MS = 1_000;
const SESSION_TIMEOUT_MS = 40 * 60_000; // generous manual navigate + inspect + snippet budget

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    if (typeof t.unref === "function") t.unref();
  });
}

function removeSentinel(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER API-center ELEMENT-ANCHOR CALIBRATION — READ-ONLY. Explicit read-only approval required.");
  console.error(" This runtime OPENS your Chrome window once and then only keeps it open. It reads NOTHING off the");
  console.error(" page — no page evaluation, no value read, no highlight, no tag. YOU inspect the two LABEL elements");
  console.error(" in DevTools; the value-scoped SellerOps snippet emits sanitized STRUCTURE only. No Client ID /");
  console.error(" Secret value, no full page HTML, no cookies, no tokens ever leave the page.");
  console.error(line);
}

function instructions(donePath: string): void {
  console.error("");
  console.error("In the opened dedicated Chrome window:");
  console.error("  1) Log in if needed and navigate to ONE existing app's DETAIL page (the one that shows the");
  console.error("     API group section and the Application ID label).");
  console.error("  2) Open DevTools → Elements. Select the API-group heading element (the LABEL, not any value).");
  console.error("     Run the SellerOps calibration snippet in the Console; copy its sanitized JSON output.");
  console.error("  3) Select the Application-ID label element (the LABEL, not the value field next to it).");
  console.error("     Run the snippet again; copy that sanitized JSON output.");
  console.error("  4) Paste BOTH JSON outputs back into your SellerOps session for anchor analysis.");
  console.error("");
  console.error("  Select the LABEL element. Do NOT select the value field. The snippet omits anything that looks");
  console.error("  like a value, but selecting the label keeps the evidence clean by construction.");
  console.error("");
  console.error(`  When BOTH elements are collected, create:  ${donePath}   (or press Ctrl+C).`);
  console.error("  Idle… (read-only — the browser is only being held open; nothing is inspected by this process)");
}

/**
 * Live entry (gated). NOT run during offline build/verify. Opens the window ONCE, navigates once to the
 * screened base, prints the operator instructions, waits for the operator-done sentinel (or Ctrl+C), and
 * always closes. It performs NO page evaluation and reads no DOM — the evidence is collected in the
 * operator's DevTools.
 */
async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  const refusal = calibrationRefusal(args, process.env);
  if (refusal) {
    console.error(refusal.reason);
    process.exit(refusal.exitCode);
    return;
  }

  const url = process.env.NAVER_API_CENTER_URL;
  if (!url) {
    console.error("Set NAVER_API_CENTER_URL (operator-owned; never logged) to the API-center page first.");
    process.exit(2);
    return;
  }
  const screen = screenApiCenterUrl(url);
  if (!screen.ok) {
    console.error(
      `Refusing to launch: NAVER_API_CENTER_URL failed screening (reason=${screen.reason}). It must be the ` +
        "NAVER API-center or auth host and not a placeholder. No browser launched.",
    );
    process.exit(2);
    return;
  }

  const cfg = loadConfig();
  const donePath = calibrationDonePathFor(cfg.statusFile);
  mkdirSync(dirname(donePath), { recursive: true });
  removeSentinel(donePath);

  const doneFlag = { v: false };
  const onSigint = (): void => {
    doneFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const entry = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  await entry.goto(url, { waitUntil: "domcontentloaded" }).catch(() => undefined);

  try {
    instructions(donePath);
    log("apiCenter.elementCalibration.opened", { urlCategory: screen.urlCategory });
    const maxTicks = Math.ceil(SESSION_TIMEOUT_MS / SENTINEL_POLL_MS);
    let signalled = false;
    for (let i = 0; i < maxTicks; i += 1) {
      if (doneFlag.v || existsSync(donePath)) {
        signalled = true;
        break;
      }
      await sleep(SENTINEL_POLL_MS);
    }
    console.error("");
    console.error(
      signalled
        ? "Calibration window closing. If you collected both elements, paste the two sanitized JSON outputs into SellerOps for anchor analysis."
        : "No operator-done signal within the window; closing without having inspected anything.",
    );
    log("apiCenter.elementCalibration.done", { urlCategory: screen.urlCategory, signalled });
  } finally {
    removeSentinel(donePath);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await ctx.close();
  }
}

// Run the live path ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    log("apiCenter.elementCalibration.fatal", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
    process.exit(1);
  });
}
