/**
 * Overlay renderer (R1). Mounts a spotlight + step badge + minimal instruction over the real target
 * on the synthetic page. CRITICAL: the overlay uses `pointer-events:none`, so it can NEVER intercept
 * the user's click on the target. Runtime owns geometry / positioning / mount-unmount; it does not
 * recreate the Product Shell design system, and it never clicks.
 */
import type { Frame, Page } from "playwright";

/**
 * `Page | Frame`: the overlay only calls `.evaluate`, which a `Frame` exposes identically to a `Page`.
 * Accepting either lets the live driver mount the spotlight inside the exact frame that hosts the export
 * control (an iframe/SPA surface). Every existing caller passes a `Page` (assignable), so no behavior
 * changes for the top-document case.
 */
type PageOrFrame = Page | Frame;

export interface OverlayOptions {
  stepNumber: number;
  totalSteps: number;
  /** Semantic copy key (diagnostic badge label) — Runtime renders no final user prose. */
  copyKey: string;
  /**
   * Optional operator-legible label for the headed diagnostic badge. When a caller (the headed
   * live/CLI run, which has no product FE) supplies it, the badge shows this instead of the raw
   * dotted `copyKey`. It is a diagnostic aid on a dev-only overlay, NOT the product FE's localized
   * copy — that mapping still belongs to the FE. Absent ⇒ the badge falls back to `copyKey`.
   */
  label?: string;
  guidanceEnabled: boolean;
}

const OVERLAY_ID = "__aw_overlay__";

/**
 * How many EXTRA times a mount `evaluate` is retried when it throws a transient navigation error (the SPA
 * destroyed the execution context under it — the NAVER app-detail case). Small: a page that keeps destroying
 * the context on every mount is a genuine fault the caller's own recovery must handle, not this cosmetic layer.
 */
const MOUNT_EVAL_RETRIES = 2;
const MOUNT_EVAL_GAP_MS = 150;

/**
 * A transient SPA navigation error under an `evaluate` — the execution context was destroyed / the frame
 * detached mid-call because the single-page app soft-navigated. Detected by MESSAGE substring only (Playwright
 * gives these a generic `Error` name, so the name cannot distinguish them). Read for control flow only — never
 * logged or emitted, so no page content leaks.
 */
function isTransientNavError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : "";
  return (
    msg.includes("Execution context was destroyed") ||
    msg.includes("context was destroyed") ||
    msg.includes("frame was detached") ||
    msg.includes("Frame was detached") ||
    msg.includes("Target closed") ||
    msg.includes("Target page, context or browser has been closed")
  );
}

const overlaySleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run one overlay `evaluate` (passed as a thunk) SPA-safely: on a transient navigation error (context destroyed
 * / frame detached), pause briefly and retry — bounded by {@link MOUNT_EVAL_RETRIES}. A non-transient error
 * propagates immediately; if every retry still hits the transient error, the last one propagates so the caller's
 * own recovery can react. Re-runs the SAME `evaluate` on the SAME page/frame — the caller (e.g. the issuance
 * driver) owns re-resolving a NEW active page/frame and re-tagging the target, so a full re-render is recovered
 * one level up, not masked here. A thunk (not a `(page, fn, arg)` helper) keeps Playwright's `evaluate` overload
 * inference intact for the inline page-function.
 */
