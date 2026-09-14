import { useEffect, useRef, useState } from "react";
import { PageHead } from "../../ui/PageHead";
import { Btn, BtnLink } from "../../ui/Btn";
import { Disclosure } from "../../ui/Disclosure";
import { CapabilityCard } from "./CapabilityCard";
import { ConnectionInfoSection } from "../ChannelStatusSection";
import { CollectionSettingsSection } from "../CollectionSettingsSection";
import { CollectionHistorySection } from "../CollectionHistorySection";
import { BackfillPanel } from "../../BackfillPanel";
import { api } from "../../../lib/apiClient";
import { relativeTime, untilTime } from "../../../lib/format";
import { reviewRecordPath } from "../../../lib/reviewRecord";
import {
  apiCardOf,
  reviewCardOf,
  reviewCollectionPath,
} from "../../../lib/connect/coupangCapabilities";
import { lastScreenRead } from "../../../lib/connect/reviewCollection";
import type { AcquisitionReadinessView } from "../../../lib/acquisitionReadiness";
import type {
  CapabilityView,
  ChannelCapabilityOverview,
  ConnectionInfoView,
  ConnectionStatusView,
  CredentialTemplateView,
  ScheduleView,
  SyncRunView,
} from "../../../lib/types";

/**
 * <b>쿠팡 채널 화면 — 판매자가 이해해야 하는 것은 두 가지뿐이다.</b>
 *
 * <p>리뷰는 <b>열려 있는 판매자 화면</b>에서 오고, 문의·주문은 <b>API</b>로 온다. 그 둘은 서로를 필요로
 * 하지 않는다. 이 화면은 그 두 문장과, 각각의 상태와, 각각의 다음 걸음 하나씩으로 끝난다.
 *
 * <p><b>무엇을 지웠는가</b>(product-owner decision, 2026-09-14). 「요약」 KPI 여섯 칸과 기간 토글(리뷰·문의
 * 화면과 홈이 이미 소유한다) · 「수집 가능 데이터」(배포 사실을 채널 사실처럼 말해, 바로 아래 카드와 정면으로
 * 모순됐다) · 「수집된 리뷰·문의」(상품평 목록과 문의 화면의 세 번째 사본) · 페이지 바닥의 범용 「기간 지정
 * 수집」(기본값으로 ✓리뷰가 켜져 있었는데, 쿠팡 리뷰에는 그 경로가 없다). 실측 3,796px · 제목 13 ·
 * 컨트롤 25 → 이 화면.
 *
 * <p><b>배포에서 돌지 않는 capability는 카드가 없다.</b> 쿠팡 OpenAPI 커넥터가 해석되지 않는 배포에서는
 * 문의·주문 카드도, 자격 입력 폼도 존재하지 않는다 — 예전에는 폼이 그대로 떠 있었고, 키를 넣어도 아무것도
 * 수집되지 않았다.
 *
 * <p>정상 상태에 진단은 없다. 도우미·실행 프로그램·연결 방식은 그것이 막고 있는 걸음 안에서만 이름을 얻는다.
 */
