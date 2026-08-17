import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Empty } from "../../components/ui/Empty";
import { BtnLink } from "../../components/ui/Btn";
import { api } from "../../lib/apiClient";
import { reviewAccounts, type ReviewAccount } from "../../lib/reviewAccounts";
import { reviewRecordPath } from "../../lib/reviewRecord";
import type { ChannelResponse, SellerAccountResponse } from "../../lib/types";
import { ChannelReviews } from "./ChannelReviews";

/**
 * 리뷰 — the workflow surface for reviews (`docs/product_assembly_ia_v1.md` §3).
 *
 * The data behind it is per account: each connected channel keeps its own review record, with its
 * own capability (AI 확인 필요 suggestion, locate-on-marketplace, reply flow) that the record page
 * reads from the server. This page does not re-implement any of that. It answers one question the
 * record page cannot — "which channel's reviews?" — with a switcher over the org's review-capable
 * accounts, and then renders the record for the chosen one. A channel is a filter here, never a
 * destination: adding a channel adds a chip, not a screen.
 *
 * `/reviews` with no account opens the first account in product order (NAVER, Coupang, Cafe24).
 * `/reviews/:accountId` is the record itself; the pre-assembly `/connect/channels/:accountId/reviews`
 * redirects here.
 */
export function Reviews() {
  const { accountId } = useParams();
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
        <p className="text-muted">불러오는 중…</p>
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
        <PageHead title="리뷰" description="연결된 채널에서 수집한 리뷰를 확인이 필요한 것부터 봅니다." />
        <Empty
          title="리뷰를 볼 채널이 아직 없습니다"
          body="네이버 스마트스토어, 쿠팡, 카페24 중 하나를 연결하면 그 채널의 리뷰가 여기에 모입니다."
          action={<BtnLink to="/connect">채널 연결하기</BtnLink>}
        />
      </>
    );
  }
  if (!accountId) {
    return <Navigate to={reviewRecordPath(targets[0].account.id)} replace />;
  }

  return (
    <div className="space-y-5">
      <ChannelSwitcher targets={targets} selectedAccountId={accountId} />
      <ChannelReviews />
    </div>
  );
}

/**
 * One chip per review-capable account. A single account still renders — the chip is then the
 * screen's statement of which channel it is showing, which the record page's own header (a count,
 * a last-import time) does not say.
 */
function ChannelSwitcher({
  targets,
  selectedAccountId,
}: {
  targets: readonly ReviewAccount[];
  selectedAccountId: string;
}) {
  return (
    <nav aria-label="리뷰 채널" className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold text-muted">채널</span>
      {targets.map(({ account, label }) => {
        const active = account.id === selectedAccountId;
        return (
          <Link
            key={account.id}
            to={reviewRecordPath(account.id)}
            aria-current={active ? "page" : undefined}
            className={`min-h-[36px] rounded-lg px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 ${
              active ? "bg-brand-50 text-brand-700" : "text-muted hover:bg-canvas hover:text-ink"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
