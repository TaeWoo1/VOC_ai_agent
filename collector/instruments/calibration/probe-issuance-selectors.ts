/**
 * **Live, GATED, human-attended NAVER API-center READ-ONLY Phase-B selector probe (`API_ISSUANCE_SELECTOR_PROBE`).**
 *
 *   set -a && . ./.env && set +a          # NAVER_API_CENTER_URL (operator-owned; never logged)
 *   npx tsx instruments/calibration/probe-issuance-selectors.ts -- --i-understand-this-opens-live-naver
 *
 * The step that VALIDATES the issuance highlight driver's OWN locate mechanism against the real API center,
 * WITHOUT ever highlighting, tagging, clicking, or reading a value. It opens the seller's dedicated Chrome
 * window; per screen the seller navigates there and signals ready; then it runs the SAME `NaverIssuanceDriver`
 * that Phase B (`API_ISSUANCE_HIGHLIGHT_PROOF`) would use, but only through its READ-ONLY
 * {@link NaverIssuanceDriver.probeTargetMatch}: for each highlight target on that screen it COUNTS how many
 * candidates the calibrated fixed-label locator matches and whether it resolves uniquely (`canHighlight`). The
 * output is value-free integers + booleans + a sanitized page category — never a selector, label, value, or URL.
 *
 * This is the read-only evidence that confirms the driver's locate resolves each calibrated highlight target to
 * exactly one element live. (`open_app` is NAVIGATION guidance, not a highlighted control, so it is not probed
 * here — only the three fixed-label controls are.) It NEVER highlights or observes a click — that is Phase B.
 *
 * Gating mirrors `run-api-issuance-live-naver` / `calibrate-api-center`: refuses without
 * `--i-understand-this-opens-live-naver` (`hasLiveRunApproval`); `screenApiCenterUrl`-fail-closed BEFORE Chrome
 * launches; navigates exactly once to the pre-screened URL; always `ctx.close()`. `main()` runs ONLY when
 * invoked directly (inert on import), so offline build/verify launches nothing.
 */
import type { BrowserContext, Page } from "playwright";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../../src/config";
import { log } from "../../src/log";
import { launchNaverContext } from "../../src/profile";
import { NaverIssuanceDriver } from "../../src/action-window/naver-issuance-driver";
import {
  ISSUANCE_TARGET_SELECTORS,
  selectorSpecFor,
  type IssuanceHighlightTarget,
  type TargetCalibrationStatus,
} from "../../src/action-window/api-issuance-calibration/issuance-highlight-selectors";
import { VISUAL_RECON_SCREENS, type VisualReconScreen } from "../../src/action-window/api-issuance-calibration/visual-recon";
import { screenApiCenterUrl, type ApiCenterPageCategory } from "../../src/cli/observe-api-center";
import { approvalRequiredMessage, hasLiveRunApproval } from "../../src/cli/live-run-approval";
import type { OperatorConfirmAsk } from "../../src/cli/operator-confirm";
import { attachOperatorConfirmTab, type ConfirmHostContext } from "../../src/cli/operator-confirm-host";

/** A per-screen operator signal: proceed, abort the session, or the wait timed out. */
export type SelectorProbeSignal = "ready" | "abort" | "timeout";

/** The highlight targets that sit on a given screen (in registry order). */
export function targetsForScreen(screen: VisualReconScreen): IssuanceHighlightTarget[] {
  return ISSUANCE_TARGET_SELECTORS.filter((s) => s.screen === screen).map((s) => s.target);
}

/** The screens the probe walks — exactly those that carry at least one highlight target (skips app_detail). */
export function issuanceProbeScreens(): VisualReconScreen[] {
  return VISUAL_RECON_SCREENS.filter((s) => targetsForScreen(s).length > 0);
}

export interface SelectorProbeTargetResult {
  target: IssuanceHighlightTarget;
  status: TargetCalibrationStatus;
  /** How many candidates the calibrated fixed-label locator matched live (integer only). */
  matchCount: number;
  /** Whether it resolves uniquely (matchCount===1) and can therefore be highlighted. */
  canHighlight: boolean;
}

export interface SelectorProbeScreenResult {
  screen: VisualReconScreen;
  pageCategory: ApiCenterPageCategory;
  targets: SelectorProbeTargetResult[];
}

