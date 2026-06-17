import { useState } from "react";
import { EmptyState } from "./EmptyState";
import { relativeTime } from "../lib/format";
import {
  analysisKey,
  primaryAction,
  sentimentChip,
  urgencyChip,
  type ActionTone,
  type ChipTone,
} from "../lib/inboxView";
import type { FeedItem, ItemAnalysis } from "../lib/types";

const ACTION_CLASS: Record<ActionTone, string> = {
  warn: "bg-warn/10 text-warn",
  bad: "bg-bad/10 text-bad",
  muted: "bg-canvas text-muted",
};

const CHIP_CLASS: Record<ChipTone, string> = {
  good: "bg-good/10 text-good",
  warn: "bg-warn/10 text-warn",
  bad: "bg-bad/10 text-bad",
  neutral: "bg-ink/5 text-ink",
};

/** One inbox card. Action-first and scannable: the collapsed view leads with the
 *  next-action chip plus at most two analysis hints (category, and urgency when
 *  it is 높음/보통). Detailed analysis values (full summary, 감정, 분석 방식) are
 *  hidden behind a click-to-expand "자세히" control — never hover (weak on mobile,
 *  inaccessible). Read-only: no links, no status mutation. The disclosed method
 *  is honestly "규칙 기반" (never "AI"); no model/prompt metadata or raw body is
 *  shown. Cards without a stored analysis show no control and no "분석 전" marker. */
function InboxCard({ item, analysis }: { item: FeedItem; analysis?: ItemAnalysis }) {
  const [expanded, setExpanded] = useState(false);
  const action = primaryAction(item, analysis);
  const urg = analysis ? urgencyChip(analysis.urgency) : null;
  const sent = analysis ? sentimentChip(analysis.sentiment) : null;
  const showUrgencyHint = analysis?.urgency === "HIGH" || analysis?.urgency === "NORMAL";

  return (
    <li className="rounded-xl bg-canvas px-4 py-4">
      <div className="flex flex-wrap items-center gap-2 text-base text-muted">
        <span
          className={`rounded-lg px-2 py-0.5 text-sm font-semibold ${
            item.type === "INQUIRY" ? "bg-brand/10 text-brand-700" : "bg-ink/5 text-ink"
          }`}
        >
          {item.type === "INQUIRY" ? "문의" : "리뷰"}
        </span>
        <span>{item.channelNameKo}</span>
        <span aria-hidden>·</span>
        <span className="font-medium text-ink">{item.productName}</span>
        {item.type === "REVIEW" && item.rating != null ? (
          <span className="rounded bg-ink/5 px-1.5 text-sm text-ink">★{item.rating}</span>
        ) : null}
        {item.status === "UNANSWERED" ? (
          <span className="rounded bg-warn/10 px-1.5 text-sm text-warn">미답변</span>
        ) : null}
        {item.status === "NEGATIVE" ? (
          <span className="rounded bg-bad/10 px-1.5 text-sm text-bad">부정</span>
        ) : null}
      </div>

      <p className="mt-2 text-lg leading-relaxed text-ink">{item.snippet}</p>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Strongest element: the operator's next action. */}
          <span
            className={`rounded-lg px-3 py-1 text-sm font-semibold ${ACTION_CLASS[action.tone]}`}
          >
            {action.label}
          </span>
          {/* Subordinate group: small hints + a secondary expand control. */}
          {analysis ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className={`rounded px-1.5 py-0.5 ${CHIP_CLASS.neutral}`}>
                {analysis.category}
              </span>
              {urg && showUrgencyHint ? (
                <span className={`rounded px-1.5 py-0.5 ${CHIP_CLASS[urg.tone]}`}>
                  긴급도 {urg.label}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                {expanded ? "접기 ▴" : "자세히 ▾"}
              </button>
            </div>
          ) : null}
        </div>
        <span className="shrink-0 text-sm text-muted">{relativeTime(item.receivedAt)}</span>
      </div>

      {analysis && urg && sent && expanded ? (
        <dl className="mt-2 space-y-0.5 border-t border-line pt-2 text-sm text-muted">
          <div>
            <dt className="inline font-medium text-ink">운영 분류</dt>
            <dd className="inline">: {analysis.summary}</dd>
          </div>
          <div>
            <dt className="inline">카테고리</dt>
            <dd className="inline">: {analysis.category}</dd>
          </div>
          <div>
            <dt className="inline">긴급도</dt>
            <dd className="inline">: {urg.label}</dd>
          </div>
          <div>
            <dt className="inline">감정</dt>
            <dd className="inline">: {sent.label}</dd>
          </div>
          <div>
            <dt className="inline">추천</dt>
            <dd className="inline">: {analysis.recommendedAction}</dd>
          </div>
          <div>
            <dt className="inline">분석 방식</dt>
            <dd className="inline">: 규칙 기반</dd>
          </div>
        </dl>
      ) : null}
    </li>
  );
}

/** The integrated-inbox card list. Read-only and presentational: it renders only
 *  the fields the backend returns (snippet is already PII-masked there) and never
 *  shows the author or raw body. Analysis enrichment is joined per card by
 *  (type,id) and shown action-first with click-to-expand detail (see InboxCard). */
export function InboxFeed({
  items,
  analysisIndex,
}: {
  items: FeedItem[];
  analysisIndex?: Map<string, ItemAnalysis>;
}) {
  if (items.length === 0) {
    return <EmptyState message="해당 조건의 항목이 없습니다." />;
  }
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <InboxCard
          key={it.id}
          item={it}
          analysis={analysisIndex?.get(analysisKey(it.type, it.id))}
        />
      ))}
    </ul>
  );
}
