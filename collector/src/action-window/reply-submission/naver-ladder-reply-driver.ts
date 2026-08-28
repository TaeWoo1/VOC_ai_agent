/**
 * **NAVER reply driver for the resident (conversation-started) guided run — identity by the review-id ladder.**
 *
 * The seated CLI's `NaverReplySubmitProbeDriver` locates rows through an operator-calibrated structural mapping
 * that only a seated operator can produce. A run started from a conversation has no operator at the keyboard,
 * so this driver locates the exact review the way the review-id probe already does — the in-page ladder over
 * the generic row containers — and accepts a row ONLY when the backend's channel-review-id fingerprint is
 * found on exactly one row (Acceptance Closure §3: hint-only identity is not enough to fill). The rating in the
 * target hint is a secondary check, never the identity.
 *
 * Boundaries, same as the calibrated driver: read-only in-page strings, counts/booleans/opaque sigs out; the
 * one click (`reply-composer-open.ts`) and the one fill (`reply-composer-fill.ts`) live elsewhere and are
 * called by name. The composer is looked for INSIDE the matched row's exclusive scope, never document-wide.
 */
import type { ReplyPageLike } from "./naver-reply-driver";
import type { ComposerFillResult, ReviewIdMatchVerdict } from "./reply-composer-fill";
import type { ComposerFillPageLike } from "./reply-composer-fill";
import { fillComposer, composerFillDecision } from "./reply-composer-fill";
import type { ComposerOpenPageLike, ComposerOpenResult } from "./reply-composer-open";
import { openComposer } from "./reply-composer-open";
import type { LocateComposerResult, LocateRowResult, SurfaceProbeResult } from "./reply-engine";
import type { ReplySubmitProbeDriver } from "./reply-driver";
import { composerSigFor, replyComposerLocateDecision } from "./reply-surface";
import type { ReplyTargetHint } from "./reply-surface";
import { civilDateParts, parseLadderResult } from "./review-id-ladder-parse";
import { IN_PAGE_ID_OUTLINE_TEARDOWN, inPageOutlineRowAt, inPageReviewIdLadder } from "./review-id-probe-inpage";
import {
  IN_PAGE_ANNOTATE_SCOPED_COMPOSER,
  IN_PAGE_ARM_OPEN_OBSERVER,
  IN_PAGE_LOGIN_SIGNAL,
  IN_PAGE_SCOPED_COMPOSER_SIGNALS,
  IN_PAGE_SCOPED_TEARDOWN,
  IN_PAGE_TAG_OPEN_CONTROL,
} from "./reply-row-composer-inpage";

export type LadderReplyPage = ReplyPageLike & ComposerFillPageLike & ComposerOpenPageLike;

export interface NaverLadderReplyDriverOptions {
  /** The privacy-safe hint (rating is the only part this driver reads, as a secondary check). */
  hint: ReplyTargetHint;
  /** KST as-of civil date the ladder's recency bucket is derived against. */
  asOfDate: string;
  /** SHA-256 of the channel review id the backend holds. Absent ⇒ no row can be proven ⇒ fail closed. */
  reviewIdFingerprint: string | null;
  /** The approved draft, byte for byte; held here for the fill and nowhere else. */
  draftBody: string | null;
  submitTimeoutMs?: number;
  rowOpenTimeoutMs?: number;
}

const ARM_SUBMIT_OBSERVER = `(() => {
  window.__awReplyObserved = false;
  var composer = document.querySelector('[data-aw-reply-target]');
  var scope = composer ? (composer.closest('form') || composer.parentElement || document) : document;
  scope.addEventListener('click', function (ev) {
    var t = ev.target;
    if (composer && t && composer.contains && composer.contains(t)) { return; }
    window.__awReplyObserved = true;
  }, true);
  return true;
})()`;

export class NaverLadderReplyDriver implements ReplySubmitProbeDriver {
  private readonly page: LadderReplyPage;
  private readonly hint: ReplyTargetHint;
  private readonly asOfDate: string;
  private readonly reviewIdFingerprint: string | null;
  private readonly draftBody: string | null;
  private readonly submitTimeoutMs: number;
  private readonly rowOpenTimeoutMs: number;
  private matchedRowIndex: number | null = null;
  private matchCount = 0;
  private composerCount = 0;

  constructor(page: LadderReplyPage, opts: NaverLadderReplyDriverOptions) {
    this.page = page;
    this.hint = opts.hint;
    this.asOfDate = opts.asOfDate;
    this.reviewIdFingerprint = opts.reviewIdFingerprint && /^[0-9a-f]{64}$/.test(opts.reviewIdFingerprint)
      ? opts.reviewIdFingerprint : null;
    this.draftBody = opts.draftBody;
    this.submitTimeoutMs = opts.submitTimeoutMs ?? 600_000;
    this.rowOpenTimeoutMs = opts.rowOpenTimeoutMs ?? this.submitTimeoutMs;
  }

  async prepareSurface(): Promise<SurfaceProbeResult> {
    const loggedIn = await this.page.evaluate<boolean>(IN_PAGE_LOGIN_SIGNAL);
    if (!loggedIn) return { ok: false, code: "LOGIN_REQUIRED" };
    return true;
  }

