import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { Section } from "../components/Section";
import { EmptyState } from "../components/EmptyState";
import { HealthBadge } from "../components/HealthBadge";
import { api } from "../lib/apiClient";
import { relativeTime, untilTime } from "../lib/format";
import type {
  CapabilityView,
  ChannelResponse,
  ConnectionInfoView,
  ConnectionStatusView,
  ConnectionTestResultView,
  CredentialFieldView,
  CredentialTemplateView,
  ScheduleView,
  SellerAccountResponse,
  SyncRunView,
} from "../lib/types";

type ScrollTarget = "collect" | "runs" | "info";

/** Pull the backend's error message out of an Axios error, if present. */
function backendMessage(e: unknown): string | null {
  if (isAxiosError(e)) {
    const data = e.response?.data as { message?: string } | undefined;
    return data?.message ?? null;
  }
  return null;
}

const DATA_TYPES: Array<{ value: string; label: string }> = [
  { value: "REVIEW", label: "리뷰" },
  { value: "INQUIRY", label: "문의" },
  { value: "ORDER_SUMMARY", label: "주문·매출" },
];

const INTERVALS: Array<{ minutes: number; label: string }> = [
  { minutes: 60, label: "매시간" },
  { minutes: 360, label: "6시간마다" },
  { minutes: 1440, label: "매일" },
];

type Tone = "good" | "warn" | "bad" | "muted";

const TITLE_CLS: Record<Tone, string> = {
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  muted: "text-ink",
};

interface NextAction {
  tone: Tone;
  title: string;
  guidance: string;
  detail?: string;
  cta?: { label: string; target: ScrollTarget };
}

// Humanize the masked credential authType for operators. Kept high-level — the
// exact secret-key shape is the connector's concern (and a Slice 2 backend
// template), never surfaced here.
function authTypeLabel(authType: string): string {
  switch (authType) {
    case "API_KEY":
    case "HMAC":
    case "JWT_HS256":
      return "API 키";
    case "OAUTH2":
      return "앱 연동(OAuth)";
    default:
      return authType;
  }
}

// Expiry label for tokenExpiresAt: future → "n일 후", past/now → 재등록 안내,
// missing → 정보 없음.
function expiryLabel(iso: string | null): { text: string; expired: boolean } {
  if (!iso) {
    return { text: "만료 정보 없음", expired: false };
  }
  if (new Date(iso).getTime() <= Date.now()) {
    return { text: "만료됨 (재등록 필요)", expired: true };
  }
  return { text: untilTime(iso), expired: false };
}

// Calm, high-level per-channel guidance on what kind of connection info the
// channel needs — keyed by ChannelResponse.code. Describes the *kind* of info,
// never the connector's exact secret-key names, never a password-casual ask.
// Falls back to a generic line for channels without a specific note.
const CHANNEL_GUIDANCE: Record<string, string> = {
  COUPANG: "쿠팡 판매자센터(쿠팡 윙)에서 발급한 API 키로 연결합니다.",
  NAVER: "네이버 커머스 API 센터에서 발급한 애플리케이션 키로 연결합니다.",
  GMARKET: "ESM 판매자센터에서 발급한 API 인증 정보로 연결합니다.",
  ELEVENST: "11번가 셀러오피스에서 발급한 오픈 API 키로 연결합니다.",
  CAFE24: "자사몰 관리자에서 앱 연동(OAuth)으로 연결합니다.",
};
const GENERIC_GUIDANCE =
  "채널 판매자센터에서 발급한 연결 정보(API 키 등)로 연결합니다.";

