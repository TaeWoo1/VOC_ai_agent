/**
 * **Live, GATED, human-attended NAVER API-center VISUAL RECON capture.**
 *
 *   set -a && . ./.env && set +a          # NAVER_API_CENTER_URL (operator-owned; never logged)
 *   npx tsx src/cli/capture-api-center-visual.ts -- --i-understand-this-opens-live-naver
 *   npx tsx src/cli/capture-api-center-visual.ts -- --cleanup   # delete this tree's recon artifacts, launch nothing
 *
 * A different calibration strategy from the hotkey calibrator: instead of the operator hovering one element and
 * pressing a hotkey, the operator navigates their OWN dedicated Chrome to each API-center screen, signals ready,
 * and the tool (1) draws opaque overlays over EVERY sensitive region in every frame, (2) VERIFIES — fail-closed
 * — that every detected sensitive element is covered, (3) ONLY THEN screenshots the already-redacted viewport,
 * (4) re-verifies the overlays still hold and discards the shot if they regressed, and (5) writes the redacted
 * PNG + a sanitized structural summary to the gitignored `.calibration/visual/` sink for a HUMAN reviewer.
 *
 * **The screenshot is the ONE new capability, and it is fenced:** the sole `.screenshot(...)` call lives in a
 * single seam that the pure orchestrator invokes ONLY when {@link mayScreenshot} is true for the current
 * screen; the pixels captured are therefore already redacted. There is no code path that screenshots an
 * un-redacted page, and the screenshot is taken to an in-memory buffer (no `path:` option) so nothing is
 * written before the post-shot re-verification passes.
 *
 * It NEVER logs in, clicks, types, submits, selects, autofills, reads a field VALUE (incl. Client ID/Secret),
 * dumps the DOM, or touches the clipboard. Operator navigation is the operator's OWN clicks. Only integers /
 * booleans / closed-vocab enums + the REDACTED image ever leave the page; no raw selector, value, text, or URL
 * (a URL is reduced to a host category before Chrome launches). Gating mirrors `calibrate-api-center` /
 * `observe-api-center`: refuses without `--i-understand-this-opens-live-naver`; `screenApiCenterUrl`-fail-closed
 * BEFORE Chrome launches; always `ctx.close()`. `main()` runs ONLY when invoked directly (inert on import).
 */
import type { BrowserContext, Frame, Page } from "playwright";
import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config";
import { log } from "../log";
import { launchNaverContext } from "../profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "./live-run-approval";
import { EXTRACT_API_CENTER_CENSUS, screenApiCenterUrl, type ApiCenterStructuralCensus, type ApiCenterUrlCategory } from "./observe-api-center";
import {
  mayScreenshot,
  sanitizeVisualSummary,
  verifyRedaction,
  VISUAL_RECON_SCREENS,
  type RawRedactionReport,
  type RawVisualControl,
  type RawVisualSummary,
  type RedactionVerdict,
  type SanitizedVisualSummary,
  type VisualReconScreen,
} from "../action-window/api-issuance-calibration/visual-recon";
import {
  buildRedactionScript,
  EXTRACT_VISUAL_CONTROLS,
} from "../action-window/api-issuance-calibration/visual-recon-inpage";

/** A per-screen operator signal: capture, skip this screen, abort the session, or the wait timed out. */
export type VisualCheckpointSignal = "ready" | "skip" | "abort" | "timeout";