export interface SelectorProbeResult {
  screens: SelectorProbeScreenResult[];
  aborted: boolean;
  screensProbed: number;
  /** How many calibrated (live_confirmed) targets resolved uniquely this run (sanitized count). */
  uniqueCalibrated: number;
  /** How many calibrated targets did NOT resolve uniquely (drift signal; sanitized count). */
  nonUniqueCalibrated: number;
}

/** Injected seams so the whole read-only walk is unit-tested offline over fakes (no browser). */
export interface SelectorProbeDeps {
  /** The sanitized page category of the CURRENT (newest) page — reused from the driver's own probe. */
  probeSurface(): Promise<{ pageCategory: ApiCenterPageCategory }>;
  /** Read-only fixed-label matchCount for one highlight target (never tags/highlights/clicks/reads a value). */
  probeTarget(target: IssuanceHighlightTarget): Promise<{ matchCount: number; canHighlight: boolean }>;
  /** Block until the operator signals this screen ready / abort / timeout (sentinel-file only). */
  waitForScreenSentinel(screen: VisualReconScreen): Promise<SelectorProbeSignal>;
  /** Print sanitized per-screen instructions (noop in tests). */
  announceScreen?(screen: VisualReconScreen, targets: readonly IssuanceHighlightTarget[]): void;
}

/**
 * The pure orchestrator. Walks each screen that carries a highlight target: waits for the operator, reads the
 * sanitized page category, and measures each target's calibrated fixed-label matchCount read-only. It NEVER
 * highlights, tags, clicks, or reads a value — every measurement is `probeTarget` (count only). Abort/timeout
 * stop the walk and return the partial sanitized result gathered so far.
 */
export async function runSelectorProbeSession(deps: SelectorProbeDeps): Promise<SelectorProbeResult> {
  const screens: SelectorProbeScreenResult[] = [];
  let aborted = false;
  let screensProbed = 0;
  let uniqueCalibrated = 0;
  let nonUniqueCalibrated = 0;

  for (const screen of issuanceProbeScreens()) {
    const targets = targetsForScreen(screen);
    deps.announceScreen?.(screen, targets);
    const signal = await deps.waitForScreenSentinel(screen);
    if (signal === "abort") {
      aborted = true;
      break;
    }
    if (signal === "timeout") break;

    const { pageCategory } = await deps.probeSurface();
    const targetResults: SelectorProbeTargetResult[] = [];
    for (const target of targets) {
      const status = selectorSpecFor(target).status;
      const { matchCount, canHighlight } = await deps.probeTarget(target);
      targetResults.push({ target, status, matchCount, canHighlight });
      if (canHighlight) uniqueCalibrated += 1;
      else nonUniqueCalibrated += 1;
    }
    screens.push({ screen, pageCategory, targets: targetResults });
    screensProbed += 1;
  }

  return { screens, aborted, screensProbed, uniqueCalibrated, nonUniqueCalibrated };
}

/* ────────────────────────────── sentinels + live wiring (inert on import) ────────────────────────────── */

/**
 * **There is no per-screen readiness sentinel.** It used to advance this probe from screen to screen, and its
 * own printed instruction said `Signal readiness by creating this file (or say "ready")` — which is precisely
 * the channel that failed on 2026-08-13. Each screen is now a verified press on the SellerOps confirmation
 * surface (`./operator-confirm`).
 *
 * The abort sentinel stays: a forged abort ends a session, which is the safe direction.
 */
export const PROBE_ABORT_FILENAME = "probe-issuance-selectors.abort";

export function probeAbortPathFor(statusFile: string): string {
  return resolve(dirname(resolve(statusFile)), PROBE_ABORT_FILENAME);
}

const SCREEN_WAIT_TIMEOUT_MS = 20 * 60_000; // generous per-screen budget for a manual navigate/scroll

/** One screen's ask, in the operator's own words. Built per screen so the press belongs to that screen. */
export function screenAskFor(screen: VisualReconScreen, targets: readonly IssuanceHighlightTarget[]): OperatorConfirmAsk {
  return {
    title: `SELECTOR PROBE — ${screen}`,
    headline: `${screen} 화면으로 직접 이동하신 뒤 확인해 주세요.`,
    lines: [
      `측정 대상: ${targets.join(", ")}`,
      "열린 전용 Chrome 창에서 직접 이동하세요 — SellerOps는 그 창을 조작하지 않습니다.",
      "확인을 누르시면 각 대상의 고정 라벨이 몇 개 매칭되는지만 읽습니다 (읽기 전용 — 표시도 클릭도 없습니다).",
    ],
  };
}

