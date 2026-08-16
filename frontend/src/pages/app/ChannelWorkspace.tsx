import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Empty } from "../../components/ui/Empty";
import { BtnLink } from "../../components/ui/Btn";
import { CapabilityBadges } from "../../components/CapabilityBadges";
import { ChannelSummaryCards } from "../../components/ChannelSummaryCards";
import { BackfillPanel } from "../../components/BackfillPanel";
import { CommunityArticleList } from "../../components/CommunityArticleList";
import { HealthBadge } from "../../components/HealthBadge";
import {
  ChannelStatusSection,
  ConnectionInfoSection,
  NextActionPanel,
} from "../../components/connect/ChannelStatusSection";
import { CollectionSettingsSection } from "../../components/connect/CollectionSettingsSection";
import { CollectionHistorySection } from "../../components/connect/CollectionHistorySection";
import { ReviewRecordPanel } from "../../components/connect/ReviewRecordPanel";
import { nextActionFor, type ScrollTarget } from "../../components/connect/channelShared";
import { api } from "../../lib/apiClient";
import { hasReviewRecord, reviewRecordPath } from "../../lib/reviewRecord";
import type {
  CapabilityView,
  ChannelResponse,
  ConnectionInfoView,
  ConnectionStatusView,
  CredentialTemplateView,
  ScheduleView,
  SellerAccountResponse,
  SyncRunView,
} from "../../lib/types";

/**
 * One channel's connection and collection workspace.
 *
 * Decomposed from the previous single-file 채널 상세 page into four sections — 연결 상태 /
 * 수집 설정 / 수집 이력 / 기간 수집. The decomposition was MECHANICAL: this page keeps the same
 * state, the same effects and the same API call order the live-verified flows were proven against;
 * only the JSX moved out and the page chrome became the v2 primitives.
 */
