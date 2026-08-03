// Extracted VERBATIM from the previous single-file 채널 상세 page — the component bodies below are
// the same code that drove the live-verified connection and collection flows. Only the file they
// live in changed; no call, no order, no condition was rewritten.
import { useState } from "react";
import { Section } from "../Section";
import { api } from "../../lib/apiClient";
import { relativeTime, untilTime } from "../../lib/format";
import type { SyncRunView } from "../../lib/types";
import { backendMessage } from "./channelShared";

/** 수집 이력 — the runs the server recorded, newest first, each retryable. */
export function CollectionHistorySection({
  runs,
  loading,
  error,
  onChanged,
  onReport,
}: {
  runs: SyncRunView[];
  loading: boolean;
  error: boolean;
  onChanged: () => void;
  onReport: (message: string, isError: boolean) => void;
}) {
  return (
    <Section title="수집 이력">
      {loading ? (
        <p className="text-base text-muted">불러오는 중…</p>
      ) : error ? (
        <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
          수집 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : runs.length === 0 ? (
        <p className="text-base text-muted">아직 수집 이력이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-line">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} onChanged={onChanged} onReport={onReport} />
          ))}
        </ul>
      )}
    </Section>
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
