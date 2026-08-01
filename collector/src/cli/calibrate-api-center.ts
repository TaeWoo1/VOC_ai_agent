/**
 * **Live, GATED, human-attended NAVER API-center MULTI-SURFACE selector calibrator (Phase A).**
 *
 *   set -a && . ./.env && set +a          # NAVER_API_CENTER_URL (operator-owned; never logged)
 *   npx tsx src/cli/calibrate-api-center.ts -- --i-understand-this-opens-live-naver
 *
 * Walks the five `CALIBRATION_STAGES` (app_list, app_detail, api_group, credentials, return_path) in ONE
 * session, in ONE window, keeping the operator's login across every stage. At each stage the operator
 * navigates to the surface, hovers the target control and presses the calibration hotkey (default
 * Ctrl+Shift+K), then signals readiness with a per-stage sentinel file. The tool then reads a SANITIZED page
 * signature and the STRUCTURAL capture of the confirmed element, hands the capture to the FROZEN pure gate
 * (`sanitizeCapture`), and advances.
 *
 * It NEVER logs in, clicks, types, submits, creates, selects, autofills, or reads any field VALUE (incl.
 * Client ID / Secret). Operator navigation is the operator's OWN clicks — OBSERVED read-only via
 * `READ_CLICK_OBSERVED`, never generated or blocked. The RAW capture (with real selectors) is written ONLY to
 * the gitignored `.calibration/` sink; the console/log gets ONLY the sanitized `summarize(...)` output (target
 * kind + structural hash + match count + resolution + confidence + page signatures) — never a raw selector,
 * value, or URL (a URL is reduced to a host category before launch).
 *
 * Gating mirrors `observe-api-center` / `run-api-issuance-live-naver`: refuses without
 * `--i-understand-this-opens-live-naver` (`hasLiveRunApproval`); `screenApiCenterUrl`-fail-closed BEFORE Chrome
 * launches; always `ctx.close()`. `main()` runs ONLY when invoked directly (inert on import), so offline
 * build/verify launches nothing.
 */
