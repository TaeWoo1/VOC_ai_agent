/**
 * The guided-fill reply driver — the ONE place a reviewnary-hosted NAVER reply run may put the approved
 * draft into the composer (Agentic Operating Workspace v2 §13, product-owner decision 2026-08-28).
 *
 * <p>Two boundaries, both structural:
 * <ul>
 *   <li><b>It wraps, it does not replace.</b> Every locate/highlight/observe step is the existing
 *       {@link ReplySubmitProbeDriver}; `naver-reply-driver.ts` keeps its no-typing guard byte for byte. The
 *       fill itself is `reply-composer-fill.ts`'s single helper, which writes only into the element the driver
 *       tagged as the ONE composer of the ONE matched row.</li>
 *   <li><b>Fill is gated on identity, not on optimism.</b> {@link composerFillDecision} refuses unless exactly one
 *       review row matched the target hint and exactly one composer was located — anything ambiguous fills
 *       nothing and the run continues to the seller's own submit as it always did. The submit control is never
 *       clicked here or anywhere (`reply-guard.test.ts`).</li>
 * </ul>
 *
 * <p>The surface is opened lazily on `prepareSurface()` so an idle resident helper holds no browser; the draft body
 * lives only in this object's memory for the run and is never logged or persisted.
 */
import type { ComposerFillResult, ReviewIdMatchVerdict } from "./reply-composer-fill";
import { composerFillDecision, fillComposer } from "./reply-composer-fill";
import type { ComposerFillPageLike } from "./reply-composer-fill";
import type { ReplySubmitProbeDriver } from "./reply-driver";
import type { ComposerOpenResult } from "./reply-composer-open";
import type { LocateComposerResult, LocateRowResult, SurfaceProbeResult } from "./reply-engine";

export interface GuidedFillReplyDriverDeps {
  /** Opens (or reuses) the seller-center surface and builds the inner driver on it. */
  open(): Promise<{ inner: ReplySubmitProbeDriver; page: ComposerFillPageLike }>;
  /** The approved draft, byte for byte. Absent ⇒ NOT_FILLABLE, the legacy unfilled barrier. */
  draftBody: string | null;
  /**
   * Whether the backend's channel-review-id fingerprint matched the located row. Optional here because the
   * inner driver may answer it itself (`NaverLadderReplyDriver.reviewIdVerdict`); when neither can, the gate
   * reads UNAVAILABLE and nothing is typed.
   */
  reviewIdVerdict?: () => ReviewIdMatchVerdict;
}

/** An inner driver that can say whether the review id matched, and can press the open control. */
type IdentityAwareDriver = ReplySubmitProbeDriver & {
  reviewIdVerdict?: () => ReviewIdMatchVerdict;
  openComposer?: () => Promise<ComposerOpenResult>;
  waitForSurfaceReady?: () => Promise<boolean>;
};

export class GuidedFillReplyDriver implements ReplySubmitProbeDriver {
  private opened: { inner: IdentityAwareDriver; page: ComposerFillPageLike } | null = null;
  private rowMatchCount = 0;
  private composerCount = 0;

  constructor(private readonly deps: GuidedFillReplyDriverDeps) {}

  isOpen(): boolean {
    return this.opened !== null;
  }

  private async inner(): Promise<ReplySubmitProbeDriver> {
    if (!this.opened) this.opened = await this.deps.open();
    return this.opened.inner;
  }

  async prepareSurface(): Promise<SurfaceProbeResult> {
    return (await this.inner()).prepareSurface();
  }

  /**
   * Forwarded, never invented: the wrapper cannot watch a page it does not own, so a driver that offers no
   * wait keeps the old behaviour (a recoverable blocker ends the run) exactly.
   */
  async waitForSurfaceReady(): Promise<boolean> {
    const inner = (await this.inner()) as IdentityAwareDriver;
    return inner.waitForSurfaceReady ? inner.waitForSurfaceReady() : false;
  }

  async locateReviewRow(): Promise<LocateRowResult> {
    const res = await (await this.inner()).locateReviewRow();
    this.rowMatchCount = res.count;
    return res;
  }

  async highlightRow(): Promise<LocateRowResult> {
    return (await this.inner()).highlightRow();
  }

  async armRowObserve(): Promise<void> {
    return (await this.inner()).armRowObserve();
  }

  async waitForRowOpen(): Promise<boolean> {
    return (await this.inner()).waitForRowOpen();
  }

  /** The runtime's own press on the verified row's open control — only when the inner driver can name it. */
  async openComposer(): Promise<ComposerOpenResult> {
    const inner = await this.inner();
    if (!inner.openComposer) return { opened: false, reason: "NOT_SUPPORTED" };
    return inner.openComposer();
  }

  async locateComposer(): Promise<LocateComposerResult> {
    const res = await (await this.inner()).locateComposer();
    this.composerCount = res.count;
    return res;
  }

  async highlight(): Promise<void> {
    return (await this.inner()).highlight();
  }

  /** The gated fill. Ambiguity ⇒ nothing is written and the run reaches the barrier unfilled. */
  async fillComposer(): Promise<ComposerFillResult> {
    const opened = this.opened;
    if (!opened) return { filled: false, reason: "NOT_FILLABLE" };
    const decision = composerFillDecision({
      rowMatchCount: this.rowMatchCount,
      matchedRowIndex: this.rowMatchCount === 1 ? 0 : null,
      reviewId: this.deps.reviewIdVerdict?.() ?? opened.inner.reviewIdVerdict?.() ?? { kind: "UNAVAILABLE" },
      composerCount: this.composerCount,
      hasDraft: this.deps.draftBody != null && this.deps.draftBody.length > 0,
    });
    if (!decision.fill) return { filled: false, reason: decision.reason };
    return fillComposer(opened.page, this.deps.draftBody!);
  }

  async armObserve(): Promise<void> {
    return (await this.inner()).armObserve();
  }

  async waitForSubmit(): Promise<boolean> {
    return (await this.inner()).waitForSubmit();
  }

  async cleanup(): Promise<void> {
    const opened = this.opened;
    this.opened = null;
    if (opened) await opened.inner.cleanup();
  }
}
