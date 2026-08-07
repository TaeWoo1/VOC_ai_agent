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
  /**
   * Optional WING-RESIDENT guidance panel + advance affordance. When present, mountOverlay draws a
   * fixed-position guidance panel (product copy + a single advance button) SEPARATE from the
   * `pointer-events:none` spotlight ring, so the seller reads the guidance and advances the walk ON
   * the marketplace page itself — never bouncing back to the SellerOps tab to press "다음". Only the
   * panel button is interactive (`pointer-events:auto`); it can never sit over or intercept a WING
   * control. The button click sets an in-page value-free LATCH (`__aw_advance_pressed__ = token`) that
   * the driver polls with {@link readOverlayAdvancePressed}; the `token` is opaque and per-step so a
   * stale press from a prior step can never skip the next one. Absent ⇒ the classic ring+badge only
   * (the NAVER driver passes nothing, so its behavior is unchanged).
   */
  advance?: OverlayAdvance;
}

/** The WING-resident advance affordance (a labelled button + its opaque per-step latch token). */
export interface OverlayAdvance {
  /** The button caption the seller presses to advance (e.g. "다음", "발급 완료 · 다음"). */
  buttonLabel: string;
  /** Opaque per-step latch token — never a page value; only compared for equality. */
  token: string;
}

const ADVANCE_PANEL_ID = "__aw_advance_panel__";

const OVERLAY_ID = "__aw_overlay__";

/**
 * The mount IIFE stamps the sub-stage it is CURRENTLY in into the in-page global `"__aw_mount_stage__"` (inlined
 * as a literal at both the stamp and the read sites so no arg has to cross), so a mount fault can be localized to
 * the exact internal step it came from. Value-free — it only ever holds one of these fixed {@link MountSubStage}
 * enum strings, never any page content, selector, or value. Emitted so a SINGLE gated live diagnostic can name the
 * EXACT internal step a generic-`Error` mount fault came from — the `Overlay Root-Cause Isolation` unit pinned the
 * fault to the `mount` stage with `reason=OTHER`, but not to WHICH line inside the mount. These names carry no page data.
 *
 * Stamped in strict CODE ORDER (monotonic — each is set exactly once, as its region begins), so the last value
 * read back IS the furthest step the mount reached before throwing:
 *   - `find_tagged_target` — `querySelector([data-aw-target])` + the stale-overlay `getElementById` lookups.
 *   - `remove_previous`    — removing a stale overlay box + tearing down its stale scroll/resize tracker.
 *   - `reveal_target`      — `target.scrollIntoView(...)` (bringing the found control into view; a named suspect).
 *   - `create_overlay`     — creating the box + badge elements and their attributes.
 *   - `inject_style`       — assigning the box/badge inline `cssText`.
 *   - `append_overlay`     — `document.body.appendChild(box)` (the real DOM insertion).
 *   - `position_overlay`   — the first `reposition()` + wiring the scroll/resize listeners.
 *   - `unknown`            — no breadcrumb was readable: the IIFE succeeded (it CLEARS the breadcrumb on
 *                            completion — see {@link mountOverlay}), the read itself could not run (context
 *                            gone), or the fault rejected the `evaluate` BEFORE the body ran (a transient
 *                            soft-nav; the `reason` enum is authoritative in that case, not this hint).
 */
export type MountSubStage =
  | "find_tagged_target"
  | "remove_previous"
  | "reveal_target"
  | "create_overlay"
  | "inject_style"
  | "append_overlay"
  | "position_overlay"
  | "unknown";

/**
 * A FIXED, sanitized reason enum for an overlay-MOUNT fault, produced by CODE-BASED FINGERPRINT of the thrown
 * error's name + message — the message itself is NEVER returned or logged, only this closed enum. This is the
 * "classify first, before emitting any message" gate the mount-identification unit needs: a recognized cause maps
 * to a fixed reason so the raw message never has to leave; only a genuinely UNRECOGNIZED cause falls to
 * {@link sanitizeMountMessage}. Playwright/JS-engine fault messages carry framework text (API names, not page
 * content), but we still reduce them to this enum first.
 *   - `CONTEXT_DESTROYED` / `FRAME_DETACHED` / `TARGET_CLOSED` — the transient SPA soft-nav family.
 *   - `SYMBOL_NOT_DEFINED`   — "… is not defined" (e.g. an esbuild `__name` shim leaking into the page function).
 *   - `NULL_PROPERTY_ACCESS` — "Cannot read properties of null/undefined" (a missing DOM node under a step).
 *   - `NOT_A_FUNCTION`       — "… is not a function" (a call target that wasn't callable in the page).
 *   - `DOM_EXCEPTION`        — a DOMException (SecurityError / HierarchyRequestError / NotFoundError, …).
 *   - `TYPE_ERROR`           — a generic `TypeError` not matched by the more specific shapes above.
 *   - `UNKNOWN`              — no known fingerprint matched → the ONE case that may attach a sanitized message.
 */
