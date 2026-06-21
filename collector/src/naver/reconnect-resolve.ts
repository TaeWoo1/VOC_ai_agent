import type { BrowserContext, Page } from "playwright";
import type { PwPage } from "../profile";
import type { CollectorState } from "../status";
import { continueAtCardOnce, type ContinueOutcome } from "./account-store-continue";
import type { ExpectedContinueCard, ExpectedIdentity } from "./account-store-resolver";
import {
  waitForPostContinueExportSurface,
  type PostContinueStabilizeDeps,
} from "./post-continue-stabilize";
import { haltForVerdict } from "./session-halt";
import type { SessionVerdict } from "./session-verdict";

/**
 * Pre-step for the same-session CAPTURE path: resolve a `RECONNECT_REQUIRED`
 * reconnect-continue screen — when, and ONLY when, every guard holds — before the
 * existing strict export gate (`decideCaptureGate`) ever runs.
 *
 * Why this exists: a cold launch on the review route lands on the Commerce
 * reconnect-continue interstitial (`RECONNECT_REQUIRED`), so the export click →
 * download → upload leg has only ever run after a human manually clears it. The
 * guarded continue boundary (`continueAtCardOnce`, validated in its own slice)
 * performs exactly ONE structurally-verified click on the proven safe control and
 * reports the settled post-click state. This helper is the thin orchestration that
 * decides whether to invoke that boundary at all and translates its result into a
 * proceed/halt decision the capture CLI can act on.
 *
 * HARD INVARIANTS:
 *   - `LOGGED_IN` short-circuits — the continue boundary is NEVER invoked, so the
 *     existing LOGGED_IN capture path is byte-for-byte unchanged and needs no new env.
 *   - The continue prerequisites (continue-card fingerprint + salt) are required
 *     LAZILY, only on the `RECONNECT_REQUIRED` branch. Missing → HALT, no click.
 *   - Continue success is NOT collection success. A `RESOLVED_PROCEED` only means the
 *     page is now a logged-in export surface; the independent `decideCaptureGate`
 *     still governs whether the export click happens.
 *   - A CONTINUED click whose post-click read is weak/unstable (a briefly-visible
 *     review-ready surface read as UNKNOWN / LAYOUT_UNRECOGNIZED before hydration
 *     settled) is NOT trusted: a READ-ONLY stabilization waits until the page is truly
 *     a logged-in actionable sync export surface, or HALTS honestly on timeout. It
 *     never re-clicks continue and never clicks/export/upload/writes status.
 *   - Every non-proceed branch HALTS honestly with a content-free state/detail and
 *     never clicks (and never re-clicks). All fields are enums/booleans — no PII.
 */

export interface ReconnectResolveDeps {
  /** Channel/store identity the resolver matches against (`{ expectedChannelCode, expectedStoreFingerprint? }`). */
  expected: ExpectedIdentity;
  /** `STORAGE_PROBE_SALT` — required only on the reconnect branch (the resolver fingerprints with it). */
  salt?: string;
  /** Expected continuation-card fingerprint (`{ expectedCardFingerprint? }`). */
  expectedContinueCard: ExpectedContinueCard;
  /** Whether the expected continue-card fingerprint is configured (`!!cfg.naverExpectedContinueCardFingerprint`). */
  fingerprintConfigured: boolean;
  /**
   * Read-only post-continue stabilization config (settle/verdict/export-plan readers +
   * timeouts), wired live at the CLI. Used ONLY when the continue advances but its own
   * post-click read is weak/unstable — never clicks, exports, or writes anything.
   */
  stabilize: PostContinueStabilizeDeps;
}

export type ReconnectDecision = "PROCEED_LOGGED_IN" | "RESOLVED_PROCEED" | "HALT";

export interface ReconnectResolution {
  decision: ReconnectDecision;
  /** `LOGGED_IN` on either PROCEED kind; the pre-step verdict otherwise. */
  resolvedVerdict: SessionVerdict;
  /** Present only when the continue boundary was actually invoked. */
  continueOutcome?: ContinueOutcome;
  /** Mirrors `ContinueResult.postClick.reachedExportSurface` — present only when continue ran. */
  reachedExportSurface?: boolean;
  /** Present only when `decision === "HALT"`. */
  halt?: { state: CollectorState; detail: string };
}

/** The continue boundary's signature — injectable so the helper is fully offline-testable. */
export type ContinueFn = typeof continueAtCardOnce;

