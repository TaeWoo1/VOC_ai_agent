import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { DataTable, Td, Th } from "../../components/ui/DataTable";
import { Empty } from "../../components/ui/Empty";
import { BtnLink } from "../../components/ui/Btn";
import { AgentLaunch } from "../../components/ui/AgentLaunch";
import { api } from "../../lib/apiClient";
import type { ProductSummaryView } from "../../lib/types";

/**
 * 상품 — the catalogue, which the product did not previously show at all.
 *
 * <b>This screen is new, not tidied.</b> The backend has served `/api/products` since before the v2
 * shell and this org holds 300 real products; the frontend had no route, no menu entry and no type
 * for any of it, so the only thing that could see a seller's catalogue was the Agent.
 *
 * <b>Search is server-side and debounced, because the catalogue is not small.</b> Filtering a page of
 * thirty in the browser would answer a search over the thirty that happened to load.
 */
export function Products() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ProductSummaryView[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setError(false);
    const timer = setTimeout(() => {
      void api
        .searchProductsStrict(query, 50)
        .then((list) => active && setRows(list))
        .catch(() => active && setError(true));
    }, query ? 250 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="space-y-6">
      <PageHead
        title="상품"
        description="판매 중인 상품과 그 상품에 대해 SellerOps가 아는 것을 봅니다."
        action={<AgentLaunch context={{ surface: "products" }} />}
      />

      <label className="block">
        <span className="sr-only">상품 이름 또는 상품코드로 검색</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="상품 이름이나 상품코드(SKU)로 찾기"
          className="w-full max-w-md rounded-xl border border-line px-4 py-2.5 text-base focus:border-brand focus:outline-none"
        />
      </label>

      {error ? (
        <Empty
          title="상품 목록을 불러오지 못했습니다"
          body="잠시 후 다시 시도해 주세요. 상품은 채널을 연결하면 자동으로 채워집니다."
          action={<BtnLink to="/connect">채널 연결 열기</BtnLink>}
        />
      ) : rows === null ? (
        <p className="text-muted">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <Empty
          title={query ? "찾는 상품이 없습니다" : "아직 상품이 없습니다"}
          body={
            query
              ? "다른 이름이나 상품코드로 찾아보세요."
              : "채널을 연결하면 판매 중인 상품이 여기에 채워집니다."
          }
          action={query ? undefined : <BtnLink to="/connect">채널 연결하기</BtnLink>}
        />
      ) : (
        <DataTable
          caption="상품 이름, 상품코드, 판매 상태"
          head={
            <>
              <Th>상품</Th>
              <Th>상품코드</Th>
              <Th>상태</Th>
            </>
          }
        >
          {rows.map((row) => (
            <tr key={row.id} className="transition hover:bg-canvas/60">
              <Td>
                <Link
                  to={`/products/${row.id}`}
                  className="rounded-lg font-medium text-ink hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                >
                  <span className="break-keep">{row.name}</span>
                </Link>
                {/* Which surface the search matched on. Two products can share a canonical name in
                    this catalogue, and the matched listing title is often the only thing that tells
                    a seller which one they are looking at. */}
                {row.matchedName && row.matchedName !== row.name ? (
                  <span className="ml-2 break-keep text-sm text-muted">{row.matchedName}</span>
                ) : null}
              </Td>
              <Td muted>{row.sku ?? "—"}</Td>
              <Td muted>{row.status ?? "—"}</Td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
