import { Link } from "react-router-dom";
import type { ReviewListArtifact as ReviewList } from "../../../lib/conversation/types";
import { Status } from "../../ui/Status";
import { previewText } from "../../../lib/plainText";
import { ArtifactCard } from "./ArtifactCard";
import { FRESHNESS_LABEL, FRESHNESS_TONE } from "./freshness";
import { useContinueInPanel } from "../useContinueInPanel";

/**
 * Review rows: state word · ★ rating · the customer's sentence (or 「별점만」) · product. One freshness
 * line per channel underneath, in seller words — a list that cannot prove it is current says so
 * beside the rows rather than pretending the rows are all there is.
 */
export function ReviewListArtifact({ artifact }: { artifact: ReviewList }) {
  const onOpen = useContinueInPanel("REVIEW_LIST");
  return (
    <ArtifactCard title={artifact.title} note={artifact.note}>
      {artifact.items.length === 0 ? (
        <p className="px-4 pb-2 text-sm text-muted">보여드릴 리뷰 행이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {artifact.items.map((r) => (
            <li key={r.reviewId}>
              <Link to={r.to} onClick={onOpen} className="flex items-start gap-3 px-4 py-3 transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <Status tone={r.negative ? "bad" : "neutral"} variant="word">{r.negative ? "부정" : "리뷰"}</Status>
                    {r.rating != null ? <span className="text-sm tabular-nums text-muted">★ {r.rating}</span> : null}
                    <span className="break-keep text-sm text-muted">{[r.channelNameKo, r.writtenOn].filter(Boolean).join(" · ")}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 break-keep text-base font-semibold leading-snug text-ink">
                    {r.preview ? previewText(r.preview) : "별점만"}
                  </p>
                  {r.productName ? <p className="mt-0.5 break-keep text-sm text-muted">{r.productName}</p> : null}
                </div>
                <span aria-hidden="true" className="text-muted">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {artifact.freshness.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line/70 px-4 py-2" aria-label="채널별 수집 상태">
          {artifact.freshness.map((f) => (
            <li key={f.channelCode} className="flex items-center gap-1.5 text-sm text-muted">
              <span>{f.channelNameKo ?? f.channelCode}</span>
              <Status tone={FRESHNESS_TONE[f.verdict]} variant="word">{FRESHNESS_LABEL[f.verdict]}</Status>
            </li>
          ))}
        </ul>
      ) : null}
      {artifact.more ? (
        <p className="px-4 py-2">
          <Link to={artifact.more.to} onClick={onOpen} className="text-sm font-semibold text-brand-700 hover:underline">{artifact.more.label}</Link>
        </p>
      ) : null}
    </ArtifactCard>
  );
}
