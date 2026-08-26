import { Link } from "react-router-dom";
import type { FeedItem, ItemAnalysis } from "../../lib/types";
import { TYPE_LABEL, itemTitle, needsCheck, needsReply } from "../../lib/inboxWorkspace";
import { sentimentChip, urgencyChip } from "../../lib/inboxView";
import { relativeTime } from "../../lib/format";
import { Chip } from "../ui/Chip";
import { Disclosure } from "../ui/Disclosure";
import { InquiryResponsePanel } from "./InquiryResponsePanel";
import { plainText, previewText } from "../../lib/plainText";

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
 *
 * <b>The heading is not the product (Demo UX Polish v1).</b> `itemTitle` falls back to the product
 * name, and this org's Cafe24 backlog is largely unattributed — so the pane's largest text used to
 * read 「상품 미지정」 on inquiry after inquiry while the customer's actual question sat far below it.
 * An inquiry is now headed by what the customer wrote, and when the response panel renders (which
 * opens with 고객 문의 and its own context line) this header carries no heading at all rather than
 * saying the same thing twice one block apart.
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
  // The panel owns 고객 문의 — title, body, channel, product and the 상품 지정 control — whenever it
  // renders. Repeating any of it above would be the same fact twice on one screen.
  const panelOwnsTheQuestion = !!workItemId && item.type === "INQUIRY";
  const heading =
    item.type === "INQUIRY" ? previewText(item.snippet) || "문의" : itemTitle(item);

  return (
    <article aria-label="선택한 항목" className="space-y-4">
      {/* Status is a WORD on one line, not a row of pills (Executive-friendly UX Redesign v1). Three
          chips at the top of the pane were the first thing the eye landed on, above the question the
          seller opened this row to read. */}
      <header>
        {/* Every word of this line is said again within one screen when the panel owns the question
            (Executive Readiness Fix v1): 유형 is the page title, 시각 is in the panel's own context
            line, and the status is on the highlighted row in the rail to the left. It cost 38px at
            the top of the pane — which at 125% zoom is the difference between seeing the draft and
            not. It stays for a review, which has no panel. */}
        {panelOwnsTheQuestion ? null : (
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span>{TYPE_LABEL[item.type]}</span>
            {needsReply(item) ? <span className="font-semibold text-warn">답변 필요</span> : null}
            {needsCheck(item) ? <span className="font-semibold text-bad">확인 필요</span> : null}
            <span>{relativeTime(item.receivedAt)}</span>
          </p>
        )}
        {panelOwnsTheQuestion ? null : (
          <>
            <h2 className="mt-3 break-keep text-lg font-bold leading-snug text-ink">{heading}</h2>
            <p className="mt-1.5 break-keep text-sm text-muted">
              {item.channelNameKo}
              {item.productName ? ` · ${item.productName}` : ""}
              {item.rating != null ? ` · 별점 ${item.rating}` : ""}
            </p>
          </>
        )}
      </header>

      {/* The text itself. A review only ever has the feed's snippet; an inquiry gets its full body from
          the response panel below WHEN a work item resolves — otherwise the snippet is all there is,
          and a detail pane that named the product but never showed the question was a real gap (A7).
          Either way it is labelled 발췌, not 원문. */}
      {panelOwnsTheQuestion ? null : (
        <section>
          <h3 className="text-sm font-semibold text-muted">
            {item.type === "REVIEW" ? "리뷰 발췌" : "문의 발췌"}
          </h3>
          <p className="mt-1.5 whitespace-pre-wrap break-keep leading-relaxed text-ink">
            {plainText(item.snippet)}
          </p>
        </section>
      )}

      {workItemId ? <InquiryResponsePanel workItemId={workItemId} /> : null}

      {/* Classification is a hint about the row, not a finding — and it is not why the seller opened
          it. Closed by default: three chips, a summary sentence and a disclaimer were four lines of
          the same grey competing with 고객 문의 and the draft above them. */}
      {analysis ? (
        <Disclosure className="border-t border-line pt-4" label={`자동 분류 · ${analysis.category}`}>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {urgency ? <Chip>긴급도 {urgency.label}</Chip> : null}
            {sentiment ? <Chip>{sentiment.label}</Chip> : null}
          </div>
          <p className="mt-2 break-keep text-sm leading-relaxed text-muted">{analysis.summary}</p>
          {/* Seller language, not the analyzer's name and version: the fact that matters is that this
              is an automatic keyword classification that may be wrong. */}
          <p className="mt-1 text-sm text-muted">키워드로 자동 분류한 것이라 정확하지 않을 수 있습니다.</p>
        </Disclosure>
      ) : null}

      {!workItemId && item.type === "INQUIRY" ? (
        <p className="break-keep text-sm leading-relaxed text-muted">
          이 문의에는 SellerOps가 답변 방향을 제안할 수 없습니다. 답변은 해당 채널의 판매자센터에서
          직접 작성합니다.
        </p>
      ) : null}

      <footer className="border-t border-line pt-4">
        <Link
          to="/memory"
          className="inline-flex rounded-lg text-sm font-semibold text-brand-700 transition hover:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
        >
          같은 문제가 반복되는지 보기
        </Link>
      </footer>
    </article>
  );
}
