import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/apiClient";
import type { ProactiveSummaryView } from "../../lib/types";

/**
 * 홈's entry point into 「AI가 먼저 확인한 일」 — one line and a link.
 *
 * <b>Deliberately not the list.</b> The cards live on 문의, where the work is; reprinting them here
 * would make the seller read the same four items twice and decide on neither. What the home screen
 * owes them is the knowledge that the work exists and one press to reach it.
 *
 * Renders nothing when there is nothing prepared — a dashboard line that says "0건" every morning is
 * a line that stops being read by the second week.
 */
export function ProactiveSummaryBanner() {
  const [summary, setSummary] = useState<ProactiveSummaryView | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const data = await api.getProactiveSummary();
        if (live) setSummary(data);
      } catch {
        if (live) setSummary(null);   // fail-soft: the home screen is not about this
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!summary || summary.open === 0) {
    return null;
  }

  return (
    <Link
      to="/inquiries"
      /* The one thing on 홈 the seller did not ask for, at the emphasis that says so. It used to be
         border-line on bg-surface — visually identical to every other panel on the page, which put
         the screen's only prepared work at the same weight as its furniture. */
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/30 bg-brand-50 px-5 py-4 transition hover:border-brand/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
    >
      <div className="min-w-0">
        <p className="break-keep font-semibold text-ink">
          AI가 먼저 확인한 일 <span className="tabular-nums">{summary.open}</span>건
        </p>
        <p className="mt-0.5 break-keep text-sm text-muted">
          {summary.draftsPrepared > 0
            ? `그중 ${summary.draftsPrepared}건은 답변 초안까지 준비돼 있습니다. 보낼지는 직접 확인합니다.`
            : "확인이 필요한 이유와 근거를 미리 정리해 뒀습니다."}
        </p>
      </div>
      <span className="inline-flex min-h-[36px] shrink-0 items-center justify-center rounded-xl bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white">
        확인하러 가기
      </span>
    </Link>
  );
}
