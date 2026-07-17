import type { OperatorVocItem } from "../lib/types";
import { previewText, productLabel, replyStatusLabel } from "../lib/vocItems";
import { VocItemTriageControl } from "./VocItemTriageControl";

// One drill-down row behind an attention signal: the product it concerns, a reply
// chip, ★rating, dates, and a sanitized preview line. The preview is produced/redacted
// by the backend — this only renders it, or a neutral placeholder when none is
// available. No raw text.
//
// The product is a display NAME only — the backend sends no product identifier here —
// so it reads as the row's subject and is deliberately not a link or a routing target.

export function VocItemCard({ item, accountId }: { item: OperatorVocItem; accountId: string }) {
  const reply = replyStatusLabel(item.replyStatus);
  const preview = previewText(item.safePreview);
  const product = productLabel(item.productName);
  return (
    <li className="flex flex-col gap-2 py-3">
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
          <span
            className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-semibold ${reply.cls}`}
          >
            {reply.text}
          </span>
          {item.rating != null ? (
            <span className="text-sm font-semibold text-ink">{"★".repeat(item.rating)}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-4 text-sm text-muted">
          <span>작성 {item.sourceCreatedDate ?? "날짜 미상"}</span>
          <span>수집 {item.collectedDate ?? "-"}</span>
        </div>
      </div>
      <p className={`text-sm ${preview.isPlaceholder ? "text-muted italic" : "text-ink"}`}>
        {preview.text}
      </p>
      {/* Only for a row that can actually carry a decision. A null actionRef is a
          capability limit (a Cafe24 community article has no triage anchor), so the row
          stays fully readable and simply offers nothing — rendering a disabled control
          would say "you may not", when the truth is "this row cannot be decided". */}
      {item.actionRef != null ? (
        <VocItemTriageControl
          accountId={accountId}
          actionRef={item.actionRef}
          disposition={item.triageDisposition}
        />
      ) : null}
    </li>
  );
}
