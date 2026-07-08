/**
 * Synthetic target locator (R1). Reads the fixture surface and returns a sanitized result only:
 * a candidate COUNT and, when exactly one, an opaque 16-hex signature computed IN-PAGE. It never
 * returns a selector, attribute, or raw text, and it never clicks. Zero/one/many are distinguished
 * so the engine can fail closed on ambiguity.
 */
import type { Page } from "playwright";
import { IN_PAGE_SIG_FACTORY, SURFACE_SELECTOR } from "./signature";
import type { LocateResult } from "./engine";

/** Is the opened page the expected seller-center surface? */
export async function surfaceIsValid(page: Page): Promise<boolean> {
  return page.evaluate((sel) => !!document.querySelector(sel), SURFACE_SELECTOR);
}

export async function locateTarget(page: Page): Promise<LocateResult> {
  return page.evaluate((factorySrc): { count: number; sig?: string } => {
    const sig = new Function("return " + factorySrc)() as (r: string, l: string) => string;
    const els = Array.from(document.querySelectorAll("[data-aw-target]"));
    if (els.length !== 1) return { count: els.length };
    const el = els[0]!;
    const role = el.getAttribute("data-aw-role") ?? "";
    const label = el.getAttribute("data-aw-label") ?? "";
    return { count: 1, sig: sig(role, label) };
  }, IN_PAGE_SIG_FACTORY);
}