/** Injected seams so the whole walk is unit-tested offline over fakes (no browser, no screenshot). */
export interface VisualReconSessionDeps {
  urlCategory: ApiCenterUrlCategory;
  /** Block until the operator signals this screen ready / skip / abort / times out (production: sentinel files). */
  waitForScreenSentinel(screen: VisualReconScreen): Promise<VisualCheckpointSignal>;
  /** Inject the redaction APPLY pass into every frame; returns one report per frame. */
  applyRedactionAllFrames(): Promise<RawRedactionReport[]>;
  /** Inject the redaction VERIFY pass into every frame (draws nothing); returns one report per frame. */
  verifyRedactionAllFrames(): Promise<RawRedactionReport[]>;
  /** Capture the ALREADY-REDACTED viewport to an in-memory BUFFER (no disk write). Called only after the gate. */
  screenshotRedactedViewport(screen: VisualReconScreen): Promise<{ taken: boolean }>;
  /** Write the captured buffer to the gitignored sink — called ONLY after the post-shot re-verification passes. */
  commitScreenshot(screen: VisualReconScreen): Promise<void>;
  /** Drop the captured buffer WITHOUT writing it (used when the post-shot re-verification regressed). */
  discardScreenshot(screen: VisualReconScreen): Promise<void>;
  /** Read the sanitized structural census + control list of the current (top) page. */
  readRawSummary(): Promise<RawVisualSummary>;
  /** Read the current viewport size (for coarse buckets only). */
  readViewport(): Promise<{ w: number; h: number }>;
  /** Persist the sanitized per-screen summary (production: JSON to `.calibration/visual/`). */
  persistSummary(summary: SanitizedVisualSummary): Promise<void>;
  announceScreen?(screen: VisualReconScreen): void;
  announceHalt?(screen: VisualReconScreen, verdict: RedactionVerdict): void;
  announceCaptured?(screen: VisualReconScreen): void;
}

export interface VisualReconSessionResult {
  summaries: SanitizedVisualSummary[];
  aborted: boolean;
  screensWalked: number;
  screenshotsTaken: number;
  screensHalted: number;
  screensSkipped: number;
}

/**
 * The pure per-screen orchestrator. For each screen it waits for the operator, applies redaction, VERIFIES
 * (fail-closed), and only screenshots when {@link mayScreenshot} is true — then re-verifies and discards the
 * shot if the overlays regressed. It never itself calls Playwright: the redaction / screenshot / read seams are
 * injected, so a fake drives the whole walk offline. A HALT on a screen skips the screenshot but still records a
 * sanitized (screenshot-less) summary so the run is honest about what was and was not captured.
 */
export async function runVisualReconSession(deps: VisualReconSessionDeps): Promise<VisualReconSessionResult> {
  const summaries: SanitizedVisualSummary[] = [];
  let aborted = false;
  let screensWalked = 0;
  let screenshotsTaken = 0;
  let screensHalted = 0;
  let screensSkipped = 0;

  for (const screen of VISUAL_RECON_SCREENS) {
    deps.announceScreen?.(screen);

    let signal: VisualCheckpointSignal = "timeout";
    let waiting = true;
    while (waiting) {
      signal = await deps.waitForScreenSentinel(screen);
      // ready / skip / abort / timeout are all definitive here — no capture-less retry loop.
      waiting = false;
    }
    if (signal === "abort") {
      aborted = true;
      break;
    }
    if (signal === "timeout") break;
    if (signal === "skip") {
      screensSkipped += 1;
      continue;
    }

    // ready → redact, verify, then (only if it passed) screenshot.
    const applyReports = await deps.applyRedactionAllFrames();
    const applyVerdict = verifyRedaction(applyReports);

    let screenshotTaken = false;
    let gateVerdict = applyVerdict;
    let reportsForSummary = applyReports;

    if (mayScreenshot(applyVerdict)) {
      // Independent re-verification is the authoritative gate (a fresh detection pass over the drawn overlays).
      const verifyReports = await deps.verifyRedactionAllFrames();
      const verifyVerdict = verifyRedaction(verifyReports);
      gateVerdict = verifyVerdict;
      reportsForSummary = verifyReports;

      if (mayScreenshot(verifyVerdict)) {
        // Capture to a BUFFER only — nothing is on disk yet. Confirm the overlays STILL cover after the shot,
        // and COMMIT (write) the buffer only if they do; otherwise drop the buffer unwritten.
        const shot = await deps.screenshotRedactedViewport(screen);
        const postReports = await deps.verifyRedactionAllFrames();
        const postVerdict = verifyRedaction(postReports);
        if (shot.taken && mayScreenshot(postVerdict)) {
          await deps.commitScreenshot(screen);
          screenshotTaken = true;
          reportsForSummary = postReports;
          gateVerdict = postVerdict;
        } else if (shot.taken) {
          await deps.discardScreenshot(screen);
        }
      }
    }

    if (screenshotTaken) {
      screenshotsTaken += 1;
      deps.announceCaptured?.(screen);
    } else {
      screensHalted += 1;
      deps.announceHalt?.(screen, gateVerdict);
    }

    const raw = await deps.readRawSummary();
    const viewport = await deps.readViewport();
    const summary = sanitizeVisualSummary({
      screen,
      urlCategory: deps.urlCategory,
      raw,
      reports: reportsForSummary,
      verdict: gateVerdict,
      screenshotTaken,
      viewport,
    });
    await deps.persistSummary(summary);
    summaries.push(summary);
    screensWalked += 1;
  }

  return { summaries, aborted, screensWalked, screenshotsTaken, screensHalted, screensSkipped };
}