export function CoupangChannelView({
  accountId,
  channelCode,
  title,
  status,
  connectionInfo,
  infoLoading,
  infoError,
  credentialTemplate,
  templateError,
  schedules,
  capabilities,
  runs,
  onReport,
  onChanged,
}: {
  accountId: string;
  channelCode: string;
  title: string;
  status: ConnectionStatusView | null;
  connectionInfo: ConnectionInfoView | null;
  infoLoading: boolean;
  infoError: boolean;
  credentialTemplate: CredentialTemplateView | null;
  templateError: boolean;
  schedules: ScheduleView[];
  capabilities: CapabilityView[] | null;
  runs: SyncRunView[];
  onReport: (message: string, isError: boolean) => void;
  onChanged: () => void;
}) {
  const [readiness, setReadiness] = useState<AcquisitionReadinessView | null>(null);
  const [overview, setOverview] = useState<ChannelCapabilityOverview | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  /** 연결 정보가 펼쳐져 있는가. 「API 연결하기」가 여는 것이 정확히 이것이다. */
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const credentialsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void api
      .getReviewAcquisitionReadiness(accountId)
      .then((r) => live && setReadiness(r))
      // A failed read says nothing: the card stays on 확인 중 rather than inventing a state.
      .catch(() => undefined);
    void api
      .getChannelReviewsStrict(accountId, { size: 1 })
      .then((v) => live && setReviewCount(v.total))
      .catch(() => live && setReviewCount(null));
    return () => {
      live = false;
    };
  }, [accountId, runs.length]);

  useEffect(() => {
    let live = true;
    void api
      .getChannelCapabilityOverview(channelCode)
      // Fail closed: an unreadable capability answer draws no API card, because the one thing this
      // package refuses to do is invite a seller to set up something that may not run here.
      .then((o) => live && setOverview(o))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [channelCode]);

  const review = reviewCardOf(readiness);
  const apiCard = apiCardOf(overview, connectionInfo, status);
  const lastRead = lastScreenRead(runs);

  /**
   * <b>한 시점에 가장 강한 컨트롤은 하나다.</b>
   *
   * 카드마다 다음 걸음 하나는 맞지만, 그 둘이 같은 화면에서 같은 무게로 서면 판매자는 「먼저 무엇을 할지」를
   * 고르게 된다. 규칙은 둘이다 — <b>끝나지 않은 연결이 있으면 그것이 이 화면의 다음 걸음이고</b>, 없으면
   * 이 화면이 존재하는 이유(상품평 가져오기)가 그 자리를 갖는다. 나머지는 보조 컨트롤이다.
   */
  const lead: "REVIEW" | "API" =
    review?.kind === "SETUP" ? "REVIEW" : apiCard && apiCard.kind !== "READY" ? "API" : "REVIEW";

  const reviewFacts: string[] = [];
  if (lastRead?.finishedAt) reviewFacts.push(`마지막 수집 ${relativeTime(lastRead.finishedAt)}`);
  if (reviewCount !== null) reviewFacts.push(`가져온 상품평 ${reviewCount.toLocaleString("ko-KR")}개`);

  const apiFacts: string[] = [];
  if (status?.lastSyncedAt) apiFacts.push(`마지막 수집 ${relativeTime(status.lastSyncedAt)}`);
  if (status?.nextScheduledAt) apiFacts.push(`다음 수집 ${untilTime(status.nextScheduledAt)}`);

  return (
    <>
      <PageHead
        title={title}
        action={
          <BtnLink to="/connect" size="sm" variant="outline">
            채널 목록
          </BtnLink>
        }
      />

      {review ? (
        <CapabilityCard
          testId="coupang-review-card"
          title="리뷰 수집"
          status={review.status}
          description="로그인된 쿠팡 판매자 화면에서 상품평을 가져옵니다. API 키는 필요하지 않습니다."
          facts={reviewFacts.length > 0 ? reviewFacts.join(" · ") : null}
          primary={
            review.primaryLabel ? (
              <BtnLink
                to={reviewCollectionPath(accountId)}
                variant={lead === "REVIEW" ? "solid" : "outline"}
                // 이 press가 곧 시작이다. 도착한 화면은 이 표시를 읽자마자 지우므로, 같은 주소를 새로고침해도
                // 수집이 다시 일어나지 않는다.
                state={{ start: true }}
              >
                {review.primaryLabel}
              </BtnLink>
            ) : null
          }
          secondary={
            reviewCount !== null && reviewCount > 0 ? (
              <BtnLink to={reviewRecordPath(accountId)} size="sm" variant="ghost">
                가져온 상품평 보기
              </BtnLink>
            ) : null
          }
        />
      ) : null}

      {apiCard ? (
        <CapabilityCard
          testId="coupang-api-card"
          title="문의·주문 자동 수집"
          status={apiCard.status}
          description="쿠팡에서 발급한 API 키로 문의와 주문을 자동으로 가져옵니다. 리뷰와는 서로 필요하지 않습니다."
          facts={apiFacts.length > 0 ? apiFacts.join(" · ") : null}
          primary={
            apiCard.kind === "READY" ? (
              <ApiCollectNow
                accountId={accountId}
                dataTypes={apiCollectableTypes(capabilities)}
                onReport={onReport}
                onChanged={onChanged}
              />
            ) : (
              <Btn
                variant={lead === "API" ? "solid" : "outline"}
                data-testid="coupang-api-cta"
                onClick={() => {
                  setCredentialsOpen(true);
                  // 여는 것이 본체이고 스크롤은 거들 뿐이다 — 스크롤을 구현하지 않는 환경에서 컨트롤이
                  // 예외로 죽으면, 판매자는 눌렀는데 아무 일도 일어나지 않은 화면을 본다.
                  const el = credentialsRef.current;
                  if (el && typeof el.scrollIntoView === "function") {
                    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  }
                }}
              >
                {apiCard.primaryLabel}
              </Btn>
            )
          }
          advanced={
            <div className="space-y-4" ref={credentialsRef}>
              <Disclosure label="연결 정보" open={credentialsOpen} onOpenChange={setCredentialsOpen}>
                <div className="pt-3">
                  <ConnectionInfoSection
                    accountId={accountId}
                    info={connectionInfo}
                    loading={infoLoading}
                    error={infoError}
                    channelCode={channelCode}
                    template={credentialTemplate}
                    templateError={templateError}
                    onViewRuns={() => undefined}
                    onReport={onReport}
                    onChanged={onChanged}
                    heading={null}
                  />
                </div>
              </Disclosure>
              <Disclosure label="수집 주기">
                <div className="pt-3">
                  <CollectionSettingsSection
                    accountId={accountId}
                    channelCode={channelCode}
                    schedules={schedules}
                    capabilities={capabilities}
                    onChanged={onChanged}
                    onReport={onReport}
                    heading={null}
                  />
                </div>
              </Disclosure>
              {/*
                기간 수집은 그것을 실제로 할 수 있는 capability 안에 산다. 쿠팡 리뷰에는 기간 수집 경로가
                없으므로 이 목록에 리뷰가 없고, 그래서 판매자가 될 수 없는 수집을 시작할 수 없다 — 예전
                화면은 기본값으로 ✓리뷰를 켜 둔 채 [이 기간 수집하기]를 제공했다.
              */}
              <Disclosure label="기간 지정 수집">
                <div className="pt-3">
                  <BackfillPanel
                    accountId={accountId}
                    onCompleted={onChanged}
                    dataTypes={["INQUIRY", "ORDER_SUMMARY"]}
                    heading={null}
                  />
                </div>
              </Disclosure>
            </div>
          }
        />
      ) : null}

      <Disclosure label="지난 실행 기록" className="rounded-2xl border border-line bg-surface px-3 py-2">
        <div className="px-2 pb-2 pt-3">
          <CollectionHistorySection
            runs={runs}
            loading={false}
            error={false}
            onChanged={onChanged}
            onReport={onReport}
            heading={null}
          />
        </div>
      </Disclosure>
    </>
  );
}

