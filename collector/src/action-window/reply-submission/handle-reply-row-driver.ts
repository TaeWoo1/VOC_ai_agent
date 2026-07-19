/**
 * **Same-session abort-rehearsal row driver.** Unlike the persisted-mapping live driver, this one holds the EXACT
 * live DOM element the operator clicked — an in-memory element handle — so there is no structural path, no
 * page-signature, and no cross-session reload to drift. It is used only for the row-match abort rehearsal: it
 * confirms the retained element is still connected, highlights THAT element read-only, and observes nothing (the
 * operator aborts at the row barrier and never opens a composer).
 *
 * HARD BOUNDARIES (same as the live driver): NO click, NO type, NO submit, NO navigation. The only in-element
 * effects are a read-only outline + marker attribute for the operator to visually confirm, and `scrollIntoView`.
 * If the element detaches or the SPA re-renders it away, `isConnected` is false (or evaluate throws) → the driver
 * reports zero rows and the run fails closed — the operator then re-calibrates in the SAME session.
 */
import { composerSigFor } from "./reply-surface";
import type { LocateComposerResult, LocateRowResult, SurfaceProbeResult } from "./reply-engine";
import type { ReplySubmitProbeDriver } from "./reply-driver";

/** The minimal element-handle surface this driver needs — a Playwright `ElementHandle` satisfies it. */
export interface AbortRowHandle {
  evaluate<R>(pageFunction: (element: unknown) => R): Promise<R>;
}

/** Stable opaque row signature for the operator-designated element (identical across locate + highlight). */
const CALIBRATED_ROW_SIG = composerSigFor(["row", "same-session-calibrated"]);

export class HandleReplyRowDriver implements ReplySubmitProbeDriver {
  private readonly handle: AbortRowHandle;
  private readonly waitRowOpen: () => Promise<boolean>;

  /**
   * @param handle       the retained live element (the operator's clicked review row).
   * @param waitRowOpen  resolves when the operator opens the reply control; in the abort rehearsal the operator
   *                     aborts instead, so this simply waits (and the abort watcher terminates the run first).
   */
  constructor(handle: AbortRowHandle, waitRowOpen: () => Promise<boolean>) {
    this.handle = handle;
    this.waitRowOpen = waitRowOpen;
  }

  /** True only while the retained element is still attached to the live DOM. Detached / re-rendered → false. */
  private async connected(): Promise<boolean> {
    try {
      return await this.handle.evaluate((el) => !!(el && (el as { isConnected?: boolean }).isConnected));
    } catch {
      return false; // handle disposed / element gone → fail closed
    }
  }

  async prepareSurface(): Promise<SurfaceProbeResult> {
    // The operator is already on the (filtered) review list; the surface precondition is the retained element.
    return (await this.connected()) ? true : { ok: false, code: "UNSUPPORTED_STATE" };
  }

  async locateReviewRow(): Promise<LocateRowResult> {
    // The operator designated exactly one row; "locate" only re-confirms it is still connected (anti-detach).
    return (await this.connected()) ? { count: 1, sig: CALIBRATED_ROW_SIG } : { count: 0 };
  }

  async highlightRow(): Promise<LocateRowResult> {
    if (!(await this.connected())) return { count: 0 };
    // The retained handle is the operator's exact clicked element (the anchor); resolve the REVIEW ROW from it
    // (the nearest repeated text-rich ancestor) and outline the whole row — a clear, unambiguous highlight.
    await this.handle.evaluate((el) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let cur: any = el, row: any = el, d = 0;
      while (cur && cur.parentElement && d < 25) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p: any = cur.parentElement;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const same: any[] = Array.prototype.filter.call(p.children, (c: any) => c.tagName === cur.tagName);
        if (same.length >= 2 && (cur.textContent || "").trim().length > 150) {
          let rich = 0;
          for (let i = 0; i < same.length; i += 1) if ((same[i].textContent || "").trim().length > 150) rich += 1;
          if (rich >= 2) { row = cur; break; }
        }
        cur = p; d += 1;
      }
      if (row.setAttribute) row.setAttribute("data-aw-abort-highlight", "1");
      if (row.style) { row.style.outline = "3px solid #2b6cff"; row.style.outlineOffset = "2px"; }
      if (row.scrollIntoView) row.scrollIntoView({ block: "center" });
    });
    return { count: 1, sig: CALIBRATED_ROW_SIG };
  }

  async armRowObserve(): Promise<void> {
    return; // the operator aborts at the barrier; no reply-control observation is needed.
  }

  async waitForRowOpen(): Promise<boolean> {
    return this.waitRowOpen(); // waits; the abort (SWITCH_TO_MANUAL) terminates the run first.
  }

  // ── Composer stubs: never reached — the abort rehearsal terminates at the row barrier, before any composer. ──
  async locateComposer(): Promise<LocateComposerResult> {
    return { count: 0 };
  }
  async highlight(): Promise<void> {
    return;
  }
  async armObserve(): Promise<void> {
    return;
  }
  async waitForSubmit(): Promise<boolean> {
    return false;
  }

  async cleanup(): Promise<void> {
    try {
      // Re-resolve the same review row from the anchor and remove the read-only outline.
      await this.handle.evaluate((el) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let cur: any = el, row: any = el, d = 0;
        while (cur && cur.parentElement && d < 25) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p: any = cur.parentElement;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const same: any[] = Array.prototype.filter.call(p.children, (c: any) => c.tagName === cur.tagName);
          if (same.length >= 2 && (cur.textContent || "").trim().length > 150) {
            let rich = 0;
            for (let i = 0; i < same.length; i += 1) if ((same[i].textContent || "").trim().length > 150) rich += 1;
            if (rich >= 2) { row = cur; break; }
          }
          cur = p; d += 1;
        }
        if (row.removeAttribute) row.removeAttribute("data-aw-abort-highlight");
        if (row.style) { row.style.outline = ""; row.style.outlineOffset = ""; }
      });
    } catch {
      /* element already gone — nothing to clean */
    }
  }
}
