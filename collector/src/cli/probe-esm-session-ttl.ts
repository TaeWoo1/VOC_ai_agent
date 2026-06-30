/**
 * Local-only KEEP-OPEN ESM+ session-TTL probe — one persistent context, multiple no-click reads.
 *
 *   set -a && . ./.env && set +a
 *   npm run probe-esm-session-ttl -- --i-understand-this-opens-live-esm            # real: T0, T+120m, T+190m
 *   npm run probe-esm-session-ttl -- --i-understand-this-opens-live-esm --t4h      # + T+240m if still logged in
 *   npm run probe-esm-session-ttl -- --i-understand-this-opens-live-esm --after-minutes 1,2   # DEV dry-run
 *
 * EXPERIMENTAL / one-shot. It answers: does a single logged-in ESM+ session stay usable
 * after ~2h and past the documented ~3h boundary, WITHOUT closing the context between
 * reads? It launches the persistent `.profile/esm` context, hands off to the human for
 * login/navigation (ESM sentinel), runs the SHARED no-click classification at T0, then
 * KEEPS THE SAME CONTEXT OPEN and re-reads (re-navigating to re-validate the session
 * server-side) at each configured offset. The browser is closed exactly ONCE, at the end.
 *
 * STRICT NO-CLICK: it reuses `classifyOpenEsmReviewPage` (no click, no download, no save,
 * no upload, no status). It is NOT production scheduling — the local process owns a single
 * bounded timer line; there is no cron / setInterval / scheduler / manualSync. Output is a
 * sanitized checkpoint table only — booleans / categories / buckets, never env values, raw
 * URLs/hosts, DOM text, selectors, identifiers, or tokens.
 *
 * LIVE-ONLY — refuses to act without the explicit per-run ESM approval flag.
 */
import { appendFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Page } from "playwright";
import { loadConfig } from "../config";
import { esmApprovalRequiredMessage, hasEsmLiveApproval } from "../esm/esm-live-approval";
import { classifyOpenEsmReviewPage } from "../esm/esm-review-live-scan";
import { esmSentinelPathFor } from "../esm/esm-sentinel";
import {
  esmTtlResultsPath,
  parseCheckpointOffsets,
  parseLoginTimeoutMin,
  runTtlCheckpoints,
  toCheckpointRow,
  type TtlCheckpointRow,
} from "../esm/esm-ttl-schedule";
import { log } from "../log";
import { launchPersistentBrowser } from "../profile";

const SENTINEL_POLL_INTERVAL_MS = 750;

const CONFIRM_PROMPT = [
  "",
  "A browser window is open on ESM+ (Gmarket / Auction). In that SAME window:",
  "  1) Complete the ESM+ login (and any 2FA/CAPTCHA) yourself.",
  "  2) Navigate to the review-management / feedback page; let it settle.",
  "  3) Leave the browser OPEN — this probe keeps the SAME context open the whole time.",
  "",
  'Then signal readiness (say "ready"; Claude creates the sentinel). The probe runs a',
  "no-click classification at T0, then keeps the context open and re-reads at each",
  "configured offset. It never clicks, downloads, uploads, or writes status. (Ctrl-C aborts.)",
].join("\n");

function banner(offsetsMin: readonly number[]): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE ESM+ KEEP-OPEN session-TTL probe — explicit per-run approval required.");
  console.error(" One persistent context; no-click reads at T0 and each offset; closed once at end.");
  console.error(`  checkpoints (minutes after T0): ${offsetsMin.join(", ")}`);
  console.error(line);
}

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

async function waitForSentinel(path: string, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const maxChecks = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < maxChecks; i += 1) {
    if (existsSync(path)) return true;
    await sleep(intervalMs);
  }
  return existsSync(path);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const offsetsMin = parseCheckpointOffsets(args);
  // Pre-T0 login/navigation handoff window only — independent of the checkpoint offsets.
  const loginTimeoutMs = parseLoginTimeoutMin(args) * 60_000;
  banner(offsetsMin);
  console.error(`  login handoff window (minutes): ${parseLoginTimeoutMin(args)}`);

  if (!hasEsmLiveApproval(args)) {
    console.error(esmApprovalRequiredMessage());
    process.exit(3);
    return;
  }

  const cfg = loadConfig();
  const reviewUrl = cfg.esmReviewUrl;
  if (!reviewUrl) {
    console.error("Set ESM_REVIEW_URL to the ESM+ review-management/export page URL first.");
    process.exit(2);
    return;
  }
  const allowlist = cfg.esmFrameOriginAllowlist;
  // Presence/count only — never the values.
  console.error(`  allowlistConfigured: ${allowlist.length > 0} (entries: ${allowlist.length})`);

  const sentinelPath = esmSentinelPathFor(cfg.statusFile);
  mkdirSync(dirname(sentinelPath), { recursive: true });
  removeSentinel(sentinelPath);

  // Incremental results: each checkpoint row is appended to this gitignored `.status/`
  // JSONL the moment it completes, so a kill during a later sleep keeps the earlier rows.
  const resultsPath = esmTtlResultsPath(cfg.statusFile);
  writeFileSync(resultsPath, ""); // fresh file for THIS run; dir ensured above
  console.error(`  Results (sanitized JSONL, gitignored): ${resultsPath}`);

  const ctx = await launchPersistentBrowser(cfg.esmProfileDir, cfg.browserChannel);
  const page = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  try {
    await page.goto(reviewUrl, { waitUntil: "domcontentloaded" });

    console.error(CONFIRM_PROMPT);
    console.error("");
    console.error(`  Sentinel file (create this when ready):`);
    console.error(`    ${sentinelPath}`);
    console.error("");
    const ready = await waitForSentinel(sentinelPath, loginTimeoutMs, SENTINEL_POLL_INTERVAL_MS);
    if (!ready) {
      console.error("No sentinel within the timeout; aborting without reading the page.");
      log("esm.ttl-probe.aborted", { reason: "sentinel-timeout" });
      return;
    }

    // T0 reads the page as the human left it; each later checkpoint RE-NAVIGATES (a server
    // round-trip that re-validates the session) but reuses the SAME open context.
    const classifyAt = async (label: string): Promise<TtlCheckpointRow> => {
      if (label !== "T0") {
        try {
          await page.goto(reviewUrl, { waitUntil: "domcontentloaded" });
        } catch {
          /* a navigation failure still classifies what the page shows (e.g. a login redirect) */
        }
      }
      const classification = await classifyOpenEsmReviewPage(page, allowlist);
      return toCheckpointRow(label, classification);
    };

    // Persist each checkpoint IMMEDIATELY: print the sanitized row + append it to the
    // JSONL. `row` is the already-sanitized `TtlCheckpointRow` (no URL/host/DOM/filename).
    const onCheckpoint = (row: TtlCheckpointRow): void => {
      const line = JSON.stringify(row);
      console.log(line);
      appendFileSync(resultsPath, `${line}\n`);
    };

    const rows = await runTtlCheckpoints({ offsetsMin, classifyAt, sleep, onCheckpoint });

    // Final summary remains, but it is NOT the only persisted result (see the JSONL above).
    console.log(JSON.stringify({ mode: "ttl-probe", offsetsMin, resultsFile: resultsPath, rows }, null, 2));
    log("esm.ttl-probe.done", {
      checkpoints: rows.length,
      finalVerdict: rows[rows.length - 1]?.sessionVerdict ?? "none",
      finalStop: rows[rows.length - 1]?.stop ?? "none",
    });
  } finally {
    removeSentinel(sentinelPath);
    await ctx.close();
  }
}

void main();
