import { useState } from "react";
import { VocItemCard } from "./VocItemCard";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { vocItemKey } from "../lib/vocItems";

// Paginated, metadata-only list of the rows behind one attention signal, over the
// same [from, to] window as the signal count. Self-fetching and fail-closed; never
// renders raw VOC text. `type` is an AttentionSignalType name.

const PAGE_SIZE = 10;

export function OperatorVocItemList({
  accountId,
  type,
  from,
  to,
  refreshKey = 0,
}: {
  accountId: string;
  type: string;
  from: string;
  to: string;
  refreshKey?: number;
}) {
  const [page, setPage] = useState(0);

  const { data, loading, error } = useApiData(
    () => api.getAttentionItems(accountId, { type, from, to, page, size: PAGE_SIZE }),
    [accountId, type, from, to, page, refreshKey],
  );

  const hasNext = data ? (data.page + 1) * data.size < data.total : false;

  if (loading) {
    return <p className="text-base text-muted">불러오는 중…</p>;
  }
  if (error || !data) {
    return (
      <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
        항목을 불러오지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.
      </p>
    );
  }
  if (data.items.length === 0) {
    return <p className="text-base text-muted">해당하는 항목이 없습니다.</p>;
  }

  return (
    <>
      <p className="mb-1 text-sm text-muted">총 {data.total.toLocaleString("ko-KR")}건</p>
      <ul className="divide-y divide-line">
        {data.items.map((item, i) => (
          <VocItemCard key={vocItemKey(item, data.page, i)} item={item} />
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="btn-ghost px-4 py-2 text-sm disabled:opacity-40"
        >
          이전
        </button>
        <span className="text-sm text-muted">{page + 1} 페이지</span>
        <button
          type="button"
          disabled={!hasNext}
          onClick={() => setPage((p) => p + 1)}
          className="btn-ghost px-4 py-2 text-sm disabled:opacity-40"
        >
          다음
        </button>
      </div>
    </>
  );
}
