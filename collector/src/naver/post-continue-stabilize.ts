import type { PwPage } from "../profile";
import type { ExportActionPlan } from "./export-classify";
import type { SessionVerdict } from "./session-verdict";

/**
 * Read-only POST-CONTINUE stabilization for the same-session capture/diagnose path.
 *
 * Why this exists: the guarded continue (`continueAtCardOnce`) clicks once and reads
 * the settled state with its OWN bounded poll. On a cold context that poll can confirm
 * a briefly-visible `review-ready` surface before the SPA finishes hydrating its
 * session/export markers — so the live diagnostic saw `verdict: UNKNOWN`,
 * `exportLayout: LAYOUT_UNRECOGNIZED`, `reachedExportSurface: false` and halted before
 * the export gate, even though the page was on its way to a usable export surface.
 *
 * This helper closes that gap WITHOUT clicking anything: after the continue advances,
 * it keeps settling + re-reading the verdict and re-running the no-click export
 * classification until the page is TRULY ready for the capture/export gate
 * (`LOGGED_IN` + an actionable single-control sync export surface), or the bounded
 * window elapses. It never clicks, exports, downloads, uploads, writes status, or
 * mutates anything — it only reads. Transient mid-navigation read failures are treated
 * as "keep waiting", never fatal. The result is sanitized (a verdict enum + booleans +
 * a check count).
 */

/** The two start verdicts aside, a stable export surface is the only success here. */
export interface PostContinueStabilizeDeps {
  timeoutMs: number;
  intervalMs: number;
  /** Bounded SPA settle before each read (e.g. `waitForSpaHydration`). */
  settleFn: (page: PwPage) => Promise<unknown>;
  /** Read-only five-state verdict read (e.g. `checkLiveSessionVerdict`). */
  checkVerdictFn: (page: PwPage) => Promise<SessionVerdict>;
  /** Read-only no-click export plan (e.g. `planExportAction(await page.content())`). */
  readExportPlanFn: (page: PwPage) => Promise<ExportActionPlan>;
  /** Injectable sleep so tests run without real timers. */
  sleepFn?: (ms: number) => Promise<void>;
}

export type PostContinueStabilizeKind = "READY" | "TIMEOUT";

export interface PostContinueStabilization {
  kind: PostContinueStabilizeKind;
  /** Last verdict read. On `READY` it is `LOGGED_IN`. */
  verdict: SessionVerdict;
  /** True only on `READY` — a logged-in, actionable single-control sync export surface. */
  reachedExportSurface: boolean;
  /** How many settle+read cycles ran (bounded by the timeout/interval). */
  checks: number;
}

/**
 * Pure: is the post-continue page a usable export surface for the capture gate? Mirrors
 * `deriveReachedExportSurface` (LOGGED_IN + actionable) but additionally requires the
 * SYNC layout, so an async-job surface (which can also expose a candidate) never counts
 * as ready. The downstream `decideCaptureGate` still applies the strict single-control
 * check; this only decides when to STOP waiting.
 */
export function isExportSurfaceReady(verdict: SessionVerdict, plan: ExportActionPlan): boolean {
  return verdict === "LOGGED_IN" && plan.layout === "SYNC_DOWNLOAD" && plan.hasActionableExportCandidate;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Read-only: poll until the post-continue page settles into a usable export surface or
 * the bounded window elapses. See the module doc for the contract. Never clicks /
 * exports / downloads / uploads / writes status.
 */
export async function waitForPostContinueExportSurface(
  page: PwPage,
  deps: PostContinueStabilizeDeps,
): Promise<PostContinueStabilization> {
  const { timeoutMs, intervalMs, settleFn, checkVerdictFn, readExportPlanFn, sleepFn = defaultSleep } = deps;
  const maxChecks = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  let verdict: SessionVerdict = "UNKNOWN";
  for (let i = 0; i < maxChecks; i += 1) {
    let ready = false;
    try {
      await settleFn(page);
      verdict = await checkVerdictFn(page);
      const plan = await readExportPlanFn(page);
      ready = isExportSurfaceReady(verdict, plan);
    } catch {
      // Transient mid-navigation read (the SPA re-rendering post-continue) — keep waiting.
      verdict = "UNKNOWN";
    }
    if (ready) return { kind: "READY", verdict, reachedExportSurface: true, checks: i + 1 };
    if (i + 1 < maxChecks) await sleepFn(intervalMs);
  }
  return { kind: "TIMEOUT", verdict, reachedExportSurface: false, checks: maxChecks };
}
