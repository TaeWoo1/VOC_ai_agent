import type { OperatorVocItem } from "../lib/types";
import { previewText, replyStatusLabel } from "../lib/vocItems";

// One drill-down row behind an attention signal: reply chip, ★rating, dates, and a
// sanitized preview line. The preview is produced/redacted by the backend — this
// only renders it, or a neutral placeholder when none is available. No raw text.

export function VocItemCard({ item }: { item: OperatorVocItem }) {
  const reply = replyStatusLabel(item.replyStatus);
  const preview = previewText(item.safePreview);
  return (
    <li className="flex flex-col gap-2 py-3">
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
    </li>
  );
}
