// Extracted VERBATIM from the previous single-file 채널 상세 page — the component bodies below are
// the same code that drove the live-verified connection and collection flows. Only the file they
// live in changed; no call, no order, no condition was rewritten.
import { useEffect, useState } from "react";
import { Section } from "../Section";
import { api } from "../../lib/apiClient";
import { channelDataTypeLabel } from "../../lib/channelVocabulary";
import { useApiData } from "../../lib/useApiData";
import type { AcquisitionPathView, CapabilityView, ScheduleView } from "../../lib/types";
import { DATA_TYPES, INTERVALS, backendMessage } from "./channelShared";

/** 수집 설정 — one row per data type, each owning its own cadence + manual run. */
export function CollectionSettingsSection({
  accountId,
  channelCode,
  schedules,
  capabilities,
  onChanged,
  onReport,
}: {
  accountId: string;
  /** Optional: without it the rows simply say less, never something untrue. */
  channelCode?: string | null;
  schedules: ScheduleView[];
  capabilities: CapabilityView[] | null;
  onChanged: () => void;
  onReport: (message: string, isError: boolean) => void;
}) {
  // A row that cannot be scheduled still owes the seller a reason, and the honest reason is
  // sometimes "SellerOps collects this — just not on a cadence". Only the capability OVERVIEW knows
  // that: `capabilities` above is the connector_capabilities table, which answers whether a PULL
  // connector can serve the type and is what gates scheduling. Read here strictly to explain, never
  // to gate — a failed read leaves the row exactly as it was.
  const { data, loading, error } = useApiData(
    () => (channelCode ? api.getChannelCapabilityOverview(channelCode) : Promise.resolve(null)),
    [channelCode],
  );
  // `useApiData` keeps the last successful payload across a deps change, so on an account switch the
  // PREVIOUS channel's overview is still in `data` until the new one lands. Honouring `loading` is
  // what stops one channel's route being described on another channel's row.
  const overview = loading || error ? null : data;

  return (
    <Section title="수집 설정">
      <ul className="divide-y divide-line">
        {DATA_TYPES.map((t) => (
          <ScheduleRow
            key={t.value}
            accountId={accountId}
            dataType={t.value}
            label={channelDataTypeLabel(channelCode, t.value, t.label)}
            schedule={schedules.find((s) => s.dataType === t.value) ?? null}
            capability={capabilities?.find((c) => c.dataType === t.value) ?? null}
            capabilitiesReady={capabilities !== null}
            acquisitionPaths={
              overview?.dataTypes.find((d) => d.dataType === t.value)?.acquisitionPaths ?? []
            }
            onChanged={onChanged}
            onReport={onReport}
          />
        ))}
      </ul>
    </Section>
  );
}

function ScheduleRow({
  accountId,
  dataType,
  label,
  schedule,
  capability,
  capabilitiesReady,
  acquisitionPaths,
  onChanged,
  onReport,
}: {
  accountId: string;
  dataType: string;
  label: string;
  schedule: ScheduleView | null;
  capability: CapabilityView | null;
  capabilitiesReady: boolean;
  acquisitionPaths: AcquisitionPathView[];
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
  // A route the seller runs themselves on the marketplace. It is why this row can be uncollectable
  // on a cadence and collected all the same; it never makes the row schedulable.
  const operatorRunPath = acquisitionPaths.some((p) => p.method === "ACTION_WINDOW");
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
      onReport(backendMessage(e) ?? "설정 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.", true);
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
      onReport(backendMessage(e) ?? "수집 실행에 실패했습니다. 잠시 후 다시 시도해 주세요.", true);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <span className="w-24 text-lg font-semibold">{label}</span>
        {unsupported ? (
          // 자동 수집, not 이 채널: this row is about a cadence, and saying the CHANNEL does not
          // support the data type overstated it — Coupang 상품평 sat under this chip while the panel
          // one scroll above counted 22 of them, collected through the Action Window.
          <span className="rounded-lg bg-ink/5 px-2.5 py-1 text-sm text-muted">자동 수집 미지원</span>
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
        <p className="text-sm text-muted">
          {operatorRunPath
            ? "Action Window는 판매자가 직접 실행하는 수집 경로라 자동 수집 주기 대상이 아닙니다."
            : capability?.notes ?? "이 데이터는 파일 업로드로 채울 수 있습니다."}
        </p>
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