// "다음 조치" copy keyed by ConnectionStatusView.state (the 6 connection states
// from ChannelConnectionStatus — NOT the connector-alert types). Every CTA points
// at an action that already exists on this page: 수집 테스트 = 지금 수집하기 in the
// 자동 수집 설정 section; 수집 내역 보기 scrolls to 최근 수집 내역 (where 다시 시도
// lives). Re-auth/disconnected states explain that 연결 정보 갱신 is needed but
// render no reconnect button (that flow is not built) and no roadmap copy.
const NEXT_ACTION: Record<string, NextAction> = {
  CONNECTED: {
    tone: "good",
    title: "정상 수집 중입니다",
    guidance: "연결에 문제가 없습니다. 필요하면 지금 수집을 한 번 테스트할 수 있습니다.",
    cta: { label: "수집 테스트", target: "collect" },
  },
  NOT_COLLECTED: {
    tone: "muted",
    title: "아직 수집 이력이 없습니다",
    guidance: "수집을 한 번 테스트해 연결이 정상인지 확인해 보세요.",
    cta: { label: "수집 테스트", target: "collect" },
  },
  DEGRADED: {
    tone: "warn",
    title: "최근 수집에 실패했습니다",
    guidance: "수집 내역에서 오류를 확인하고 다시 시도해 보세요.",
    cta: { label: "수집 내역 보기", target: "runs" },
  },
  EXPIRED: {
    tone: "bad",
    title: "재연결이 필요합니다",
    guidance: "인증이 만료되어 자동 수집이 멈췄습니다. 자동 수집을 다시 사용하려면 연결 정보를 갱신해야 합니다.",
    detail: "아래 연결 정보에서 만료 상태를 확인할 수 있습니다.",
    cta: { label: "연결 정보 보기", target: "info" },
  },
  NEEDS_REAUTH: {
    tone: "bad",
    title: "재연결이 필요합니다",
    guidance: "인증이 만료되어 자동 수집이 멈췄습니다. 자동 수집을 다시 사용하려면 연결 정보를 갱신해야 합니다.",
    detail: "아래 연결 정보에서 만료 상태를 확인할 수 있습니다.",
    cta: { label: "연결 정보 보기", target: "info" },
  },
  DISCONNECTED: {
    tone: "bad",
    title: "연결 정보 확인이 필요합니다",
    guidance: "채널 연결이 끊겼습니다. 연결 정보와 최근 수집 내역을 확인해 주세요.",
    cta: { label: "연결 정보 보기", target: "info" },
  },
};

function nextActionFor(status: ConnectionStatusView): NextAction {
  const base: NextAction = NEXT_ACTION[status.state] ?? {
    tone: "muted",
    title: "연결 상태를 확인해 주세요",
    guidance: "아래 수집 내역과 오류 메시지에서 자세한 상태를 확인할 수 있습니다.",
    cta: { label: "수집 내역 보기", target: "runs" },
  };
  // For a degraded connection, lead with the consecutive-failure count.
  if (base.tone === "warn" && status.consecutiveFailures > 0) {
    return {
      ...base,
      guidance: `최근 수집이 연속 ${status.consecutiveFailures}회 실패했습니다. ${base.guidance}`,
    };
  }
  return base;
}

/** 자동 수집 관리 — connection panel for one seller account. */
export function ChannelDetail() {
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
          setError("수집 지원 정보를 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.");
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
      <EmptyState message="채널 정보를 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요." />
    );
  }
  if (accounts && !account) {
    return <EmptyState message="판매 계정을 찾을 수 없습니다." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-base text-muted">
          <Link to="/channels" className="hover:underline">채널 연결</Link> / 자동 수집 관리
        </p>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-bold">{account?.alias ?? account?.channelNameKo ?? "채널"}</h1>
          {status ? <HealthBadge state={status.state} /> : null}
        </div>
        <p className="mt-1 text-lg text-muted">
          자동 수집이 이 채널의 기본 연결 방식입니다. 파일 업로드는 백업 방식으로 언제든 쓸 수 있습니다.
        </p>
      </div>

      {/* State-aware next action. Only when status is loaded and the read
          succeeded — a dead backend must not fabricate a "다음 조치". */}
      {!loadingCollection && !collectionError && status ? (
        <NextActionPanel action={nextActionFor(status)} onCta={scrollToSection} />
      ) : null}

      {notice ? <div className="rounded-xl bg-brand/10 px-4 py-3 text-brand-700">{notice}</div> : null}
      {error ? <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">{error}</div> : null}

      <Section title="연결 상태">
        {loadingCollection ? (
          <p className="text-base text-muted">불러오는 중…</p>
        ) : collectionError ? (
          <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
            연결 상태를 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 text-base md:grid-cols-3">
              <div>
                <p className="text-sm text-muted">마지막 수집</p>
                <p className="mt-1 font-semibold">
                  {status?.lastSyncedAt ? relativeTime(status.lastSyncedAt) : "수집 이력 없음"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted">다음 자동 수집</p>
                <p className="mt-1 font-semibold">
                  {status?.nextScheduledAt ? untilTime(status.nextScheduledAt) : "예약 없음"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted">연속 실패</p>
                <p className={`mt-1 font-semibold ${status && status.consecutiveFailures > 0 ? "text-warn" : ""}`}>
                  {status ? `${status.consecutiveFailures}회` : "-"}
                </p>
              </div>
            </div>
            {status?.lastError ? (
              <p className="mt-4 rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">{status.lastError}</p>
            ) : null}
          </>
        )}
      </Section>

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
        <Section title="자동 수집 설정">
          <ul className="divide-y divide-line">
            {DATA_TYPES.map((t) => (
              <ScheduleRow
                key={t.value}
                accountId={accountId}
                dataType={t.value}
                label={t.label}
                schedule={schedules.find((s) => s.dataType === t.value) ?? null}
                capability={capabilities?.find((c) => c.dataType === t.value) ?? null}
                capabilitiesReady={capabilities !== null}
                onChanged={reload}
                onReport={report}
              />
            ))}
          </ul>
        </Section>
      </div>

      <div ref={runsRef}>
      <Section title="최근 수집 내역">
        {loadingCollection ? (
          <p className="text-base text-muted">불러오는 중…</p>
        ) : collectionError ? (
          <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
            수집 내역을 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.
          </p>
        ) : runs.length === 0 ? (
          <p className="text-base text-muted">아직 수집 내역이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} onChanged={reload} onReport={report} />
            ))}
          </ul>
        )}
      </Section>
      </div>

      <div className="rounded-xl bg-canvas px-4 py-3 text-base text-muted">
        자동 수집이 어려운 데이터는{" "}
        <Link to={`/upload?channelId=${account?.channelId ?? ""}`} className="font-semibold text-brand-700 hover:underline">
          파일 업로드(백업 방식)
        </Link>
        로 채울 수 있습니다. 같은 데이터를 다시 올려도 중복은 자동으로 건너뜁니다.
      </div>
    </div>
  );
}