/**
 * 이 채널의 API가 실제로 가져올 수 있는 종류. 서버의 capability 표가 유일한 근거이고, 읽지 못했으면
 * 아무것도 주장하지 않는다(빈 목록 → 버튼 없음).
 */
function apiCollectableTypes(capabilities: CapabilityView[] | null): string[] {
  if (!capabilities) return [];
  return ["INQUIRY", "ORDER_SUMMARY"].filter((type) =>
    capabilities.some((c) => c.dataType === type && c.connectorClass === "API" && c.supported),
  );
}

/**
 * 지금 가져오기 — API lane.
 *
 * 이 카드가 약속하는 것은 「문의·주문」이므로 한 번의 press가 그 둘을 다 가져온다. 예전 화면은 같은 일을
 * 두 줄에 나눠 [지금 수집하기]를 두 개 세워 두었고, 판매자는 어느 쪽이 자기가 원하는 것인지 골라야 했다.
 * 지원하지 않는 종류는 누르지 않는다 — 무엇을 지원하는지는 서버의 capability 표가 답한다.
 */
function ApiCollectNow({
  accountId,
  dataTypes,
  onReport,
  onChanged,
}: {
  accountId: string;
  dataTypes: string[];
  onReport: (message: string, isError: boolean) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (dataTypes.length === 0) return null;
  return (
    <Btn
      variant="outline"
      disabled={busy}
      data-testid="coupang-api-collect"
      onClick={() => {
        setBusy(true);
        void (async () => {
          let stored = 0;
          try {
            for (const type of dataTypes) {
              const run = await api.manualSync(accountId, type);
              stored += run.successRows;
            }
            onReport(`문의·주문을 가져왔습니다. 새로 저장 ${stored}건.`, false);
            onChanged();
          } catch {
            onReport("수집을 마치지 못했습니다. 잠시 후 다시 시도해 주세요.", true);
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      {busy ? "가져오는 중…" : "지금 가져오기"}
    </Btn>
  );
}
