import { useEffect, useState } from "react";
import { PageHead } from "../../components/ui/PageHead";
import { Panel } from "../../components/ui/Panel";
import { BtnLink } from "../../components/ui/Btn";
import { ChannelList } from "../../components/connect/ChannelList";
import { HomeReviewOpsCard } from "../../components/actionWindow/HomeReviewOpsCard";
import { useOperationsStore } from "../../hooks/useOperationsStore";
import { isFixturePreviewEnabled } from "../../lib/actionWindow/devMode";
import { useOpenAlerts } from "../../lib/openAlerts";
import { api } from "../../lib/apiClient";
import { selectChannelAccount } from "../../lib/channelConnection";
import { hasReviewRecord } from "../../lib/reviewRecord";
import type {
  ChannelResponse,
  ConnectionStatusView,
  SellerAccountResponse,
} from "../../lib/types";

/**
 * 채널 연결 — where the product's data comes from, and the one place every route into it converges.
 *
 * Only the product channels are listed (NAVER / Coupang / Cafe24 — `lib/productChannels.ts`,
 * `docs/product_assembly_ia_v1.md` §2): a channel on this screen is a channel a seller can actually
 * use. The catalog rows the backend keeps for other channels are not shown here.
 *
 * The channel list lives here rather than on a separate page: splitting "the hub" from "the list"
 * meant the hub had nothing to say except "the list is over there". `/connect/channels` now
 * redirects here.
 *
 * The in-progress strip reuses the Action Window card unchanged, including its honesty gate: the
 * operations store seeds a demo run even in production, so a run is shown only when a live agent is
 * driving it or the dev fixture preview is on.
 */
export function ConnectHub() {
  const [channels, setChannels] = useState<ChannelResponse[]>([]);
  const [accounts, setAccounts] = useState<SellerAccountResponse[] | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState(false);
  const [health, setHealth] = useState<Map<string, ConnectionStatusView>>(new Map());
  const [reviewCounts, setReviewCounts] = useState<Map<string, number>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const { openCount } = useOpenAlerts();

  useEffect(() => {
    let active = true;
    void api
      .getChannels()
      .then((list) => active && setChannels(list))
      .catch(() => active && setChannels([]));
    void api
      .getSellerAccountsStrict()
      .then((list) => {
        if (active) {
          setAccounts(list);
          setAccountsLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setAccounts(null);
          setAccountsError(true);
          setAccountsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Per-account health. Fail-soft per account: a failed status read leaves that row on its catalog
  // state rather than blocking the list.
  useEffect(() => {
    const connected = (accounts ?? []).filter((account) => !account.fileUpload);
    if (connected.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.allSettled(
      connected.map((account) =>
        api.getConnectionStatusStrict(account.id).then((status) => [account.id, status] as const),
      ),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      const map = new Map<string, ConnectionStatusView>();
      for (const result of results) {
        if (result.status === "fulfilled") {
          map.set(result.value[0], result.value[1]);
        }
      }
      setHealth(map);
    });
    return () => {
      cancelled = true;
    };
  }, [accounts]);

  // How many 상품평 each review-record channel has actually collected, so the row can say so instead
  // of making the seller open the page to find out. Read per account and fail-soft in both
  // directions: a rejected read leaves that account out of the map, and a row with no entry in the
  // map shows the way in without a number. The count is decoration on a link; it never gates it.
  useEffect(() => {
    const targets = channels
      .filter((channel) => hasReviewRecord(channel.code))
      .map((channel) => selectChannelAccount(accounts, channel.id))
      .filter((account): account is SellerAccountResponse => account !== null);
    if (targets.length === 0) {
      return;
    }
    let cancelled = false;
    // `size: 1` because only `total` is wanted here — the list itself belongs to the page this
    // links to, and the hub has no business pulling a screenful of what buyers wrote.
    void Promise.allSettled(
      targets.map((account) =>
        api
          .getChannelReviewsStrict(account.id, { size: 1 })
          .then((view) => [account.id, view.total] as const),
      ),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      const map = new Map<string, number>();
      for (const result of results) {
        if (result.status === "fulfilled") {
          map.set(result.value[0], result.value[1]);
        }
      }
      setReviewCounts(map);
    });
    return () => {
      cancelled = true;
    };
  }, [channels, accounts]);

  const ops = useOperationsStore();
  const liveRun = ops.sourceMode === "bridge" || isFixturePreviewEnabled() ? ops.run : null;

  return (
    <>
      <PageHead
        title="채널 연결"
        description="판매 채널을 연결하고, 자료 가져오기 상태를 한곳에서 관리합니다."
      />

      {openCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-warn/10 px-4 py-3">
          <span className="font-semibold text-warn">확인이 필요한 연결 알림 {openCount}건</span>
          <BtnLink to="/settings/alerts" size="sm" variant="outline">
            확인하기
          </BtnLink>
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-xl bg-brand-50 px-4 py-3 text-brand-700">{notice}</div>
      ) : null}

      {accountsError ? (
        <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">
          연결 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </div>
      ) : null}

      <Panel
        title="채널"
        description="네이버 스마트스토어, 쿠팡, 카페24를 연결할 수 있습니다. 채널마다 가능한 연결 방식이 다르며, 지금 가능한 범위만 표시합니다."
      >
        <ChannelList
          channels={channels}
          accounts={accounts}
          health={health}
          statusLoading={accountsLoading}
          reviewCounts={reviewCounts}
          onNotice={setNotice}
        />
      </Panel>

      <Panel
        title="정기 자료 가져오기"
        description="연결이 어려운 채널은 정해진 주기에 자료를 넘겨주시면 이어서 정리합니다."
        action={
          <BtnLink to="/connect/upload" size="sm" variant="outline">
            자료 넘기기
          </BtnLink>
        }
      >
        <ol className="space-y-2">
          {[
            "가져올 자료를 고릅니다.",
            "형식과 기간이 맞는지 먼저 확인합니다.",
            "중복을 걸러내고 채널이 달라도 같은 형태로 정리합니다.",
            "리뷰·문의 화면과 리포트에 반영됩니다.",
          ].map((step, index) => (
            <li key={step} className="flex gap-3 break-keep leading-relaxed text-muted">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-xs font-bold tabular-nums text-brand-700"
              >
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
        <p className="mt-4 break-keep text-sm text-muted">
          이전 기간의 리뷰는{" "}
          <BtnLink to="/connect/review-history" size="sm" variant="ghost">
            과거 리뷰 가져오기
          </BtnLink>
          에서 구간별로 채울 수 있습니다.
        </p>
      </Panel>

      <Panel
        title="가져오기 진행"
        description="사람이 확인해야 하는 지점에서만 멈추고 알려드립니다."
        action={
          <BtnLink to="/connect/imports" size="sm" variant="outline">
            진행 상황
          </BtnLink>
        }
      >
        <HomeReviewOpsCard run={liveRun} />
      </Panel>
    </>
  );
}
