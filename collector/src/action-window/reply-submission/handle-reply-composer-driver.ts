/**
 * **Same-session abort-rehearsal driver that advances THROUGH the composer barrier.**
 *
 * The composer counterpart to {@link HandleReplyRowDriver}. It reuses that (already-shipped, tested) driver
 * unchanged for the ROW half — prepare / locate row / highlight row / row cleanup — by composition, and adds
 * the COMPOSER half over a SECOND retained live element: the composer the operator clicks AFTER their own
 * entry (the review-body link into the detail page, or the row checkbox + toolbar reply action). Neither
 * element is a persisted mapping or a page signature; both are in-memory handles to the exact elements the
 * operator designated, so a dynamic SPA cannot drift the target between capture and highlight.
 *
 * The composer handle is not known at construction — it is acquired only after the operator performs the
 * entry. So {@link waitForRowOpen} (the engine's row-open barrier) runs the injected `acquireComposer`
 * callback: it observes the entry transition, re-acquires the active page, arms the composer capture, and
 * retains the clicked composer element. A connected handle → the barrier lifts and the engine drives
 * locate → highlight → the composer submit barrier, where the operator ABORTS. No handle (timeout / detach)
 * → the barrier never lifts and the operator aborts at the row barrier instead. Either way, ABORT_REHEARSAL
 * guarantees the only terminal is SUBMISSION_ABORTED.
 *
 * HARD BOUNDARIES (source-guard enforced): NO click, NO type, NO paste, NO submit, NO navigation, NO event
 * dispatch on a NAVER control. The only composer-side effect is a read-only outline + marker attribute for
 * the operator to visually confirm. The seller's own approved draft is shown by the CLI's separate read-only
 * overlay, never typed into the composer.
 */
import { composerSigFor } from "./reply-surface";
import { HandleReplyRowDriver, type AbortRowHandle } from "./handle-reply-row-driver";
import { resolveAndOutlineComposer, clearComposerOutline } from "./reply-composer-inpage";
import type { LocateComposerResult, LocateRowResult, SurfaceProbeResult } from "./reply-engine";
import type { ReplySubmitProbeDriver } from "./reply-driver";

/** Stable opaque composer signature for the operator-designated element (identical across locate + highlight). */
const CALIBRATED_COMPOSER_SIG = composerSigFor(["composer", "same-session-calibrated"]);

/** True only while a retained element handle is still attached to the live DOM. Detached / disposed → false. */
async function handleConnected(handle: AbortRowHandle): Promise<boolean> {
  try {
    return await handle.evaluate((el) => !!(el && (el as { isConnected?: boolean }).isConnected));
  } catch {
    return false; // handle disposed / element gone → fail closed
  }
}

export class HandleReplyComposerDriver implements ReplySubmitProbeDriver {
  /** Reused unchanged for the ROW half (prepare / locate row / highlight row / row cleanup). */
  private readonly rowDriver: HandleReplyRowDriver;
  private readonly acquireComposer: () => Promise<AbortRowHandle | null>;
  private readonly waitSubmit: () => Promise<boolean>;
  /** The operator-designated composer element, retained only once the entry transition has happened. */
  private composerHandle: AbortRowHandle | null = null;

  /**
   * @param rowHandle       the operator's retained review-row anchor (drives the row-half highlight).
   * @param acquireComposer observes the entry transition, arms the composer capture on the re-acquired active
   *                        page, and resolves the operator's clicked composer element (or null on timeout/detach).
   * @param waitSubmit      resolves when the operator opens/acts on the composer; in the rehearsal the operator
   *                        aborts instead, so this simply waits and the abort watcher terminates the run first.
   */
  constructor(
    rowHandle: AbortRowHandle,
    acquireComposer: () => Promise<AbortRowHandle | null>,
    waitSubmit: () => Promise<boolean>,
  ) {
    // The row driver's own waitForRowOpen is never used here — this driver overrides that barrier below.
    this.rowDriver = new HandleReplyRowDriver(rowHandle, () => Promise.resolve(false));
    this.acquireComposer = acquireComposer;
    this.waitSubmit = waitSubmit;
  }

  /* ── ROW half — delegated verbatim to the shipped, tested HandleReplyRowDriver ─────────────────────── */
  prepareSurface(): Promise<SurfaceProbeResult> {
    return this.rowDriver.prepareSurface();
  }
  locateReviewRow(): Promise<LocateRowResult> {
    return this.rowDriver.locateReviewRow();
  }
  highlightRow(): Promise<LocateRowResult> {
    return this.rowDriver.highlightRow();
  }
  armRowObserve(): Promise<void> {
    return this.rowDriver.armRowObserve();
  }

  /**
   * The row-open barrier — OVERRIDDEN to acquire the composer. The operator performs their own entry (body-link
   * navigation or checkbox+toolbar); `acquireComposer` observes that transition, arms the composer capture, and
   * retains the composer the operator clicks. A connected handle lifts the barrier; otherwise it stays closed
   * (→ the operator aborts at the row barrier). The runtime never clicks/navigates — the operator does both.
   */
  async waitForRowOpen(): Promise<boolean> {
    const handle = await this.acquireComposer();
    if (!handle) return false;
    if (!(await handleConnected(handle))) return false;
    this.composerHandle = handle;
    return true;
  }

  /* ── COMPOSER half — over the second retained element ──────────────────────────────────────────────── */
  async locateComposer(): Promise<LocateComposerResult> {
    if (!this.composerHandle) return { count: 0 };
    // The operator designated exactly one composer; "locate" only re-confirms it is still connected (anti-detach).
    return (await handleConnected(this.composerHandle)) ? { count: 1, sig: CALIBRATED_COMPOSER_SIG } : { count: 0 };
  }

  async highlight(): Promise<void> {
    if (!this.composerHandle) return;
    if (!(await handleConnected(this.composerHandle))) return;
    await this.composerHandle.evaluate(resolveAndOutlineComposer);
  }

  async armObserve(): Promise<void> {
    return; // the operator aborts at the composer barrier; no submit observation is armed.
  }

  async waitForSubmit(): Promise<boolean> {
    return this.waitSubmit(); // waits; the abort (SWITCH_TO_MANUAL) terminates the run first.
  }

  async cleanup(): Promise<void> {
    await this.rowDriver.cleanup(); // remove the row outline
    if (this.composerHandle) {
      try {
        await this.composerHandle.evaluate(clearComposerOutline);
      } catch {
        /* composer element already gone — nothing to clean */
      }
    }
  }
}
