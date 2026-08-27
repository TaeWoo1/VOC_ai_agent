import { useCallback, useEffect, useState } from "react";
import { Section, ListBox } from "../ui/Section";
import { WorkItem } from "../ui/WorkItem";
import { InsightList } from "../ui/InsightList";
import { ProactiveCases } from "../proactive/ProactiveCases";
import { api } from "../../lib/apiClient";
import { BtnLink } from "../ui/Btn";
import {
  briefingHeadline,
  briefingInsights,
  briefingSubline,
  DISCONNECTED_HEADLINE,
  DISCONNECTED_SUBLINE,
  preparedTitle,
} from "../../lib/briefing";
import { previewText } from "../../lib/plainText";
import type { InquiryQueueItem, OperationsInsight } from "../../lib/types";

/**
 * <b>The first thing on the home screen: what today looks like, then the work itself.</b>
 *
 * <p>Agent Command Center v1 §0/§3/§4, reshaped by docs/reviewnary_design.md §7: one sentence, the
 * command box, then **먼저 볼 일** — prepared drafts, 「AI가 먼저 확인한 일」 and the findings as rows in
 * containers, never a paragraph explaining them. That is the whole of what "agentic" means here: it
 * went and looked first, and the objects say what it found.
 *
 * <p><b>The sentence is arithmetic, not a summary.</b> It counts the rows rendered underneath it and
 * nothing else; no model is called on this screen, so the dashboard still works when the day's AI
 * budget is gone.
 *
 * <p><b>The input sits inside the briefing</b> as a slot: the greeting is arithmetic over what this
 * component renders, and the input is not one of the things it counts.
 */
export function AgentBriefing({
  insights,
  commandSlot,
}: {
  insights: OperationsInsight[];
  /** Rendered between the greeting and the work. Counted by neither. */
  commandSlot?: React.ReactNode;
}) {
  const [prepared, setPrepared] = useState<InquiryQueueItem[]>([]);
  const [preparedReady, setPreparedReady] = useState(false);
  const [proactive, setProactive] = useState(0);
  const [proactiveReady, setProactiveReady] = useState(false);
  /** `null` = we do not know — the state a failed read lands in, never `false`. */
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const page = await api.getInquiryQueueStrict({ phase: "PROPOSED", page: 0, size: 5 });
        if (live) setPrepared(page.content);
      } catch {
        if (live) setPrepared([]);
      } finally {
        if (live) setPreparedReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const accounts = await api.getSellerAccountsStrict();
        if (live) setConnected(accounts.some((a) => a.connectionStatus === "CONNECTED"));
      } catch {
        if (live) setConnected(null);
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
  const onboarding = connected === false;
  const ready = preparedReady && proactiveReady;

  return (
    <section className="space-y-4" aria-label="오늘의 브리핑">
      <div>
        <p className="break-keep text-2xl font-bold leading-tight text-ink" aria-live="polite">
          {onboarding ? DISCONNECTED_HEADLINE : ready ? briefingHeadline(total) : " "}
        </p>
        {onboarding ? (
          <p className="mt-1 break-keep text-base text-muted">{DISCONNECTED_SUBLINE}</p>
        ) : ready && briefingSubline(total) ? (
          <p className="mt-1 break-keep text-base text-muted">{briefingSubline(total)}</p>
        ) : null}
        {onboarding ? (
          <div className="mt-4">
            <BtnLink to="/connect">채널 연결하기</BtnLink>
          </div>
        ) : null}
      </div>

      {commandSlot}

      {prepared.length > 0 ? (
        <Section
          title={preparedTitle(prepared.length)}
          ariaLabel="준비된 답변 초안"
          hint="확인하고 보내시면 됩니다. 아직 아무 곳에도 보내지 않았습니다."
        >
          <ListBox>
            <ul className="divide-y divide-line/70">
              {prepared.map((item) => (
                <li key={item.workItemId}>
                  <WorkItem
                    state="초안 준비됨"
                    tone="info"
                    title={previewText(item.title) || "제목 없는 문의"}
                    meta={item.channelNameKo ?? "채널 미상"}
                    to={`/inquiries/${item.inquiryId}`}
                    time={<span aria-hidden="true">›</span>}
                  />
                </li>
              ))}
            </ul>
          </ListBox>
        </Section>
      ) : null}

      <ProactiveCases limit={3} onLoaded={onProactive} />

      {findings.length > 0 ? (
        <Section title="지금 눈여겨볼 것" ariaLabel="지금 눈여겨볼 것">
          <ListBox>
            <InsightList insights={findings} />
          </ListBox>
        </Section>
      ) : null}
    </section>
  );
}