function mintRunId(): string {
  return `probe_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  console.error(" LIVE NAVER API-center READ-ONLY selector probe — explicit per-run approval required.");
  console.error(" It measures ONLY how many candidates each target's fixed NAVER label matches (a count) and");
  console.error(" whether it resolves uniquely. It never highlights, tags, clicks, types, submits, or reads any");
  console.error(" value (incl. Client ID/Secret). Per screen: navigate MANUALLY, then signal ready. Output is");
  console.error(" sanitized integers/booleans only — no selector, label, value, or URL.");
  console.error(line);
}

/**
 * Live entry (gated). NOT run during offline build/verify. Opens the window ONCE, keeps login across screens,
 * measures each calibrated target's fixed-label matchCount read-only, prints ONLY a sanitized summary, and
 * always closes. Never highlights, tags, clicks, or reads a value.
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

  const cfg = loadConfig();
  const runId = mintRunId();
  const abortPath = probeAbortPathFor(cfg.statusFile);
  mkdirSync(dirname(abortPath), { recursive: true });
  removeSentinel(abortPath);

  const abortFlag = { v: false };
  const onSigint = (): void => {
    abortFlag.v = true;
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  const ctx: BrowserContext = await launchNaverContext(cfg.profileDir, cfg.browserChannel);
  // The confirmation surface, and the entry page captured before it existed. The driver reads the NEWEST tab,
  // so it is handed a context the surface is filtered out of — unfiltered, every measurement would land on the
  // blank SellerOps page and be reported as a confident reading of nothing.
  const confirmHost = await attachOperatorConfirmTab(ctx as unknown as ConfirmHostContext, {
    aborted: () => abortFlag.v || existsSync(abortPath),
    abortPath,
    timeoutMs: SCREEN_WAIT_TIMEOUT_MS,
  });
  const entry = confirmHost.entryPage as unknown as Page;
  await entry.goto(url, { waitUntil: "domcontentloaded" }).catch(() => undefined);

  const driver = new NaverIssuanceDriver(entry, { context: confirmHost.contextLike as unknown as BrowserContext });

  /** The targets the session announced for the screen now in flight, so its ask names them. */
  let screenTargets: readonly IssuanceHighlightTarget[] = [];
  const deps: SelectorProbeDeps = {
    probeSurface: async () => {
      const p = await driver.probeSurface();
      return { pageCategory: p.pageCategory };
    },
    probeTarget: (target) => driver.probeTargetMatch(target),
    // A FRESH confirmation per screen. A press held over from the previous one cannot advance this one.
    waitForScreenSentinel: async (screen) => (await confirmHost.confirm(screenAskFor(screen, screenTargets))).signal,
    announceScreen: (s, targets) => {
      screenTargets = targets;
      confirmHost.announce(screenAskFor(s, targets));
    },
  };

  try {
    const result = await runSelectorProbeSession(deps);
    console.error("");
    console.error("Selector probe complete. 이제 SellerOps 탭으로 직접 돌아가세요.");
    // SANITIZED summary → console/log. Integers/booleans/enums only — no selector/label/value/URL.
    console.log(
      JSON.stringify(
        {
          runId,
          urlCategory: screen.urlCategory,
          aborted: result.aborted,
          screensProbed: result.screensProbed,
          uniqueCalibrated: result.uniqueCalibrated,
          nonUniqueCalibrated: result.nonUniqueCalibrated,
          screens: result.screens,
        },
        null,
        2,
      ),
    );
    log("apiCenter.selectorProbe.done", {
      runId,
      urlCategory: screen.urlCategory,
      aborted: result.aborted,
      screensProbed: result.screensProbed,
      uniqueCalibrated: result.uniqueCalibrated,
      nonUniqueCalibrated: result.nonUniqueCalibrated,
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
    log("apiCenter.selectorProbe.fatal", { reason: e instanceof Error ? e.name || "Error" : typeof e }, "warn");
    process.exit(1);
  });
}
