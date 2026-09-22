import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Empty } from "../../components/ui/Empty";
import { Disclosure } from "../../components/ui/Disclosure";
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
import { CoupangChannelView } from "../../components/connect/coupang/CoupangChannelView";
import { ReviewRecordPanel } from "../../components/connect/ReviewRecordPanel";
import { nextActionFor, type ScrollTarget } from "../../components/connect/channelShared";
import { api } from "../../lib/apiClient";
import { hasReviewRecord } from "../../lib/reviewRecord";
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
  // Which fold is open, so a 다음 조치 button can open the one it points into (Phase 4).
  const [openFold, setOpenFold] = useState<"info" | "runs" | null>(null);
  const scrollToSection = useCallback((target: ScrollTarget) => {
    if (target === "info" || target === "runs") setOpenFold(target);
    const ref =
      target === "collect" ? collectSettingsRef : target === "info" ? credentialRef : runsRef;
    // After the fold has opened, so the scroll lands on content rather than on a closed summary.
    requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
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


  /**
   * <b>쿠팡은 자기 화면을 갖는다</b>(Coupang Connection UX v2, product-owner decision 2026-09-14).
   *
   * 이 페이지가 지금까지 그리던 열세 개의 제목은 「연결이 살아 있는가」를 관리하는 화면의 것이고, 쿠팡
   * 판매자가 이 주소에서 물어보는 것은 「리뷰는 어떻게 들어오고, 문의·주문은 어떻게 들어오는가」 둘뿐이다.
   * 아래의 분기가 그 둘을 가른다 — <b>다른 채널의 화면은 한 글자도 바뀌지 않는다</b>(NAVER·Cafe24 IA 고정).
   * 이 화면이 이미 읽어 둔 것을 그대로 넘기므로, 쿠팡 화면이 추가로 사는 읽기는 둘(취득 준비 상태 ·
   * capability 개요)뿐이다.
   */
  if (channel?.code === "COUPANG" && accountId) {
    return (
      <>
        {notice ? <div className="rounded-xl bg-brand-50 px-4 py-3 text-brand-700">{notice}</div> : null}
        {error ? <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">{error}</div> : null}
        <CoupangChannelView
          accountId={accountId}
          channelCode={channel.code}
          title={account?.alias ?? account?.channelNameKo ?? "쿠팡"}
          status={collectionError ? null : status}
          connectionInfo={connectionInfo}
          infoLoading={loadingInfo}
          infoError={infoError}
          credentialTemplate={credentialTemplate}
          templateError={templateError}
          schedules={schedules}
          capabilities={capabilities}
          runs={runs}
          onReport={report}
          onChanged={reload}
        />
      </>
    );
  }

  /*
   * UI/UX v2 Phase 4 — the same sections, sorted by what the seller came for. On top: the state and its one next
   * step, the reviews this channel holds, and the collection controls. Below, folded: the connection's credentials,
   * the run log, a dated collection, this channel's numbers and articles — everything is still here, one click
   * away, and none of it stands between the seller and the two questions this page answers first. The 다음 조치
   * buttons open the fold they point into before scrolling to it.
   */
  return (
    <div className="space-y-6">
      <PageHead
        title={account?.alias ?? account?.channelNameKo ?? "채널"}
        meta={status ? <HealthBadge state={status.state} /> : undefined}
        action={
          <BtnLink to="/connect" size="sm" variant="ghost">
            채널 목록
          </BtnLink>
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

      {/* Above the connection sections, because it is what the seller came for. It is the page's one way to the
          review record — the header no longer repeats it. */}
      {accountId && hasReviewRecord(channel?.code) ? (
        <ReviewRecordPanel
          accountId={accountId}
          channelCode={channel?.code}
          refreshKey={refreshKey}
        />
      ) : null}

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

      <div ref={credentialRef}>
        <Disclosure label="연결 정보" note="인증 · 연결 상태" open={openFold === "info"} onOpenChange={(o) => setOpenFold(o ? "info" : null)}>
          <div className="mt-3 space-y-6">
            <ChannelStatusSection
              accountId={accountId}
              status={status}
              loading={loadingCollection}
              error={collectionError}
            />
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
        </Disclosure>
      </div>

      <div ref={runsRef}>
        <Disclosure label="수집 이력" note={runs.length > 0 ? `${runs.length}회` : undefined} open={openFold === "runs"} onOpenChange={(o) => setOpenFold(o ? "runs" : null)}>
          <div className="mt-3">
            <CollectionHistorySection
              runs={runs}
              loading={loadingCollection}
              error={collectionError}
              onChanged={reload}
              onReport={report}
            />
          </div>
        </Disclosure>
      </div>

      {accountId ? (
        <Disclosure label="기간 지정 수집">
          <div className="mt-3">
            {/* 기간 수집 — the backfill panel, mounted unchanged. */}
            <BackfillPanel accountId={accountId} onCompleted={reload} />
          </div>
        </Disclosure>
      ) : null}

      {accountId ? (
        <Disclosure label="이 채널의 자료" note="수집 가능 데이터 · 숫자 · 수집된 글">
          <div className="mt-3 space-y-6">
            {channel?.code ? <CapabilityBadges channelCode={channel.code} /> : null}
            <ChannelSummaryCards accountId={accountId} refreshKey={refreshKey} />
            <CommunityArticleList accountId={accountId} refreshKey={refreshKey} />
          </div>
        </Disclosure>
      ) : null}

      <p className="break-keep text-sm text-muted">
        연결로 가져오기 어려운 자료는{" "}
        <Link to={`/connect/upload?channelId=${account?.channelId ?? ""}`} className="font-semibold text-ink underline underline-offset-4">
          자료 업로드
        </Link>
        로 채울 수 있습니다. 같은 자료를 다시 넘겨도 중복은 건너뜁니다.
      </p>
    </div>
  );
}
