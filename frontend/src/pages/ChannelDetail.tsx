import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { Section } from "../components/Section";
import { EmptyState } from "../components/EmptyState";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { relativeTime, untilTime } from "../lib/format";
import type {
  CapabilityView,
  ConnectionStatusView,
  ScheduleView,
  SyncRunView,
} from "../lib/types";

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

/** 자동 수집 관리 — connection panel for one seller account. */
export function ChannelDetail() {
  const { accountId = "" } = useParams();
  const { data: accounts } = useApiData(() => api.getSellerAccounts());
  const { data: channels } = useApiData(() => api.getChannels());

  const account = useMemo(
    () => (accounts ?? []).find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );
  const channel = useMemo(
    () => (channels ?? []).find((c) => c.id === account?.channelId) ?? null,
    [channels, account],
  );

  const [status, setStatus] = useState<ConnectionStatusView | null>(null);
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  // null = not loaded (loading or failed) → schedule controls stay disabled,
  // because an absent capability row means "allowed" and we must not guess.
  const [capabilities, setCapabilities] = useState<CapabilityView[] | null>(null);
  const [runs, setRuns] = useState<SyncRunView[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Account-scoped data. The active flag drops stale responses after the
  // account changes or the page unmounts.
  useEffect(() => {
    if (!accountId) {
      return;
    }
    let active = true;
    api.getConnectionStatus(accountId)
      .then((s) => active && setStatus(s))
      .catch(() => active && setStatus(null));
    api.getSchedules(accountId)
      .then((s) => active && setSchedules(s))
      .catch(() => active && setSchedules([]));
    api.getSyncRuns({ sellerAccountId: accountId })
      .then((r) => active && setRuns(r))
      .catch(() => active && setRuns([]));
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
    return () => {
      active = false;
    };
  }, [channel, refreshKey]);

  function report(message: string, isError: boolean) {
    setError(isError ? message : null);
    setNotice(isError ? null : message);
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

      {notice ? <div className="rounded-xl bg-brand/10 px-4 py-3 text-brand-700">{notice}</div> : null}
      {error ? <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">{error}</div> : null}

      <Section title="연결 상태">
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
      </Section>

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

      <Section title="최근 수집 내역">
        {runs.length === 0 ? (
          <p className="text-base text-muted">아직 수집 내역이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line">
            {runs.map((run) => (
              <RunRow key={run.id} run={run} onChanged={reload} onReport={report} />
            ))}
          </ul>
        )}
      </Section>

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

function HealthBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    CONNECTED: { label: "정상 수집 중", cls: "bg-good/10 text-good" },
    DEGRADED: { label: "점검 필요", cls: "bg-warn/10 text-warn" },
    EXPIRED: { label: "인증 만료", cls: "bg-bad/10 text-bad" },
    DISCONNECTED: { label: "연결 끊김", cls: "bg-bad/10 text-bad" },
    NOT_COLLECTED: { label: "수집 이력 없음", cls: "bg-ink/5 text-muted" },
  };
  const { label, cls } = map[state] ?? { label: state, cls: "bg-ink/5 text-muted" };
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${cls}`}>
      {label}
    </span>
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
    <li className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
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