/* ────────────────────────────── gitignored artifact paths (under .calibration/visual/) ────────────────────────────── */

const COLLECTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Absolute path of the gitignored visual-recon artifact directory for this collector tree. */
export function visualArtifactDirAbs(): string {
  return resolve(COLLECTOR_ROOT, ".calibration", "visual");
}

/** True only for a path that stays inside the gitignored `.calibration/visual/` sink (defence in depth). */
export function isSafeVisualArtifactPath(absPath: string): boolean {
  const dir = visualArtifactDirAbs();
  const norm = resolve(absPath);
  return norm === dir || norm.startsWith(dir + "/");
}

export function visualScreenshotAbsPath(runId: string, screen: VisualReconScreen): string {
  return resolve(visualArtifactDirAbs(), `${runId}-${screen}.png`);
}
export function visualSummaryAbsPath(runId: string, screen: VisualReconScreen): string {
  return resolve(visualArtifactDirAbs(), `${runId}-${screen}.summary.json`);
}

/** Delete every artifact in the gitignored visual-recon sink (the `--cleanup` action). Returns files removed. */
export function cleanupVisualArtifacts(): number {
  const dir = visualArtifactDirAbs();
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    if (!isSafeVisualArtifactPath(p)) continue; // never step outside the sink
    try {
      rmSync(p, { force: true });
      removed += 1;
    } catch {
      /* best-effort */
    }
  }
  return removed;
}

/* ────────────────────────────── sentinels (per screen) ────────────────────────────── */

export const VISUAL_READY_FILENAME = "capture-api-center-visual.ready";
export const VISUAL_SKIP_FILENAME = "capture-api-center-visual.skip";
export const VISUAL_ABORT_FILENAME = "capture-api-center-visual.abort";

export function visualReadyPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), VISUAL_READY_FILENAME);
}
export function visualSkipPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), VISUAL_SKIP_FILENAME);
}
export function visualAbortPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), VISUAL_ABORT_FILENAME);
}

/* ────────────────────────────── live wiring (inert on import) ────────────────────────────── */

const SENTINEL_POLL_MS = 1_000;
const SCREEN_WAIT_TIMEOUT_MS = 20 * 60_000;
const HYDRATION_TIMEOUT_MS = 15_000;