import type { Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import {
  EXTRACT_API_CENTER_CENSUS,
  observeFrom,
  screenApiCenterUrl,
  type ApiCenterStructuralCensus,
  type ApiCenterUrlCategory,
} from "./observe-api-center";
import {
  CALIBRATION_STAGES,
  pageSignature,
  sanitizeCapture,
  summarize,
  type CalibrationStage,
  type CalibrationSummary,
  type PageSignature,
  type RawArtifactEntry,
  type RawTargetCapture,
  type SanitizedTargetCandidate,
} from "../action-window/api-issuance-calibration/calibration";
import {
  ARM_CALIBRATION_CAPTURE,
  DEFAULT_CALIBRATION_HOTKEY_LABEL,
  READ_CAPTURED_TARGET,
  READ_CLICK_OBSERVED,
  RESET_CAPTURE,
} from "../action-window/api-issuance-calibration/calibration-inpage";
import { CANDIDATE_APP_ENTRY_SELECTOR } from "../action-window/naver-issuance-driver";
import { isSafeCalibrationArtifactPath } from "./approval-manifest";
import type { IssuanceTarget } from "../action-window/api-issuance/issuance-driver";

/** The structural capture the in-page READ script returns — everything except the stage-attached `targetKind`. */
export type RawCapturedShape = Omit<RawTargetCapture, "targetKind">;

/** A per-checkpoint operator signal: proceed, abort the whole session, or the wait timed out. */
export type CalibrationCheckpointSignal = "ready" | "abort" | "timeout";

/** Count candidate application-entry rows — a COUNT only, never a name/id/value (reuses the canonical selector). */
const IN_PAGE_APP_ENTRY_COUNT = `(function () {
  /* cal-appcount */
  return document.querySelectorAll(${JSON.stringify(CANDIDATE_APP_ENTRY_SELECTOR)}).length;
})()`;

/**
 * Map a calibration stage to the target-kind it calibrates. `app_list` calibrates the CREATE control when no
 * application exists yet, otherwise the OPEN control; `app_detail` calibrates OPEN only when an application
 * exists (nothing to open otherwise → left unresolved). Returning `null` means "leave this target unresolved,
 * do not force it".
 */
export function stageTargetKind(stage: CalibrationStage, hasExistingApp: boolean): IssuanceTarget | null {
  switch (stage) {
    case "app_list":
      return hasExistingApp ? "open_app" : "create_app";
    case "app_detail":
      return hasExistingApp ? "open_app" : null;
    case "api_group":
      return "api_group";
    case "credentials":
      return "credentials";
    case "return_path":
      return "return";
  }
}

/** Injected seams so the whole multi-checkpoint walk is unit-tested offline over a fake page. */
export interface CalibrationSessionDeps {
  urlCategory: ApiCenterUrlCategory;
  /** Sanitized structural census of the CURRENT (newest) page. */
  readCensus(): Promise<ApiCenterStructuralCensus>;
  /** CANDIDATE app-entry row count (existing-vs-empty branch); counts only. */
  readAppEntryCount(): Promise<number>;
  /** Arm the three read-only in-page listeners (hover / hotkey / click-observe). */
  armCapture(): Promise<void>;
  /** Clear the calibration window vars before a checkpoint. */
  resetCapture(): Promise<void>;
  /** Read the structural capture of the hotkey-confirmed element (null when nothing was confirmed). */
  readCapturedTarget(): Promise<RawCapturedShape | null>;
  /** Whether the operator's own navigation click was observed since the last read. */
  readClickObserved(): Promise<boolean>;
  /** Block until the operator signals this stage ready / abort / times out. */
  waitForStageSentinel(stage: CalibrationStage): Promise<CalibrationCheckpointSignal>;
  /** Print sanitized per-stage instructions (noop in tests). */
  announceStage?(stage: CalibrationStage, targetKind: IssuanceTarget | null): void;
}

export interface CalibrationSessionResult {
  summary: CalibrationSummary;
  /** RAW selectors — written ONLY to the gitignored sink, NEVER logged. */
  rawEntries: RawArtifactEntry[];
  /** True only on an explicit operator abort (SIGINT / `.abort` sentinel). */
  aborted: boolean;
  /** How many stages were walked (sanitized count). */
  stagesCompleted: number;
  /** How many operator navigation clicks were observed (sanitized count). */
  clicksObserved: number;
}

/**
 * The pure multi-checkpoint orchestrator. Walks the five stages in ONE session; at each it arms capture,
 * waits for the operator, reads the sanitized page signature, and (when the operator confirmed a control)
 * sanitizes the structural capture through the FROZEN gate. Abort/timeout stop the walk and return the partial
 * sanitized summary gathered so far. It never navigates, clicks, types, or reads a value — those are the
 * injected page seams, each of which is value-free.
 */
export async function runCalibrationSession(deps: CalibrationSessionDeps): Promise<CalibrationSessionResult> {
  const pages: PageSignature[] = [];
  const targets: SanitizedTargetCandidate[] = [];
  const rawEntries: RawArtifactEntry[] = [];
  let aborted = false;
  let hasExistingApp = false;
  let stagesCompleted = 0;
  let clicksObserved = 0;

  for (const stage of CALIBRATION_STAGES) {
    deps.announceStage?.(stage, null);
    await deps.resetCapture();
    await deps.armCapture();

    const signal = await deps.waitForStageSentinel(stage);
    if (signal !== "ready") {
      aborted = signal === "abort";
      break;
    }

    // Sanitized page signature of wherever the operator navigated.
    const census = await deps.readCensus();
    const obs = observeFrom(deps.urlCategory, census);
    pages.push(pageSignature(stage, obs.pageCategory, obs.signals));

    // The existing-vs-empty branch is decided on the app-list surface and carried to app_detail.
    if (stage === "app_list") {
      hasExistingApp = (await deps.readAppEntryCount()) > 0;
    }
    const targetKind = stageTargetKind(stage, hasExistingApp);

    // Sanitize the confirmed control (if any). No target kind (unresolved stage) ⇒ nothing forced.
    const captured = await deps.readCapturedTarget();
    if (captured && targetKind) {
      const raw: RawTargetCapture = { ...captured, targetKind };
      const { sanitized, raw: rawEntry } = sanitizeCapture(raw);
      targets.push(sanitized);
      if (rawEntry) rawEntries.push(rawEntry);
    }

    if (await deps.readClickObserved()) clicksObserved += 1;
    stagesCompleted += 1;
  }

  return { summary: summarize(pages, targets), rawEntries, aborted, stagesCompleted, clicksObserved };
}

/* ────────────────────────────── page-bound seams (string-form evaluate) ────────────────────────────── */

/** Evaluate a STRING snippet (not a function) so esbuild's `__name` shim is never referenced in the page. */
function evalStr<R>(page: Page, script: string): Promise<R> {
  return (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
}

/**
 * Build the page-bound subset of the deps over a getter for the ACTIVE (newest) page — the operator may open
 * the next stage in a new tab, so reads always target the newest tab (mirrors `observe-api-center`). Pure of
 * the sentinel wait + instructions, so a fake page can drive the same seams in tests.
 */
export function buildPageSessionDeps(
  getActivePage: () => Page,
  urlCategory: ApiCenterUrlCategory,
): Omit<CalibrationSessionDeps, "waitForStageSentinel" | "announceStage"> {
  return {
    urlCategory,
    readCensus: () => evalStr<ApiCenterStructuralCensus>(getActivePage(), EXTRACT_API_CENTER_CENSUS),
    readAppEntryCount: () => evalStr<number>(getActivePage(), IN_PAGE_APP_ENTRY_COUNT),
    armCapture: async () => {
      await evalStr(getActivePage(), ARM_CALIBRATION_CAPTURE);
    },
    resetCapture: async () => {
      await evalStr(getActivePage(), RESET_CAPTURE);
    },
    readCapturedTarget: () => evalStr<RawCapturedShape | null>(getActivePage(), READ_CAPTURED_TARGET),
    readClickObserved: () => evalStr<boolean>(getActivePage(), READ_CLICK_OBSERVED),
  };
}

/* ────────────────────────────── gitignored artifact path (sanitized/raw split) ────────────────────────────── */

const COLLECTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Repo-relative calibration artifact path for a run (the `.calibration/` dir is gitignored). */
export function calibrationArtifactRelPath(runId: string): string {
  return `.calibration/api-center-${runId}.json`;
}

/** Absolute path of the gitignored raw artifact for a run (under the collector tree). */
export function calibrationArtifactAbsPath(runId: string): string {
  return resolve(COLLECTOR_ROOT, ".calibration", `api-center-${runId}.json`);
}

/* ────────────────────────────── sentinels (multi-checkpoint) ────────────────────────────── */

/** Per-stage readiness sentinel filename (cleared + re-polled every stage). */
export const CALIBRATION_SENTINEL_FILENAME = "calibrate-api-center.ready";
/** Operator abort sentinel filename (ends the session, writes the partial sanitized summary). */
export const CALIBRATION_ABORT_FILENAME = "calibrate-api-center.abort";

export function calibrationSentinelPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), CALIBRATION_SENTINEL_FILENAME);
}
export function calibrationAbortPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), CALIBRATION_ABORT_FILENAME);
}

