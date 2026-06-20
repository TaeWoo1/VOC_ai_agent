import type { PwPage } from "../profile";
import type { HydrationWaitResult } from "./session-probe";

/**
 * Bounded, READ-ONLY SPA-hydration wait — the seam between navigating to the review
 * route and reading the session verdict.
 *
 * Why it exists: the full-capture discovery path navigates with `domcontentloaded` and
 * then reads the session immediately. The SmartStore review route is a client-rendered
 * SPA, so on a cold programmatic navigation the strong logged-in signals (menu/GNB,
 * logout, export controls) are not in the DOM yet — the verdict reads `UNKNOWN` and the
 * run safe-halts even though the session is valid (proven by the human-paced no-click
 * probe). This gives the page a bounded chance to hydrate first.
 *
 * It waits for the ONE generic hydration signal the diagnostic probe already uses — the
 * SPA root (`#app/#root/#__next/[data-reactroot]`) having children — NOT for any
 * login/menu/export marker (that marker logic lives once in the pure verdict classifier;
 * duplicating it here as in-browser selectors would fork it). After the wait the existing
 * classifier reads the now-rendered HTML.
 *
 * SAFETY: this NEVER clicks, navigates, fills, or waits for a download — it only awaits a
 * browser-evaluated DOM predicate. It cannot change the verdict: it only lets the page
 * render before it is read. On timeout/error (or when the page surface has no
 * `waitForFunction`, e.g. an offline unit fake) it returns the coarse result and the
 * caller reads whatever rendered — so a stuck/unhydrated page degrades to today's safe
 * behavior (`UNKNOWN` → `SESSION_EXPIRED`, no click). A timeout NEVER upgrades the verdict.
 */

/** Default budget for the hydration wait (matches the same-session probes' convention). */
export const HYDRATION_TIMEOUT_MS = 15_000;

export async function waitForSpaHydration(
  page: PwPage,
  opts: { timeoutMs?: number } = {},
): Promise<HydrationWaitResult> {
  // Offline / unit-fake page surfaces omit the live method → nothing to wait on.
  if (typeof page.waitForFunction !== "function") return "not-attempted";
  try {
    await page.waitForFunction(
      () => {
        const root = document.querySelector("#app, #root, #__next, [data-reactroot]");
        return !!root && root.childElementCount > 0;
      },
      undefined,
      { timeout: opts.timeoutMs ?? HYDRATION_TIMEOUT_MS },
    );
    return "hydrated";
  } catch (error) {
    // Playwright raises a named TimeoutError when the predicate never settles; anything
    // else (navigation/detach) is a genuine error. Either way the caller proceeds safely.
    return error instanceof Error && error.name === "TimeoutError" ? "timeout" : "error";
  }
}
