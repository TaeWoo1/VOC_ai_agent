/**
 * **Live, GATED, human-attended Coupang WING API-issuance READ-ONLY selector/structure RECORDER
 * (`COUPANG_WING_SELECTOR_RECORD`).**
 *
 *   set -a && . ./.env && set +a          # COUPANG_WING_URL (operator-owned; never logged)
 *   npx tsx src/cli/probe-wing-issuance-selectors.ts -- --i-understand-this-opens-live-coupang-wing
 *
 * The Coupang analog of `probe-issuance-selectors.ts`: the read-only step that CALIBRATES the guided WING
 * issuance driver's OWN fixed-label locate mechanism against the real WING open-API issuance page, WITHOUT ever
 * highlighting, tagging, clicking, typing, submitting, issuing a key, or reading a value. It opens the seller's
 * dedicated Chrome window; the SELLER navigates MANUALLY to the open-API issuance page and signals ready (a
 * sentinel file — this recorder never calls `.goto`); then it runs the SAME {@link CoupangWingIssuanceDriver}
 * the guided walk would use, but only through its READ-ONLY {@link CoupangWingIssuanceDriver.probeTargetMatch}
 * (per candidate: how many elements its fixed WING label matches, whether it resolves uniquely, and the opaque
 * 16-hex structural signature of a unique match) plus {@link CoupangWingIssuanceDriver.observeSurface} (the
 * sanitized page category + bucketized signals + calibration blockers).
 *
 * The output is a machine-checkable CALIBRATION RECORD: value-free integers + booleans + fixed candidate labels +
 * coarse candidate roles + opaque 16-hex sigs + the sanitized {@link WingObservation}. NEVER a raw DOM/HTML, a
 * screenshot, a field value (esp. Access Key / Secret Key / 업체코드), PII, a selector, or a raw URL (a URL is only
 * screened to a host CATEGORY, never logged). `LIVE_DOM_CALIBRATION_PENDING` is always reported — this recorder
 * MEASURES uniqueness so a later live run can flip the calibration; it never flips a `SELECTORS_CALIBRATED` flag.
 *
 * Gating mirrors `run-coupang-wing-issuance-live`: refuses without `--i-understand-this-opens-live-coupang-wing`
 * (`hasCoupangWingRunApproval` — a NAVER grant never opens WING); `screenWingUrl`-fail-closed BEFORE Chrome
 * launches; the recorder NEVER navigates (the seller does — read-only); always `ctx.close()`. `main()` runs ONLY
 * when invoked directly (inert on import), so offline build/verify launches nothing.
 */
