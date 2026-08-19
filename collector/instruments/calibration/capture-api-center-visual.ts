/**
 * **Live, GATED, human-attended NAVER API-center VISUAL RECON capture.**
 *
 *   set -a && . ./.env && set +a          # NAVER_API_CENTER_URL (operator-owned; never logged)
 *   npx tsx instruments/calibration/capture-api-center-visual.ts -- --i-understand-this-opens-live-naver
 *   npx tsx instruments/calibration/capture-api-center-visual.ts -- --cleanup   # delete this tree's recon artifacts, launch nothing
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
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { launchNaverContext } from "../../src/profile";
import { approvalRequiredMessage, hasLiveRunApproval } from "../../src/cli/live-run-approval";
import type { OperatorConfirmAsk } from "../../src/cli/operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "../../src/cli/operator-confirm-host";
import { EXTRACT_API_CENTER_CENSUS, screenApiCenterUrl, type ApiCenterStructuralCensus, type ApiCenterUrlCategory } from "../../src/cli/observe-api-center";
import {
  checkpointFor,
  type VisualReconCheckpoint,
  mayScreenshot,
  sanitizeVisualSummary,
  verifyRedaction,
  VISUAL_RECON_SCREENS,
  resolveVisualReconScope,
  type FixedLabelMatch,
  type RawRedactionReport,
  type RawVisualControl,
  type RawVisualSummary,
  type RedactionVerdict,
  type SanitizedVisualSummary,
  type VisualReconScreen,
} from "../../src/action-window/api-issuance-calibration/visual-recon";
import {
  buildFixedLabelProbeScript,
  buildRedactionScript,
  EXTRACT_VISUAL_CONTROLS,
  REDACTION_CLEAR_SCRIPT,
} from "../../src/action-window/api-issuance-calibration/visual-recon-inpage";
import { labelProbesForScreen } from "../../src/action-window/api-issuance-calibration/visual-recon-candidates";

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
  /** READ-ONLY: count how many elements match each fixed-label probe for this screen (value-free integers). */
  probeFixedLabels(screen: VisualReconScreen): Promise<FixedLabelMatch[]>;
  /** Remove every redaction overlay so the operator's view returns to normal before the next checkpoint. */
  clearOverlaysAllFrames(): Promise<void>;
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
export async function runVisualReconSession(
  deps: VisualReconSessionDeps,
  screens: readonly VisualReconScreen[] = VISUAL_RECON_SCREENS,
): Promise<VisualReconSessionResult> {
  const summaries: SanitizedVisualSummary[] = [];
  let aborted = false;
  let screensWalked = 0;
  let screenshotsTaken = 0;
  let screensHalted = 0;
  let screensSkipped = 0;

  // The capture SCOPE — the full fixed set by default, or the narrower per-run subset the manifest approved.
  // Walking only these screens is what keeps the capture consistent with the scope the operator approved.
  for (const screen of screens) {
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
    // READ-ONLY fixed-label matchCount probe for this screen (value-free integer counts; never a page value).
    const labelMatches = await deps.probeFixedLabels(screen);
    const summary = sanitizeVisualSummary({
      screen,
      urlCategory: deps.urlCategory,
      raw,
      reports: reportsForSummary,
      verdict: gateVerdict,
      screenshotTaken,
      viewport,
      labelMatches,
    });
    await deps.persistSummary(summary);
    summaries.push(summary);
    screensWalked += 1;

    // Capture/HALT for this screen is done — remove the overlays so the operator can navigate/scroll to the next
    // checkpoint on a clean page (they no longer linger until the next apply).
    await deps.clearOverlaysAllFrames();
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

/* ────────────────────────────── the operator's per-screen checkpoint ────────────────────────────── */

/**
 * **There is no readiness sentinel and no skip sentinel.** Both ADVANCED a checkpoint, and a file any process
 * can `touch` cannot be evidence that a human looked at a screen — least of all here, where what follows a
 * confirmation is a SCREENSHOT of the operator's own seller-centre page. Skipping is a second ANSWER to the
 * same ask, so it is a second button on the same verified surface (`./operator-confirm`).
 *
 * The abort sentinel stays: a forged abort ends a session, which is the safe direction.
 */
export const VISUAL_ABORT_FILENAME = "capture-api-center-visual.abort";

export function visualAbortPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), VISUAL_ABORT_FILENAME);
}

/** The label on the second button — every visual checkpoint may honestly be skipped. */
export const VISUAL_SKIP_BUTTON_LABEL = "이 화면 건너뛰기";

