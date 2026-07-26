/**
 * **The SellerOps guidance panel, inside the marketplace page.**
 *
 * ## Why guidance had to move here
 *
 * Until now a guided run said what it wanted in the SellerOps window and highlighted a control in the
 * marketplace window. The seller works in the marketplace window. On the 2026-07-25 live run the scope gate
 * stopped the run and said so correctly — in the tab nobody was looking at — while a stale highlight sat on
 * the date field the seller had already left, so they kept changing a date no barrier was watching. Product
 * decision (2026-07-26): after one start in SellerOps, everything the seller needs is in the SmartStore
 * screen, and they come back only when it is done.
 *
 * ## Three properties this module is built around
 *
 *  1. **It authors no words.** Every string it renders arrives in {@link GuidancePanelState}, assembled by
 *     `guidance-copy.ts` from the frontend's own pack. There is no default sentence, no fallback prose, and
 *     no Hangul in this file — `guidance-panel-purity.test.ts` asserts that, so contract §6 (the FE owns all
 *     copy) is structural here rather than remembered.
 *  2. **It clicks nothing on the marketplace.** The panel's own buttons set a flag in the page; the driver
 *     reads it and the session either hands it to the engine as an ordinary operator command or forwards it to
 *     the frontend as an intent. They are SellerOps controls the seller presses, exactly like a barrier the
 *     seller satisfies — the runtime still never presses a platform control, and `REQUEST_STEP_RECHECK` still
 *     only means "look again".
 *  3. **It never covers the control it is talking about.** The spotlight
 *     ({@link import("./overlay").mountOverlay}) keeps `pointer-events: none` so it can never intercept the
 *     seller's click. This panel DOES take pointer events — it has buttons — so it is pinned to a corner,
 *     away from the highlighted target, and it is the only element here that is interactive.
 */
import type { Frame, Page } from "playwright";

/** Only `.evaluate` is used, which a `Frame` exposes identically to a `Page` (same rule as the overlay). */
type PageOrFrame = Page | Frame;

/**
 * One control the panel offers.
 *
 * `command` is either a v2 `CommandType` the Runtime applies to the run it is hosting, or a guidance INTENT the
 * Runtime forwards to the frontend because it cannot act on it alone (`CONTINUE_NEXT_SEGMENT` needs a ticket only
 * the backend mints). This module does not know or care which: it renders a labelled button and reports the press.
 * The routing decision belongs to `guidance-copy.ts` and `import-session.ts`, which is where the two closed sets
 * live.
 */
export interface GuidancePanelAction {
  command: string;
  label: string;
}

/**
 * Everything the panel shows, fully resolved.
 *
 * Every field is final text. Nothing here is a key, a template, or an enum the panel would have to interpret
 * — interpretation happens in `guidance-copy.ts`, so this module cannot invent meaning even by accident.
 */
export interface GuidancePanelState {
  /** The product label, so the seller can tell our panel from the marketplace's own UI. */
  product: string;
  /** e.g. the step counter line. Empty string ⇒ the line is omitted. */
  stepLine: string;
  /** What to do now. Empty ⇒ omitted (the frontend's pack had no entry for this step). */
  instruction: string;
  /** The window this segment must cover. Empty ⇒ omitted. */
  requiredRange: string;
  /** Present only while the run is stopped: what is wrong, and the one thing that clears it. */
  blocked: { label: string; title: string; fix: string } | null;
  /**
   * Present only when the run has FINISHED: that it is done, and what comes next.
   *
   * A segment ending used to take the panel down, which meant the seller's next act was to find the SellerOps
   * tab — thirteen times for thirteen months. `line` is either the next window and how many are left, or the
   * whole-plan completion, and the frontend decided which before it ever reached this module.
   */
  completion: { doneLabel: string; line: string } | null;
  /**
   * Rendered from the runtime's `allowedCommands` alone while a run is live — never from what the panel assumes.
   * A finished run allows no commands at all, so the one control it can carry is a guidance intent.
   */
  actions: readonly GuidancePanelAction[];
}

const PANEL_ID = "__aw_guidance_panel__";
const INTENT_KEY = "__aw_guidance_intent__";

/**
 * Mount or update the panel. Idempotent: called after every published transition, so it replaces its own
 * content rather than accumulating panels.
 */
