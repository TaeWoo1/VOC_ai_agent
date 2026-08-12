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
  /**
   * A SHORT title for the badge, when the full {@link label} belongs somewhere else.
   *
   * The badge is a chip pinned above the highlighted control and it cannot wrap (`white-space:nowrap`, so it
   * never obscures the control it sits over). That was fine while the badge carried a `copyKey`. Once the
   * WING-resident panel arrived, the SAME long instruction went to both, and the chip version ran off the
   * viewport — live-observed 2026-08-11 on the KEY-CREATION step, where what it cut off was
   * "SellerOps는 이 버튼을 절대 누르지 않고, 자동으로 넘어가지도 않습니다": the promise not to press it, pushed
   * off-screen at the one control that presses it.
   *
   * So: the panel owns the instruction, the chip says which step this is. Absent ⇒ unchanged behaviour
   * (`label`, then `copyKey`), so no other caller moves.
   */
  badgeLabel?: string;
  /**
   * The REST of the step's copy, behind a `자세히` disclosure — everything the seller may need to read but does
   * not need in front of them while their hands are on the marketplace.
   *
   * The panel started as one paragraph and grew: by the key-creation step it carried five sentences of safety
   * copy across four lines, docked over a WING dialog that had its own crop problem. A panel that large stops
   * being read and starts being an obstacle, which is the opposite of what a guidance panel is for. So the
   * panel now shows a SHORT instruction ({@link label}) with the complete copy one press away.
   *
   * Absent ⇒ the panel is exactly what it was: `label` alone. The disclosure is only offered on a panel that
   * ALREADY takes pointer events (one with an {@link advance} button) — adding a button to a copy-only panel
   * would make it interactive and give it a new way to sit on a control the seller must reach.
   */
  detail?: string;
  /**
   * Start with {@link detail} OPEN. For a step whose copy carries a safety claim — the one control in this walk
   * that brings a real credential into existence — the seller must not have to press anything to see the
   * warning. Lightening a panel is worth doing; hiding a warning to do it is not, and the honest consequence is
   * that the walk's two safety-bearing steps stay as long as they are.
   */
  detailExpanded?: boolean;
  guidanceEnabled: boolean;
  /**
   * Explicit opt-in for the WING-RESIDENT guidance panel. When `true`, mountOverlay draws a
   * fixed-position guidance panel (the {@link label} product copy + an optional advance button) SEPARATE
   * from the `pointer-events:none` spotlight ring, so the seller reads the guidance and advances the walk
   * ON the marketplace page itself — never bouncing back to the SellerOps tab to press "다음".
   *
   * <p>This is a DELIBERATE opt-in, NOT inferred from {@link label}: every overlay caller (NAVER review
   * export / NAVER issuance / Coupang renewal) passes a `label` for the diagnostic badge, so gating the
   * panel on `label` would inject a new interactive fixed element onto those pages. Only the Coupang
   * WING-resident issuance driver sets this flag, so all other flows keep the classic ring+badge only and
   * their behavior is unchanged.
   */
  residentPanel?: boolean;
  /**
   * **Panel-only, DOCKED, no spotlight.** Off by default; every existing caller keeps the anchored ring.
   *
   * For a step whose control is MEASURED but not PROMOTED: there is no locator, so there is nothing honest to
   * draw a ring around. Without this, `mountOverlay` finds no `[data-aw-target]` and returns having created
   * NOTHING — which is why the Coupang walk's four text-guided steps had no presentation of their own, and why
   * the ring the operator saw at them was the previous step's, re-labelled. (Live-confirmed 2026-08-10.)
   *
   * Docked to a viewport corner rather than positioned over an element, so there is no anchor to track and no
   * claim about where the control is. The panel and its advance button behave exactly as in anchored mode.
   */
  dockedPanelOnly?: boolean;
  /**
   * Optional advance affordance for a WING-RESIDENT step (only meaningful with {@link residentPanel}). When
   * present the guidance panel gains a single advance button; its click sets an in-page value-free LATCH
   * (`__aw_advance_pressed__ = token`) the driver polls with {@link readOverlayAdvancePressed}. The `token`
   * is opaque and per-step so a stale press from a prior step can never skip the next one. Absent ⇒ a
   * guidance-only panel (e.g. the reach step, which auto-advances on a page-category transition).
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
    // In docked panel-only mode the anchor is deliberately absent — the step has no promoted locator — so the
    // mount must NOT bail on a missing target. It must also not silently use a STALE tag left by an earlier
    // step: that is the defect this mode exists to fix, so the anchor is ignored outright rather than looked up.
    // EVERY tagged element, not the first one. A step may promote more than one control — the terms screen has
    // two separate consents, and agreeing to one is not agreeing to the other — and `querySelector` silently
    // ringed only whichever came first in the document while the panel described both. The PRIMARY (the control
    // the chip names, and the only one that dims the page) is the element carrying `data-aw-primary`, falling
    // back to document order so every existing single-ring caller is unchanged.
    const tagged = o.dockedPanelOnly ? [] : Array.prototype.slice.call(document.querySelectorAll("[data-aw-target]")) as Element[];
    let primaryIndex = 0;
    for (let t = 0; t < tagged.length; t++) {
      if (tagged[t]!.hasAttribute("data-aw-primary")) {
        primaryIndex = t;
        break;
      }
    }
    const target = tagged.length > 0 ? tagged[primaryIndex]! : null;
    const prev = document.getElementById("__aw_overlay__");
    G["__aw_mount_stage__"] = "remove_previous";
    if (prev) prev.remove();
    // …and every SECONDARY ring from the previous step. They are separate elements from `__aw_overlay__`, so
    // removing only the primary would leave a step's extra rings painted over the next step's screen — the same
    // stale-anchor defect `dockedPanelOnly` exists to fix, one layer out.
    const staleRings = document.querySelectorAll("[data-aw-ring-secondary]");
    for (let s = 0; s < staleRings.length; s++) staleRings[s]!.remove();
    // Clean any stale in-page tracker before re-mounting so listeners never accumulate.
    const stale = G["__aw_overlay_untrack__"];
    if (typeof stale === "function") (stale as () => void)();
    if (!target && !o.dockedPanelOnly) {
      // Clear the breadcrumb: a stale value from a PRIOR mount must not be misread as this (no-op) mount's stage.
      delete G["__aw_mount_stage__"];
      return;
    }
    // Run 7 attempt-3 finding: a target below the fold got a fixed overlay drawn OFF-SCREEN, so the
    // seated operator saw no highlight. Bring the control into view FIRST (read-only — scrolling is
    // not a click), then position over it. `block:"center"` keeps a comfortable margin around it.
    G["__aw_mount_stage__"] = "reveal_target";
    // Nothing to reveal when there is no anchor; scrolling the page for a step whose control we cannot locate
    // would move the seller's view for no reason we can justify.
    if (target) (target as Element).scrollIntoView({ block: "center", inline: "center" });
    G["__aw_mount_stage__"] = "create_overlay";
    const box = document.createElement("div");
    box.id = "__aw_overlay__";
    box.setAttribute("aria-hidden", "true");
    box.setAttribute("data-aw-ring-index", String(primaryIndex));
    G["__aw_mount_stage__"] = "inject_style";
    // The page-dimming shroud is a hole punched around ONE element, so two of them stack their darkness and the
    // second ring's own control ends up dimmed by the first. With more than one ring the shroud is dropped and
    // the rings carry the emphasis alone; a single ring keeps exactly the dimming it has always had.
    const dim = tagged.length <= 1;
    box.style.cssText = [
      "position:fixed",
      "pointer-events:none", // never intercept the target click
      "z-index:2147483000",
      "box-sizing:border-box",
      "border:3px solid #2b6cff",
      "border-radius:8px",
      dim ? "box-shadow:0 0 0 9999px rgba(0,0,0,0.28)" : "box-shadow:0 0 0 3px rgba(43,108,255,0.35)",
      o.guidanceEnabled ? "display:block" : "display:none",
    ].join(";");
    if (o.dockedPanelOnly) {
      // No ring, no dimming, no anchor geometry — the box becomes an invisible host for the panel, docked out
      // of the way. Drawing a border here would be a claim about a control's location that nothing measured.
      box.style.border = "none";
      box.style.boxShadow = "none";
      box.style.left = "0px";
      box.style.top = "0px";
      box.style.width = "0px";
      box.style.height = "0px";
    }
    const badge = document.createElement("div");
    badge.setAttribute("data-aw-badge", "");
    if (o.dockedPanelOnly) badge.style.display = "none";
    badge.textContent = `${o.stepNumber}/${o.totalSteps} · ${o.badgeLabel ?? o.label ?? o.copyKey}`;
    // `nowrap` stays — a wrapping chip grows downward over the very control it points at. What it gains is a
    // CEILING and an ellipsis, so a label longer than the chip can hold is visibly cut ("…") instead of running
    // off the viewport, where the seller cannot tell truncated text from text that was never written.
    // A structural backstop, not a substitute for `badgeLabel`: the ellipsis says something is missing, and the
    // short title means nothing is.
    badge.style.cssText =
      "position:absolute;left:0;top:-28px;background:#2b6cff;color:#fff;font:12px system-ui;padding:2px 8px;border-radius:4px;white-space:nowrap;max-width:min(420px,60vw);overflow:hidden;text-overflow:ellipsis";
    box.appendChild(badge);
    G["__aw_mount_stage__"] = "append_overlay";
    document.body.appendChild(box);
    // One ring per remaining tagged element. No chip and no shroud on these: the chip names ONE control, and a
    // second chip pointing at a second control with the same step text is the crowding that made the first chip
    // unreadable. They carry the same border so the seller sees "these, together".
    for (let s = 0; s < tagged.length; s++) {
      if (s === primaryIndex) continue;
      const extra = document.createElement("div");
      extra.setAttribute("aria-hidden", "true");
      extra.setAttribute("data-aw-ring-secondary", "");
      extra.setAttribute("data-aw-ring-index", String(s));
      extra.style.cssText = [
        "position:fixed",
        "pointer-events:none",
        "z-index:2147483000",
        "box-sizing:border-box",
        "border:3px solid #2b6cff",
        "border-radius:8px",
        "box-shadow:0 0 0 3px rgba(43,108,255,0.35)",
        o.guidanceEnabled ? "display:block" : "display:none",
      ].join(";");
      document.body.appendChild(extra);
    }
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
    // Write a style property ONLY when the value actually changes. Load-bearing, not a micro-optimization:
    // assigning the same value still emits an attribute MutationRecord, and the tracker below repositions ON
    // mutations — so an unconditional write would feed its own observer and spin a permanent rAF loop.
    // (Array-index initializer for the `__name` reason documented above; same for every closure that follows.)
    const setStyle = [
      (el: HTMLElement, prop: string, value: string) => {
        const s = el.style as unknown as Record<string, string>;
        if (s[prop] !== value) s[prop] = value;
      },
    ][0]!;
    const reposition = [
      () => {
        // In docked mode the anchor is deliberately absent, so there is nothing to track — and a STALE tag left
        // by an earlier step must not become one. That is the defect `dockedPanelOnly` exists to fix, and the
        // repositioner is the second place it could re-enter. Nothing below applies either: a docked step rings
        // no control, so there is no control for its panel to be sitting on.
        if (o.dockedPanelOnly) return;
        // Re-queried, never captured: the tag set is what the driver rewrote for THIS step, and a closure over
        // stale element references would keep tracking a control the page has since replaced. Each ring carries
        // the index it was created for, so the pairing survives a scroll without any shared state.
        const els = document.querySelectorAll("[data-aw-target]");
        const boxes = document.querySelectorAll("#__aw_overlay__,[data-aw-ring-secondary]");
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i] as HTMLElement;
          const el = els[Number(b.getAttribute("data-aw-ring-index"))];
          if (!el) continue;
          const r = (el as Element).getBoundingClientRect();
          setStyle(b, "left", `${r.left - 6}px`);
          setStyle(b, "top", `${r.top - 6}px`);
          setStyle(b, "width", `${r.width + 12}px`);
          setStyle(b, "height", `${r.height + 12}px`);
        }
        // …and then KEEP THE PANEL OFF THE CONTROL IT DESCRIBES. The panel is docked bottom-centre, which is
        // also where a marketplace dialog puts its primary buttons — live-observed twice on the Coupang walk,
        // where the panel saying "press 확인 yourself" sat on top of 확인. The ring is `pointer-events:none` and
        // could only ever hide the control; the panel takes clicks when it carries a button, so an overlap there
        // is a walk that blocks the seller's own manual progress. That is a safety-fence violation, not cosmetics.
        //
        // SIX candidate placements, not two. The first version chose between bottom-centre and top-centre, and
        // when a control sat at BOTH ends it kept the bottom one — i.e. it settled, deliberately, onto a
        // control. A viewport has corners; a 560px panel and a marketplace dialog rarely need the same ones.
        //
        // …and the ring is not the only thing the seller has to reach. A step's ring sits on ONE control while
        // the screen in front of them holds the ones they must operate to GET there — on the vendor screen, the
        // form above the button the next step rings. The panel covered WING's own `확인` there on 2026-08-12
        // while ringing the option ABOVE it, and nothing in this computation could see that: `확인` carried no
        // tag yet. So a step may also declare controls to KEEP CLEAR of, tagged `data-aw-avoid`, and they enter
        // the same geometry as the rings.
        const panel = document.getElementById("__aw_advance_panel__");
        if (!panel) return;
        const targets = document.querySelectorAll("[data-aw-target]");
        const avoided = document.querySelectorAll("[data-aw-avoid]");
        if (targets.length === 0 && avoided.length === 0) return;
        const p = panel.getBoundingClientRect();
        const pw = p.width;
        const ph = p.height;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 24;
        // A target OUTSIDE the viewport is projected onto the edge it will arrive from, rather than dropped.
        // Dropping it is what let the panel park exactly where a below-the-fold control lands the moment the
        // seller scrolls to it: at that instant the panel is "not covering" anything, and one scroll later it is
        // covering the only thing that matters. A projected target keeps that edge reserved from the start.
        // It is projected FLUSH AGAINST that edge, keeping its own height — the position it holds after the
        // smallest scroll that brings it into view. A one-pixel marker at the very edge would be technically
        // "inside the viewport" and would clear every candidate, which is the same blindness in a new costume.
        const spansOf = [
          (nodes: NodeListOf<Element>) => {
            const out: number[][] = [];
            for (let i = 0; i < nodes.length; i++) {
              const r = nodes[i]!.getBoundingClientRect();
              const rh = Math.min(Math.max(r.bottom - r.top, 1), vh);
              const above = r.bottom <= 0;
              const below = r.top >= vh;
              const top = above ? 0 : below ? vh - rh : r.top;
              const bottom = above ? rh : below ? vh : r.bottom;
              out.push([r.left, top, r.right, bottom]);
            }
            return out;
          },
        ][0]!;
        const spans = spansOf(targets);
        const avoidSpans = spansOf(avoided);
        // How much of a set of controls a panel at (x, y) would sit on, in square pixels. Zero means clear;
        // comparing areas is what lets the least-bad placement win when nothing is clear.
        const overlapAt = [
          (x: number, y: number, boxes: number[][]) => {
            let area = 0;
            for (let i = 0; i < boxes.length; i++) {
              const s = boxes[i]!;
              const ox = Math.min(x + pw, s[2]!) - Math.max(x, s[0]!);
              const oy = Math.min(y + ph, s[3]!) - Math.max(y, s[1]!);
              if (ox > 0 && oy > 0) area += ox * oy;
            }
            return area;
          },
        ][0]!;
        // Clamped so an oversized panel (a long step, a narrow window) is never pushed off the top-left, where
        // the seller could not read it at all.
        const xs = [Math.max(margin, (vw - pw) / 2), Math.max(margin, vw - pw - margin), margin];
        const ys = [Math.max(margin, vh - ph - margin), margin];
        // Order IS the preference: bottom-centre first (where it has always rested), then top-centre, then the
        // right corners, then the left. The decision reads only the TARGETS and the panel's own size — never the
        // panel's current position — so re-running it cannot move the panel, and it cannot oscillate.
        //
        // The two sets are compared LEXICOGRAPHICALLY, ring overlap first: the panel may sit on a control the
        // seller is not being pointed at yet, if the alternative is sitting on the one they are. Ranking them
        // together with a weight would let enough avoided area outvote the ring, which is a step that hides the
        // thing it is about — and it would need a fudge factor nothing measured. Least ring, then least next.
        let bestX = xs[0]!;
        let bestY = ys[0]!;
        let bestArea = -1;
        let bestAvoid = -1;
        for (let xi = 0; xi < xs.length && !(bestArea === 0 && bestAvoid === 0); xi++) {
          for (let yi = 0; yi < ys.length; yi++) {
            const area = overlapAt(xs[xi]!, ys[yi]!, spans);
            const avoid = overlapAt(xs[xi]!, ys[yi]!, avoidSpans);
            if (bestArea < 0 || area < bestArea || (area === bestArea && avoid < bestAvoid)) {
              bestArea = area;
              bestAvoid = avoid;
              bestX = xs[xi]!;
              bestY = ys[yi]!;
            }
            if (bestArea === 0 && bestAvoid === 0) break;
          }
        }
        setStyle(panel, "left", `${Math.round(bestX)}px`);
        setStyle(panel, "top", `${Math.round(bestY)}px`);
        // The mount styles the panel bottom-centred with a translate; an explicit placement has to clear both or
        // the two compose into a position neither of them meant.
        setStyle(panel, "right", "auto");
        setStyle(panel, "bottom", "auto");
        setStyle(panel, "transform", "none");
      },
    ][0]!;
    // Coalesce a burst of layout changes into ONE reposition on the next frame. The latch lives on `window` so a
    // re-mount (which runs the previous tracker's teardown first) cannot leave a frame scheduled against a
    // closure that is gone.
    // Every host API this tracker uses is FEATURE-DETECTED, and none of it is optional decoration: a host
    // missing one simply keeps the scroll/resize tracking it always had. (The offline fakes the overlay suite
    // drives are such a host — they model a document, not a browser — and a mount that threw there would be a
    // mount that throws on any surface with a trimmed sandbox.)
    const schedule = [
      () => {
        const w = window as unknown as Record<string, unknown>;
        if (typeof w["requestAnimationFrame"] !== "function") {
          reposition();
          return;
        }
        if (w["__aw_overlay_pending__"]) return;
        // The PENDING flag is claimed BEFORE the frame is requested, and the handle is stored after — never the
        // other way round. Storing the handle as the flag looks equivalent and is not: a host that runs the
        // callback synchronously would clear a flag that had not been set yet, and the assignment would then
        // set it permanently, wedging every later reposition. One coalescing latch, one cancel handle.
        w["__aw_overlay_pending__"] = true;
        const id = window.requestAnimationFrame(() => {
          const w2 = window as unknown as Record<string, unknown>;
          delete w2["__aw_overlay_pending__"];
          delete w2["__aw_overlay_raf__"];
          reposition();
        });
        if (w["__aw_overlay_pending__"]) w["__aw_overlay_raf__"] = id;
      },
    ][0]!;
    reposition();
    // `capture:true` catches scrolls on any nested scroller, not just the window.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    // THE OTHER WAY A CONTROL MOVES, and until 2026-08-12 the only one nothing watched: the page relaid itself
    // out without a scroll and without a resize. Live-observed on the Coupang vendor screen, where selecting the
    // integration method reveals two more rows and turns a dropdown into a text input — a step whose whole
    // content is a layout change — and the rings stayed at the coordinates they were mounted at. The seller then
    // sees emphasis on the wrong control, which is worse than none: a ring is a claim about where to press.
    const W = window as unknown as Record<string, unknown>;
    const mo = typeof W["MutationObserver"] === "function" ? new MutationObserver(schedule) : null;
    if (mo && document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const ro = typeof W["ResizeObserver"] === "function" ? new ResizeObserver(schedule) : null;
    if (ro) {
      if (document.documentElement) ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body);
      for (let t = 0; t < tagged.length; t++) ro.observe(tagged[t]!);
    }
    // Backstop for the movement neither observer reports: a CSS transition/animation slides an element over
    // several hundred ms while mutating nothing. Cheap — a few `getBoundingClientRect` reads, and `setStyle`
    // writes nothing when the answer has not changed.
    const tick = typeof W["setInterval"] === "function" ? window.setInterval(schedule, 500) : 0;
    (window as unknown as Record<string, unknown>)["__aw_overlay_untrack__"] = () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      if (mo) mo.disconnect();
      if (ro) ro.disconnect();
      const w = window as unknown as Record<string, unknown>;
      if (tick && typeof w["clearInterval"] === "function") window.clearInterval(tick);
      const pending = w["__aw_overlay_raf__"];
      if (typeof pending === "number" && typeof w["cancelAnimationFrame"] === "function") window.cancelAnimationFrame(pending);
      delete w["__aw_overlay_raf__"];
      delete w["__aw_overlay_pending__"];
      delete w["__aw_overlay_untrack__"];
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
    // The WING-resident panel is drawn ONLY on an explicit opt-in (residentPanel) — never inferred from a
    // label — so callers that pass only a diagnostic label (NAVER export / NAVER issuance / Coupang renewal)
    // keep the classic ring+badge and never get a new interactive fixed element on their marketplace page.
    if (o.guidanceEnabled && o.residentPanel && o.label != null) {
      const panel = document.createElement("div");
      panel.id = "__aw_advance_panel__";
      panel.setAttribute("role", "note");
      panel.setAttribute("aria-live", "polite");
      // A panel with no advance button has nothing to click, so it takes NO pointer events — otherwise a
      // copy-only panel (the deletion checkpoint, the reach step) could sit over the very control the seller
      // must press on a short page and block their manual progress. With a button it must stay clickable.
      const panelPointerEvents = o.advance ? "auto" : "none";
      panel.style.cssText =
        `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483001;pointer-events:${panelPointerEvents};box-sizing:border-box;max-width:min(560px,92vw);background:#0b1f4d;color:#fff;font:14px system-ui,-apple-system,sans-serif;padding:14px 16px;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,0.38);display:flex;flex-direction:column;gap:10px`;
      // The instruction, the disclosure and the advance button share ONE row; the detail (when open) is a second
      // row under it. That way a collapsed panel is exactly as tall as the old single-line one.
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:14px;align-items:center";
      const text = document.createElement("div");
      text.textContent = o.label != null ? o.label : o.copyKey;
      text.style.cssText = "flex:1 1 auto;line-height:1.45";
      row.appendChild(text);
      // The disclosure is offered only where the panel is ALREADY interactive. On a copy-only panel it would be
      // the single button on an element that is `pointer-events:none` precisely so it can never block a control.
      const detailShown = o.detail != null && o.advance != null;
      const startOpen = o.detailExpanded === true;
      if (detailShown) {
        const toggle = document.createElement("button");
        toggle.setAttribute("type", "button");
        toggle.setAttribute("data-aw-panel-detail-toggle", "");
        toggle.textContent = startOpen ? "간단히" : "자세히";
        toggle.style.cssText =
          "flex:0 0 auto;background:transparent;color:#cfe0ff;border:1px solid rgba(255,255,255,0.4);border-radius:8px;padding:8px 12px;font:600 13px system-ui,-apple-system,sans-serif;cursor:pointer";
        toggle.addEventListener("click", function () {
          const d = document.getElementById("__aw_panel_detail__");
          const t = document.getElementById("__aw_panel_detail_toggle__");
          if (!d) return;
          const opening = d.style.display === "none";
          d.style.display = opening ? "block" : "none";
          if (t) t.textContent = opening ? "간단히" : "자세히";
          // The panel just changed height. Re-place it in the same gesture: a panel that grows downward onto the
          // control it describes is the defect the placement logic exists to prevent, and waiting for the next
          // observer tick to notice would show the seller exactly that, briefly.
          reposition();
        });
        toggle.id = "__aw_panel_detail_toggle__";
        row.appendChild(toggle);
      }
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
          // A COUNT of presses, kept beside the latch and never cleared by a re-arm.
          //
          // The latch alone cannot distinguish "the seller never pressed" from "they pressed and something
          // ate it" — and on 2026-08-12 the walk sat at step 6 through repeated presses with no way to tell
          // those apart from outside. The count is value-free (an integer), survives the re-arm that clears
          // the latch, and is what makes "the handler ran" a measurement rather than an inference.
          const prev = w["__aw_advance_press_count__"];
          w["__aw_advance_press_count__"] = (typeof prev === "number" ? prev : 0) + 1;
        });
        row.appendChild(btn);
      }
      panel.appendChild(row);
      if (detailShown) {
        const detail = document.createElement("div");
        detail.id = "__aw_panel_detail__";
        detail.textContent = o.detail != null ? o.detail : "";
        detail.style.cssText = `line-height:1.5;font-size:13px;color:#e6eeff;border-top:1px solid rgba(255,255,255,0.18);padding-top:10px;display:${startOpen ? "block" : "none"}`;
        panel.appendChild(detail);
      }
      document.body.appendChild(panel);
      // The panel is built AFTER the first `reposition()`, so without this the occlusion check would not run
      // until the next layout change — i.e. the one moment it is most likely to matter is the one it would miss.
      reposition();
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

/** Recompute EVERY ring's position after layout movement — the primary and any secondary rings beside it. */
export async function refreshOverlay(page: PageOrFrame): Promise<void> {
  await page.evaluate(() => {
    const els = document.querySelectorAll("[data-aw-target]");
    const boxes = document.querySelectorAll("#__aw_overlay__,[data-aw-ring-secondary]");
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i] as HTMLElement;
      const el = els[Number(b.getAttribute("data-aw-ring-index"))];
      if (!el) continue;
      const rect = (el as Element).getBoundingClientRect();
      b.style.left = `${rect.left - 6}px`;
      b.style.top = `${rect.top - 6}px`;
      b.style.width = `${rect.width + 12}px`;
      b.style.height = `${rect.height + 12}px`;
    }
  });
}

