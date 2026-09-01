import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ReviewDetailArtifact as ReviewDetail } from "../../../lib/conversation/types";
import { Status } from "../../ui/Status";
import { Btn, BtnLink } from "../../ui/Btn";
import { api } from "../../../lib/apiClient";
import { previewText } from "../../../lib/plainText";
import { useContinueInPanel } from "../useContinueInPanel";

/** The prompt the primary action sends — a sentence this conversation already understands. */
const DRAFT_PROMPT = "답글 초안 준비해줘";

/**
 * ONE review, inspected (Agent Object + First-use Closure v1 §1).
 *
 * <b>The customer's sentence is the biggest text</b>, exactly as it is on the inquiry card: the seller
 * opened this object to read what was written, not to read our labels. The closed facts sit above it in
 * one line, and what the review is already evidence FOR sits under it as links into issue memory.
 *
 * <b>The body is transient and re-read, never stored twice.</b> The runtime strips it before persisting
 * the turn (identity is kept, the customer's words are not), so a reloaded thread asks the same exact
 * endpoint for them again — one READ, org-scoped, the same one the anchor stands on.
 */
export function ReviewDetailArtifact({ artifact, onPrompt }: { artifact: ReviewDetail; onPrompt?: (prompt: string) => void }) {
  const onOpen = useContinueInPanel("REVIEW_DETAIL");
  const [reloaded, setReloaded] = useState<string | null>(null);
  const body = artifact.body ?? reloaded;

  useEffect(() => {
    if (artifact.body) return;
    let live = true;
    api.getReviewDetailStrict(artifact.reviewId)
      .then((detail) => {
        if (live) setReloaded(detail.body);
      })
      .catch(() => {
        // The card still stands on its closed facts; the review screen has the whole text.
      });
    return () => {
      live = false;
    };
  }, [artifact.body, artifact.reviewId]);

  const meta = [
    artifact.channelNameKo ?? artifact.channelCode,
    artifact.productName,
    artifact.writtenOn,
  ].filter(Boolean).join(" · ");
  return (
    <section aria-label={artifact.title} data-testid="review-detail-artifact" className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="space-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {artifact.rating != null ? (
            <Status tone={artifact.negative ? "bad" : "neutral"} variant="word">{`★ ${artifact.rating}`}</Status>
          ) : null}
          {meta ? <span className="break-keep text-sm text-muted">{meta}</span> : null}
        </div>
        {body ? (
          <p className="whitespace-pre-wrap break-keep border-l-2 border-line pl-3 text-lg leading-relaxed text-ink" data-testid="review-detail-body">
            {previewText(body)}
          </p>
        ) : null}
        {artifact.issues.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>반복 문제</span>
            {artifact.issues.map((issue) => (
              <Link key={issue.issueId} to={issue.to} onClick={onOpen} className="font-medium text-ink hover:underline">
                {issue.title}
              </Link>
            ))}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {artifact.replyCapability === "DRAFTABLE" && onPrompt ? (
            <Btn size="sm" onClick={() => onPrompt(DRAFT_PROMPT)}>답글 초안</Btn>
          ) : null}
          <BtnLink to={artifact.to} variant="outline" size="sm" onClick={onOpen}>리뷰 화면에서 열기</BtnLink>
          {artifact.productId && artifact.productName ? (
            <Link to={`/products/${artifact.productId}`} onClick={onOpen} className="text-sm text-muted hover:text-ink hover:underline">
              상품 보기
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