import type { BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import {
  CoupangWingIssuanceDriver,
  WING_HIGHLIGHT_LABELS,
  type WingHighlightTarget,
} from "../action-window/coupang-wing-issuance-driver";
import {
  LIVE_DOM_CALIBRATION_PENDING,
  screenWingUrl,
  type WingObservation,
} from "./coupang-wing-classifier";
import { coupangWingApprovalRequiredMessage, hasCoupangWingRunApproval } from "./live-run-approval";

/** A per-run operator signal: proceed, abort the session, or the wait timed out. */
export type WingRecordSignal = "ready" | "abort" | "timeout";

/**
 * The highlightable fixed-label targets the recorder measures, in guided-walk order. The guidance-only targets
 * (`reach_open_api`, `return`) are NOT queried WING controls — they are text guidance — so they are never probed.
 */
export const WING_RECORD_TARGETS: readonly WingHighlightTarget[] = [
  "self_dev",
  "vendor_info",
  "call_ip",
  "issue",
  "credentials",
] as const;

/**
 * Coarse, human-legible EXPECTED role for each candidate — a fixed recorder constant (NOT a live element read), so
 * the calibration record says what KIND of control each fixed label is meant to resolve to. It is descriptive
 * evidence only; the live `matchCount` is what proves the candidate resolves uniquely.
 */
export const WING_TARGET_ROLE: Readonly<Record<WingHighlightTarget, string>> = {
  self_dev: "option",
  vendor_info: "field-label",
  call_ip: "field-label",
  issue: "button",
  credentials: "readonly-region",
};

/** One candidate's sanitized calibration row. Value-free: a count, a boolean, our own fixed label/role, an opaque sig. */
export interface WingSelectorRecord {
  target: WingHighlightTarget;
  /** How many candidates the fixed WING label matched live (integer only). */
  matchCount: number;
  /** Whether it resolves uniquely (matchCount === 1) and can therefore be highlighted. */
  canHighlight: boolean;
  /** Coarse EXPECTED role of the candidate (recorder constant — never a live element read). */
  role: string;
  /** The fixed WING label anchor the candidate probes for (our own config constant, never scraped page content). */
  label: string;
  /** Opaque 16-hex structural signature of the unique match (tag+position+child-count in-page), else null. */
  sig16: string | null;
}

/** The machine-checkable calibration record the recorder prints. Integers/booleans/fixed-labels/roles/sigs only. */
export interface WingSelectorRecordResult {
  /** Sanitized surface observation (pageCategory + bucketized signals + blockers). Null when the run never reached ready. */
  observation: WingObservation | null;
  targets: WingSelectorRecord[];
  /** How many candidates resolved uniquely this run (sanitized count). */
  uniqueCandidates: number;
  /** How many candidates did NOT resolve uniquely — the drift/calibration signal (sanitized count). */
  nonUniqueCandidates: number;
  aborted: boolean;
  /** ALWAYS present: these candidate labels are unvalidated hypotheses until a live run proves matchCount === 1. */
  calibration: typeof LIVE_DOM_CALIBRATION_PENDING;
}

/** Injected seams so the whole read-only recorder is unit-tested offline over fakes (no browser, no WING). */
export interface WingSelectorRecordDeps {
  /** Block until the operator signals ready / abort / timeout (sentinel-file only). */
  waitForReady(): Promise<WingRecordSignal>;
  /** The sanitized surface observation (pageCategory + signals + blockers) — reused from the driver's own probe. */
  observeSurface(): Promise<WingObservation>;
  /** Read-only fixed-label match for one candidate (never tags/highlights/clicks/reads a value). */
  probeTarget(target: WingHighlightTarget): Promise<{ matchCount: number; canHighlight: boolean; sig?: string }>;
  /** Print sanitized instructions (noop in tests). */
  announce?(): void;
}

/**
 * The pure orchestrator. Waits for the operator's single ready signal, reads the sanitized surface observation,
 * then measures every candidate's fixed-label matchCount read-only. It NEVER highlights, tags, clicks, or reads a
 * value — every measurement is `probeTarget` (count + opaque sig only). Abort/timeout return the empty sanitized
 * record. `label`/`role` are recorder/driver constants; `sig16` is null unless the candidate resolved uniquely.
 */
export async function runWingSelectorRecord(deps: WingSelectorRecordDeps): Promise<WingSelectorRecordResult> {
  deps.announce?.();
  const signal = await deps.waitForReady();
  if (signal !== "ready") {
    return {
      observation: null,
      targets: [],
      uniqueCandidates: 0,
      nonUniqueCandidates: 0,
      aborted: signal === "abort",
      calibration: LIVE_DOM_CALIBRATION_PENDING,
    };
  }

  const observation = await deps.observeSurface();
  const targets: WingSelectorRecord[] = [];
  let uniqueCandidates = 0;
  let nonUniqueCandidates = 0;

  for (const target of WING_RECORD_TARGETS) {
    const { matchCount, canHighlight, sig } = await deps.probeTarget(target);
    targets.push({
      target,
      matchCount,
      canHighlight,
      role: WING_TARGET_ROLE[target],
      label: WING_HIGHLIGHT_LABELS[target].exactText,
      sig16: canHighlight && sig ? sig : null,
    });
    if (canHighlight) uniqueCandidates += 1;
    else nonUniqueCandidates += 1;
  }

  return {
    observation,
    targets,
    uniqueCandidates,
    nonUniqueCandidates,
    aborted: false,
    calibration: LIVE_DOM_CALIBRATION_PENDING,
  };
}

/* ────────────────────────────── sentinels + live wiring (inert on import) ────────────────────────────── */

/** Readiness sentinel filename (cleared at startup + after use). */
export const RECORD_SENTINEL_FILENAME = "probe-wing-issuance-selectors.ready";
/** Operator abort sentinel filename (ends the session, writes the empty sanitized record). */
export const RECORD_ABORT_FILENAME = "probe-wing-issuance-selectors.abort";

export function recordSentinelPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), RECORD_SENTINEL_FILENAME);
}
export function recordAbortPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), RECORD_ABORT_FILENAME);
}

const SENTINEL_POLL_MS = 1_000;
const RECORD_WAIT_TIMEOUT_MS = 20 * 60_000; // generous budget for a manual login + navigate to the issuance page