  /** The ladder: rows carrying the backend's review-id fingerprint. Exactly one, or nothing. */
  private async ladder(): Promise<{ count: number; rowIndex: number | null; truncated: boolean }> {
    if (!this.reviewIdFingerprint) return { count: 0, rowIndex: null, truncated: false };
    const parts = civilDateParts(this.asOfDate);
    if (!parts) return { count: 0, rowIndex: null, truncated: false };
    const raw = await this.page.evaluate<unknown>(inPageReviewIdLadder(parts));
    const parsed = parseLadderResult(raw);
    const hits = parsed.candidates.filter((c) => c.idFingerprints.some((f) => f.fingerprint === this.reviewIdFingerprint));
    // Secondary: when the row offers a single rating reading it must agree with the hint. A row that offers
    // none is not contradicted — the identity is the fingerprint, the rating only refuses a contradiction.
    const consistent = hits.filter((c) => (c.secondary?.rating ?? null) === null || c.secondary?.rating === this.hint.rating);
    return {
      count: consistent.length,
      rowIndex: consistent.length === 1 ? consistent[0]!.rowIndex : null,
      truncated: parsed.rowsTruncated || parsed.tokensTruncated,
    };
  }

  async locateReviewRow(): Promise<LocateRowResult> {
    const d = await this.ladder();
    this.matchCount = d.count;
    this.matchedRowIndex = d.rowIndex;
    // A truncated scan that found nothing is "not established", which the engine reads as not found; a
    // truncated scan that found exactly one is still exactly one on what was seen — accepted, like the probe.
    if (d.count === 1 && d.rowIndex !== null) return { count: 1, sig: composerSigFor(["ladder-row", d.rowIndex]) };
    return { count: d.count };
  }

  async highlightRow(): Promise<LocateRowResult> {
    const d = await this.ladder();
    if (d.count !== 1 || d.rowIndex === null || d.rowIndex !== this.matchedRowIndex || !this.reviewIdFingerprint) {
      this.matchedRowIndex = null;
      return { count: d.count };
    }
    const outcome = await this.page.evaluate<string>(inPageOutlineRowAt(d.rowIndex, this.reviewIdFingerprint));
    if (outcome !== "outlined") {
      this.matchedRowIndex = null;
      return { count: 0 };
    }
    return { count: 1, sig: composerSigFor(["ladder-row", d.rowIndex]) };
  }

  /** The Agent's own press on the row's NON-SUBMIT open control. Ambiguity ⇒ the seller is asked instead. */
  async openComposer(): Promise<ComposerOpenResult> {
    if (this.matchedRowIndex === null) return { opened: false, reason: "NOT_FOUND" };
    const tagged = await this.page.evaluate<number>(IN_PAGE_TAG_OPEN_CONTROL);
    if (tagged === 0) {
      // Nothing to press: either the composer is already showing in this row's scope or no open word exists.
      const signals = await this.page.evaluate<{ composerCandidateCount: number }>(IN_PAGE_SCOPED_COMPOSER_SIGNALS);
      return signals.composerCandidateCount === 1 ? { opened: true } : { opened: false, reason: "NOT_FOUND" };
    }
    if (tagged !== 1) return { opened: false, reason: tagged > 1 ? "AMBIGUOUS" : "NOT_FOUND" };
    return openComposer(this.page);
  }

  async armRowObserve(): Promise<void> {
    if (this.matchedRowIndex === null) return;
    await this.page.evaluate(IN_PAGE_TAG_OPEN_CONTROL).catch(() => undefined);
    await this.page.evaluate(IN_PAGE_ARM_OPEN_OBSERVER);
  }

  async waitForRowOpen(): Promise<boolean> {
    if (this.matchedRowIndex === null) return false;
    try {
      await this.page.waitForFunction("window.__awReplyRowObserved === true", { timeout: this.rowOpenTimeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  /** Composers INSIDE the matched row's scope only. */
  async locateComposer(): Promise<LocateComposerResult> {
    if (this.matchedRowIndex === null) return { count: 0 };
    const signals = await this.page.evaluate<{ composerCandidateCount: number; structuralFingerprint: number }>(
      IN_PAGE_SCOPED_COMPOSER_SIGNALS,
    );
    this.composerCount = signals.composerCandidateCount;
    return replyComposerLocateDecision({
      composerCandidateCount: signals.composerCandidateCount,
      composerSignatureParts: signals.composerCandidateCount === 1 ? [signals.structuralFingerprint] : undefined,
    });
  }

  async highlight(): Promise<void> {
    if (this.matchedRowIndex === null) return;
    this.composerCount = await this.page.evaluate<number>(IN_PAGE_ANNOTATE_SCOPED_COMPOSER);
  }

  /** What the ladder established about the review id — MATCHED only on exactly one verified row. */
  reviewIdVerdict(): ReviewIdMatchVerdict {
    if (!this.reviewIdFingerprint) return { kind: "UNAVAILABLE" };
    if (this.matchCount === 1 && this.matchedRowIndex !== null) return { kind: "MATCHED", rowIndex: this.matchedRowIndex };
    return { kind: "AMBIGUOUS", matchCount: this.matchCount };
  }

  async fillComposer(): Promise<ComposerFillResult> {
    const decision = composerFillDecision({
      rowMatchCount: this.matchCount,
      matchedRowIndex: this.matchedRowIndex,
      reviewId: this.reviewIdVerdict(),
      composerCount: this.composerCount,
      hasDraft: this.draftBody != null && this.draftBody.length > 0,
    });
    if (!decision.fill) return { filled: false, reason: decision.reason };
    return fillComposer(this.page, this.draftBody!);
  }

  async armObserve(): Promise<void> {
    await this.page.evaluate(ARM_SUBMIT_OBSERVER);
  }

  async waitForSubmit(): Promise<boolean> {
    try {
      await this.page.waitForFunction("window.__awReplyObserved === true", { timeout: this.submitTimeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  async cleanup(): Promise<void> {
    await this.page.evaluate(IN_PAGE_SCOPED_TEARDOWN).catch(() => undefined);
    await this.page.evaluate(IN_PAGE_ID_OUTLINE_TEARDOWN).catch(() => undefined);
  }
}
