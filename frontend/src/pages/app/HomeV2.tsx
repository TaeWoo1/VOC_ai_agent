import { useEffect, useMemo, useState } from "react";
import { PageHead } from "../../components/ui/PageHead";
import { AttentionZone } from "../../components/home/AttentionZone";
import { ConnectionZone } from "../../components/home/ConnectionZone";
import { HomeReviewOpsCard } from "../../components/actionWindow/HomeReviewOpsCard";
import { useOperationsStore } from "../../hooks/useOperationsStore";
import { isFixturePreviewEnabled } from "../../lib/actionWindow/devMode";
import { api } from "../../lib/apiClient";
import { buildAnalysisIndex } from "../../lib/inboxView";
import {
  buildInboxAttention,
  buildIssueAttention,
  summarizeConnections,
  topAttentionItems,
} from "../../lib/homeSignals";
import type {
  ChannelResponse,
  ConnectorAlertView,
  FeedItem,
  ItemAnalysis,
} from "../../lib/types";

/**
 * 운영 홈 — three zones: what needs a person, what is running, what needs connecting.
 *
 * Every read is independent and every failure is local. A zone whose source did not load says so;
 * it does not render zero. "이번 주 흐름" is deliberately absent: no metric on this screen may be
 * one nobody has verified is derivable.
 */
export function HomeV2() {
  const [inbox, setInbox] = useState<FeedItem[] | null>(null);
  const [analyses, setAnalyses] = useState<ItemAnalysis[]>([]);
  const [issueCount, setIssueCount] = useState<number | null>(null);
  const [issuesLoaded, setIssuesLoaded] = useState(false);
  const [channels, setChannels] = useState<ChannelResponse[] | null>(null);
  const [alerts, setAlerts] = useState<ConnectorAlertView[] | null>(null);

  useEffect(() => {
    let active = true;

    void api
      .getInboxStrict()
      .then((res) => active && setInbox(res.items))
      .catch(() => active && setInbox(null));

    void api
      .getItemAnalysisStrict()
      .then((list) => active && setAnalyses(list))
      .catch(() => active && setAnalyses([]));

    // Strict and deliberately unmocked: a demo environment reports "확인할 수 없음" here rather
    // than inventing recurring issues that no extraction produced.
    void api
      .getReviewIssuesStrict()
      .then((list) => {
        if (active) {
          setIssueCount(list.filter((issue) => !issue.dismissed).length);
          setIssuesLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setIssueCount(null);
          setIssuesLoaded(true);
        }
      });

    void api
      .getChannelsStrict()
      .then((list) => active && setChannels(list))
      .catch(() => active && setChannels(null));

    void api
      .getConnectorAlertsStrict()
      .then((list) => active && setAlerts(list))
      .catch(() => active && setAlerts(null));

    return () => {
      active = false;
    };
  }, []);

  // The operations store seeds a demo run even in production, so the in-progress zone shows one
  // ONLY when a live agent is driving it or the dev fixture preview is on. A seeded run must never
  // appear here as live work.
  const ops = useOperationsStore();
  const liveRun = ops.sourceMode === "bridge" || isFixturePreviewEnabled() ? ops.run : null;

  const analysisIndex = useMemo(() => buildAnalysisIndex(analyses), [analyses]);
  const cards = useMemo(
    () => [...buildInboxAttention(inbox), buildIssueAttention(issueCount, issuesLoaded)],
    [inbox, issueCount, issuesLoaded],
  );
  const preview = useMemo(
    () => topAttentionItems(inbox ?? [], analysisIndex),
    [inbox, analysisIndex],
  );
  const connections = useMemo(() => summarizeConnections(channels, alerts), [channels, alerts]);

  return (
    <>
      <PageHead
        title="오늘 확인할 고객 신호"
        description="문의·리뷰·자료 연결 상태에서 사람이 확인해야 할 일을 먼저 보여줍니다."
      />
      <AttentionZone cards={cards} preview={preview} analyses={analysisIndex} />
      <HomeReviewOpsCard run={liveRun} />
      <ConnectionZone summary={connections} />
    </>
  );
}
