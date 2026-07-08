/**
 * Overlay renderer (R1). Mounts a spotlight + step badge + minimal instruction over the real target
 * on the synthetic page. CRITICAL: the overlay uses `pointer-events:none`, so it can NEVER intercept
 * the user's click on the target. Runtime owns geometry / positioning / mount-unmount; it does not
 * recreate the Product Shell design system, and it never clicks.
 */
import type { Page } from "playwright";

export interface OverlayOptions {
  stepNumber: number;
  totalSteps: number;
  instruction: string;
  guidanceEnabled: boolean;
}

const OVERLAY_ID = "__aw_overlay__";

export async function mountOverlay(page: Page, opts: OverlayOptions): Promise<void> {
  await page.evaluate((o) => {
    const target = document.querySelector("[data-aw-target]");
    const prev = document.getElementById("__aw_overlay__");
    if (prev) prev.remove();
    if (!target) return;
    const rect = (target as Element).getBoundingClientRect();
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
      `left:${rect.left - 6}px`,
      `top:${rect.top - 6}px`,
      `width:${rect.width + 12}px`,
      `height:${rect.height + 12}px`,
      o.guidanceEnabled ? "display:block" : "display:none",
    ].join(";");
    const badge = document.createElement("div");
    badge.setAttribute("data-aw-badge", "");
    badge.textContent = `${o.stepNumber}/${o.totalSteps} · ${o.instruction}`;
    badge.style.cssText = "position:absolute;left:0;top:-28px;background:#2b6cff;color:#fff;font:12px system-ui;padding:2px 8px;border-radius:4px;white-space:nowrap";
    box.appendChild(badge);
    document.body.appendChild(box);
  }, opts);
}

/** Recompute the overlay position after layout movement. */
export async function refreshOverlay(page: Page): Promise<void> {
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

export async function setOverlayGuidance(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate((en) => {
    const box = document.getElementById("__aw_overlay__");
    if (box) box.style.display = en ? "block" : "none";
  }, enabled);
}

export async function unmountOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const box = document.getElementById("__aw_overlay__");
    if (box) box.remove();
  });
}

/** Test/QA helper: is the overlay currently mounted? (sanitized boolean) */
export async function overlayMounted(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.getElementById("__aw_overlay__"));
}

/** Test/QA helper: overlay top offset (px) — used only to prove repositioning, never in the contract. */
export async function overlayTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const box = document.getElementById("__aw_overlay__");
    return box ? Math.round(box.getBoundingClientRect().top) : -1;
  });
}

export { OVERLAY_ID };
