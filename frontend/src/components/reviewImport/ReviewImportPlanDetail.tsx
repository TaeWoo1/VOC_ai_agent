import { useState } from "react";
import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import {
  coverageSummary,
  healthSummary,
  isUnattempted,
  planStatusLabel,
} from "../../lib/reviewImport";
import type {
  ReviewImportHealthView,
  ReviewImportPlanDetailView,
} from "../../lib/types";
import { SegmentCard } from "./SegmentCard";

/**
 * The resumable, honest view of one historical import: requested period + status, the coverage/health
 * rollup, and every segment in chronological order with its state, latest attempt tallies and retry
 * history. Remaining work is highlighted so an interrupted import is obvious after a reload. All reads
 * refetch on any mutation (a bumped reload key), so the picture is always the backend's truth.
 */
export function ReviewImportPlanDetail({
  planId,
  accountId,
}: {
  planId: string;
  accountId: string;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeError, setMergeError] = useState<string | null>(null);

  const { data, loading, error } = useApiData<ReviewImportPlanDetailView>(
    () => api.getReviewImportPlan(planId),
    [planId, reloadKey],
  );
  const health = useApiData<ReviewImportHealthView>(
    () => api.getReviewImportHealth(accountId),
    [accountId, reloadKey],
  );

  function refresh() {
    setSelected(new Set());
    setMergeError(null);
    setReloadKey((k) => k + 1);
  }

  function toggleMerge(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function merge() {
    try {
      await api.mergeReviewImportSegments(planId, [...selected]);
      refresh();
    } catch {
      setMergeError("선택한 구간을 합치지 못했어요. 이어져 있고 아직 가져오지 않은 구간만 합칠 수 있어요.");
    }
  }

  if (loading) {
    return <p className="text-base text-muted">불러오는 중…</p>;
  }
  if (error || !data) {
    return (
      <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad" role="alert">
        가져오기 계획을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
      </p>
    );
  }

  const { plan, segments, coverage } = data;
  const remaining = coverage.remainingSegments;

  return (
    <section aria-label="과거 리뷰 가져오기" className="flex flex-col gap-4">
      <header className="rounded-2xl bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">
            과거 리뷰 가져오기 · {plan.requestedStart} ~ {plan.requestedEnd}
          </h2>
          <span className="rounded-full bg-canvas px-3 py-1 text-sm text-muted">
            {planStatusLabel(plan.status)}
          </span>
        </div>
        {remaining > 0 ? (
          <p
            data-testid="remaining-banner"
            className="mt-3 rounded-xl bg-brand/5 px-4 py-2 text-sm text-brand break-keep"
          >
            남은 구간 {remaining}개 — 중단된 지점부터 이어서 가져올 수 있어요.
          </p>
        ) : (
          <p className="mt-3 rounded-xl bg-good/5 px-4 py-2 text-sm text-good break-keep">
            남은 구간이 없어요. 이 계획의 가져오기를 마쳤어요.
          </p>
        )}
      </header>

      <SummaryCard title="커버 현황" lines={coverageSummary(coverage)} />
      {health.data ? <SummaryCard title="가져오기 상태" lines={healthSummary(health.data)} /> : null}

      <div className="rounded-2xl bg-surface p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">구간</h3>
          {selected.size >= 2 ? (
            <button
              type="button"
              onClick={merge}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              선택한 {selected.size}개 합치기
            </button>
          ) : null}
        </div>
        {mergeError ? (
          <p className="mb-2 text-sm text-bad" role="alert">
            {mergeError}
          </p>
        ) : null}
        {segments.length === 0 ? (
          <p className="text-base text-muted">구간이 없어요.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {segments.map((s) => (
              <SegmentCard
                key={s.id}
                segment={s}
                onChanged={refresh}
                mergeSelectable={isUnattempted(s)}
                mergeSelected={selected.has(s.id)}
                onToggleMerge={toggleMerge}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function SummaryCard({
  title,
  lines,
}: {
  title: string;
  lines: { label: string; value: string }[];
}) {
  return (
    <div className="rounded-2xl bg-surface p-5 shadow-card">
      <h3 className="mb-3 text-base font-semibold text-ink">{title}</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {lines.map((l) => (
          <div key={l.label} className="flex justify-between gap-3 border-b border-line/60 pb-1">
            <dt className="text-sm text-muted">{l.label}</dt>
            <dd className="text-sm text-ink break-keep text-right">{l.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
