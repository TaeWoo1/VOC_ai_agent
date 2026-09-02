/**
 * User-action observer (R1). Arms an in-page listener that records ONLY a sanitized boolean when the
 * real user (or, in tests, a test-driver) clicks the target. The Runtime NEVER calls click() — it
 * only reads the observation flag. A click alone does not complete the step; verification does.
 *
 * **Every tagged control, not the first one** (2026-09-02). `document.querySelector` watched exactly one
 * `[data-aw-target]`, which was right while a step could only ever ring one control. It stopped being right
 * when the export locate found TWO real controls on the live NAVER review surface: the overlay already rings
 * every tagged element (`overlay.ts` uses `querySelectorAll`), so the seller saw two rings and a listener on
 * one of them. Watching all of them is what makes "press whichever of these is yours" observable — and it
 * changes nothing for a single-target step, which is every other step in every runtime.
 */
import type { Frame, Page } from "playwright";

const OBSERVED_FLAG = "__aw_observed__";

/**
 * The overlay/observer only ever call `.evaluate` / `.waitForFunction`, which a Playwright `Frame`
 * exposes identically to a `Page`. Accepting `Page | Frame` lets the live driver arm observation in the
 * exact frame that hosts the export control (an iframe/SPA surface), not only the top document. Every
 * existing caller passes a `Page`, which is assignable, so this widening changes no current behavior.
 */
type PageOrFrame = Page | Frame;

export async function armObserver(page: PageOrFrame): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    // **Never un-see a click.** Re-arming used to reset the flag unconditionally, so a press that landed in
    // the gap between an observation window expiring and the next arm was erased — and at the export barrier
    // that is the press that produces the file. Only initialise what has not already been observed.
    if (w["__aw_observed__"] !== true) w["__aw_observed__"] = false;
    const targets = document.querySelectorAll("[data-aw-target]");
    if (targets.length === 0) return;
    const handler = () => {
      (window as unknown as Record<string, unknown>)["__aw_observed__"] = true;
    };
    (window as unknown as Record<string, unknown>)["__aw_observer_handler__"] = handler;
    targets.forEach((target) => target.addEventListener("click", handler, { once: false }));
  });
}

/** Poll for the observation flag. Returns true if a user action was observed before the timeout. */
export async function waitForUserAction(page: PageOrFrame, opts?: { timeoutMs?: number; pollMs?: number }): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const pollMs = opts?.pollMs ?? 100;
  // Poll via Playwright's waitForFunction (no Runtime click — just observation of the flag).
  try {
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>)["__aw_observed__"] === true,
      undefined,
      { timeout: timeoutMs, polling: pollMs },
    );
    return true;
  } catch {
    return false;
  }
}

export async function isObserved(page: PageOrFrame): Promise<boolean> {
  return page.evaluate(() => (window as unknown as Record<string, unknown>)["__aw_observed__"] === true);
}

export async function disarmObserver(page: PageOrFrame): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const targets = document.querySelectorAll("[data-aw-target]");
    const handler = w["__aw_observer_handler__"];
    if (typeof handler === "function") {
      targets.forEach((target) => target.removeEventListener("click", handler as EventListener));
    }
    delete w["__aw_observer_handler__"];
    delete w["__aw_observed__"];
  });
}

export { OBSERVED_FLAG };