export function ChannelWorkspace() {
  const { accountId = "" } = useParams();

  // null = still loading; [] with metaError = load failed (fail closed).
  const [accounts, setAccounts] = useState<SellerAccountResponse[] | null>(null);
  const [channels, setChannels] = useState<ChannelResponse[] | null>(null);
  const [metaError, setMetaError] = useState(false);

  const account = useMemo(
    () => (accounts ?? []).find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );
  const channel = useMemo(
    () => (channels ?? []).find((c) => c.id === account?.channelId) ?? null,
    [channels, account],
  );

  const [status, setStatus] = useState<ConnectionStatusView | null>(null);
  // Masked connection info (credential metadata). null = no credential on file
  // (an expected state, not an error); infoError = the read failed (fail closed).
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfoView | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [infoError, setInfoError] = useState(false);
  // Backend-owned credential field shape (연결에 필요한 정보). null = channel needs no
  // API template (manual / file-upload → 404) OR still loading → block is omitted;
  // templateError = a non-404 read failure (fail closed, calm line). Reference data,
  // never a secret.
  const [credentialTemplate, setCredentialTemplate] = useState<CredentialTemplateView | null>(null);
  const [templateError, setTemplateError] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  // null = not loaded (loading or failed) → schedule controls stay disabled,
  // because an absent capability row means "allowed" and we must not guess.
  const [capabilities, setCapabilities] = useState<CapabilityView[] | null>(null);
  const [runs, setRuns] = useState<SyncRunView[]>([]);
  // Loading vs error vs empty kept distinct so a dead backend never renders as
  // "connected" or "no history yet".
  const [loadingCollection, setLoadingCollection] = useState(true);
  const [collectionError, setCollectionError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Smooth-scroll targets for the 다음 조치 CTAs — all point at sections that
  // already exist on this page (연결 정보 / 수집 테스트 / 다시 시도 live there).
  const collectSettingsRef = useRef<HTMLDivElement>(null);
  const runsRef = useRef<HTMLDivElement>(null);
  const credentialRef = useRef<HTMLDivElement>(null);
  const scrollToSection = useCallback((target: ScrollTarget) => {
    const ref =
      target === "collect" ? collectSettingsRef : target === "info" ? credentialRef : runsRef;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Account + channel metadata via strict reads: no silent mock fallback, so a
  // dead/wrong backend fails closed instead of resolving a fake account.
  useEffect(() => {
    let active = true;
    setMetaError(false);
    Promise.all([api.getSellerAccountsStrict(), api.getChannelsStrict()])
      .then(([accs, chs]) => {
        if (active) {
          setAccounts(accs);
          setChannels(chs);
        }
      })
      .catch(() => {
        if (active) {
          setAccounts([]);
          setChannels([]);
          setMetaError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  // Account-scoped collection data (connection status + run history) via strict
  // reads. The active flag drops stale responses after the account changes or
  // the page unmounts. Schedules keep the seeded fallback (out of slice scope).
  useEffect(() => {
    if (!accountId) {
      return;
    }
    let active = true;
    setLoadingCollection(true);
    setCollectionError(false);
    Promise.all([
      api.getConnectionStatusStrict(accountId),
      api.getSyncRunsStrict({ sellerAccountId: accountId }),
    ])
      .then(([s, r]) => {
        if (active) {
          setStatus(s);
          setRuns(r);
        }
      })
      .catch(() => {
        if (active) {
          setStatus(null);
          setRuns([]);
          setCollectionError(true);
        }
      })
      .finally(() => {
        if (active) {
          setLoadingCollection(false);
        }
      });
    // Masked connection info, loaded independently so its failure (or absence)
    // never fails-closed the whole collection block. 404 → null ("등록된 연결 정보
    // 없음"); any other failure → infoError (불러오지 못했습니다). No secret read.
    setLoadingInfo(true);
    setInfoError(false);
    api.getConnectionInfoStrict(accountId)
      .then((info) => active && setConnectionInfo(info))
      .catch(() => {
        if (active) {
          setConnectionInfo(null);
          setInfoError(true);
        }
      })
      .finally(() => active && setLoadingInfo(false));
    api.getSchedules(accountId)
      .then((s) => active && setSchedules(s))
      .catch(() => active && setSchedules([]));
    return () => {
      active = false;
    };
  }, [accountId, refreshKey]);

  useEffect(() => {
    if (!channel) {
      return;
    }
    let active = true;
    setCapabilities(null);
    api.getChannelCapabilities(channel.code)
      .then((caps) => active && setCapabilities(caps))
      .catch(() => {
        // Fail closed: without capability info the controls stay disabled.
        if (active) {
          setCapabilities(null);
          setError("수집 지원 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
      });
    // Credential field shape (연결에 필요한 정보), loaded independently and fail-soft.
    // 404 → null (channel needs no API template → block omitted); any other failure
    // → templateError (calm line), never a crash. Read-only; no secret is read.
    setCredentialTemplate(null);
    setTemplateError(false);
    api.getCredentialTemplateStrict(channel.code)
      .then((tpl) => active && setCredentialTemplate(tpl))
      .catch(() => {
        if (active) {
          setCredentialTemplate(null);
          setTemplateError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [channel, refreshKey]);

  function report(message: string, isError: boolean) {
    setError(isError ? message : null);
    setNotice(isError ? null : message);
  }

  if (metaError) {
    return (
      <Empty
        title="채널 정보를 불러오지 못했습니다"
        body="잠시 후 다시 시도해 주세요."
        action={<BtnLink to="/connect">채널 목록</BtnLink>}
      />
    );
  }
  if (accounts && !account) {
    return (
      <Empty
        title="판매 계정을 찾을 수 없습니다"
        body="목록에서 다시 선택해 주세요."
        action={<BtnLink to="/connect">채널 목록</BtnLink>}
      />
    );
  }


  return (
    <>
      <PageHead
        title={account?.alias ?? account?.channelNameKo ?? "채널"}
        description="이 채널의 연결 상태와 자료 수집을 관리합니다."
        meta={status ? <HealthBadge state={status.state} /> : undefined}
        action={
          <div className="flex flex-wrap gap-2">
            {/* Which channels have a record is decided in one place, shared with the channel list, so
                the two surfaces cannot disagree about whether this channel offers one.

                Solid, and named for what it opens. It was an outline control labelled 상품평 sitting
                between page chrome, and it read as a filter or a section heading rather than as the
                way to the seller's own review record. */}
            {hasReviewRecord(channel?.code) ? (
              <BtnLink to={reviewRecordPath(accountId)} size="sm">
                상품평 보기
              </BtnLink>
            ) : null}
            <BtnLink to="/connect" size="sm" variant="outline">
              채널 목록
            </BtnLink>
          </div>
        }
      />

      {/* State-aware next action. Only when status is loaded and the read succeeded — a failed
          read must not fabricate a "다음 조치". */}
      {!loadingCollection && !collectionError && status ? (
        <NextActionPanel action={nextActionFor(status)} onCta={scrollToSection} />
      ) : null}

      {notice ? (
        <div className="rounded-xl bg-brand-50 px-4 py-3 text-brand-700">{notice}</div>
      ) : null}
      {error ? <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">{error}</div> : null}

      {/* Above the connection sections, because it is what the seller came for. Everything below is
          about keeping the collection running; this is the collection. */}
      {accountId && hasReviewRecord(channel?.code) ? (
        <ReviewRecordPanel
          accountId={accountId}
          channelCode={channel?.code}
          refreshKey={refreshKey}
        />
      ) : null}

      {accountId ? (
        <>
          {channel?.code ? <CapabilityBadges channelCode={channel.code} /> : null}
          <ChannelSummaryCards accountId={accountId} refreshKey={refreshKey} />
        </>
      ) : null}

      <ChannelStatusSection status={status} loading={loadingCollection} error={collectionError} />

      <div ref={credentialRef}>
        <ConnectionInfoSection
          accountId={accountId}
          info={connectionInfo}
          loading={loadingInfo}
          error={infoError}
          channelCode={channel?.code}
          template={credentialTemplate}
          templateError={templateError}
          onViewRuns={() => scrollToSection("runs")}
          onReport={report}
          onChanged={reload}
        />
      </div>

      <div ref={collectSettingsRef}>
        <CollectionSettingsSection
          accountId={accountId}
          channelCode={channel?.code}
          schedules={schedules}
          capabilities={capabilities}
          onChanged={reload}
          onReport={report}
        />
      </div>

      <div ref={runsRef}>
        <CollectionHistorySection
          runs={runs}
          loading={loadingCollection}
          error={collectionError}
          onChanged={reload}
          onReport={report}
        />
      </div>

      {/* 기간 수집 — the backfill panel, mounted unchanged. */}
      {accountId ? <BackfillPanel accountId={accountId} onCompleted={reload} /> : null}

      {accountId ? <CommunityArticleList accountId={accountId} refreshKey={refreshKey} /> : null}

      <div className="rounded-xl bg-canvas px-4 py-3 text-base text-muted">
        연결로 가져오기 어려운 자료는{" "}
        <BtnLink to={`/connect/upload?channelId=${account?.channelId ?? ""}`} size="sm" variant="ghost">
          정기 자료 가져오기
        </BtnLink>
        로 채울 수 있습니다. 같은 자료를 다시 넘겨도 중복은 건너뜁니다.
      </div>
    </>
  );
}
