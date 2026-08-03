import { Link } from "react-router-dom";
import type { FeedItem, ItemAnalysis } from "../../lib/types";
import { TYPE_LABEL, itemTitle, needsCheck, needsReply } from "../../lib/inboxWorkspace";
import { sentimentChip, urgencyChip } from "../../lib/inboxView";
import { relativeTime } from "../../lib/format";
import { Chip } from "../ui/Chip";
import { InquiryResponsePanel } from "./InquiryResponsePanel";

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-keep font-medium text-ink">{value}</dd>
    </div>
  );
}

/**
 * Detail panel for one inbox row.
 *
 * WHAT IT SHOWS AND WHAT IT CALLS THINGS. For an inquiry, the full body comes from the inquiry
 * detail read inside `InquiryResponsePanel`, so this header shows context only. For a review, the
 * feed carries a `snippet` and nothing more — so it is labelled 발췌, not 원문. Labelling a
 * fragment as the original text would tell the seller they had read the whole review.
 *
 * The response workflow renders only when a work item resolves for this inquiry. When it does not
 * — a review, or an inquiry outside the queue — nothing about drafting appears at all, rather than
 * a disabled control.
 */
export function InboxDetail({
  item,
  analysis,
  workItemId,
}: {
  item: FeedItem;
  analysis?: ItemAnalysis;
  workItemId: string | null;
}) {
  const urgency = analysis ? urgencyChip(analysis.urgency) : null;
  const sentiment = analysis ? sentimentChip(analysis.sentiment) : null;

  return (
    <article aria-label="선택한 항목" className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{TYPE_LABEL[item.type]}</Chip>
          {needsReply(item) ? <Chip tone="accent">답변 필요</Chip> : null}
          {needsCheck(item) ? <Chip tone="accent">확인 필요</Chip> : null}
          <span className="text-sm text-muted">{relativeTime(item.receivedAt)}</span>
        </div>
        <h2 className="mt-3 break-keep text-xl font-bold text-ink">{itemTitle(item)}</h2>
      </header>

      <dl className="grid grid-cols-2 gap-4">
        <Meta label="채널" value={item.channelNameKo} />
        <Meta label="상품" value={item.productName || "상품명 미상"} />
        {item.rating != null ? <Meta label="별점" value={String(item.rating)} /> : null}
      </dl>

      {item.type === "REVIEW" ? (
        <section>
          <h3 className="text-base font-bold text-ink">리뷰 발췌</h3>
          <p className="mt-2 whitespace-pre-wrap break-keep leading-relaxed text-ink">
            {item.snippet}
          </p>
        </section>
      ) : null}

      {analysis ? (
        <section>
          <h3 className="text-base font-bold text-ink">분류</h3>
          <p className="mt-2 break-keep leading-relaxed text-muted">{analysis.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip>{analysis.category}</Chip>
            {urgency ? <Chip>긴급도 {urgency.label}</Chip> : null}
            {sentiment ? <Chip>{sentiment.label}</Chip> : null}
          </div>
          <p className="mt-2 text-xs text-muted">
            {analysis.analyzerName} {analysis.analyzerVersion}
          </p>
        </section>
      ) : null}

      {workItemId ? (
        <InquiryResponsePanel workItemId={workItemId} />
      ) : item.type === "INQUIRY" ? (
        <p className="text-sm text-muted">
          이 문의는 응답 작업으로 연결되어 있지 않아 제안을 만들 수 없습니다.
        </p>
      ) : null}

      <footer className="border-t border-line pt-5">
        <p className="break-keep text-sm leading-relaxed text-muted">
          같은 문제가 반복되는지는 고객운영 메모리에서 확인할 수 있습니다.
        </p>
        <Link
          to="/memory"
          className="mt-2 inline-flex rounded-lg text-sm font-semibold text-brand-700 transition hover:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
        >
          고객운영 메모리 열기
        </Link>
      </footer>
    </article>
  );
}
