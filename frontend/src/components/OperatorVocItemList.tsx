import { useState } from "react";
import { VocItemCard } from "./VocItemCard";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { facetOptions, vocItemKey } from "../lib/vocItems";
import type { FacetOption } from "../lib/vocItems";

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
  onOutcomeRecorded,
}: {
  accountId: string;
  type: string;
  from: string;
  to: string;
  /** Composite change-signal; only its identity matters, never its magnitude. */
  refreshKey?: number | string;
  /** Bubbled up so the COUNT above refetches too — this list alone cannot correct the headline. */
  onOutcomeRecorded?: () => void;
}) {
  const [page, setPage] = useState(0);
  // The active classification facet; null = all rows. Held here rather than in the card so the
  // fetch owns it — the list is server-paginated, so filtering the rendered page would silently
  // narrow one page of ten and call it the answer.
  const [category, setCategory] = useState<string | null>(null);

  // Changing the facet resets to the first page. Without this a page index left over from a
  // wider result set renders an empty list above a non-zero total, which reads as "no such
  // reviews" when the truth is "you are past the end of them".
  const selectFacet = (next: string | null) => {
    setCategory(next);
    setPage(0);
  };

  const { data, loading, error } = useApiData(
    () =>
      api.getAttentionItems(accountId, {
        type,
        from,
        to,
        ...(category != null ? { category } : {}),
        page,
        size: PAGE_SIZE,
      }),
    [accountId, type, from, to, category, page, refreshKey],
  );

  const hasNext = data ? (data.page + 1) * data.size < data.total : false;

  // Rendered from whatever page is currently in hand — `useApiData` keeps the previous data
  // while a refetch is in flight, so the control an operator just clicked does not vanish
  // under the cursor mid-request.
  const facets = data == null ? null : (
    <FacetBar
      options={facetOptions(data.categoryCounts, data.unclassifiedCount, category)}
      unfilteredTotal={data.unfilteredTotal}
      active={category}
      onSelect={selectFacet}
    />
  );

  if (loading) {
    return (
      <>
        {facets}
        <p className="text-base text-muted">불러오는 중…</p>
      </>
    );
  }
  if (error || !data) {
    // Fail closed, and WITHOUT the facet bar: its counts describe a window this read could not
    // confirm, so showing them beside a failure would present unverified numbers as current.
    return (
      <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
        항목을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </p>
    );
  }
  if (data.items.length === 0) {
    // The facet bar stays: with a filter active this empty state is a property of the FILTER,
    // and removing the only control that clears it would strand the operator on an empty list.
    return (
      <>
        {facets}
        <p className="text-base text-muted">해당하는 항목이 없습니다.</p>
      </>
    );
  }

  return (
    <>
      {facets}
      <p className="mb-1 text-sm text-muted">총 {data.total.toLocaleString("ko-KR")}건</p>
      <ul className="divide-y divide-line">
        {data.items.map((item, i) => (
          <VocItemCard
            key={vocItemKey(item, data.page, i)}
            item={item}
            accountId={accountId}
            onOutcomeRecorded={onOutcomeRecorded}
          />
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

/**
 * The classification facet: "전체" plus one option per category present in this window.
 *
 * Options come from the page's server-computed counts, which are always UNFILTERED — so the list
 * an operator sees does not collapse to the option they just picked. Nothing is derived from the
 * rendered rows: the list is server-paginated, so a page of ten cannot describe the window.
 *
 * Rendered only when there is a real choice to make. One option means the facet cannot narrow
 * anything, and a control whose every setting shows the same rows is noise dressed as agency.
 */
function FacetBar({
  options,
  unfilteredTotal,
  active,
  onSelect,
}: {
  options: FacetOption[];
  unfilteredTotal: number;
  active: string | null;
  onSelect: (next: string | null) => void;
}) {
  if (options.length < 2) {
    return null;
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="분류 필터">
      <FacetButton
        label="전체"
        count={unfilteredTotal}
        selected={active == null}
        onClick={() => onSelect(null)}
      />
      {options.map((o) => (
        <FacetButton
          key={o.value}
          label={o.label}
          count={o.count}
          selected={active === o.value}
          onClick={() => onSelect(o.value)}
        />
      ))}
    </div>
  );
}

function FacetButton({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full px-3 py-1 text-sm transition ${
        selected ? "bg-brand text-white" : "bg-canvas text-muted hover:text-ink"
      }`}
    >
      {label} {count.toLocaleString("ko-KR")}
    </button>
  );
}
