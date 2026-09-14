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
  heading,
}: {
  accountId: string;
  /** Optional: without it the rows simply say less, never something untrue. */
  channelCode?: string | null;
  schedules: ScheduleView[];
  capabilities: CapabilityView[] | null;
  onChanged: () => void;
  onReport: (message: string, isError: boolean) => void;
  /**
   * `null`이면 제목 없이 본문만. 이 블록이 <b>이미 이름이 붙은 자리</b>(접힌 영역 · capability 카드) 안에서
   * 열릴 때를 위한 것이다 — 한 사실에 화면 위 이름이 둘이면 어느 쪽이 그것인지 말할 사람이 없다. 생략하면
   * 예전과 바이트 동일하다.
   */
  heading?: string | null;
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

  const body = (
    <>
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
    </>
  );
  if (heading === null) return <div className="space-y-3">{body}</div>;
  return <Section title={heading ?? "수집 설정"}>{body}</Section>;
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
  // A proven route that only the seller can repeat — an export they download, a window they open.
  // Shown so a row with no schedule reads as "이 채널은 이렇게 가져옵니다" instead of as a gap; the demo
  // org's 3,858 NAVER reviews all arrived this way while the screen said nothing about how.
  const sellerRepeatedPath = acquisitionPaths.find((p) => p.recurrence === "SELLER_REPEATED");
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
          {/*
            **커넥터의 `notes`는 판매자 문장이 아니다.** 그 칸은 우리끼리 쓰는 영문 기록이고, 이 자리에서
            그대로 렌더돼 쿠팡 채널 화면이 판매자에게 「No review-retrieval endpoint in the official seller
            API.」라고 말하고 있었다(실측 2026-09-14). 알 수 없는 종류에는 이 제품이 아는 문장 하나만 쓴다 —
            읽지 못한 사실을 문장으로 바꾸는 것보다 적게 말하는 편이 옳다.
          */}
          {operatorRunPath
            ? "판매자가 직접 실행하는 수집 경로라 자동 수집 주기 대상이 아닙니다."
            : sellerRepeatedPath?.method === "EXPORT"
              ? "이 채널은 리뷰 API를 제공하지 않습니다. 판매자 센터에서 내려받은 파일을 올리는 방식이 정식 수집 경로이며, 새 데이터는 다시 올릴 때 들어옵니다."
              : "이 데이터는 파일 업로드로 채울 수 있습니다."}
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

