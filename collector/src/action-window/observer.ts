/**
 * User-action observer (R1). Arms an in-page listener that records ONLY a sanitized boolean when the
 * real user (or, in tests, a test-driver) clicks the target. The Runtime NEVER calls click() — it
 * only reads the observation flag. A click alone does not complete the step; verification does.
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
    (window as unknown as Record<string, unknown>)["__aw_observed__"] = false;
    const target = document.querySelector("[data-aw-target]");
    if (!target) return;
    const handler = () => {
      (window as unknown as Record<string, unknown>)["__aw_observed__"] = true;
    };
    (window as unknown as Record<string, unknown>)["__aw_observer_handler__"] = handler;
    target.addEventListener("click", handler, { once: false });
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
    const target = document.querySelector("[data-aw-target]");
    const handler = w["__aw_observer_handler__"];
    if (target && typeof handler === "function") target.removeEventListener("click", handler as EventListener);
    delete w["__aw_observer_handler__"];
    delete w["__aw_observed__"];
  });
}

export { OBSERVED_FLAG };
