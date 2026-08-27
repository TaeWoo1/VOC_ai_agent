import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Empty } from "../../components/ui/Empty";
import { BtnLink } from "../../components/ui/Btn";
import { AgentLaunch } from "../../components/ui/AgentLaunch";
import { api } from "../../lib/apiClient";
import { reviewAccounts, type ReviewAccount } from "../../lib/reviewAccounts";
import { reviewRecordPath } from "../../lib/reviewRecord";
import type { ChannelResponse, SellerAccountResponse } from "../../lib/types";
import { ChannelReviews } from "./ChannelReviews";

/**
 * 리뷰 — the workflow surface for reviews (`docs/product_assembly_ia_v1.md` §3), issue-first
 * (docs/reviewnary_design.md §7).
 *
 * The data behind it is per account; this page answers only "which channel's reviews?" with a
 * segmented switcher and renders the record for the chosen one. A channel is a filter, never a
 * destination. `/reviews` with no account opens the first account in product order.
 */
export function Reviews() {
  const { accountId } = useParams();
  const { search } = useLocation();
  const [accounts, setAccounts] = useState<SellerAccountResponse[] | null>(null);
  const [channels, setChannels] = useState<ChannelResponse[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.getSellerAccountsStrict(), api.getChannelsStrict()])
      .then(([accountList, channelList]) => {
        if (!active) return;
        setAccounts(accountList);
        setChannels(channelList);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const targets = reviewAccounts(accounts, channels);

  if (loading) {
    return (
      <>
        <PageHead title="리뷰" />
        <p className="text-sm text-muted">불러오는 중…</p>
      </>
    );
  }
  if (failed) {
    return (
      <>
        <PageHead title="리뷰" />
        <Empty
          title="채널 정보를 불러오지 못했습니다"
          body="연결 상태를 확인한 뒤 다시 시도해 주세요."
          action={<BtnLink to="/connect">채널 연결 확인</BtnLink>}
        />
      </>
    );
  }
  if (targets.length === 0) {
    return (
      <>
        <PageHead title="리뷰" />
        <Empty
          title="리뷰를 볼 채널이 아직 없습니다"
          body="네이버 스마트스토어, 쿠팡, 카페24 중 하나를 연결하면 그 채널의 리뷰가 여기에 모입니다."
          action={<BtnLink to="/connect">채널 연결하기</BtnLink>}
        />
      </>
    );
  }
  if (!accountId) {
    return <Navigate to={`${reviewRecordPath(targets[0].account.id)}${search}`} replace />;
  }

  const selected = targets.find((t) => t.account.id === accountId) ?? null;
  return (
    <div className="space-y-5">
      <PageHead
        title="리뷰"
        meta={<span className="text-sm text-muted">{REVIEWS_DESCRIPTION}</span>}
        action={
          <>
            {targets.length > 1 ? <ChannelSwitcher targets={targets} selectedAccountId={accountId} /> : null}
            <AgentLaunch
              context={{ surface: "reviews", goal: "반복되는 리뷰 문제가 문의에서도 반복되는지 확인해 줘" }}
              label="문의에서도 반복되는지 확인"
            />
          </>
        }
      />
      <ChannelReviews channelName={selected?.label} />
    </div>
  );
}

/** One line, and it answers 「이 화면은 무엇인가」. */
export const REVIEWS_DESCRIPTION = "확인이 필요한 리뷰부터 봅니다.";

/** One segment per review-capable account; rendered only when there are several. */
function ChannelSwitcher({ targets, selectedAccountId }: { targets: readonly ReviewAccount[]; selectedAccountId: string }) {
  const [searchParams] = useSearchParams();
  const carried = new URLSearchParams(searchParams);
  carried.delete("review");
  const search = carried.toString() ? `?${carried.toString()}` : "";
  return (
    <nav aria-label="리뷰 채널" className="flex items-center gap-0.5 rounded-lg bg-canvas p-0.5">
      {targets.map(({ account, label }) => {
        const active = account.id === selectedAccountId;
        return (
          <Link
            key={account.id}
            to={`${reviewRecordPath(account.id)}${search}`}
            aria-current={active ? "page" : undefined}
            className={`min-h-[32px] whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 ${
              active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