export async function mountGuidancePanel(page: PageOrFrame, state: GuidancePanelState): Promise<void> {
  await page.evaluate((s) => {
    const PANEL = "__aw_guidance_panel__";
    const INTENT = "__aw_guidance_intent__";
    const existing = document.getElementById(PANEL);
    const panel = existing ?? document.createElement("div");
    if (!existing) {
      panel.id = PANEL;
      // Bottom-LEFT on purpose. The spotlight scrolls its target into the viewport centre and the
      // marketplace's own primary controls sit right and top, so a left-bottom anchor is the corner least
      // likely to sit over anything the seller has to reach.
      panel.style.cssText = [
        "position:fixed",
        "left:16px",
        "bottom:16px",
        "z-index:2147483001", // one above the spotlight, so the dimming layer never greys the instructions
        "width:320px",
        "max-width:calc(100vw - 32px)",
        "box-sizing:border-box",
        "padding:14px 16px",
        "border-radius:12px",
        "background:#ffffff",
        "color:#111827",
        "box-shadow:0 8px 28px rgba(0,0,0,0.28)",
        "font:14px/1.55 system-ui,-apple-system,sans-serif",
        // The panel is interactive — it is the only element in this runtime that is. Everything the
        // spotlight draws stays pointer-transparent.
        "pointer-events:auto",
      ].join(";");
      panel.setAttribute("role", "status");
      document.body.appendChild(panel);
    }
    // Rebuilt from the state each time. Text goes in through textContent only: the strings are the
    // frontend's copy, and treating them as markup would make a copy change a script-injection surface.
    panel.textContent = "";

    const brand = document.createElement("div");
    brand.setAttribute("data-aw-panel-brand", "");
    brand.textContent = s.product;
    brand.style.cssText = "font-size:12px;font-weight:600;letter-spacing:0.02em;color:#2b6cff;margin-bottom:6px";
    panel.appendChild(brand);

    if (s.stepLine) {
      const step = document.createElement("div");
      step.setAttribute("data-aw-panel-step", "");
      step.textContent = s.stepLine;
      step.style.cssText = "font-size:12px;color:#6b7280;margin-bottom:4px";
      panel.appendChild(step);
    }
    if (s.instruction) {
      const line = document.createElement("div");
      line.setAttribute("data-aw-panel-instruction", "");
      line.textContent = s.instruction;
      line.style.cssText = "font-weight:600;word-break:keep-all";
      panel.appendChild(line);
    }
    if (s.requiredRange) {
      const range = document.createElement("div");
      range.setAttribute("data-aw-panel-range", "");
      range.textContent = s.requiredRange;
      range.style.cssText = "margin-top:4px;font-size:13px;color:#374151;word-break:keep-all";
      panel.appendChild(range);
    }
    if (s.blocked) {
      // A stopped run states the cause and the repair together. The 2026-07-25 run proved the cost of
      // splitting them across two windows: the seller cannot act on a reason they cannot see.
      const box = document.createElement("div");
      box.setAttribute("data-aw-panel-blocked", "");
      box.style.cssText =
        "margin-top:10px;padding:10px 12px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa";
      const label = document.createElement("div");
      label.textContent = s.blocked.label;
      label.style.cssText = "font-size:11px;font-weight:700;color:#b45309;letter-spacing:0.04em";
      const title = document.createElement("div");
      title.setAttribute("data-aw-panel-blocked-title", "");
      title.textContent = s.blocked.title;
      title.style.cssText = "margin-top:2px;font-weight:600;word-break:keep-all";
      const fix = document.createElement("div");
      fix.setAttribute("data-aw-panel-blocked-fix", "");
      fix.textContent = s.blocked.fix;
      fix.style.cssText = "margin-top:2px;font-size:13px;color:#374151;word-break:keep-all";
      box.appendChild(label);
      box.appendChild(title);
      box.appendChild(fix);
      panel.appendChild(box);
    }
    if (s.completion) {
      // Green rather than amber: a finished segment is the one panel state that is good news, and the seller has
      // to be able to tell "done, carry on" from "stopped, fix something" at a glance in someone else's UI.
      const box = document.createElement("div");
      box.setAttribute("data-aw-panel-completion", "");
      box.style.cssText =
        "margin-top:10px;padding:10px 12px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0";
      const label = document.createElement("div");
      label.textContent = s.completion.doneLabel;
      label.style.cssText = "font-size:11px;font-weight:700;color:#15803d;letter-spacing:0.04em";
      const line = document.createElement("div");
      line.setAttribute("data-aw-panel-completion-line", "");
      line.textContent = s.completion.line;
      line.style.cssText = "margin-top:2px;font-weight:600;word-break:keep-all";
      box.appendChild(label);
      box.appendChild(line);
      panel.appendChild(box);
    }
    if (s.actions.length > 0) {
      const row = document.createElement("div");
      row.setAttribute("data-aw-panel-actions", "");
      row.style.cssText = "margin-top:12px;display:flex;flex-wrap:wrap;gap:8px";
      for (const action of s.actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-aw-panel-action", action.command);
        button.textContent = action.label;
        button.style.cssText =
          "padding:8px 12px;border-radius:8px;border:1px solid #d1d5db;background:#f9fafb;color:#111827;font:inherit;font-weight:600;cursor:pointer";
        button.addEventListener("click", (event) => {
          // Stop it at the panel. A click that continued into the page could reach a marketplace control,
          // and this runtime never presses one.
          event.preventDefault();
          event.stopPropagation();
          (window as unknown as Record<string, unknown>)[INTENT] = action.command;
        });
        row.appendChild(button);
      }
      panel.appendChild(row);
    }
  }, state);
}

/**
 * Read and clear the seller's last panel press.
 *
 * Take-once, deliberately: an intent that stayed set would be re-applied on the next poll, so one press
 * would become a stream of rechecks. Returns null when they have pressed nothing.
 */
export async function takeGuidanceIntent(page: PageOrFrame): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const value = w["__aw_guidance_intent__"];
    w["__aw_guidance_intent__"] = undefined;
    return typeof value === "string" ? value : null;
  });
}

/** Remove the panel. Safe to call twice, and on a page that never had one. */
export async function unmountGuidancePanel(page: PageOrFrame): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w["__aw_guidance_intent__"] = undefined;
    const panel = document.getElementById("__aw_guidance_panel__");
    if (panel) panel.remove();
  });
}

/** Test/QA helper: is the panel mounted? (sanitized boolean) */
export async function guidancePanelMounted(page: PageOrFrame): Promise<boolean> {
  return page.evaluate(() => !!document.getElementById("__aw_guidance_panel__"));
}

export { PANEL_ID as GUIDANCE_PANEL_ID, INTENT_KEY as GUIDANCE_INTENT_KEY };