export type MountFaultReason =
  | "CONTEXT_DESTROYED"
  | "FRAME_DETACHED"
  | "TARGET_CLOSED"
  | "SYMBOL_NOT_DEFINED"
  | "NULL_PROPERTY_ACCESS"
  | "NOT_A_FUNCTION"
  | "DOM_EXCEPTION"
  | "TYPE_ERROR"
  | "UNKNOWN";

/** Cap for a diagnostic mount message — long enough to identify a framework error shape, short enough to bound leak surface. */
const MAX_MOUNT_MESSAGE_LEN = 120;

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
    // Sub-stage breadcrumb: stamp the CURRENTLY-executing internal step into a window global BEFORE each step, so
    // that if a step throws (rejecting the whole `evaluate`), the caller can read back the last step entered and
    // localize the fault. Pure observation — a string assignment cannot throw and cannot alter the flow below.
    const G = window as unknown as Record<string, unknown>;
    G["__aw_mount_stage__"] = "find_tagged_target";
    const target = document.querySelector("[data-aw-target]");
    const prev = document.getElementById("__aw_overlay__");
    G["__aw_mount_stage__"] = "remove_previous";
    if (prev) prev.remove();
    // Clean any stale in-page tracker before re-mounting so listeners never accumulate.
    const stale = G["__aw_overlay_untrack__"];
    if (typeof stale === "function") (stale as () => void)();
    if (!target) {
      // Clear the breadcrumb: a stale value from a PRIOR mount must not be misread as this (no-op) mount's stage.
      delete G["__aw_mount_stage__"];
      return;
    }
    // Run 7 attempt-3 finding: a target below the fold got a fixed overlay drawn OFF-SCREEN, so the
    // seated operator saw no highlight. Bring the control into view FIRST (read-only — scrolling is
    // not a click), then position over it. `block:"center"` keeps a comfortable margin around it.
    G["__aw_mount_stage__"] = "reveal_target";
    (target as Element).scrollIntoView({ block: "center", inline: "center" });
    G["__aw_mount_stage__"] = "create_overlay";
    const box = document.createElement("div");
    box.id = "__aw_overlay__";
    box.setAttribute("aria-hidden", "true");
    G["__aw_mount_stage__"] = "inject_style";
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
    G["__aw_mount_stage__"] = "append_overlay";
    document.body.appendChild(box);
    G["__aw_mount_stage__"] = "position_overlay";
    // Glue the box to the control's live position. A `position:fixed` box uses viewport coordinates,
    // so it must be recomputed on every scroll/resize or it drifts off the control the moment the
    // operator scrolls — the other half of the same finding. The tracker recomputes from the target's
    // own getBoundingClientRect (read-only) and is torn down by unmountOverlay / the next mount.
    //
    // ⚠ The `[ … ][0]` array-index initializer is LOAD-BEARING, not a stylistic quirk. Under `tsx`/esbuild
    // (`keepNames`, the default), a plain `const reposition = () => {…}` compiles to
    // `const reposition = __name(() => {…}, "reposition")` to preserve `fn.name`. But `page.evaluate`
    // serializes only THIS function's BODY to the page — esbuild's module-scope `__name` helper is NOT
    // shipped — so that wrapper threw `ReferenceError: __name is not defined` here, which is EXACTLY the
    // live-confirmed `subStage: position_overlay` / `reason: SYMBOL_NOT_DEFINED` mount fault (`reposition`
    // was the only name-inferable closure in the mount IIFE). Wrapping the arrow in an array literal and
    // indexing it means the initializer is not a name-inferable binding, so esbuild emits NO `__name`
    // wrapper and the closure ships clean — while staying valid TypeScript (unlike a `(0, …)` sequence,
    // which tsc rejects with TS2695 "Left side of comma operator is unused and has no side effects").
    // `reposition` still needs a stable reference for
    // add/removeEventListener, so it cannot simply be inlined. (A transform-level regression test asserts
    // the shipped mountOverlay page body contains no `__name(`.)
    const reposition = [
      () => {
        const el = document.querySelector("[data-aw-target]");
        const b = document.getElementById("__aw_overlay__");
        if (!el || !b) return;
        const r = (el as Element).getBoundingClientRect();
        b.style.left = `${r.left - 6}px`;
        b.style.top = `${r.top - 6}px`;
        b.style.width = `${r.width + 12}px`;
        b.style.height = `${r.height + 12}px`;
      },
    ][0]!;
    reposition();
    // `capture:true` catches scrolls on any nested scroller, not just the window.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    (window as unknown as Record<string, unknown>)["__aw_overlay_untrack__"] = () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      delete (window as unknown as Record<string, unknown>)["__aw_overlay_untrack__"];
    };
    // WING-RESIDENT guidance panel + advance latch. Drawn as a SEPARATE fixed element from the ring, so the
    // interactive advance button (pointer-events:auto) can never overlap or intercept a WING control (the ring
    // stays pointer-events:none). Re-latch this step: set THIS step's opaque token and drop any prior press, so a
    // stale press from an earlier step cannot skip the current one. The button, when present, records the press
    // by copying the in-page token into `__aw_advance_pressed__` — a value-free equality latch the driver polls.
    const prevPanel = document.getElementById("__aw_advance_panel__");
    if (prevPanel) prevPanel.remove();
    G["__aw_advance_token__"] = o.advance ? o.advance.token : "";
    delete G["__aw_advance_pressed__"];
    if (o.guidanceEnabled && (o.label != null || o.advance)) {
      const panel = document.createElement("div");
      panel.id = "__aw_advance_panel__";
      panel.setAttribute("role", "note");
      panel.setAttribute("aria-live", "polite");
      panel.style.cssText =
        "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483001;pointer-events:auto;box-sizing:border-box;max-width:min(560px,92vw);background:#0b1f4d;color:#fff;font:14px system-ui,-apple-system,sans-serif;padding:14px 16px;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,0.38);display:flex;gap:14px;align-items:center";
      const text = document.createElement("div");
      text.textContent = o.label != null ? o.label : o.copyKey;
      text.style.cssText = "flex:1 1 auto;line-height:1.45";
      panel.appendChild(text);
      if (o.advance) {
        const btn = document.createElement("button");
        btn.setAttribute("type", "button");
        btn.setAttribute("data-aw-advance", "");
        btn.textContent = o.advance.buttonLabel;
        btn.style.cssText =
          "flex:0 0 auto;background:#2b6cff;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:600 14px system-ui,-apple-system,sans-serif;cursor:pointer";
        btn.addEventListener("click", function () {
          const w = window as unknown as Record<string, unknown>;
          w["__aw_advance_pressed__"] = w["__aw_advance_token__"];
        });
        panel.appendChild(btn);
      }
      document.body.appendChild(panel);
    }
    // Mount SUCCEEDED — clear the breadcrumb so a subsequent mount that rejects BEFORE its body runs (a transient
    // soft-nav) reads back `unknown`, never this completed mount's stale stage (which would read as a false locus).
    delete G["__aw_mount_stage__"];
  }, opts));
}

