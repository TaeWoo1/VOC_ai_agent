import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Panel } from "../../components/ui/Panel";
import { Empty } from "../../components/ui/Empty";
import { BtnLink } from "../../components/ui/Btn";
import { api } from "../../lib/apiClient";
import { useReviewAttention } from "../../hooks/useReviewAttention";
import { buildWeeklyReport } from "../../lib/reportView";
import type { TodayBreakdown } from "../../lib/todayInbox";
import { SEVERITY_LABEL_KO, changeBadges } from "../../lib/reviewIssuesView";
import type { FeedItem, ItemAnalysis, ReviewIssueView } from "../../lib/types";

const UNAVAILABLE = "이 항목은 지금 확인할 수 없습니다.";

/**
 * One figure. It links only where the destination shows exactly this count (`to`); when the count
 * is spread over several screens the figure is a heading and the `shares` under it carry the exact
 * links — the same rule the home follows (`lib/todayInbox.ts`).
 */
function Figure({
  label,
  available,
  value,
  to,
  shares = [],
}: {
  label: string;
  available: boolean;
  value: number;
  to: string | null;
  shares?: readonly TodayBreakdown[];
}) {
  const body = (
    <>
      <p className="break-keep text-base text-muted">{label}</p>
      {available ? (
        <p className="mt-1.5 text-3xl font-bold tabular-nums text-ink">
          {value}
          <span className="ml-1 text-lg font-semibold text-muted">건</span>
        </p>
      ) : (
        <p className="mt-2 break-keep text-base text-muted">{UNAVAILABLE}</p>
      )}
    </>
  );
  const box = "block rounded-xl border border-line p-4";
  if (to) {
    return (
      <Link
        to={to}
        className={`${box} transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2`}
      >
        {body}
      </Link>
    );
  }
  return (
    <div className={box}>
      {body}
      {shares.length > 0 ? (
        <ul aria-label={`${label} 채널별`} className="mt-3 flex flex-wrap gap-2">
          {shares.map((share) => (
            <li key={share.key}>
              <Link
                to={share.to}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-canvas px-3 text-sm font-medium text-ink transition hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
              >
                {share.label}
                <span className="tabular-nums text-muted">{share.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function IssueLine({ issue }: { issue: ReviewIssueView }) {
  const badges = changeBadges(issue.change);
  return (
    <li>
      <Link
        to={`/memory/${issue.id}`}
        className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
      >
        <span className="min-w-0 flex-1 break-keep font-medium text-ink">{issue.title}</span>
        <span className="shrink-0 text-xs text-muted">
          심각도 {SEVERITY_LABEL_KO[issue.severity]}
        </span>
        {badges[0] ? (
          <span className="shrink-0 rounded-full bg-canvas px-2.5 py-0.5 text-xs font-semibold text-muted">
            {badges[0].labelKo}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * 주간 고객운영 리포트.
 *
 * Every figure comes from a source that loaded; a source that failed renders as unavailable rather
 * than as zero. Nothing here claims a business outcome, because nothing in the data measures one —
 * and a single unbacked claim would make the rows that ARE true unreadable. The copy guard in
 * `pages-copy.test.ts` scans this file's raw source, comments included, so the claim vocabulary is
 * described here rather than spelled out.
 */
export function ReportsV2() {
  const [issues, setIssues] = useState<ReviewIssueView[] | null>(null);
  const [inbox, setInbox] = useState<FeedItem[] | null>(null);
  const [analyses, setAnalyses] = useState<ItemAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  // 확인이 필요한 리뷰: the shared canonical source (per account, attention-filtered) — same as 홈.
  const reviewSources = useReviewAttention(1);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      api.getReviewIssuesStrict(),
      api.getInboxStrict(),
      api.getItemAnalysisStrict(),
    ]).then(([issueResult, inboxResult, analysisResult]) => {
      if (!active) {
        return;
      }
      setIssues(issueResult.status === "fulfilled" ? issueResult.value : null);
      setInbox(inboxResult.status === "fulfilled" ? inboxResult.value.items : null);
      setAnalyses(analysisResult.status === "fulfilled" ? analysisResult.value : []);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const report = buildWeeklyReport(issues, inbox, analyses, reviewSources === undefined ? null : reviewSources);

  if (loading || reviewSources === undefined) {
    return (
      <>
        <PageHead title="주간 고객운영 리포트" />
        <p className="text-muted">불러오는 중…</p>
      </>
    );
  }

  if (!report.hasAnything) {
    return (
      <>
        <PageHead title="주간 고객운영 리포트" />
        <Empty
          title="아직 정리할 자료가 없습니다"
          body="자료를 연결하면 그 기간의 고객 이슈를 모아 주간 고객운영 리포트를 구성합니다."
          action={<BtnLink to="/connect">채널 연결하기</BtnLink>}
        />
      </>
    );
  }

  return (
    <>
      <PageHead
        title="주간 고객운영 리포트"
        description="수집된 문의·리뷰를 기준으로, 이번 기간에 확인할 것을 정리했습니다."
      />

      <Panel title="이번 기간 요약" description="대표 보고용으로 그대로 옮겨 쓰실 수 있습니다.">
        {report.summaryLines.length > 0 ? (
          <ul className="space-y-2">
            {report.summaryLines.map((line) => (
              <li key={line} className="break-keep leading-relaxed text-ink">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{UNAVAILABLE}</p>
        )}
      </Panel>

      <Panel title="확인이 필요한 문의·리뷰">
        <div className="grid gap-3 sm:grid-cols-2">
          <Figure
            label="답변이 필요한 문의"
            available={report.unansweredInquiries.available}
            value={report.unansweredInquiries.value}
            to="/inquiries?state=NEEDS_REPLY"
          />
          <Figure
            label="확인이 필요한 리뷰"
            available={report.reviewsToCheck.available}
            value={report.reviewsToCheck.value}
            to={report.reviewsToCheckTo}
            shares={report.reviewsToCheckShares}
          />
        </div>
      </Panel>

      <Panel
        title="반복되는 고객 문제"
        description="같은 이야기가 이어지고 있는 것부터 정리했습니다."
        action={
          <BtnLink to="/memory" size="sm" variant="outline">
            메모리 열기
          </BtnLink>
        }
      >
        {!report.issuesNeedingReview.available ? (
          <p className="text-muted">{UNAVAILABLE}</p>
        ) : report.issuesNeedingReview.value.length > 0 ? (
          <ul className="space-y-1">
            {report.issuesNeedingReview.value.map((issue) => (
              <IssueLine key={issue.id} issue={issue} />
            ))}
          </ul>
        ) : (
          <p className="text-muted">이번 기간에 새로 확인이 필요한 반복 문제는 없었습니다.</p>
        )}

        {report.issuesImproved.available && report.issuesImproved.value.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-base font-bold text-ink">관련 리뷰가 줄어든 문제</h3>
            <ul className="mt-2 space-y-1">
              {report.issuesImproved.value.map((issue) => (
                <IssueLine key={issue.id} issue={issue} />
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="FAQ·상세페이지에서 다룰 후보"
        description="반복해서 들어오는 내용을 응대 대신 페이지에서 먼저 답하도록 옮길 후보입니다."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Figure
            label="자주 나오는 질문"
            available={report.faqCandidates.available}
            value={report.faqCandidates.value}
            to="/inquiries"
          />
          <Figure
            label="상세페이지에서 다룰 내용"
            available={report.detailPageCandidates.available}
            value={report.detailPageCandidates.value}
            to="/inquiries"
          />
        </div>
      </Panel>
    </>
  );
}
