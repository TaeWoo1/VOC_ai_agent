import type { OperatorVocItem } from "../lib/types";
import { replyStatusLabel } from "../lib/vocItems";

// One drill-down row behind an attention signal: reply chip, ★rating, and the
// 작성/수집 dates. Metadata only — the item carries no article text or PII.

export function VocItemCard({ item }: { item: OperatorVocItem }) {
  const reply = replyStatusLabel(item.replyStatus);
  return (
    <li className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
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
    </li>
  );
}
