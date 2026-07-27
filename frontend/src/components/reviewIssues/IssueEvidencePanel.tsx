import { useEffect, useState } from "react";
import { api } from "../../lib/apiClient";
import type { ReviewIssueDetailView } from "../../lib/types";
import { renderableQuotes, suppressedQuoteCount } from "../../lib/reviewIssuesView";

/**
 * 근거 리뷰 — the evidence behind one issue, loaded on demand.
 *
 * <p><b>On demand, not with the list.</b> Every issue's evidence requires re-splitting and masking
 * each review body, so eagerly loading it for a whole list would do that work for issues nobody
 * opens.
 *
 * <p><b>Suppressed quotes are counted, not padded.</b> The sanitizer returns null when too little
 * real text survives redaction. Rendering an empty quote would put words the customer never said
 * inside quotation marks, so those rows are dropped — and the count is stated, because an operator
 * reading three quotes out of twenty pieces of evidence should know the list is partial.
 */
export function IssueEvidencePanel({ issueId }: { issueId: string }) {
  const [detail, setDetail] = useState<ReviewIssueDetailView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    api
      .getReviewIssueDetailStrict(issueId)
      .then((data) => {
        if (active) {
          setDetail(data);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [issueId]);

  if (failed) {
    return <p className="mt-2 text-sm text-bad">근거 리뷰를 불러오지 못했습니다.</p>;
  }
  if (!detail) {
    return <p className="mt-2 text-sm text-muted">불러오는 중…</p>;
  }

  const quotes = renderableQuotes(detail.evidence, 5);
  const suppressed = suppressedQuoteCount(detail.evidence);
  const actedNotes = detail.history.filter((h) => h.actor === "OPERATOR" && h.note);

  return (
    <div className="mt-2 space-y-3 border-t border-line pt-3">
      <div>
        <p className="text-sm font-semibold text-ink">대표 고객 표현</p>
        {quotes.length === 0 ? (
          <p className="mt-1 text-sm text-muted">
            표시할 수 있는 표현이 없습니다. 개인정보 보호를 위해 가려졌습니다.
          </p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-muted">
            {quotes.map((quote, index) => (
              <li key={index}>“{quote}”</li>
            ))}
          </ul>
        )}
        {suppressed > 0 ? (
          <p className="mt-1 text-xs text-muted">
            {suppressed}건은 개인정보 보호를 위해 표시하지 않았습니다.
          </p>
        ) : null}
      </div>

      <div>
        <p className="text-sm font-semibold text-ink">근거 리뷰 {detail.evidence.length}건</p>
        <ul className="mt-1 space-y-1 text-sm text-muted">
          {detail.evidence.slice(0, 5).map((row) => (
            <li key={`${row.reviewId}-${row.unitOrdinal}`}>
              {row.occurredOn}
              {row.rating === null ? "" : ` · ${row.rating}점`}
              {row.productName ? ` · ${row.productName}` : ""}
            </li>
          ))}
        </ul>
      </div>

      {actedNotes.length > 0 ? (
        <div>
          <p className="text-sm font-semibold text-ink">조치 기록</p>
          <ul className="mt-1 space-y-1 text-sm text-muted">
            {actedNotes.map((event, index) => (
              <li key={index}>
                {event.toStateLabelKo} · {event.note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