function mintRunId(): string {
  return `wingrec_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE Coupang WING READ-ONLY selector/structure recorder — explicit per-run approval required.");
  console.error(" It measures ONLY how many candidates each target's fixed WING label matches (a count), whether");
  console.error(" it resolves uniquely, and an opaque 16-hex structural signature. It never highlights, tags,");
  console.error(" clicks, types, submits, issues a key, or reads any value (incl. Access Key / Secret Key / 업체코드).");
  console.error(" The SELLER navigates MANUALLY to the open-API issuance page, then signals ready. Output is a");
  console.error(" sanitized calibration record — no selector, value, PII, raw DOM/HTML, screenshot, or raw URL.");
  console.error(line);
}

function printInstructions(readyPath: string, abortPath: string): void {
  console.error("");
  console.error("WING selector recorder: navigate MANUALLY to the open-API 키 발급 page in the opened window.");
  console.error("  1) Log in and reach the open-API issuance page yourself (nothing on WING is clicked for you).");
  console.error('  2) Signal readiness by creating this file (or say "ready"):');
  console.error(`       ${readyPath}`);
  console.error(`     To abort the session, create: ${abortPath}  (or press Ctrl+C).`);
  console.error("  Polling… (read-only — nothing is highlighted, clicked, or navigated)");
}

/**
 * Live entry (gated). NOT run during offline build/verify. Opens the seller's window ONCE, NEVER navigates it,
 * waits for the operator's ready signal, records each candidate's fixed-label matchCount + sig read-only, prints
 * ONLY the sanitized calibration record, and always closes. Never highlights, tags, clicks, or reads a value.
 */
async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasCoupangWingRunApproval(args)) {
    console.error(coupangWingApprovalRequiredMessage());
    process.exit(3);
    return;
  }
  const url = process.env.COUPANG_WING_URL;
  if (!url) {
    console.error("Set COUPANG_WING_URL (operator-owned; never logged) to the WING page first.");
    process.exit(2);
    return;
  }
  // Fail closed BEFORE launching Chrome: reject placeholders, unparseable URLs, and off-target hosts. The raw URL
  // is never printed — only a reason enum + host category. The recorder does NOT navigate; the seller does.
  const screen = screenWingUrl(url);
  if (!screen.ok) {
    console.error(
      `Refusing to launch: COUPANG_WING_URL failed screening (reason=${screen.reason}). It must be the ` +
        "Coupang WING or auth host and not a placeholder. No browser launched.",
    );
    process.exit(2);
    return;
  }

  const cfg = loadConfig();
  const runId = mintRunId();
  const readyPath = recordSentinelPathFor(cfg.statusFile);
  const abortPath = recordAbortPathFor(cfg.statusFile);
  mkdirSync(dirname(readyPath), { recursive: true });
  removeSentinel(readyPath);
  removeSentinel(abortPath);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  // The driver reads the NEWEST tab (context injected) — wherever the seller navigated. The recorder never drives it.
  const entry = (ctx.pages()[0] ?? (await ctx.newPage())) as Page;
  const driver = new CoupangWingIssuanceDriver(entry, { context: ctx });

  const deps: WingSelectorRecordDeps = {
    waitForReady: async () => {
      removeSentinel(readyPath);
      const maxTicks = Math.ceil(RECORD_WAIT_TIMEOUT_MS / SENTINEL_POLL_MS);
      for (let i = 0; i < maxTicks; i++) {
        if (abortFlag.v || existsSync(abortPath)) return "abort";
        if (existsSync(readyPath)) return "ready";
        await sleep(SENTINEL_POLL_MS);
      }
      return "timeout";
    },
    observeSurface: () => driver.observeSurface(),
    probeTarget: (target) => driver.probeTargetMatch(target),
    announce: () => printInstructions(readyPath, abortPath),
  };

  try {
    const result = await runWingSelectorRecord(deps);
    console.error("");
    console.error("WING selector recorder complete. 이제 SellerOps 탭으로 직접 돌아가세요.");
    // SANITIZED calibration record → stdout. Integers/booleans/fixed-labels/roles/opaque sigs + the sanitized
    // observation only — never a selector, value, PII, raw DOM/HTML, screenshot, or raw URL.
    console.log(
      JSON.stringify(
        {
          runId,
          urlCategory: screen.urlCategory,
          aborted: result.aborted,
          uniqueCandidates: result.uniqueCandidates,
          nonUniqueCandidates: result.nonUniqueCandidates,
          calibration: result.calibration,
          observation: result.observation,
          targets: result.targets,
        },
        null,
        2,
      ),
    );
    log("aw_coupang_selector_record_done", {
      runId,
      urlCategory: screen.urlCategory,
      aborted: result.aborted,
      uniqueCandidates: result.uniqueCandidates,
      nonUniqueCandidates: result.nonUniqueCandidates,
    });
  } finally {
    removeSentinel(readyPath);
    removeSentinel(abortPath);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await ctx.close();
  }
}

// Run the live path ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    log("aw_coupang_selector_record_fatal", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
    process.exit(1);
  });
}
