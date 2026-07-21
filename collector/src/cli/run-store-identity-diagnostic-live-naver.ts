/**
 * Live, GATED, human-attended **NAVER STORE IDENTITY DIAGNOSTIC** — strictly READ-ONLY, and deliberately
 * *less* than the guided session.
 *
 *   set -a && . ./.env && set +a
 *   npx tsx src/cli/run-store-identity-diagnostic-live-naver.ts -- --i-understand-this-inspects-live-naver-read-only
 *
 * The question, and nothing beyond it: **which allow-listed seller/store identity keys does the trusted
 * page-load-time NAVER state actually expose, does each carry exactly one value, and which root produced
 * it?**
 *
 * WHY THIS EXISTS AS ITS OWN CLI. The guided session refuses to pick a store key for the operator: a key may
 * not be bound until it is shown to DISCRIMINATE between stores, and one run cannot show that. Binding the
 * wrong key is permanent and there is no unbind path. So the evidence has to be gathered by something that
 * *cannot* bind — not by the binding path running in a careful mode. This CLI has no connection-registry
 * writer, no backend client, no review locator and no composer in its import graph at all.
 *
 * WHAT IT WILL NOT DO, structurally rather than by intention:
 *   - no connection binding, and no write to `.connections/` (the store module is not imported);
 *   - no review lookup and no composer (neither module is imported);
 *   - no backend call — it never logs in, so there is nothing to mint or record;
 *   - no click, type, paste, navigation or submission. Exactly ONE `goto`, before the operator acts.
 *
 * WHAT IT REPORTS: key names (NAVER's own API field names), root labels (global variable names), distinct
 * value counts, conflicts, and a 12-character digest prefix per single-valued key so a LATER run against a
 * different store can be compared. Never a raw value.
 *
 * SUCCESS is "at least one stable single-valued candidate key from a trusted root". That is NOT proof the
 * key discriminates between stores — proving that needs a second store, and this run does not attempt it.
 *
 * It refuses without its own read-only flag, refuses any MUTATING flag rather than accepting the stronger
 * grant, and refuses under `NODE_ENV=production`.
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import {
  hasLiveRunApproval,
  hasNoIngest,
  hasReplyRunApproval,
  hasReviewIdProbeApproval,
  hasSessionRecovery,
  isClassifyOnly,
  NO_INGEST_FLAG,
  SESSION_RECOVERY_FLAG,
  mutatingFlagOnReadOnlyProbeMessage,
  storeIdentityDiagnosticApprovalRequiredMessage,
  APPROVAL_FLAG,
  REPLY_APPROVAL_FLAG,
} from "./live-run-approval";
import {
  inPageAccountIdentityProbe,
  parseAccountProbeResult,
} from "../action-window/reply-submission/session-account-probe-inpage";
import {
  summariseStoreIdentity,
  type StoreIdentityDiagnostic,
} from "../action-window/reply-submission/store-identity-diagnostic";
import { urlCategory } from "../naver/session-check";

const RUN_RECORD_REL_DIR = ".store-identity-diagnostics";
const READY_TIMEOUT_MS = 15 * 60_000;
const SENTINEL_POLL_INTERVAL_MS = 750;

export const DIAGNOSTIC_PRODUCTION_REFUSAL =
  "Refusing to inspect live NAVER under NODE_ENV=production.";

/** Sanitized record. Key names, root labels, counts, booleans and digest prefixes only. */
export interface StoreIdentityDiagnosticRecord {
  runId: string;
  /** Why the run ended early, or null when it inspected the page. Fixed categories only. */
  stopReason: string | null;
  channel: string;
  /** Coarse URL class of the page inspected — never the URL. */
  urlCategory: string;
  diagnostic: StoreIdentityDiagnostic;
  /** Pinned false: this CLI has no writer for either. */
  boundAnything: false;
  reachedReviewLookup: false;
}

/**
 * Gate. The weakest grant in the runtime, and a MUTATING flag is a refusal rather than a stronger
 * permission — an operator reaching for the reply flag is asking for a different run than this one.
 */
export function diagnosticRefusal(
  args: string[],
  env: NodeJS.ProcessEnv,
): { reason: string; exitCode: number } | null {
  if (hasReplyRunApproval(args)) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage(REPLY_APPROVAL_FLAG), exitCode: 6 };
  }
  if (hasLiveRunApproval(args)) {
    return { reason: mutatingFlagOnReadOnlyProbeMessage(APPROVAL_FLAG), exitCode: 6 };
  }
  // Any flag that belongs to a more-capable run is a refusal, not a stronger permission: an operator
  // reaching for one is asking for a different CLI than this one.
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
    return { reason: storeIdentityDiagnosticApprovalRequiredMessage(), exitCode: 3 };
  }
  if (env.NODE_ENV === "production") {
    return { reason: DIAGNOSTIC_PRODUCTION_REFUSAL, exitCode: 4 };
  }
  return null;
}

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
async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  // Clear it FIRST. Clearing only at startup left a window in which a sentinel created
  // before its own step was already there when the step arrived — so the wait returned
  // immediately and the gate passed without the operator having done the thing. That is
  // exactly how the re-render check nearly accepted selectors proven only once.
  removeSentinel(path);
  for (let i = 0; i < Math.max(1, Math.ceil(timeoutMs / SENTINEL_POLL_INTERVAL_MS)); i += 1) {
    if (existsSync(path)) return true;
    await sleep(SENTINEL_POLL_INTERVAL_MS);
  }
  return false;
}
function evalOn<R>(page: Page, script: string): Promise<R> {
  return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
}

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" STORE IDENTITY DIAGNOSTIC — READ-ONLY. It reads the page's parsed state for allow-listed");
  console.error(" identity KEYS and reports key names, roots, value counts and digest prefixes. It binds");
  console.error(" nothing, looks up no review, opens no composer, and calls no backend. It never clicks,");
  console.error(" types, pastes, navigates or submits. No raw identity value is printed or stored.");
  console.error(line);
}