function NextActionPanel({
  action,
  onCta,
}: {
  action: NextAction;
  onCta: (target: ScrollTarget) => void;
}) {
  const { tone, title, guidance, detail, cta } = action;
  return (
    <section className="card">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted">다음 조치</p>
          <p className={`text-xl font-bold ${TITLE_CLS[tone]}`}>{title}</p>
          <p className="text-base text-ink">{guidance}</p>
          {detail ? <p className="text-sm text-muted">{detail}</p> : null}
        </div>
        {cta ? (
          <button
            type="button"
            onClick={() => onCta(cta.target)}
            className="btn-ghost shrink-0"
          >
            {cta.label}
          </button>
        ) : null}
      </div>
    </section>
  );
}

// Read-only 연결 정보 panel: shows whether masked credential metadata is on file
// and its 갱신/만료, plus calm per-channel guidance. No secret is read or shown,
// no write action, no reconnect form — that flow (연결 정보 갱신) is a later slice.
function ConnectionInfoSection({
  accountId,
  info,
  loading,
  error,
  channelCode,
  template,
  templateError,
  onViewRuns,
  onReport,
  onChanged,
}: {
  accountId: string;
  info: ConnectionInfoView | null;
  loading: boolean;
  error: boolean;
  channelCode: string | undefined;
  template: CredentialTemplateView | null;
  templateError: boolean;
  onViewRuns: () => void;
  onReport: (message: string, isError: boolean) => void;
  onChanged: () => void;
}) {
  const guidance = (channelCode && CHANNEL_GUIDANCE[channelCode]) ?? GENERIC_GUIDANCE;
  // The entry form needs an API template; manual / file-upload channels (404 →
  // null) get the guidance text only, never a form.
  const canEnter = template !== null && template.fields.length > 0;

  return (
    <Section title="연결 정보">
      {loading ? (
        <p className="text-base text-muted">불러오는 중…</p>
      ) : error ? (
        <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
          연결 정보를 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.
        </p>
      ) : info === null ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-base font-semibold text-ink">등록된 연결 정보가 없습니다.</p>
            <p className="text-base text-muted">{guidance}</p>
          </div>
          {canEnter ? (
            <CredentialEntryForm
              accountId={accountId}
              template={template}
              onReport={onReport}
              onChanged={onChanged}
            />
          ) : null}
        </div>
      ) : (
        <ConnectionInfoDetail
          info={info}
          guidance={guidance}
          onViewRuns={onViewRuns}
          accountId={accountId}
          template={template}
          onReport={onReport}
          onChanged={onChanged}
        />
      )}
      <CredentialTemplateBlock template={template} error={templateError} />
    </Section>
  );
}