export async function setOverlayGuidance(page: PageOrFrame, enabled: boolean): Promise<void> {
  await page.evaluate((en) => {
    // Every ring, not just the primary: a guidance toggle that hid one ring and left the others painted would
    // leave the seller looking at emphasis nobody is explaining.
    const boxes = document.querySelectorAll("#__aw_overlay__,[data-aw-ring-secondary]");
    for (let i = 0; i < boxes.length; i++) (boxes[i] as HTMLElement).style.display = en ? "block" : "none";
  }, enabled);
}

export async function unmountOverlay(page: PageOrFrame): Promise<void> {
  await page.evaluate(() => {
    const untrack = (window as unknown as Record<string, unknown>)["__aw_overlay_untrack__"];
    if (typeof untrack === "function") (untrack as () => void)();
    const boxes = document.querySelectorAll("#__aw_overlay__,[data-aw-ring-secondary]");
    for (let i = 0; i < boxes.length; i++) boxes[i]!.remove();
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

/**
 * **Everything the host needs to say WHERE the advance path broke, in one read.** Value-free throughout: a
 * count, three booleans, no page content.
 *
 * Four independent facts, because "the walk did not advance" has four distinct causes and they need different
 * fixes: the panel is gone (nothing to press), the seller has not pressed (`presses` 0), they pressed but the
 * latch does not match this step's token (`presses` > 0, `latched` false — a re-arm race or a stale panel from
 * a previous step), or everything is in order and the reader is not running (`latched` true and the walk still
 * sitting there). Inferring between those from silence is what cost a live sitting on 2026-08-12.
 */
export interface OverlayAdvanceDiagnostics {
  /** How many times THIS page's advance button has been pressed since the page loaded. Never cleared by a re-arm. */
  presses: number;
  /** Is the latch currently set to the token the caller is polling for? */
  latched: boolean;
  /** Is a token armed at all? (`false` ⇒ nothing mounted an advance affordance, or it was torn down.) */
  tokenArmed: boolean;
  /** Is the guidance panel still on the page? */
  panelMounted: boolean;
}

export async function readOverlayAdvanceDiagnostics(page: PageOrFrame, token: string): Promise<OverlayAdvanceDiagnostics> {
  return page.evaluate((t) => {
    const w = window as unknown as Record<string, unknown>;
    const presses = w["__aw_advance_press_count__"];
    const armed = w["__aw_advance_token__"];
    return {
      presses: typeof presses === "number" ? presses : 0,
      latched: w["__aw_advance_pressed__"] === t,
      tokenArmed: typeof armed === "string" && armed.length > 0,
      panelMounted: !!document.getElementById("__aw_advance_panel__"),
    };
  }, token);
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
