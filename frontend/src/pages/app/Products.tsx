import { useEffect, useState } from "react";
import { PageHead } from "../../components/ui/PageHead";
import { ListBox } from "../../components/ui/Section";
import { ObjectRow, Facet, Dot } from "../../components/ui/ObjectRow";
import { Status } from "../../components/ui/Status";
import { Empty } from "../../components/ui/Empty";
import { BtnLink } from "../../components/ui/Btn";
import { AgentLaunch } from "../../components/ui/AgentLaunch";
import { api } from "../../lib/apiClient";
import { count } from "../../lib/format";
import type { ProductSummaryView } from "../../lib/types";
import { orderProductRows, productChannelLabel, type ProductRowFacts } from "../../lib/productRows";
import { useAgentSurface } from "../../lib/agentPanel";

/**
 * 상품 — an object list, not a SKU table (docs/reviewnary_design.md §7).
 *
 * <b>A product is "what reviewnary knows about this product's operations".</b> The row is the name,
 * then one line of facets — channels · 문의 · 리뷰 · 답변 기준 · 미답변 — and [열기]. The SKU is inside
 * the detail. Facets are read per product from `/api/products/{id}/signals` and the knowledge source
 * list, both fail-soft: a row whose reads failed shows `—`, never 0, and the list never waits for them.
 *
 * <b>Ordering is presentation, not semantics.</b> Rows with unanswered inquiries first, then issue
 * evidence, then review volume, then name — so the unattributed placeholder the backend keeps for
 * unlinked rows never leads the catalogue. No backend change; `lib/productRows.ts` owns the rule.
 *
 * Search is server-side and debounced, because the catalogue is not small.
 */
const PAGE_SIZE = 20;

export function Products() {
  useAgentSurface({ surface: "products", label: "상품 목록" });
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ProductSummaryView[] | null>(null);
  const [facts, setFacts] = useState<Map<string, ProductRowFacts>>(new Map());
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setError(false);
    const timer = setTimeout(() => {
      void api
        .searchProductsStrict(query, PAGE_SIZE)
        .then((list) => {
          if (!active) return;
          setRows(list);
          void loadFacts(list, (next) => active && setFacts(next));
        })
        .catch(() => active && setError(true));
    }, query ? 250 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const ordered = rows ? orderProductRows(rows, facts) : [];

  return (
    <div className="space-y-6">
      <PageHead
        title="상품"
        meta={rows && rows.length > 0 ? <span className="text-sm text-muted">{query ? `찾은 상품 ${rows.length}개` : `${rows.length}개`}</span> : undefined}
        action={<AgentLaunch context={{ surface: "products" }} label="상품에 대해 물어보기" />}
      />

      <label className="block">
        <span className="sr-only">상품 이름 또는 상품코드로 검색</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="상품 이름이나 상품코드로 찾기"
          className="w-full max-w-md rounded-lg border border-line bg-surface px-3.5 py-2 text-base focus:border-brand-700 focus:outline-none"
        />
      </label>

      {error ? (
        <Empty
          title="상품 목록을 불러오지 못했습니다"
          body="잠시 후 다시 시도해 주세요. 상품은 채널을 연결하면 자동으로 채워집니다."
          action={<BtnLink to="/connect">채널 연결 열기</BtnLink>}
        />
      ) : rows === null ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <Empty
          title={query ? "찾는 상품이 없습니다" : "아직 상품이 없습니다"}
          body={query ? "다른 이름이나 상품코드로 찾아보세요." : "채널을 연결하면 판매 중인 상품이 여기에 채워집니다."}
          action={query ? undefined : <BtnLink to="/connect">채널 연결하기</BtnLink>}
        />
      ) : (
        <ListBox ariaLabel="상품 목록">
          <ul className="divide-y divide-line/70">
            {ordered.map((row) => {
              const f = facts.get(row.id);
              return (
                <li key={row.id}>
                  <ObjectRow
                    to={`/products/${row.id}`}
                    name={productNameNode(row.name)}
                    status={
                      f && f.unanswered > 0 ? (
                        <Status tone="warn">미답변 {f.unanswered}</Status>
                      ) : f && f.issueEvidence > 0 ? (
                        <Status tone="neutral">반복 문제</Status>
                      ) : null
                    }
                    facets={
                      f ? (
                        <>
                          {f.channels.length > 0 ? (
                            <>
                              <span>{f.channels.map(productChannelLabel).join(" · ")}</span>
                              <Dot />
                            </>
                          ) : null}
                          {f.inquiries === 0 && f.reviews === 0 ? (
                            <span>문의·리뷰 아직 없음</span>
                          ) : (
                            <>
                              <Facet label="문의" value={count(f.inquiries)} />
                              <Dot />
                              <Facet label="리뷰" value={count(f.reviews)} />
                            </>
                          )}
                          <Dot />
                          <Facet label="답변 기준" value={f.knowledge === null ? "—" : count(f.knowledge)} />
                          {f.issueEvidence > 0 ? (
                            <>
                              <Dot />
                              <Facet label="최근 문제 근거" value={count(f.issueEvidence)} />
                            </>
                          ) : null}
                        </>
                      ) : f === undefined ? (
                        <span>확인하는 중…</span>
                      ) : (
                        <span>운영 정보를 읽지 못했습니다</span>
                      )
                    }
                    action={<span className="text-sm font-semibold text-brand-700">열기</span>}
                  />
                </li>
              );
            })}
          </ul>
        </ListBox>
      )}
      {rows && rows.length >= PAGE_SIZE ? (
        <p className="text-sm text-muted">상위 {PAGE_SIZE}개만 보입니다. 이름이나 상품코드로 찾으면 나머지도 열립니다.</p>
      ) : null}
    </div>
  );
}

/**
 * Two fail-soft reads per row, concurrent, and the list never waits for them. A row whose reads
 * failed gets `null` (rendered as a sentence, not as zeros).
 */
async function loadFacts(list: ProductSummaryView[], commit: (next: Map<string, ProductRowFacts>) => void) {
  const results = await Promise.allSettled(
    list.map(async (row) => {
      const [signals, sources] = await Promise.allSettled([
        api.getProductSignalsStrict(row.id),
        api.listProductKnowledgeSources(row.id),
      ]);
      if (signals.status !== "fulfilled") throw new Error("signals");
      const v = signals.value;
      const facts: ProductRowFacts = {
        channels: v.linkedChannels,
        inquiries: v.volume.inquiries,
        unanswered: v.volume.unansweredInquiries,
        reviews: v.volume.reviews,
        issueEvidence: v.volume.issueEvidence,
        knowledge: sources.status === "fulfilled" ? sources.value.length : null,
      };
      return [row.id, facts] as const;
    }),
  );
  const next = new Map<string, ProductRowFacts>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled") next.set(r.value[0], r.value[1]);
    else next.set(list[i].id, null as unknown as ProductRowFacts);
  });
  commit(next);
}

/**
 * A catalogue whose product NAME is a bare number (a channel product id used as the title). It is the
 * real name and is not replaced; it is set in tabular figures with a muted 「코드」 mark so a column of
 * such rows reads as product objects rather than as a list of ids that lost their names.
 */
function productNameNode(name: string): React.ReactNode {
  if (/^\d{2,}$/.test(name.trim())) {
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <span className="text-xs font-medium text-muted">코드</span>
        <span className="tabular-nums">{name}</span>
      </span>
    );
  }
  return name;
}