/** One checkpoint's ask, in the operator's own words. */
export function visualScreenAskFor(screen: VisualReconScreen, checkpoint: VisualReconCheckpoint): OperatorConfirmAsk {
  return {
    title: `VISUAL RECON — ${screen}`,
    headline:
      checkpoint.navigation === "scroll_same_page"
        ? "같은 페이지입니다 — 이동하지 마시고, 이 구간이 보이도록 직접 스크롤한 뒤 확인해 주세요."
        : "이 페이지로 직접 이동하신 뒤 확인해 주세요.",
    lines: [
      `page: ${checkpoint.page}, ${checkpoint.kind}`,
      "열린 전용 Chrome 창에서 직접 이동/스크롤하세요 — SellerOps는 그 창을 조작하지 않습니다.",
      "확인을 누르시면 민감한 영역을 모두 가리고, 가려졌는지 검증한 뒤 촬영하고, 다시 걷어냅니다.",
      "검증되지 않으면 촬영하지 않습니다.",
      "",
      `이 화면을 건너뛰려면 [${VISUAL_SKIP_BUTTON_LABEL}] 를 누르세요.`,
    ],
    secondary: { label: VISUAL_SKIP_BUTTON_LABEL },
  };
}

/* ────────────────────────────── live wiring (inert on import) ────────────────────────────── */

const SCREEN_WAIT_TIMEOUT_MS = 20 * 60_000;
const HYDRATION_TIMEOUT_MS = 15_000;

function mintRunId(): string {
  return `vis_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  // Per-run capture SCOPE — resolved from the SAME env the manifest gate reads, so the capture can only ever
  // walk the screens the approved manifest declared. A LIVE capture NEVER defaults its scope: the env must be
  // set EXPLICITLY (to the exact set the manifest approved — a subset like `app_list,app_detail`, or all four).
  // Failing closed here — rather than silently defaulting to the full set — is what stops a narrowed manifest
  // from being paired with a wider capture. (The manifest-generator may default to the full set; a real capture
  // may not.)
  const rawScope = process.env.SELLEROPS_VISUAL_RECON_SCREENS;
  // Require at least one REAL screen token — not just a non-empty string. A degenerate value ("," / " , ")
  // would otherwise resolve to the full set via the generator's empty⇒full default; a live capture must name
  // its screens explicitly, so an empty token list fails closed exactly like an absent env.
  const scopeTokens = (rawScope ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (scopeTokens.length === 0) {
    console.error(
      "Refusing to launch: set SELLEROPS_VISUAL_RECON_SCREENS to the EXACT capture scope approved in the manifest " +
        `(a subset like 'app_list,app_detail', or all: '${VISUAL_RECON_SCREENS.join(",")}'). A live capture never defaults its scope. No browser launched.`,
    );
    process.exit(2);
    return;
  }
  const scope = resolveVisualReconScope(rawScope);
  if (!scope.ok) {
    console.error(`Refusing to launch: SELLEROPS_VISUAL_RECON_SCREENS invalid (${scope.reason}). No browser launched.`);
    process.exit(2);
    return;
  }
  const captureScreens = scope.screens;
  console.error(`Capture scope: ${captureScreens.join(", ")} (${captureScreens.length}/${VISUAL_RECON_SCREENS.length} screens) — must match the approved manifest.`);
  const cfg = loadConfig();
  const runId = mintRunId();

  const abortPath = visualAbortPathFor(cfg.statusFile);
  mkdirSync(dirname(abortPath), { recursive: true });
  mkdirSync(visualArtifactDirAbs(), { recursive: true });
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
    timeoutMs: SCREEN_WAIT_TIMEOUT_MS,
  });
  // The NEWEST tab, from a list the confirmation surface is filtered out of. Unfiltered, this run would redact,
  // verify and SCREENSHOT the blank SellerOps page instead of the screen the operator prepared.
  const activePage = (): Page => {
    const list = confirmHost.contextLike.pages() as unknown as Page[];
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
    // A FRESH confirmation per checkpoint. A press held over from the previous screen cannot advance this one.
    waitForScreenSentinel: async (screen) => {
      const confirmation = await confirmHost.confirm(visualScreenAskFor(screen, checkpointFor(screen)));
      if (confirmation.signal !== "ready") return confirmation.signal;
      return confirmation.choice === "secondary" ? "skip" : "ready";
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
    probeFixedLabels: async (scr) => {
      const probes = labelProbesForScreen(scr);
      if (probes.length === 0) return [];
      // Value-free: the probe returns [{targetId, matchCount}] integers only; fail closed to [] on any eval error.
      const res = await evalStr<FixedLabelMatch[]>(activePage(), buildFixedLabelProbeScript(probes)).catch(() => [] as FixedLabelMatch[]);
      return Array.isArray(res) ? res : [];
    },
    clearOverlaysAllFrames: async () => {
      await evalAllFrames(activePage(), REDACTION_CLEAR_SCRIPT).catch(() => undefined);
    },
    persistSummary: async (summary) => {
      const out = visualSummaryAbsPath(runId, summary.screen);
      if (!isSafeVisualArtifactPath(out)) return;
      writeFileSync(out, JSON.stringify(summary, null, 2), "utf8");
    },
    announceScreen: (scr) => confirmHost.announce(visualScreenAskFor(scr, checkpointFor(scr))),
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
    const result = await runVisualReconSession(deps, captureScreens);
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
