import { useState } from "react";
import { api } from "../../lib/apiClient";
import type { SellerAccountResponse } from "../../lib/types";

/**
 * Start a historical review import for a connected NAVER seller account: pick the period, create the
 * plan. The period is taken as chosen — the copy makes NO claim about a NAVER row cap or a maximum
 * history depth (both unknown); any range the marketplace cannot reach simply surfaces later as a
 * "가져올 수 없는 기간" segment. The period is divided into calendar-month segments to import one at a time.
 */
export function ReviewImportEntry({
  account,
  onCreated,
}: {
  account: SellerAccountResponse;
  onCreated: (planId: string) => void;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalid = !start || !end || start > end;

  async function create() {
    if (invalid) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const detail = await api.createReviewImportPlan({
        sellerAccountId: account.id,
        channelId: account.channelId,
        requestedStart: start,
        requestedEnd: end,
      });
      onCreated(detail.plan.id);
    } catch {
      setError("가져오기 계획을 만들지 못했어요. 기간을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="과거 리뷰 가져오기 시작" className="rounded-2xl bg-surface p-5 shadow-card">
      <h2 className="text-lg font-semibold text-ink">과거 리뷰 가져오기</h2>
      <p className="mt-1 text-sm text-muted break-keep">
        {account.alias ?? account.channelNameKo} 계정의 과거 리뷰를 기간별로 가져와요. 선택한 기간은 월 단위 구간으로
        나뉘고, 각 구간을 하나씩 내보내 올리면 돼요.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col text-sm text-ink">
          시작일
          <input
            type="date"
            value={start}
            max={end || undefined}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
        </label>
        <label className="flex flex-col text-sm text-ink">
          종료일
          <input
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
        </label>
        <button
          type="button"
          onClick={create}
          disabled={invalid || busy}
          className="rounded-xl bg-brand px-5 py-2.5 font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "만드는 중…" : "가져오기 계획 만들기"}
        </button>
      </div>

      {start && end && start > end ? (
        <p className="mt-2 text-sm text-bad" role="alert">
          시작일은 종료일보다 늦을 수 없어요.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-bad" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