// Read-only 연결에 필요한 정보 block: the backend-owned credential field shape for
// this channel. Reference only — labels/helpText/required/secret indicators, never
// an input, a value, or a submit. Omitted entirely when the channel needs no API
// template (404 → null), shown as one calm line on a non-404 read failure.
function CredentialTemplateBlock({
  template,
  error,
}: {
  template: CredentialTemplateView | null;
  error: boolean;
}) {
  if (error) {
    return (
      <div className="mt-6 border-t border-line pt-6">
        <h3 className="text-base font-bold text-ink">연결에 필요한 정보</h3>
        <p className="mt-2 rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
          연결에 필요한 정보를 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.
        </p>
      </div>
    );
  }
  if (template === null || template.fields.length === 0) {
    return null;
  }
  return (
    <div className="mt-6 border-t border-line pt-6">
      <h3 className="text-base font-bold text-ink">연결에 필요한 정보</h3>
      <ul className="mt-3 space-y-3">
        {template.fields.map((field) => (
          <CredentialFieldRow key={field.key} field={field} />
        ))}
      </ul>
    </div>
  );
}

function CredentialFieldRow({ field }: { field: CredentialFieldView }) {
  return (
    <li className="rounded-xl border border-line/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-ink">{field.label}</span>
        <span
          className={`rounded-lg px-2.5 py-1 text-sm font-medium ${
            field.required ? "bg-ink/5 text-ink" : "bg-canvas text-muted"
          }`}
        >
          {field.required ? "필수" : "선택"}
        </span>
        {field.secret ? (
          <span className="rounded-lg bg-warn/10 px-2.5 py-1 text-sm font-medium text-warn">
            민감 정보
          </span>
        ) : null}
      </div>
      {field.helpText ? (
        <p className="mt-1.5 text-sm text-muted">{field.helpText}</p>
      ) : null}
    </li>
  );
}

