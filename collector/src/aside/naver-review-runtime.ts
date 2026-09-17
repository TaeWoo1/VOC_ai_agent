/**
 * **The program that runs INSIDE Aside's browser for an unattended NAVER Seller Center 리뷰 read — one function,
 * shipped by `toString()`.** The NAVER sibling of `coupang-review-runtime.ts`, and it keeps that file's rule: it
 * forwards page scripts that arrive on the plan and never composes page code of its own. The scripts are authored
 * and unit-tested in `src/naver/review-list-observe-inpage.ts` and
 * `src/action-window/reply-submission/review-list-range-inpage.ts` (the live-proven range census).
 *
 * **What it does, and all it does:** open the one route on the plan, wait for the grid to finish drawing, read the
 * rows, read the period, close the tab. Nothing is clicked, typed, filled, scrolled, focused, downloaded or
 * navigated to after the entry URL. Waiting for a page to draw is not an action on it: the program re-evaluates the
 * SAME reader on a timer until two consecutive readings agree, bounded by the plan's settle time.
 *
 * **Order:** sign-in wall first, then the grid, then the period. A signed-out browser never reaches a row, and a
 * sign-in wall is a stop — never a thing to type into.
 *
 * No closure. Nothing here may reference an import or a module-level identifier. Plain JavaScript only.
 */

export interface NaverReviewRuntimeTabLike {
  evaluate<T = unknown>(script: string): Promise<T>;
  waitForLoadState?(state?: string, opts?: { timeout?: number }): Promise<void>;
}

export interface NaverReviewRuntimeEnv {
  openTab(url: string): Promise<NaverReviewRuntimeTabLike>;
  closeTab(tab: NaverReviewRuntimeTabLike): Promise<void>;
  /** A plain timer, supplied by the program text. */
  wait(ms: number): Promise<void>;
}

export interface NaverReviewRuntimePlan {
  entryUrl: string;
  authScript: string;
  readerScript: string;
  rangeScript: string;
  settleTimeoutMs: number;
  pollMs: number;
}

export type NaverReviewRuntimeResult =
  | { ok: true; reading: unknown; range: unknown; elapsedMs: number }
  | {
      ok: false;
      code: "AUTH_REQUIRED" | "UNSUPPORTED_STATE" | "READ_UNSETTLED" | "RUNTIME_FAULT";
      stage: "PREPARE" | "AUTH" | "READ" | "RANGE";
      reason: string | null;
      elapsedMs: number;
    };

export async function asideNaverReviewRuntime(
  plan: NaverReviewRuntimePlan,
  env: NaverReviewRuntimeEnv,
): Promise<NaverReviewRuntimeResult> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const fail = (
    code: "AUTH_REQUIRED" | "UNSUPPORTED_STATE" | "READ_UNSETTLED" | "RUNTIME_FAULT",
    stage: "PREPARE" | "AUTH" | "READ" | "RANGE",
    reason: string | null,
  ): NaverReviewRuntimeResult => ({ ok: false, code, stage, reason, elapsedMs: elapsed() });

  let tab: NaverReviewRuntimeTabLike | null = null;
  try {
    try {
      tab = await env.openTab(plan.entryUrl);
    } catch (e) {
      return fail("UNSUPPORTED_STATE", "PREPARE", null);
    }
    const opened = tab;
    if (typeof opened.waitForLoadState === "function") {
      try {
        await opened.waitForLoadState("networkidle", { timeout: plan.settleTimeoutMs });
      } catch (e) {
        /* best-effort: the readings below decide, not a timer */
      }
    }

    let signedIn = false;
    let lastReason: string | null = null;
    let previousCount = -1;
    let settled: unknown = null;
    while (elapsed() < plan.settleTimeoutMs) {
      let auth: { signedIn?: boolean } | null = null;
      try {
        auth = await opened.evaluate(plan.authScript);
      } catch (e) {
        return fail("RUNTIME_FAULT", "AUTH", null);
      }
      signedIn = !!auth && auth.signedIn === true;
      if (signedIn) {
        let reading: { reason?: string; rowCount?: number; loaded?: number } | null = null;
        try {
          reading = await opened.evaluate(plan.readerScript);
        } catch (e) {
          return fail("RUNTIME_FAULT", "READ", null);
        }
        lastReason = reading && typeof reading.reason === "string" ? reading.reason : null;
        if (reading && reading.reason === "OK" && typeof reading.rowCount === "number"
            && reading.rowCount === reading.loaded) {
          if (reading.rowCount === previousCount) {
            settled = reading;
            break;
          }
          previousCount = reading.rowCount;
        } else if (lastReason === "ROUTE_MISMATCH" || lastReason === "ID_LINK_MISMATCH"
            || lastReason === "MODEL_SHAPE_CHANGED" || lastReason === "TOO_MANY_ROWS") {
          // Not a page still drawing — a page whose meaning is not the one this reader was built for.
          return fail("UNSUPPORTED_STATE", "READ", lastReason);
        } else {
          previousCount = -1;
        }
      }
      await env.wait(plan.pollMs);
    }
    if (!signedIn) return fail("AUTH_REQUIRED", "AUTH", null);
    if (settled === null) return fail("READ_UNSETTLED", "READ", lastReason);

    let range: unknown = null;
    try {
      range = await opened.evaluate(plan.rangeScript);
    } catch (e) {
      return fail("RUNTIME_FAULT", "RANGE", null);
    }
    return { ok: true, reading: settled, range, elapsedMs: elapsed() };
  } finally {
    if (tab !== null) {
      try {
        await env.closeTab(tab);
      } catch (e) {
        /* a tab that will not close is not a failed read */
      }
    }
  }
}