/**
 * Read back the sub-stage breadcrumb the last {@link mountOverlay} stamped into the in-page `__aw_mount_stage__`
 * global. Value-free — it returns only one of the fixed {@link MountSubStage} strings, never any page content. A
 * missing/unrecognized breadcrumb reads back as `unknown` (a successful prior mount clears it; a fault that
 * rejected the `evaluate` before the body ran never set it). On its OWN evaluate failing (e.g. the context was
 * destroyed by the very fault we are localizing) the caller should treat it as `unknown` — this helper does not
 * swallow, so the caller's `.catch` decides.
 */
export async function readMountSubStage(page: PageOrFrame): Promise<MountSubStage> {
  // The global name is inlined (not passed as an arg) so the breadcrumb it reads is self-evident in the evaluate.
  const raw = await page.evaluate(() => (window as unknown as Record<string, unknown>)["__aw_mount_stage__"]);
  const known: readonly MountSubStage[] = [
    "find_tagged_target",
    "remove_previous",
    "reveal_target",
    "create_overlay",
    "inject_style",
    "append_overlay",
    "position_overlay",
  ];
  return (known as readonly string[]).includes(raw as string) ? (raw as MountSubStage) : "unknown";
}

/**
 * CODE-BASED FINGERPRINT of an overlay-mount fault → a fixed {@link MountFaultReason}, WITHOUT emitting the raw
 * message. Branches on the error name/message for classification only; nothing here is logged. `UNKNOWN` is the
 * single case with no recognized shape — the ONLY case the caller may then attach a {@link sanitizeMountMessage}.
 */
