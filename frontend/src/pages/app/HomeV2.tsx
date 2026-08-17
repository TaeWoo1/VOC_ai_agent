import { useEffect, useMemo, useState } from "react";
import { PageHead } from "../../components/ui/PageHead";
import { Panel } from "../../components/ui/Panel";
import { BtnLink } from "../../components/ui/Btn";
import { TodayInbox } from "../../components/home/TodayInbox";
import { HomeReviewOpsCard } from "../../components/actionWindow/HomeReviewOpsCard";
import { useOperationsStore } from "../../hooks/useOperationsStore";
import { isFixturePreviewEnabled } from "../../lib/actionWindow/devMode";
import { api } from "../../lib/apiClient";
import { buildAnalysisIndex } from "../../lib/inboxView";
import { buildIssueAttention, summarizeConnections } from "../../lib/homeSignals";
import { reviewAccounts } from "../../lib/reviewAccounts";
import {
  buildConnectionToday,
  buildInquiryToday,
  buildReviewToday,
  type ReviewSource,
} from "../../lib/todayInbox";
import type {
  ChannelResponse,
  ConnectorAlertView,
  FeedItem,
  ItemAnalysis,
  SellerAccountResponse,
} from "../../lib/types";

/**
 * 홈 — Today Inbox: "오늘 내가 확인하거나 조치할 일은 무엇인가?"
 *
 * The answer is assembled from the workflow surfaces themselves, so every number here is the number
 * that surface shows (`lib/todayInbox.ts`): 리뷰 from each account's record under the attention
 * filter, 문의 from the inquiry feed, 연결 from channel status + open alerts. Every read is
 * independent and every failure is local: an item whose source did not load says so; it does not
 * render zero. There is no "이번 주 흐름" and no metric nobody has verified is derivable.
 */
export function HomeV2() {
  const [inbox, setInbox] = useState<FeedItem[] | null>(null);
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [analyses, setAnalyses] = useState<ItemAnalysis[]>([]);
  const [issueCount, setIssueCount] = useState<number | null>(null);
  const [issuesLoaded, setIssuesLoaded] = useState(false);
  const [channels, setChannels] = useState<ChannelResponse[] | null>(null);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [accounts, setAccounts] = useState<SellerAccountResponse[] | null>(null);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [alerts, setAlerts] = useState<ConnectorAlertView[] | null>(null);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [reviewSources, setReviewSources] = useState<ReviewSource[] | null | undefined>(undefined);

  useEffect(() => {
    let active = true;

    void api
      .getInboxStrict()
      .then((res) => active && setInbox(res.items))
      .catch(() => active && setInbox(null))
      .finally(() => active && setInboxLoaded(true));

    void api
      .getItemAnalysisStrict()
      .then((list) => active && setAnalyses(list))
      .catch(() => active && setAnalyses([]));

    // Strict and deliberately unmocked: a demo environment reports "확인할 수 없음" here rather
    // than inventing recurring issues that no extraction produced.
    void api
      .getReviewIssuesStrict()
      .then((list) => active && setIssueCount(list.filter((issue) => !issue.dismissed).length))
      .catch(() => active && setIssueCount(null))
      .finally(() => active && setIssuesLoaded(true));

    void api
      .getChannelsStrict()
      .then((list) => active && setChannels(list))
      .catch(() => active && setChannels(null))
      .finally(() => active && setChannelsLoaded(true));

    void api
      .getSellerAccountsStrict()
      .then((list) => active && setAccounts(list))
      .catch(() => active && setAccounts(null))
      .finally(() => active && setAccountsLoaded(true));

    void api
      .getConnectorAlertsStrict()
      .then((list) => active && setAlerts(list))
      .catch(() => active && setAlerts(null))
      .finally(() => active && setAlertsLoaded(true));

    return () => {
      active = false;
    };
  }, []);

  // 리뷰: one read per review-capable account, under the same filter the destination opens with.
  // `size` is only the preview depth — `total` is the count. Fail-soft per account.
  const targets = useMemo(
    () => (accountsLoaded && channelsLoaded ? reviewAccounts(accounts, channels) : null),
    [accounts, channels, accountsLoaded, channelsLoaded],
  );
  useEffect(() => {
    if (targets === null) {
      return;
    }
    if (accounts === null || channels === null) {
      setReviewSources(null);
      return;
    }
    let cancelled = false;
    void Promise.allSettled(
      targets.map((target) =>
        api.getChannelReviewsStrict(target.account.id, {
          tier: "NEEDS_ATTENTION",
          sort: "attention",
          size: 3,
        }),
      ),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      setReviewSources(
        results.map((result, i) => ({
          account: targets[i],
          page: result.status === "fulfilled" ? result.value : null,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [targets, accounts, channels]);

  // The operations store seeds a demo run even in production, so the in-progress zone shows one
  // ONLY when a live agent is driving it or the dev fixture preview is on.
  const ops = useOperationsStore();
  const liveRun = ops.sourceMode === "bridge" || isFixturePreviewEnabled() ? ops.run : null;

  const analysisIndex = useMemo(() => buildAnalysisIndex(analyses), [analyses]);
  const today = useMemo(
    () => [
      buildReviewToday(reviewSources === undefined ? null : reviewSources),
      buildInquiryToday(inboxLoaded ? inbox : null, analysisIndex),
      buildConnectionToday(summarizeConnections(channels, alerts), channelsLoaded && channels !== null, alertsLoaded && alerts !== null),
    ],
    [reviewSources, inbox, inboxLoaded, analysisIndex, channels, alerts, channelsLoaded, alertsLoaded],
  );
  const issues = useMemo(() => buildIssueAttention(issueCount, issuesLoaded), [issueCount, issuesLoaded]);

  return (
    <>
      <PageHead
        title="오늘 확인하거나 조치할 일"
        description="리뷰·문의·연결 상태에서 사람이 봐야 할 일을 먼저 보여줍니다."
      />
      <TodayInbox items={today} />
      <HomeReviewOpsCard run={liveRun} />
      <Panel title="참고" description="오늘 할 일은 아니지만 살펴볼 것">
        <ul className="space-y-2">
          <li className="flex flex-wrap items-center justify-between gap-2">
            <BtnLink to={issues.to} size="sm" variant="outline">
              {issues.label}
            </BtnLink>
            <span className="text-sm text-muted">
              {issues.signal.kind === "READY" ? `${issues.signal.count}건` : issues.hint}
            </span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2">
            <BtnLink to="/reports" size="sm" variant="outline">
              리포트
            </BtnLink>
            <span className="text-sm text-muted">수집된 자료로 만든 기간 요약</span>
          </li>
        </ul>
      </Panel>
    </>
  );
}
