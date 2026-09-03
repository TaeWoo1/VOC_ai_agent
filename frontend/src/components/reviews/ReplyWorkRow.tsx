import type { ReactNode } from "react";
import { WorkItem } from "../ui/WorkItem";
import { Status } from "../ui/Status";
import { previewText, productLabel } from "../../lib/vocItems";
import { previewText as plainPreview } from "../../lib/plainText";
import { replyWorkStateWord } from "../../lib/replyWorkState";
import type { OperatorVocItem } from "../../lib/types";

/**
 * One row of review reply work — a QUEUE row, and nothing more.
 *
 * <b>Why this replaced the expanded card.</b> 내 답변 작업 mounted the whole reply-preparation panel
 * for every row: the customer's sentence twice (once as the row's own preview, once inside the
 * panel), four state words that disagreed about what they described (승인 대기 · 상태 미상 ·
 * 대응 필요 · 기타), three explanatory sentences repeated verbatim per row, and a textarea. Measured
 * at 1440 on 2026-09-04 that came to ~570px a row, so four rows of work pushed the review record —
 * the rest of the screen — 4,000px down, and the seller met three task screens stacked on top of
 * each other before reaching the list they came for.
 *
 * A queue row's job is to say what the work is and open it. The place to do the work already exists
 * and is one screen tall: {@code /reviews/reply/{reviewId}}, built by Review Approval Path v1, where
 * the approve control sits at y≈478 with no scroll at any of the three widths. So this row links
 * there. No reply flow, no approval boundary and no draft contract is touched — this is the door,
 * not a second room.
 *
 * <b>One state word.</b> It comes from `lib/workState.ts` through `replyWorkStateWord`, the product's
 * single work vocabulary. The channel's own reply status, the stored category and the operator's
 * reported-submission mark are all still true and all still on the task surface; they are not what a
 * seller scanning a worklist is asking.
 */
export function ReplyWorkRow({
  item,
  dim = false,
  action,
}: {
  item: OperatorVocItem;
  /** A settled row (already reported, or set aside): same information, quieter ink. */
  dim?: boolean;
  /** The list's own control for this row, when it has one (작업에서 제외). */
  action?: ReactNode;
}) {
  const state = replyWorkStateWord(item.replyWorkState);
  const product = productLabel(item.productName);
  const preview = previewText(item.safePreview);
  // The customer's own sentence is what the seller recognises the row by — never the product name,
  // which every row on this account may share.
  const title = preview.isPlaceholder ? preview.text : plainPreview(preview.text);

  return (
    <WorkItem
      // Null reviewId is a capability limit (a Cafe24 community article is not a `reviews` row), so
      // the row stays fully readable and simply offers no door. A dead link would be worse.
      to={item.reviewId ? `/reviews/reply/${item.reviewId}` : undefined}
      state={state?.text ?? null}
      tone={state?.tone ?? "neutral"}
      dim={dim || preview.isPlaceholder}
      title={title}
      meta={
        <>
          {item.rating != null ? (
            <span className="mr-1 font-semibold text-ink" aria-label={`별점 ${item.rating}점`}>
              {"★".repeat(item.rating)}
            </span>
          ) : null}
          {product.isPlaceholder ? product.text : product.text}
        </>
      }
      time={item.sourceCreatedDate ?? undefined}
      action={action}
    />
  );
}

/** The 「기록만 남은」 row's one extra fact, used where a reported reply is listed. */
export function ReportedMark() {
  return <Status tone="neutral">확인 안 함</Status>;
}