async function runEvaluateResilient(run: () => Promise<unknown>): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MOUNT_EVAL_RETRIES; attempt++) {
    try {
      await run();
      return;
    } catch (e) {
      lastErr = e;
      if (isTransientNavError(e) && attempt < MOUNT_EVAL_RETRIES) {
        await overlaySleep(MOUNT_EVAL_GAP_MS);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export async function mountOverlay(page: PageOrFrame, opts: OverlayOptions): Promise<void> {
  await runEvaluateResilient(() => page.evaluate((o) => {
    const target = document.querySelector("[data-aw-target]");
    const prev = document.getElementById("__aw_overlay__");
    if (prev) prev.remove();
    // Clean any stale in-page tracker before re-mounting so listeners never accumulate.
    const stale = (window as unknown as Record<string, unknown>)["__aw_overlay_untrack__"];
    if (typeof stale === "function") (stale as () => void)();
    if (!target) return;
    // Run 7 attempt-3 finding: a target below the fold got a fixed overlay drawn OFF-SCREEN, so the
    // seated operator saw no highlight. Bring the control into view FIRST (read-only — scrolling is
    // not a click), then position over it. `block:"center"` keeps a comfortable margin around it.
    (target as Element).scrollIntoView({ block: "center", inline: "center" });
    const box = document.createElement("div");
    box.id = "__aw_overlay__";
    box.setAttribute("aria-hidden", "true");
    box.style.cssText = [
      "position:fixed",
      "pointer-events:none", // never intercept the target click
      "z-index:2147483000",
      "box-sizing:border-box",
      "border:3px solid #2b6cff",
      "border-radius:8px",
      "box-shadow:0 0 0 9999px rgba(0,0,0,0.28)",
      o.guidanceEnabled ? "display:block" : "display:none",
    ].join(";");
    const badge = document.createElement("div");
    badge.setAttribute("data-aw-badge", "");
    badge.textContent = `${o.stepNumber}/${o.totalSteps} · ${o.label ?? o.copyKey}`;
    badge.style.cssText = "position:absolute;left:0;top:-28px;background:#2b6cff;color:#fff;font:12px system-ui;padding:2px 8px;border-radius:4px;white-space:nowrap";
    box.appendChild(badge);
    document.body.appendChild(box);
    // Glue the box to the control's live position. A `position:fixed` box uses viewport coordinates,
    // so it must be recomputed on every scroll/resize or it drifts off the control the moment the
    // operator scrolls — the other half of the same finding. The tracker recomputes from the target's
    // own getBoundingClientRect (read-only) and is torn down by unmountOverlay / the next mount.
    const reposition = () => {
      const el = document.querySelector("[data-aw-target]");
      const b = document.getElementById("__aw_overlay__");
      if (!el || !b) return;
      const r = (el as Element).getBoundingClientRect();
      b.style.left = `${r.left - 6}px`;
      b.style.top = `${r.top - 6}px`;
      b.style.width = `${r.width + 12}px`;
      b.style.height = `${r.height + 12}px`;
    };
    reposition();
    // `capture:true` catches scrolls on any nested scroller, not just the window.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    (window as unknown as Record<string, unknown>)["__aw_overlay_untrack__"] = () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      delete (window as unknown as Record<string, unknown>)["__aw_overlay_untrack__"];
    };
  }, opts));
}

/** Recompute the overlay position after layout movement. */
export async function refreshOverlay(page: PageOrFrame): Promise<void> {
  await page.evaluate(() => {
    const box = document.getElementById("__aw_overlay__");
    const target = document.querySelector("[data-aw-target]");
    if (!box || !target) return;
    const rect = (target as Element).getBoundingClientRect();
    box.style.left = `${rect.left - 6}px`;
    box.style.top = `${rect.top - 6}px`;
    box.style.width = `${rect.width + 12}px`;
    box.style.height = `${rect.height + 12}px`;
  });
}

export async function setOverlayGuidance(page: PageOrFrame, enabled: boolean): Promise<void> {
  await page.evaluate((en) => {
    const box = document.getElementById("__aw_overlay__");
    if (box) box.style.display = en ? "block" : "none";
  }, enabled);
}

export async function unmountOverlay(page: PageOrFrame): Promise<void> {
  await page.evaluate(() => {
    const untrack = (window as unknown as Record<string, unknown>)["__aw_overlay_untrack__"];
    if (typeof untrack === "function") (untrack as () => void)();
    const box = document.getElementById("__aw_overlay__");
    if (box) box.remove();
  });
}

/** Test/QA helper: is the overlay currently mounted? (sanitized boolean) */
export async function overlayMounted(page: PageOrFrame): Promise<boolean> {
  return page.evaluate(() => !!document.getElementById("__aw_overlay__"));
}

/** Test/QA helper: overlay top offset (px) — used only to prove repositioning, never in the contract. */
export async function overlayTop(page: PageOrFrame): Promise<number> {
  return page.evaluate(() => {
    const box = document.getElementById("__aw_overlay__");
    return box ? Math.round(box.getBoundingClientRect().top) : -1;
  });
}

export { OVERLAY_ID };
