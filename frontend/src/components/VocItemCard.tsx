import type { OperatorVocItem } from "../lib/types";
import { previewText as plainPreview } from "../lib/plainText";
import {
  categoryChip,
  previewText,
  productLabel,
  replyStatusLabel,
  reportedSubmissionLabel,
} from "../lib/vocItems";
import { ReplyWorkControls } from "./ReplyWorkControls";
import { replyWorkStateLabel } from "../lib/replyWorkState";

// One reply-work row (내 답변 작업 · 제외한 작업): the product it concerns, a reply
// chip, ★rating, dates, and a sanitized preview line. The preview is produced/redacted
// by the backend — this only renders it, or a neutral placeholder when none is
// available. No raw text.
//
// The product is a display NAME only — the backend sends no product identifier here —
// so it reads as the row's subject and is deliberately not a link or a routing target.

export function VocItemCard({
  item,
  accountId,
  onOutcomeRecorded,
  triageMode = "edit",
}: {
  item: OperatorVocItem;
  accountId: string;
  /** Bubbled to the list so the count and this row's badge reflect a reply the operator just posted. */
  onOutcomeRecorded?: () => void;
  /**
   * Whether this row offers to CHANGE the triage decision, or only shows it.
   *
   * "edit" (default) renders the interactive control. "readonly" renders a compact label instead, for the 내 답변 작업
   * worklist: there a full toggle group reads as a competing "take it off my list" control beside
   * 작업에서 제외, and moving a DRAFTED row to 지켜보기 silently fails to remove it. The decision is made
   * on the 리뷰 screen's detail (product assembly A6). The reply flow itself is unchanged in both modes.
   */
  triageMode?: "edit" | "readonly";
}) {
  const reply = replyStatusLabel(item.replyStatus);
  const preview = previewText(item.safePreview);
  const product = productLabel(item.productName);
  const category = categoryChip(item.category);
  const reported = reportedSubmissionLabel(item.hasReportedSubmission);
  // What the SELLER is being asked to do, as opposed to what the channel said (reply) or what the
  // review is about (category). It leads the chip row because it is the only one of the four that
  // tells the seller whether this row is the one they came to finish.
  const workState = replyWorkStateLabel(item.replyWorkState);

  return (
    /* A div, not an li: every caller already wraps this in its own <li> with its own padding, so
       the card's own <li> made a list item inside a list item — invalid HTML, and a real DOM-nesting
       warning in the console on the 리뷰 screen (Demo UX Polish v1). */
    <div className="flex flex-col gap-2">
      {/* Subject line. The visually-redundant prefix is sr-only so the placeholder
          ("상품명 미상") is not announced as a bare, context-free string. */}
      <p
        className={`text-sm font-semibold ${product.isPlaceholder ? "text-muted italic font-normal" : "text-ink"}`}
      >
        <span className="sr-only">상품: </span>
        {product.text}
      </p>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {workState != null ? (
            <span
              className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-semibold ${
                item.replyWorkState === "AWAITING_APPROVAL" ? "bg-brand-50 text-brand-700" : "bg-canvas text-ink"
              }`}
              data-testid="reply-work-state"
            >
              <span className="sr-only">답변 작업: </span>
              {workState}
            </span>
          ) : null}
          <span
            className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-semibold ${reply.cls}`}
          >
            {reply.text}
          </span>
          {item.rating != null ? (
            <span className="text-sm font-semibold text-ink">{"★".repeat(item.rating)}</span>
          ) : null}
          {/* What the review is about, per the stored rule-based analysis. Context only — it
              does not decide whether the row is here. Absent when nothing analyzed the row:
              no chip at all, never a placeholder and never 기타 (see categoryChip). */}
          {/* SellerOps' own record, beside the channel's chip and never merged into it: one says
              what the marketplace reported at the last import, the other what the operator says they
              did since. This row is already excluded from the headline count and sorted to the
              bottom — the badge is what makes that visible instead of merely true. */}
          {reported != null ? (
            <span
              className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium ${reported.cls}`}
            >
              {reported.text}
            </span>
          ) : null}
          {category != null ? (
            <span
              className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium ${category.cls}`}
            >
              <span className="sr-only">분류: </span>
              {category.text}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-4 text-sm text-muted">
          <span>작성 {item.sourceCreatedDate ?? "날짜 미상"}</span>
          <span>수집 {item.collectedDate ?? "-"}</span>
        </div>
      </div>
      <p className={`text-sm ${preview.isPlaceholder ? "text-muted italic" : "text-ink"}`}>
        {preview.isPlaceholder ? preview.text : plainPreview(preview.text)}
      </p>
      {/* Only for a row that can actually carry a decision. A null actionRef is a
          capability limit (a Cafe24 community article has no triage anchor), so the row
          stays fully readable and simply offers nothing — rendering a disabled control
          would say "you may not", when the truth is "this row cannot be decided".

          The decision control and the reply panel are one shared cluster (`ReplyWorkControls`) —
          the same one the 리뷰 detail mounts — so the two surfaces cannot drift in mount rule,
          gate or copy. */}
      {item.actionRef != null ? (
        <ReplyWorkControls
          accountId={accountId}
          actionRef={item.actionRef}
          disposition={item.triageDisposition}
          hasReplyPreparation={item.hasReplyPreparation}
          triageMode={triageMode}
          onOutcomeRecorded={onOutcomeRecorded}
        />
      ) : null}
    </div>
  );
}