/* ────────────────────────────── live wiring (inert on import) ────────────────────────────── */

const SENTINEL_POLL_MS = 1_000;
const STAGE_WAIT_TIMEOUT_MS = 20 * 60_000; // generous per-stage budget for a manual navigate + hover + hotkey
const HYDRATION_TIMEOUT_MS = 15_000;

function mintRunId(): string {
  return `cal_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

async function settle(page: Page): Promise<void> {
  const p = page as unknown as { waitForLoadState?: (s: string, o?: { timeout?: number }) => Promise<void> };
  if (typeof p.waitForLoadState !== "function") return;
  try {
    await p.waitForLoadState("networkidle", { timeout: HYDRATION_TIMEOUT_MS });
  } catch {
    /* timeout is fine — the classifier fails closed on thin signals */
  }
}

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER API-center MULTI-SURFACE calibration — explicit per-run approval required.");
  console.error(" Read-only calibration: the SELLER logs in and navigates each surface MANUALLY. This tool");
  console.error(" never logs in, clicks, types, submits, creates, selects, autofills, or reads any value");
  console.error(` (incl. Client ID/Secret). Per stage: navigate, hover the target and press ${DEFAULT_CALIBRATION_HOTKEY_LABEL},`);
  console.error(" then signal ready. RAW selectors go to the gitignored .calibration/ sink; only a SANITIZED");
  console.error(" summary (kind + hash + match count + resolution) is ever printed/logged. No URL/value saved.");
  console.error(line);
}

function printStageInstructions(stage: CalibrationStage, readyPath: string, abortPath: string): void {
  console.error("");
  console.error(`Calibration stage: ${stage}.`);
  console.error(`  1) Navigate MANUALLY to the ${stage} surface in the opened dedicated Chrome window.`);
  console.error(`  2) Hover the target control and press ${DEFAULT_CALIBRATION_HOTKEY_LABEL} to calibrate it`);
  console.error("     (a credential value field is captured by POSITION only — its value is never read).");
  console.error("  3) Signal readiness by creating this file (or say \"ready\"):");
  console.error(`       ${readyPath}`);
  console.error(`     To abort the whole session, create: ${abortPath}  (or press Ctrl+C).`);
  console.error("  Polling…");
}

/**
 * Live entry (gated). NOT run during offline build/verify. Opens the window ONCE, keeps login across stages,
 * writes the RAW artifact to the gitignored sink, prints ONLY the sanitized summary, and always closes.
 */
async function main(): Promise<void> {
  banner();
  const args = process.argv.slice(2);
  if (!hasLiveRunApproval(args)) {
    console.error(approvalRequiredMessage());
    process.exit(3);
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
  const urlCategory = screen.urlCategory;
  const cfg = loadConfig();
  const runId = mintRunId();

  // Honor the manifest's declared raw-artifact path (SELLEROPS_CALIBRATION_ARTIFACT) so the path the operator
  // approved IS the path written — re-validated fail-closed here (defense in depth) with the SAME gate the
  // approval manifest used. Absent ⇒ the internally-minted default. Never outside the gitignored .calibration/.
  const declaredArtifactRel = process.env.SELLEROPS_CALIBRATION_ARTIFACT;
  if (declaredArtifactRel !== undefined && !isSafeCalibrationArtifactPath(declaredArtifactRel)) {
    console.error("Refusing to launch: SELLEROPS_CALIBRATION_ARTIFACT is not a safe gitignored .calibration/ path. No browser launched.");
    process.exit(2);
    return;
  }
  const artifactRel = declaredArtifactRel ?? calibrationArtifactRelPath(runId);
  const readyPath = calibrationSentinelPathFor(cfg.statusFile);
  const abortPath = calibrationAbortPathFor(cfg.statusFile);
  mkdirSync(dirname(readyPath), { recursive: true });
  removeSentinel(readyPath);
  removeSentinel(abortPath);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const ctx = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const activePage = (): Page => {
    const list = ctx.pages();
    return (list[list.length - 1] ?? list[0]) as Page;
  };

  // The operator navigates to the API-center once; the SAME window/login is reused across every stage.
  const entry = activePage();
  if (entry) await entry.goto(url, { waitUntil: "domcontentloaded" }).catch(() => undefined);

  const base = buildPageSessionDeps(activePage, urlCategory);
  const deps: CalibrationSessionDeps = {
    ...base,
    readCensus: async () => {
      await settle(activePage());
      return base.readCensus();
    },
    waitForStageSentinel: async (stage) => {
      removeSentinel(readyPath);
      printStageInstructions(stage, readyPath, abortPath);
      const maxTicks = Math.ceil(STAGE_WAIT_TIMEOUT_MS / SENTINEL_POLL_MS);
      for (let i = 0; i < maxTicks; i++) {
        if (abortFlag.v || existsSync(abortPath)) return "abort";
        if (existsSync(readyPath)) return "ready";
        await sleep(SENTINEL_POLL_MS);
      }
      return "timeout";
    },
  };

  try {
    const result = await runCalibrationSession(deps);

    // RAW artifact → gitignored sink ONLY (the declared/approved path). Selectors never touch the console/log.
    const artifactPath = resolve(COLLECTOR_ROOT, artifactRel);
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      JSON.stringify({ runId, calibrationPending: true, entries: result.rawEntries }, null, 2),
      "utf8",
    );

    // SANITIZED summary → console/log. No selector/value/URL (host category only).
    console.log(
      JSON.stringify(
        {
          runId,
          urlCategory,
          aborted: result.aborted,
          stagesCompleted: result.stagesCompleted,
          clicksObserved: result.clicksObserved,
          resolvedCount: result.summary.resolvedCount,
          unresolvedCount: result.summary.unresolvedCount,
          rawArtifact: artifactRel,
          summary: result.summary,
        },
        null,
        2,
      ),
    );
    log("apiCenter.calibrate.done", {
      runId,
      urlCategory,
      aborted: result.aborted,
      stagesCompleted: result.stagesCompleted,
      clicksObserved: result.clicksObserved,
      resolvedCount: result.summary.resolvedCount,
      unresolvedCount: result.summary.unresolvedCount,
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
