import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SectionHeader } from "../ui/SectionHeader";
import { InsightList } from "../ui/InsightList";
import { ProactiveCases } from "../proactive/ProactiveCases";
import { api } from "../../lib/apiClient";
import { briefingHeadline, briefingInsights, briefingSubline, preparedTitle } from "../../lib/briefing";
import { previewText } from "../../lib/plainText";
import type { InquiryQueueItem, OperationsInsight } from "../../lib/types";

/**
 * <b>The first thing on the home screen: what today looks like, then the work itself.</b>
 *
 * <p>Agent Command Center v1 §0/§3/§4. The screen used to open with a grid of numbers, and the
 * seller had to decide which of six was a problem. It opens with a sentence now — and then, without
 * a click, with the actual operational objects the sentence is counting. That is the whole of what
 * "agentic" means here: it went and looked first. No gradient, no bubble, no glow.
 *
 * <p><b>The sentence is arithmetic, not a summary.</b> It counts the rows rendered underneath it and
 * nothing else, so it cannot be wrong about the screen it is on. No model is called on this screen;
 * the dashboard still works when the day's AI budget is gone, which is a property this product has
 * had since {@code demo_core_experience_v1.md} §7 and does not give up for a greeting.
 *
 * <p><b>No new card framework</b> (§4). Prepared work is rows; 「AI가 먼저 확인한 일」 is the section
 * that already existed; findings are {@link InsightList}, unchanged. What is new is the order and the
 * one sentence on top.
 */
export function AgentBriefing({ insights }: { insights: OperationsInsight[] }) {
  const [prepared, setPrepared] = useState<InquiryQueueItem[]>([]);
  const [preparedReady, setPreparedReady] = useState(false);
  const [proactive, setProactive] = useState(0);
  const [proactiveReady, setProactiveReady] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const page = await api.getInquiryQueueStrict({ phase: "PROPOSED", page: 0, size: 5 });
        if (live) setPrepared(page.content);
      } catch {
        // Fail-soft, like the section below it: a briefing that cannot read one group says less,
        // never nothing. The numbers section under it is the strict read.
        if (live) setPrepared([]);
      } finally {
        if (live) setPreparedReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const onProactive = useCallback((count: number) => {
    setProactive(count);
    setProactiveReady(true);
  }, []);

  const findings = briefingInsights(insights);
  const total = prepared.length + proactive + findings.length;
  // The greeting waits for both reads. A sentence that says 1 and then says 3 a moment later is a
  // sentence the seller learns not to read.
  const ready = preparedReady && proactiveReady;

  return (
    <section className="space-y-5" aria-label="오늘의 브리핑">
      <div>
        <p className="break-keep text-2xl font-bold leading-snug text-ink" aria-live="polite">
          {ready ? briefingHeadline(total) : " "}
        </p>
        {ready && briefingSubline(total) ? (
          <p className="mt-1 break-keep text-base text-muted">{briefingSubline(total)}</p>
        ) : null}
      </div>

      {prepared.length > 0 ? (
        <section className="space-y-2" aria-label="준비된 답변 초안">
          <SectionHeader
            title={preparedTitle(prepared.length)}
            hint="확인하고 보내시면 됩니다. 저장만 되어 있고 아직 아무 곳에도 보내지 않았습니다."
          />
          <ul className="divide-y divide-line/70 rounded-2xl border border-line bg-surface">
            {prepared.map((item) => (
              <li key={item.workItemId}>
                <Link
                  to={`/inquiries/${item.inquiryId}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4 transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
                >
                  <span className="min-w-0 flex-1 break-keep font-semibold text-ink">
                    {previewText(item.title) || "제목 없는 문의"}
                  </span>
                  <span className="whitespace-nowrap text-sm text-muted">
                    {item.channelNameKo ?? "채널 미상"}
                  </span>
                  <span aria-hidden="true" className="text-muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ProactiveCases limit={3} onLoaded={onProactive} />

      {findings.length > 0 ? (
        <section className="space-y-2">
          <SectionHeader title="지금 눈여겨볼 것" hint="운영 데이터에서 바로 확인된 것만 보여줍니다." />
          <InsightList insights={findings} />
        </section>
      ) : null}
    </section>
  );
}