export function fingerprintMountFault(e: unknown): MountFaultReason {
  const name = e instanceof Error ? e.name : "";
  const msg = e instanceof Error ? e.message : "";
  if (/frame was detached|Frame was detached/.test(msg)) return "FRAME_DETACHED";
  if (/Target closed|Target page, context or browser has been closed/.test(msg)) return "TARGET_CLOSED";
  if (/Execution context was destroyed|context was destroyed/.test(msg)) return "CONTEXT_DESTROYED";
  if (/is not defined/.test(msg)) return "SYMBOL_NOT_DEFINED";
  if (/Cannot read propert(y|ies).*of (null|undefined)/.test(msg)) return "NULL_PROPERTY_ACCESS";
  if (/is not a function/.test(msg)) return "NOT_A_FUNCTION";
  if (name === "DOMException" || /SecurityError|HierarchyRequestError|NotFoundError/.test(msg)) return "DOM_EXCEPTION";
  if (name === "TypeError") return "TYPE_ERROR";
  return "UNKNOWN";
}

/**
 * A DIAGNOSTIC-ONLY sanitized rendering of a mount fault message, emitted ONLY when {@link fingerprintMountFault}
 * returns `UNKNOWN` (an unrecognized cause the one gated live diagnostic must reveal). The message is a JS-engine /
 * Playwright FRAMEWORK string — it carries API/framework identifiers, not page DOM content — and is still scrubbed
 * hard: any URL, any quoted span (the shape that could carry a selector/text), and any digit run (counts / ids /
 * coordinates) are removed, whitespace is collapsed, and the result is length-capped. No URL, quoted span, or
 * numeric value survives; a bare unquoted identifier could remain, which for a framework error is a JS/DOM symbol
 * name (e.g. `appendChild`), never a credential or page value.
 */
export function sanitizeMountMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message ?? "" : "";
  let s = raw
    .replace(/https?:\/\/\S+/gi, "<url>") // strip any URL
    .replace(/["'`][^"'`]*["'`]/g, "<q>") // strip any quoted span (may carry a selector/text)
    .replace(/\d+/g, "#") // strip digit runs (counts / ids / coordinates)
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > MAX_MOUNT_MESSAGE_LEN) s = `${s.slice(0, MAX_MOUNT_MESSAGE_LEN)}…`;
  return s;
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
    // Also tear down the WING-resident guidance panel and clear the advance latch so a stale press can never be
    // read back after the walk moves on / cleans up.
    const panel = document.getElementById("__aw_advance_panel__");
    if (panel) panel.remove();
    const g = window as unknown as Record<string, unknown>;
    delete g["__aw_advance_pressed__"];
    delete g["__aw_advance_token__"];
  });
}

/**
 * Re-arm the WING-resident advance latch for one step WITHOUT a full re-mount: set THIS step's opaque token and
 * drop any prior press. The driver calls this each time it (re-)arms an observation on a checkpoint, so a press
 * left over from a prior step or a prior arm window can never be misread as this step's advance. Value-free — it
 * only writes an opaque token and deletes a boolean-ish latch; it reads no page content.
 */
export async function resetOverlayAdvance(page: PageOrFrame, token: string): Promise<void> {
  await page.evaluate((t) => {
    const g = window as unknown as Record<string, unknown>;
    g["__aw_advance_token__"] = t;
    delete g["__aw_advance_pressed__"];
  }, token);
}

/**
 * Did the seller press THIS step's WING-resident advance button? A value-free equality poll: it returns whether
 * the in-page latch `__aw_advance_pressed__` equals the step's opaque `token`. It reads no field value, no DOM
 * text, no attribute — only the opaque token the panel button copied on click. A non-matching / absent latch
 * (a stale press from a prior step, or no press yet) reads back `false`.
 */
export async function readOverlayAdvancePressed(page: PageOrFrame, token: string): Promise<boolean> {
  return page.evaluate((t) => (window as unknown as Record<string, unknown>)["__aw_advance_pressed__"] === t, token);
}

/** Test/QA helper: is the WING-resident advance panel currently mounted? (sanitized boolean) */
export async function advancePanelMounted(page: PageOrFrame): Promise<boolean> {
  return page.evaluate(() => !!document.getElementById("__aw_advance_panel__"));
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

export { OVERLAY_ID, ADVANCE_PANEL_ID };
