// Extracted VERBATIM from the previous single-file 채널 상세 page — the component bodies below are
// the same code that drove the live-verified connection and collection flows. Only the file they
// live in changed; no call, no order, no condition was rewritten.
import { useState } from "react";
import { Section } from "../Section";
import { api } from "../../lib/apiClient";
import { relativeTime, untilTime } from "../../lib/format";
import type { ReviewCoverageSignal, SyncRunView } from "../../lib/types";
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
  // The backend retries only FAILED/PARTIAL pull runs — uploads are re-uploaded, and a screen read is not a
  // pull: re-running one here would send the connector at an API that does not carry these reviews and report
  // the result under this row. The backend refuses it; this keeps the seller from being offered it.
  const retryable =
    (run.status === "FAILED" || run.status === "PARTIAL") &&
    run.trigger !== "UPLOAD" &&
    run.method !== "SELLER_CENTER_READ" &&
    run.sellerAccountId !== null &&
    run.dataType !== null;
  const failureNote = acquisitionFailureNote(run);

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
      {run.coverage ? <CoverageNote coverage={run.coverage} /> : null}
      {failureNote ? (
        <p data-testid="acquisition-failure-note" className="text-sm text-bad">
          {failureNote}
        </p>
      ) : null}
      {(run.errorMessage && !run.coverage && !failureNote) || run.nextRetryAt ? (
        <div className="flex flex-col gap-1 text-sm">
          {run.errorMessage && !run.coverage && !failureNote ? (
            <span className="text-bad">{run.errorMessage}</span>
          ) : null}
          {run.nextRetryAt ? (
            <span className="text-muted">다음 재시도 가능: {untilTime(run.nextRetryAt)}</span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * **Why a 지금 동기화 stored nothing, in the seller's words.**
 *
 * The run row carries the runtime's own closed word (the backend validates it against the set this lane can
 * produce and refuses the rest). This table is the only place it becomes a sentence, and the sentences say
 * what happened and what the seller can do — never what carried the read. Which executor runs on this machine
 * is a deployment fact and does not belong on a screen about the seller's reviews.
 *
 * An unmapped value renders nothing here and falls through to the row's ordinary error line, the same posture
 * `TriggerChip` takes: a word nobody wrote a sentence for is not shown as itself.
 */
const ACQUISITION_FAILURE_WORDS: Record<string, string> = {
  LOGIN_REQUIRED: "쿠팡 판매자 화면에 로그인이 되어 있지 않아 상품평을 읽지 못했습니다. 로그인한 뒤 다시 동기화해 주세요.",
  STORE_MISMATCH: "화면에 열려 있던 스토어가 이 판매 계정과 달라서 아무것도 읽지 않았습니다.",
  STORE_UNRESOLVED: "화면의 스토어가 이 판매 계정과 같은지 확인하지 못해 아무것도 읽지 않았습니다.",
  EXECUTOR_UNAVAILABLE: "상품평을 읽는 프로그램에 연결하지 못했습니다. 잠시 뒤 다시 동기화해 주세요.",
  UNSUPPORTED_STATE: "상품평 목록 화면이 아니어서 읽지 못했습니다. 쿠팡 상품평 목록을 연 뒤 다시 동기화해 주세요.",
  RUNTIME_FAULT: "상품평을 읽는 도중 오류가 나서 아무것도 저장하지 않았습니다.",
  HANDOFF_REJECTED: "읽은 상품평을 저장하지 못했습니다. 저장된 상품평은 없습니다.",
};

/** The sentence for a failed screen read, or null when this row is not one (or its word has no sentence). */
function acquisitionFailureNote(run: SyncRunView): string | null {
  if (run.method !== "SELLER_CENTER_READ" || run.status !== "FAILED" || !run.errorMessage) return null;
  return ACQUISITION_FAILURE_WORDS[run.errorMessage] ?? null;
}

/**
 * What the run could say about reviews it did not read.
 *
 * The sentence for `REACHED_KNOWN_GROUND` is deliberately about the ABSENCE OF A SIGNAL, not about totality:
 * it is true both when the read ran into reviews already stored and when the pager said this was the last
 * page, and it is false in neither. "전체 리뷰를 모두 수집했습니다" is a claim no bounded read can make and
 * this screen does not make it.
 */
function CoverageNote({ coverage }: { coverage: ReviewCoverageSignal }) {
  if (coverage === "REACHED_KNOWN_GROUND") {
    return (
      <p data-testid="coverage-note" className="text-sm text-muted">
        읽지 못하고 남은 리뷰가 있다는 신호는 이번 수집에서 없었습니다.
      </p>
    );
  }
  if (coverage === "BACKLOG_POSSIBLE") {
    return (
      <p data-testid="coverage-note" className="text-sm text-warn">
        읽기 한도에서 멈췄고, 읽은 리뷰가 모두 새 리뷰였습니다. 더 이전 리뷰가 남아 있을 수 있습니다.
      </p>
    );
  }
  return (
    <p data-testid="coverage-note" className="text-sm text-muted">
      이번 수집만으로는 남은 리뷰가 있는지 알 수 없습니다.
    </p>
  );
}

function TriggerChip({ trigger }: { trigger: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    SCHEDULED: { label: "자동", cls: "bg-brand/10 text-brand-700" },
    MANUAL: { label: "수동", cls: "bg-ink/5 text-ink" },
    RETRY: { label: "재시도", cls: "bg-warn/10 text-warn" },
    UPLOAD: { label: "업로드", cls: "bg-canvas text-muted" },
    // The seller pressed 「지금 동기화」 and reviewnary read the seller-center screen. It is a manual run,
    // but not the same manual as an API pull, and it has been on this screen as the raw token ACTION_WINDOW.
    ACTION_WINDOW: { label: "화면에서 실행", cls: "bg-ink/5 text-ink" },
  };
  // An unmapped trigger renders as nothing rather than as its own token: an internal word on this screen is
  // the defect this map exists to prevent, and a missing chip costs the seller less than a raw enum.
  const known = map[trigger];
  if (!known) return null;
  const { label, cls } = known;
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
