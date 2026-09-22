import { useEffect, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import type { ReactNode } from "react";
import { MasterDetail } from "../../components/workspace/MasterDetail";
import { PageHead } from "../../components/ui/PageHead";
import { Empty } from "../../components/ui/Empty";
import { BtnLink } from "../../components/ui/Btn";
import { AgentLaunch } from "../../components/ui/AgentLaunch";
import { api } from "../../lib/apiClient";
import { reviewAccounts } from "../../lib/reviewAccounts";
import type { ChannelResponse, SellerAccountResponse } from "../../lib/types";
import { ReviewRecord } from "./ReviewRecord";
import { ProductReviews } from "../../components/reviews/ProductReviews";
import { useAgentSurface } from "../../lib/agentPanel";

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
  const [searchParams] = useSearchParams();
  // The product a doorway narrowed this surface to (Product Operations Continuity v1 §1). It is an
  // axis, not a destination of its own: with it the page answers 「이 상품의 리뷰」 across the org,
  // without it it answers 「이 채널의 리뷰」 exactly as before.
  const productId = searchParams.get("productId");
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
  const selectedTarget = accountId ? targets.find((t) => t.account.id === accountId) ?? null : null;
  useAgentSurface({
    surface: "reviews",
    label: selectedTarget ? `리뷰 · ${selectedTarget.label}` : "리뷰",
  });

  // Every branch is drawn in the page's own scroller: /reviews is a master-detail route (UI/UX v2 Phase 3), so the
  // shell gives it the full column and no outer scroll.
  const page = (content: ReactNode) => <MasterDetail wide={false} list={content} detail={null} detailLabel="" />;

  if (loading) {
    return page(
      <>
        <PageHead title="리뷰" />
        <p className="text-sm text-muted">불러오는 중…</p>
      </>,
    );
  }
  if (failed) {
    return page(
      <>
        <PageHead title="리뷰" />
        <Empty
          title="채널 정보를 불러오지 못했습니다"
          body="연결 상태를 확인한 뒤 다시 시도해 주세요."
          action={<BtnLink to="/connect">채널 연결 확인</BtnLink>}
        />
      </>,
    );
  }
  // Scoped to a product, the surface answers 「이 상품의 리뷰」 across every channel the org holds, and the channel is a
  // fact on each row — the figure the seller pressed was counted that way.
  if (productId) {
    return page(
      <>
        <PageHead
          title="리뷰"
          action={<AgentLaunch context={{ productId, surface: "reviews" }} label="이 상품 리뷰에 대해 물어보기" />}
        />
        <ProductReviews productId={productId} accountIds={targets.map((t) => t.account.id)} />
      </>,
    );
  }
  if (targets.length === 0) {
    return page(
      <>
        <PageHead title="리뷰" />
        <Empty
          title="리뷰를 볼 채널이 아직 없습니다"
          body="네이버 스마트스토어, 쿠팡, 카페24 중 하나를 연결하면 그 채널의 리뷰가 여기에 모입니다."
          action={<BtnLink to="/connect">채널 연결하기</BtnLink>}
        />
      </>,
    );
  }
  /*
    One record screen (UI/UX v2 Phase 3). `/reviews/:accountId` was a second, older record — the same rows, filters
    and paging in a different layout, plus an inline detail. It now lands on THIS screen with the account's channel
    as the filter, keeping `?tier=` and turning `?review=` into the selection, so every link and bookmark that points
    at it still opens what it named. An account this org does not hold lands on the unfiltered record.
  */
  if (accountId) {
    const target = targets.find((t) => t.account.id === accountId) ?? null;
    const params = new URLSearchParams(searchParams);
    if (target) params.set("channel", target.channel.code);
    return <Navigate replace to={`/reviews${params.toString() ? `?${params.toString()}` : ""}`} />;
  }

  return (
    <ReviewRecord
      targets={targets}
      head={
        <PageHead
          title="리뷰"
          meta={<span className="text-sm text-muted">{REVIEWS_DESCRIPTION}</span>}
          action={<AgentLaunch context={{ surface: "reviews" }} label="리뷰에 대해 물어보기" />}
        />
      }
    />
  );
}

/** One line, and it answers 「이 화면은 무엇인가」. */
export const REVIEWS_DESCRIPTION = "확인이 필요한 리뷰부터 봅니다.";