function mintRunId(): string {
  return `vis_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

/** Evaluate a STRING snippet (not a function) so esbuild's `__name` shim is never referenced in the page. */
function evalStr<R>(target: Page | Frame, script: string): Promise<R> {
  return (target as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<R>(script);
}

async function settle(page: Page): Promise<void> {
  const p = page as unknown as { waitForLoadState?: (s: string, o?: { timeout?: number }) => Promise<void> };
  if (typeof p.waitForLoadState !== "function") return;
  try {
    await p.waitForLoadState("networkidle", { timeout: HYDRATION_TIMEOUT_MS });
  } catch {
    /* timeout is fine */
  }
}

/** A safe, all-covered fallback report is NEVER used — a read failure yields a MALFORMED-ish empty list → HALT. */
async function evalAllFrames(page: Page, script: string): Promise<RawRedactionReport[]> {
  const reports: RawRedactionReport[] = [];
  const frames = (page as unknown as { frames?: () => Frame[] }).frames?.() ?? [];
  const targets: (Page | Frame)[] = frames.length > 0 ? frames : [page];
  for (const t of targets) {
    try {
      reports.push(await evalStr<RawRedactionReport>(t, script));
    } catch {
      // A frame that could not be evaluated is a RISK, not a pass: contribute a report that fails closed
      // (detected>0 semantics unknown → mark integrity failed so verifyRedaction HALTs rather than assuming safe).
      reports.push({
        bodyPresent: true,
        overlayCount: 0,
        integrityOk: false,
        detected: { form_field: 1, password: 0, readonly_or_code: 0, credential_area: 0, copy_linked: 0, identity_text: 0, chrome_region: 0 },
        covered: { form_field: 0, password: 0, readonly_or_code: 0, credential_area: 0, copy_linked: 0, identity_text: 0, chrome_region: 0 },
      });
    }
  }
  return reports;
}

function banner(): void {
  const line = "─".repeat(64);
  console.error(line);
  console.error(" LIVE NAVER API-center VISUAL RECON — explicit per-run approval required.");
  console.error(" The SELLER logs in and navigates each screen MANUALLY. Per screen the tool draws opaque");
  console.error(" overlays over EVERY sensitive region, VERIFIES coverage fail-closed, and ONLY THEN captures");
  console.error(" a REDACTED screenshot. It never logs in, clicks, types, submits, or reads any value (incl.");
  console.error(" Client ID/Secret). The redacted image + a SANITIZED structural summary go to the gitignored");
  console.error(" .calibration/visual/ sink; nothing else is saved. Redaction failure HALTs with no screenshot.");
  console.error(line);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Cleanup action: delete recon artifacts and exit — launches NOTHING, needs no approval.
  if (args.includes("--cleanup")) {
    const removed = cleanupVisualArtifacts();
    console.error(`Removed ${removed} visual-recon artifact file(s) from the gitignored sink.`);
    return;
  }

  banner();
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

  const readyPath = visualReadyPathFor(cfg.statusFile);
  const skipPath = visualSkipPathFor(cfg.statusFile);
  const abortPath = visualAbortPathFor(cfg.statusFile);
  mkdirSync(dirname(readyPath), { recursive: true });
  mkdirSync(visualArtifactDirAbs(), { recursive: true });
  removeSentinel(readyPath);
  removeSentinel(skipPath);
  removeSentinel(abortPath);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  const activePage = (): Page => {
    const list = ctx.pages();
    return (list[list.length - 1] ?? list[0]) as Page;
  };

  const entry = activePage();
  if (entry) await entry.goto(url, { waitUntil: "domcontentloaded" }).catch(() => undefined);

  const APPLY = buildRedactionScript("apply");
  const VERIFY = buildRedactionScript("verify");
  // The just-captured screenshot buffer, held between capture and the post-shot re-verification. Never written
  // to disk until commitScreenshot; dropped (unwritten) by discardScreenshot on a regression.
  let pendingBuffer: Buffer | null = null;

  const deps: VisualReconSessionDeps = {
    urlCategory,
    waitForScreenSentinel: async (_screen) => {
      removeSentinel(readyPath);
      removeSentinel(skipPath);
      const maxTicks = Math.ceil(SCREEN_WAIT_TIMEOUT_MS / SENTINEL_POLL_MS);
      for (let i = 0; i < maxTicks; i++) {
        if (abortFlag.v || existsSync(abortPath)) return "abort";
        if (existsSync(skipPath)) return "skip";
        if (existsSync(readyPath)) return "ready";
        await sleep(SENTINEL_POLL_MS);
      }
      return "timeout";
    },
    applyRedactionAllFrames: async () => {
      const page = activePage();
      await settle(page);
      return evalAllFrames(page, APPLY);
    },
    verifyRedactionAllFrames: async () => evalAllFrames(activePage(), VERIFY),
    screenshotRedactedViewport: async (_scr) => {
      // The pixels are ALREADY redacted (this seam runs only after mayScreenshot === true). Capture to an
      // in-memory BUFFER (no `path:` option → nothing auto-written); the buffer is committed to disk ONLY after
      // the post-shot re-verification passes (commitScreenshot). This keeps un-redacted pixels off disk entirely.
      const page = activePage();
      pendingBuffer = await (page as unknown as { screenshot(o: { type: "png"; fullPage: boolean }): Promise<Buffer> }).screenshot({ type: "png", fullPage: false });
      return { taken: pendingBuffer != null };
    },
    commitScreenshot: async (scr) => {
      if (!pendingBuffer) return;
      const out = visualScreenshotAbsPath(runId, scr);
      if (isSafeVisualArtifactPath(out)) writeFileSync(out, pendingBuffer);
      pendingBuffer = null;
    },
    discardScreenshot: async (_scr) => {
      pendingBuffer = null; // drop the buffer unwritten — nothing was ever on disk
    },
    readRawSummary: async () => {
      const page = activePage();
      await settle(page);
      const controls = await evalStr<RawVisualControl[]>(page, EXTRACT_VISUAL_CONTROLS).catch(() => [] as RawVisualControl[]);
      const census = await evalStr<ApiCenterStructuralCensus>(page, EXTRACT_API_CENTER_CENSUS).catch(
        () => ({ passwordFieldPresent: false, submitAffordancePresent: false, formCount: 0, editableTextInputCount: 0, readonlyFieldCount: 0, listLikeContainerCount: 0 }) as ApiCenterStructuralCensus,
      );
      return { controls, census };
    },
    readViewport: async () => {
      const page = activePage();
      return evalStr<{ w: number; h: number }>(page, "({ w: window.innerWidth||0, h: window.innerHeight||0 })").catch(() => ({ w: 0, h: 0 }));
    },
    persistSummary: async (summary) => {
      const out = visualSummaryAbsPath(runId, summary.screen);
      if (!isSafeVisualArtifactPath(out)) return;
      writeFileSync(out, JSON.stringify(summary, null, 2), "utf8");
    },
    announceScreen: (scr) => {
      console.error("");
      console.error(`Visual-recon screen: ${scr}.`);
      console.error("  1) Navigate MANUALLY to this screen in the opened dedicated Chrome window.");
      console.error('  2) When the screen is fully loaded, signal ready by creating this file (or say "ready"):');
      console.error(`       ${readyPath}`);
      console.error(`     To SKIP this screen: create ${skipPath} (or say "skip").`);
      console.error(`     To ABORT the session: create ${abortPath} (or press Ctrl+C).`);
      console.error("  The tool then redacts every sensitive region, VERIFIES coverage, and only then captures.");
    },
    announceHalt: (scr, verdict) => {
      console.error("");
      console.error(`Screen ${scr}: redaction did NOT fully verify — NO screenshot was taken (fail-closed).`);
      console.error(`  reasons: ${verdict.reasons.join(", ") || "unknown"} (sanitized). Reload the screen and retry.`);
    },
    announceCaptured: (scr) => {
      console.error(`Screen ${scr}: redaction verified — a REDACTED screenshot + sanitized summary were saved.`);
    },
  };

  try {
    const result = await runVisualReconSession(deps);
    console.error("");
    console.error("Visual-recon walk complete. 이제 SellerOps 탭으로 직접 돌아가세요.");

    // SANITIZED summary → console/log. No selector/value/URL (host category only). The redacted PNGs + per-screen
    // sanitized JSON already went to the gitignored sink; only counts are echoed here.
    console.log(
      JSON.stringify(
        {
          runId,
          urlCategory,
          aborted: result.aborted,
          screensWalked: result.screensWalked,
          screenshotsTaken: result.screenshotsTaken,
          screensHalted: result.screensHalted,
          screensSkipped: result.screensSkipped,
          artifactDir: ".calibration/visual",
        },
        null,
        2,
      ),
    );
    log("apiCenter.visualRecon.done", {
      runId,
      urlCategory,
      aborted: result.aborted,
      screensWalked: result.screensWalked,
      screenshotsTaken: result.screenshotsTaken,
      screensHalted: result.screensHalted,
      screensSkipped: result.screensSkipped,
    });
  } finally {
    removeSentinel(readyPath);
    removeSentinel(skipPath);
    removeSentinel(abortPath);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await ctx.close();
  }
}

// Run the live path ONLY when invoked directly (never on import) so hermetic tests launch nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    log("apiCenter.visualRecon.fatal", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
    process.exit(1);
  });
}