/** The post-continue stabilization signature — injectable so the helper is fully offline-testable. */
export type StabilizeFn = typeof waitForPostContinueExportSurface;

/**
 * Resolve a reconnect-continue screen if (and only if) needed and safe, returning a
 * proceed/halt decision for the capture CLI. See the module doc for the invariants.
 *
 * `continueFn` defaults to the real `continueAtCardOnce`; tests inject a spy to assert
 * the LOGGED_IN path never calls it and the reconnect path calls it exactly once.
 */
export async function resolveReconnectIfNeeded(
  page: Page,
  ctx: BrowserContext,
  verdict: SessionVerdict,
  deps: ReconnectResolveDeps,
  continueFn: ContinueFn = continueAtCardOnce,
  stabilizeFn: StabilizeFn = waitForPostContinueExportSurface,
): Promise<ReconnectResolution> {
  // 1) Already usable — never touch the continue boundary; the existing capture path takes over.
  if (verdict === "LOGGED_IN") {
    return { decision: "PROCEED_LOGGED_IN", resolvedVerdict: "LOGGED_IN" };
  }

  // 2) The only auto-resolvable non-LOGGED_IN verdict is the Commerce reconnect-continue screen.
  if (verdict === "RECONNECT_REQUIRED") {
    // Lazy fail-closed: the fingerprint gates the whole click; without it nothing is attempted.
    if (!deps.fingerprintConfigured) {
      return halt("RECONNECT_REQUIRED", "reconnect: continue fingerprint not configured; not attempted", verdict);
    }
    if (!deps.salt) {
      return halt("RECONNECT_REQUIRED", "reconnect: continue salt not configured; not attempted", verdict);
    }

    // Delegate the single guarded click to the validated boundary — its own gate may still refuse.
    const result = await continueFn(page, ctx, deps.expected, deps.salt, deps.expectedContinueCard);
    const post = result.postClick;

    // A gate refusal / clicked-but-not-CONTINUED never reaches stabilization: HALT honestly,
    // keyed on the post-click verdict (or the reconnect verdict when the gate never clicked).
    if (result.outcome !== "CONTINUED") {
      const halted = haltForVerdict(post?.verdict ?? "RECONNECT_REQUIRED");
      return {
        decision: "HALT",
        resolvedVerdict: post?.verdict ?? verdict,
        continueOutcome: result.outcome,
        reachedExportSurface: post?.reachedExportSurface === true,
        halt: { state: halted.state, detail: `reconnect: continue ${result.outcome}; not collection` },
      };
    }

    // CONTINUED + already strongly ready (LOGGED_IN + actionable export surface): proceed at once,
    // no extra waiting — the continue's own post-click read already proved the surface.
    if (post?.verdict === "LOGGED_IN" && post.reachedExportSurface === true) {
      return {
        decision: "RESOLVED_PROCEED",
        resolvedVerdict: "LOGGED_IN",
        continueOutcome: "CONTINUED",
        reachedExportSurface: true,
      };
    }

    // CONTINUED but the post-click read is weak/unstable (a briefly-visible review-ready surface
    // read as UNKNOWN / LAYOUT_UNRECOGNIZED before hydration finished). Settle READ-ONLY until the
    // page is truly a logged-in actionable sync export surface — never re-clicking continue.
    const stab = await stabilizeFn(page as unknown as PwPage, deps.stabilize);
    if (stab.kind === "READY") {
      return {
        decision: "RESOLVED_PROCEED",
        resolvedVerdict: "LOGGED_IN",
        continueOutcome: "CONTINUED",
        reachedExportSurface: true,
      };
    }

    // It continued but never stabilized into a usable export surface within the window: HALT
    // honestly, keyed on the last stabilization verdict. No re-click, no export.
    const halted = haltForVerdict(stab.verdict);
    return {
      decision: "HALT",
      resolvedVerdict: stab.verdict,
      continueOutcome: "CONTINUED",
      reachedExportSurface: false,
      halt: {
        state: halted.state,
        detail: "reconnect: continued but export surface did not stabilize; not collection",
      },
    };
  }

  // 3) Login / auth-challenge / unknown — never auto-resolved; defer to the five-state halt mapping.
  const halted = haltForVerdict(verdict);
  return halt(halted.state, `reconnect: ${halted.detail}`, verdict);
}

/** Build a HALT resolution with a content-free state/detail. */
function halt(state: CollectorState, detail: string, verdict: SessionVerdict): ReconnectResolution {
  return { decision: "HALT", resolvedVerdict: verdict, halt: { state, detail } };
}
