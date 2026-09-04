import { useEffect, useState } from "react";
import { PageHead } from "../../components/ui/PageHead";
import { Section, ListBox } from "../../components/ui/Section";
import { Disclosure } from "../../components/ui/Disclosure";
import { BtnLink } from "../../components/ui/Btn";
import { ChannelList } from "../../components/connect/ChannelList";
import { HelperStatusCard } from "../../components/connect/HelperStatusCard";
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
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState(false);
  const [accounts, setAccounts] = useState<SellerAccountResponse[] | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState(false);
  const [health, setHealth] = useState<Map<string, ConnectionStatusView>>(new Map());
  const [reviewCounts, setReviewCounts] = useState<Map<string, number>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const { openCount } = useOpenAlerts();

  useEffect(() => {
    let active = true;
    // Strict: a dead backend says so here rather than rendering the demo catalog behind the seller's back.
    void api
      .getChannelsStrict()
      .then((list) => {
        if (active) {
          setChannels(list);
          setChannelsLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setChannels([]);
          setChannelsError(true);
          setChannelsLoading(false);
        }
      });
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
  // The NAVER account's status carries the helper's last login observation; the helper card reads it.
  const naverChannel = channels.find((channel) => channel.code === "NAVER") ?? null;
  const naverAccount = naverChannel ? selectChannelAccount(accounts, naverChannel.id) : null;
  const naverHealth = naverAccount ? (health.get(naverAccount.id) ?? null) : null;

  return (
    <>
      <PageHead title="채널 연결" />

      {openCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn/5 px-4 py-2.5">
          <span className="text-sm font-semibold text-warn">확인이 필요한 연결 알림 {openCount}건</span>
          <BtnLink to="/settings/alerts" size="sm" variant="outline">
            확인하기
          </BtnLink>
        </div>
      ) : null}

      {notice ? <div className="rounded-xl bg-brand-50 px-4 py-2.5 text-sm text-brand-700">{notice}</div> : null}

      {accountsError ? (
        <div className="rounded-xl bg-bad/10 px-4 py-2.5 text-sm text-bad">연결 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>
      ) : null}

      <Section title="채널">
        <ListBox>
          <ChannelList
            channels={channels}
            accounts={accounts}
            health={health}
            statusLoading={accountsLoading}
            reviewCounts={reviewCounts}
            onNotice={setNotice}
            channelsLoading={channelsLoading}
            channelsError={channelsError}
          />
        </ListBox>
      </Section>

      {/* The helper is the second thing on this screen, after the channels it serves: the seller who
          arrives here from the installer sees the state and the one control that changes it, and never a
          port, a token or a pairing word (Local Helper Pilot Packaging v1). */}
      <Section
        title="reviewnary 도우미"
        hint="판매자센터 화면과 함께 일할 때 필요합니다"
        action={
          <BtnLink to="/connect/helper" size="sm" variant="ghost">
            설치·업데이트 안내
          </BtnLink>
        }
      >
        <ListBox ariaLabel="도우미 상태">
          <HelperStatusCard naverHealth={naverHealth} />
        </ListBox>
      </Section>
      {/* One section for getting data in, with its two ways side by side. The old pair — 「정기 자료
          가져오기」 and 「리뷰 수집 실행」 — described the same job twice and pointed at a third screen it
          called 「작업대」, a word from our side of the desk. */}
      <Section
        title="자료 가져오기"
        hint="연결이 어려운 채널은 파일로, 네이버 리뷰는 판매자센터 화면에서 기간별로"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <BtnLink to="/connect/upload" size="sm" variant="outline">
              자료 넘기기
            </BtnLink>
            <BtnLink to="/connect/review-history" size="sm" variant="outline">
              기간별로 가져오기
            </BtnLink>
          </div>
        }
      >
        <HomeReviewOpsCard run={liveRun} />
        <p className="mt-3 break-keep text-sm text-muted">
          지난 실행과 구간별 이력은{" "}
          <BtnLink to="/connect/imports" size="sm" variant="ghost">
            실행 기록
          </BtnLink>
          에서 볼 수 있습니다.
        </p>
        <Disclosure label="파일로 넘기면 어떻게 진행되나요" className="mt-2">
          <ol className="mt-2 space-y-1.5 text-sm text-muted">
            {[
              "가져올 자료를 고릅니다.",
              "형식과 기간이 맞는지 먼저 확인합니다.",
              "중복을 걸러내고 채널이 달라도 같은 형태로 정리합니다.",
              "리뷰·문의 화면과 리포트에 반영됩니다.",
            ].map((step, index) => (
              <li key={step} className="flex gap-2 break-keep">
                <span className="tabular-nums text-brand-700">{index + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </Disclosure>
      </Section>
    </>
  );
}