function ConnectionInfoDetail({
  info,
  guidance,
  onViewRuns,
  accountId,
  template,
  onReport,
  onChanged,
}: {
  info: ConnectionInfoView;
  guidance: string;
  onViewRuns: () => void;
  accountId: string;
  template: CredentialTemplateView | null;
  onReport: (message: string, isError: boolean) => void;
  onChanged: () => void;
}) {
  const expiry = expiryLabel(info.tokenExpiresAt);
  // Re-entry: connection info already exists (incl. expired), so let the operator
  // submit fresh info through the same validated path. Collapsed by default.
  const [reentering, setReentering] = useState(false);
  const canEnter = template !== null && template.fields.length > 0;

  // Manual connection check — auth/connectivity only, click-only (no effect, no
  // auto-run). The result lives in component state for this page session only:
  // never persisted, never logged, and it never mutates the displayed connection
  // status (no onChanged/reload), since a check verifies auth, not collection.
  const [checking, setChecking] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResultView | null>(null);
  const [testErrored, setTestErrored] = useState(false);
  async function runConnectionCheck() {
    if (checking) {
      return;
    }
    setChecking(true);
    setTestErrored(false);
    try {
      setTestResult(await api.testConnection(accountId));
    } catch {
      // Do not log the error/response body — it may carry provider detail.
      setTestResult(null);
      setTestErrored(true);
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-base font-semibold text-good">✓ 연결 정보가 등록되어 있습니다.</p>
      <div className="grid grid-cols-1 gap-4 text-base md:grid-cols-3">
        <div>
          <p className="text-sm text-muted">인증 방식</p>
          <p className="mt-1 font-semibold">{authTypeLabel(info.authType)}</p>
        </div>
        <div>
          <p className="text-sm text-muted">마지막 갱신</p>
          <p className="mt-1 font-semibold">
            {info.lastRotatedAt ? relativeTime(info.lastRotatedAt) : "갱신 이력 없음"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted">인증 만료</p>
          <p className={`mt-1 font-semibold ${expiry.expired ? "text-bad" : ""}`}>{expiry.text}</p>
        </div>
      </div>
      <p className="text-base text-muted">{guidance}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onViewRuns} className="btn-ghost">
          수집 내역 보기
        </button>
        {canEnter ? (
          <button type="button" onClick={() => setReentering((v) => !v)} className="btn-ghost">
            연결 정보 다시 입력
          </button>
        ) : null}
        {canEnter ? (
          <button
            type="button"
            onClick={runConnectionCheck}
            disabled={checking}
            className="btn-ghost"
          >
            {checking ? "연결 확인 중…" : "연결 확인"}
          </button>
        ) : null}
      </div>
      {testErrored ? (
        <div className="rounded-xl bg-bad/5 px-4 py-3">
          <p className="text-base font-semibold text-bad">연결 확인에 실패했습니다.</p>
        </div>
      ) : testResult ? (
        <ConnectionCheckResult result={testResult} />
      ) : null}
      {reentering && canEnter ? (
        <CredentialEntryForm
          accountId={accountId}
          template={template}
          onReport={onReport}
          onChanged={onChanged}
          onDone={() => setReentering(false)}
        />
      ) : null}
    </div>
  );
}

// Renders a connection-check result from the safe DTO. Auth/connectivity only —
// never implies collection. Copy is frontend-fixed per status (so no raw provider
// string or banned wording can surface); the backend `message` is shown ONLY for
// FAILED, as a muted secondary line (it is a fixed, secret-free, hedged string).
// `reasonCode` is never rendered raw; tokens/secrets/provider bodies are never
// present in this DTO.
function ConnectionCheckResult({ result }: { result: ConnectionTestResultView }) {
  if (result.status === "SUCCESS") {
    return <p className="text-base font-semibold text-good">✓ 연결 정보가 확인되었습니다.</p>;
  }
  if (result.status === "FAILED") {
    return (
      <div className="rounded-xl bg-bad/5 px-4 py-3">
        <p className="text-base font-semibold text-bad">연결 확인에 실패했습니다.</p>
        {result.message ? <p className="mt-1 text-sm text-muted">{result.message}</p> : null}
      </div>
    );
  }
  if (result.status === "NOT_CONFIGURED") {
    return <p className="text-base text-muted">저장된 연결 정보가 없습니다.</p>;
  }
  // UNSUPPORTED (and any unexpected status) — not-yet-supported, fixed copy.
  return <p className="text-base text-muted">이 채널의 연결 확인은 아직 제공되지 않습니다.</p>;
}

// 연결 정보 입력 form: renders one input per backend credential-template field
// (label as primary UI, helpText as helper, secret → masked password input), and
// submits to the validated POST /credentials path. Server-derives
// connectorClass/authType from the template; sends only the fields the operator
// typed (trimmed, blank optionals omitted). On success it reports a save-only
// message ("연결 정보가 저장되었습니다" — NOT a connection-success claim, no
// test-connection exists), clears every field, and triggers a masked-metadata
// re-read. Secret values live only in local state, are never logged, stored, or
// echoed; a backend 400 surfaces the calm (secret-safe) backend message and keeps
// the typed fields so the operator can correct and resubmit.
function CredentialEntryForm({
  accountId,
  template,
  onReport,
  onChanged,
  onDone,
}: {
  accountId: string;
  template: CredentialTemplateView;
  onReport: (message: string, isError: boolean) => void;
  onChanged: () => void;
  onDone?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // UX-only gate (backend validation is the source of truth): every required
  // field non-blank after trim.
  const requiredFilled = template.fields
    .filter((f) => f.required)
    .every((f) => (values[f.key] ?? "").trim().length > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) {
      return;
    }
    setSaving(true);
    // Build secrets keyed by field.key: trim every value, omit blank optionals so
    // the payload is exactly the connector's expected shape.
    const secrets: Record<string, string> = {};
    for (const field of template.fields) {
      const value = (values[field.key] ?? "").trim();
      if (value.length > 0) {
        secrets[field.key] = value;
      }
    }
    try {
      await api.storeCredential(accountId, {
        connectorClass: template.connectorClass,
        authType: template.authType,
        secrets,
      });
      setValues({});
      onReport("연결 정보가 저장되었습니다.", false);
      onChanged();
      onDone?.();
    } catch (err) {
      onReport(
        backendMessage(err) ?? "연결 정보 저장에 실패했습니다. 입력 정보를 확인해 주세요.",
        true,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-4 rounded-xl border border-line bg-canvas/40 p-4" onSubmit={submit}>
      <h3 className="text-base font-bold text-ink">연결 정보 입력</h3>
      {template.fields.map((field) => (
        <div key={field.key}>
          <label htmlFor={`cred-${field.key}`} className="mb-1.5 block text-base font-semibold text-ink">
            {field.label}
            {field.required ? null : (
              <span className="ml-2 text-sm font-normal text-muted">(선택)</span>
            )}
          </label>
          <input
            id={`cred-${field.key}`}
            type={field.secret ? "password" : "text"}
            value={values[field.key] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            required={field.required}
            autoComplete="off"
            className="w-full rounded-xl border border-line px-4 py-2.5 text-base focus:border-brand focus:outline-none"
          />
          {field.helpText ? <p className="mt-1 text-sm text-muted">{field.helpText}</p> : null}
        </div>
      ))}
      <p className="text-sm text-muted">
        입력한 정보는 암호화되어 저장됩니다. 저장 후 수집 테스트는 별도 단계에서 확인합니다.
      </p>
      <button type="submit" disabled={saving || !requiredFilled} className="btn-primary">
        {saving ? "저장 중…" : "연결 정보 저장"}
      </button>
    </form>
  );
}

function ScheduleRow({
  accountId,
  dataType,
  label,
  schedule,
  capability,
  capabilitiesReady,
  onChanged,
  onReport,
}: {
  accountId: string;
  dataType: string;
  label: string;
  schedule: ScheduleView | null;
  capability: CapabilityView | null;
  capabilitiesReady: boolean;
  onChanged: () => void;
  onReport: (message: string, isError: boolean) => void;
}) {
  const [cadence, setCadence] = useState(schedule?.intervalMinutes ?? 360);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (schedule?.intervalMinutes) {
      setCadence(schedule.intervalMinutes);
    }
  }, [schedule?.intervalMinutes]);

  const unsupported = capability !== null && !capability.supported;
  const needsVerification = capability?.verificationStatus === "NEEDS_VERIFICATION";
  const enabled = schedule?.enabled ?? false;
  // One guard for the whole row: a save and a manual sync must not overlap.
  const rowBusy = saving || syncing;
  // Cadence changed but not applied yet — saving is always an explicit action.
  const cadenceDirty = enabled && schedule?.intervalMinutes != null && cadence !== schedule.intervalMinutes;

  async function save(nextEnabled: boolean) {
    setSaving(true);
    try {
      await api.putSchedule(accountId, { dataType, intervalMinutes: cadence, enabled: nextEnabled });
      onReport(
        nextEnabled
          ? `${label} 자동 수집을 켰습니다. 다음 주기부터 자동으로 수집됩니다.`
          : `${label} 자동 수집을 껐습니다.`,
        false,
      );
      onChanged();
    } catch (e) {
      onReport(backendMessage(e) ?? "설정 저장에 실패했습니다. 백엔드가 실행 중인지 확인해 주세요.", true);
    } finally {
      setSaving(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const run = await api.manualSync(accountId, dataType);
      onReport(
        `${label} 수집 완료: 저장 ${run.successRows} · 건너뜀 ${run.skippedRows} · 실패 ${run.failedRows}`,
        run.status === "FAILED",
      );
      onChanged();
    } catch (e) {
      onReport(backendMessage(e) ?? "수집 실행에 실패했습니다. 백엔드가 실행 중인지 확인해 주세요.", true);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <span className="w-24 text-lg font-semibold">{label}</span>
        {unsupported ? (
          <span className="rounded-lg bg-ink/5 px-2.5 py-1 text-sm text-muted">이 채널 미지원</span>
        ) : needsVerification ? (
          <span className="rounded-lg bg-warn/10 px-2.5 py-1 text-sm text-warn">확인 필요</span>
        ) : null}
        {schedule?.pausedReason ? (
          <span className="text-sm text-warn">{schedule.pausedReason}</span>
        ) : null}
      </div>

      {!capabilitiesReady ? (
        <p className="text-sm text-muted">수집 지원 정보 확인 중…</p>
      ) : unsupported ? (
        <p className="text-sm text-muted">{capability?.notes ?? "이 데이터는 파일 업로드로 채울 수 있습니다."}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={cadence}
            onChange={(e) => setCadence(Number(e.target.value))}
            disabled={rowBusy}
            className="rounded-xl border border-line px-3 py-2 text-base focus:border-brand focus:outline-none"
          >
            {INTERVALS.map((opt) => (
              <option key={opt.minutes} value={opt.minutes}>
                {opt.label}
              </option>
            ))}
          </select>
          {cadenceDirty ? (
            <button
              type="button"
              disabled={rowBusy}
              onClick={() => save(true)}
              className="btn-primary px-4 py-2 text-base"
            >
              {saving ? "저장 중…" : "주기 적용"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={rowBusy}
            onClick={() => save(!enabled)}
            className={`rounded-xl px-4 py-2 text-base font-semibold ${
              enabled ? "bg-good/10 text-good" : "bg-canvas text-muted"
            }`}
          >
            {saving ? "저장 중…" : enabled ? "자동 수집 켜짐" : "자동 수집 꺼짐"}
          </button>
          <button type="button" disabled={rowBusy} onClick={syncNow} className="btn-ghost px-4 py-2 text-base">
            {syncing ? "수집 중…" : "지금 수집하기"}
          </button>
        </div>
      )}
    </li>
  );
}

function RunRow({
  run,
  onChanged,
  onReport,
}: {
  run: SyncRunView;
  onChanged: () => void;
  onReport: (message: string, isError: boolean) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  // The backend retries only FAILED/PARTIAL pull runs — uploads are re-uploaded.
  const retryable =
    (run.status === "FAILED" || run.status === "PARTIAL") &&
    run.trigger !== "UPLOAD" &&
    run.sellerAccountId !== null &&
    run.dataType !== null;

  async function retry() {
    setRetrying(true);
    try {
      const rerun = await api.retryRun(run.id);
      onReport(
        `다시 시도 완료: 저장 ${rerun.successRows} · 건너뜀 ${rerun.skippedRows} · 실패 ${rerun.failedRows}`,
        rerun.status === "FAILED",
      );
      onChanged();
    } catch (e) {
      onReport(backendMessage(e) ?? "다시 시도에 실패했습니다.", true);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <TriggerChip trigger={run.trigger} />
          <span className="rounded-lg bg-canvas px-2.5 py-1 text-sm font-semibold">
            {dataTypeLabel(run.dataType ?? run.uploadType)}
          </span>
          <span className={`text-sm font-semibold ${statusColor(run.status)}`}>
            {statusLabel(run.status)}
            {run.rateLimited ? " (속도 제한)" : ""}
          </span>
          {run.attempt > 1 ? <span className="text-sm text-muted">{run.attempt}차 시도</span> : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">
            저장 {run.successRows} · 건너뜀 {run.skippedRows} · 실패 {run.failedRows} ·{" "}
            {relativeTime(run.finishedAt ?? run.startedAt)}
          </span>
          {retryable ? (
            <button type="button" disabled={retrying} onClick={retry} className="btn-ghost px-3 py-1.5 text-sm">
              {retrying ? "재시도 중…" : "다시 시도"}
            </button>
          ) : null}
        </div>
      </div>
      {run.errorMessage || run.nextRetryAt ? (
        <div className="flex flex-col gap-1 text-sm">
          {run.errorMessage ? <span className="text-bad">{run.errorMessage}</span> : null}
          {run.nextRetryAt ? (
            <span className="text-muted">다음 재시도 가능: {untilTime(run.nextRetryAt)}</span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function TriggerChip({ trigger }: { trigger: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    SCHEDULED: { label: "자동", cls: "bg-brand/10 text-brand-700" },
    MANUAL: { label: "수동", cls: "bg-ink/5 text-ink" },
    RETRY: { label: "재시도", cls: "bg-warn/10 text-warn" },
    UPLOAD: { label: "업로드", cls: "bg-canvas text-muted" },
  };
  const { label, cls } = map[trigger] ?? { label: trigger, cls: "bg-canvas text-muted" };
  return (
    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function dataTypeLabel(type: string | null): string {
  switch (type) {
    case "REVIEW":
      return "리뷰";
    case "INQUIRY":
      return "문의";
    case "ORDER_SUMMARY":
      return "주문·매출";
    default:
      return type ?? "-";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "성공";
    case "PARTIAL":
      return "일부 성공";
    case "FAILED":
      return "실패";
    case "RUNNING":
      return "수집 중";
    default:
      return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "text-good";
    case "PARTIAL":
      return "text-warn";
    case "RUNNING":
      return "text-muted";
    default:
      return "text-bad";
  }
}