function report(d: StoreIdentityDiagnostic): void {
  console.error("");
  console.error(`Roots walked: ${d.rootLabels.length > 0 ? d.rootLabels.join(", ") : "(none)"}`);
  if (d.truncated) {
    console.error("! a probe ceiling was hit — a key that looks single-valued here may not be. Not conclusive.");
  }
  if (d.observations.length === 0) {
    console.error("No allow-listed identity key appeared in the trusted page state.");
    return;
  }
  console.error("");
  console.error("  key           roots                       values  fingerprint");
  for (const o of d.observations) {
    console.error(
      `  ${o.key.padEnd(13)} ${o.roots.join(",").padEnd(27)} ${String(o.distinctValueCount).padEnd(6)} ` +
        `${o.truncatedFingerprint ?? "(conflicting — none)"}`,
    );
  }
  console.error("");
  console.error(`Single-valued candidates: ${d.candidateKeys.join(", ") || "(none)"}`);
  if (d.conflictingKeys.length > 0) {
    console.error(`Conflicting (cannot identify a store): ${d.conflictingKeys.join(", ")}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  banner();
  const refusal = diagnosticRefusal(args, process.env);
  if (refusal) {
    console.error(refusal.reason);
    process.exit(refusal.exitCode);
    return;
  }

  const cfg = loadConfig();
  if (!cfg.naverReviewUrl) {
    console.error("Set NAVER_REVIEW_URL to the review-management page URL first.");
    process.exit(2);
    return;
  }

  const collectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const runId = `sid_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const statusDir = dirname(cfg.statusFile);
  mkdirSync(statusDir, { recursive: true });
  const readySentinel = resolve(statusDir, "store-identity-ready.ready");
  removeSentinel(readySentinel);

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  let diagnostic: StoreIdentityDiagnostic | null = null;
  let observedUrlCategory = "other";
  let stopReason: string | null = null;

  try {
    await page.goto(cfg.naverReviewUrl, { waitUntil: "domcontentloaded" });
    console.error(
      [
        "",
        "In the open browser: log in if needed and reach the seller-center page you want inspected.",
        "You do NOT need to filter, scroll, or find any review — this run never looks one up.",
        `When the page has finished loading, create:  ${readySentinel}`,
        "",
      ].join("\n"),
    );
    if (!(await waitForFile(readySentinel, READY_TIMEOUT_MS))) {
      console.error("No readiness signal; ending without inspecting anything.");
      stopReason = "no-readiness-signal";
      return;
    }
    removeSentinel(readySentinel);

    const openPages = ctx.pages();
    if (openPages.length === 0) {
      console.error("The browser page was closed — retry with the window open.");
      stopReason = "page-closed";
      return;
    }
    const activePage = openPages[openPages.length - 1] as Page;
    observedUrlCategory = urlCategory(activePage.url());

    const probe = parseAccountProbeResult(await evalOn<string>(activePage, inPageAccountIdentityProbe()));
    if (!probe) {
      console.error("The probe returned nothing parseable; reporting no observations.");
      diagnostic = summariseStoreIdentity([], [], true);
    } else {
      diagnostic = summariseStoreIdentity(probe.hits, probe.rootLabels, probe.truncated);
    }
    report(diagnostic);
    log("aw.store-identity.diagnostic", {
      candidates: diagnostic.candidateKeys.length,
      conflicting: diagnostic.conflictingKeys.length,
      truncated: diagnostic.truncated,
    });
  } finally {
    removeSentinel(readySentinel);
    await ctx.close();
  }

  const record: StoreIdentityDiagnosticRecord = {
    runId,
    stopReason,
    channel: "naver",
    urlCategory: observedUrlCategory,
    diagnostic: diagnostic ?? summariseStoreIdentity([], [], true),
    boundAnything: false,
    reachedReviewLookup: false,
  };
  console.log(JSON.stringify(record, null, 2));

  try {
    const dir = resolve(collectorRoot, RUN_RECORD_REL_DIR);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(resolve(dir, `${runId}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  } catch {
    console.error("Could not persist the record; the printed record above is the only copy.");
  }

  console.error("");
  console.error("STOP. This run proves which keys EXIST and are single-valued on this page. It does NOT");
  console.error("prove any of them differs between stores — that needs a second store. Nothing was bound.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e: unknown) => {
    const category = e instanceof Error ? e.constructor.name : typeof e;
    console.error(`The diagnostic failed (${category}). Details are suppressed to keep the run sanitized.`);
    process.exitCode = 1;
  });
}
