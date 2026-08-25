import { useParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { DataTable, Td, Th } from "../../components/ui/DataTable";
import { Empty } from "../../components/ui/Empty";
import { BtnLink } from "../../components/ui/Btn";
import { AgentLaunch } from "../../components/ui/AgentLaunch";
import { ProductKnowledgeLibrary } from "../../components/product/ProductKnowledgeLibrary";
import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import { count } from "../../lib/format";
import type { KnowledgeCoverageView, ProductKnowledgeView } from "../../lib/types";
import { priceLabel, sellingStatusLabel } from "../../lib/productVocabulary";

/**
 * 상품 상세 — Product Intelligence.
 *
 * <b>Six sections in a fixed order</b> (`docs/frontend_ux_audit_v1.md` §6, Demo Core Experience §7):
 * 핵심 정보 → 신호 → 채널 리스팅 → 반복 문제 → 상품 지식 → Agent. Each is a heading with a rule, not
 * another card, so the page has an outline instead of a stack.
 *
 * <b>One primary action.</b> The audit found screens scattered with equal-weight outline buttons; the
 * only CTA here is "지식 추가" inside the library, because that is the one thing a seller does on this
 * page that changes what the product can answer.
 *
 * <b>Coverage is stated, not implied.</b> An empty spec list under `UNAVAILABLE` says
 * "갖고 있지 않습니다" — never "이 상품에는 없습니다". That distinction is enforced in the backend, in
 * the Agent, and here.
 */
export function ProductDetail() {
  const { productId = "" } = useParams();
  const { data, loading, error } = useApiData<ProductKnowledgeView>(
    () => api.getProductKnowledgeStrict(productId),
    [productId],
  );

  if (loading) {
    return <p className="text-muted">불러오는 중…</p>;
  }
  if (error || !data) {
    return (
      <Empty
        title="상품을 불러오지 못했습니다"
        body="이 상품이 없거나 정보를 읽는 중 문제가 생겼습니다."
        action={<BtnLink to="/products">상품 목록으로</BtnLink>}
      />
    );
  }

  const volume = data.signals.volume;
  return (
    <div className="space-y-8">
      <PageHead
        title={data.name ?? "이름을 확인하지 못한 상품"}
        description={[data.sku ? `상품코드 ${data.sku}` : null]
          .filter(Boolean)
          .join(" · ")}
        action={
          <AgentLaunch
            context={{
              productId,
              surface: "product",
              goal: `${data.name ?? ""} 상품에 대해 알려 줘`,
            }}
          />
        }
      />

      {/* PRIMARY — what is happening to this product. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="리뷰" value={volume.reviews} />
        <Figure label="문의" value={volume.inquiries} />
        <Figure label="미답변 문의" value={volume.unansweredInquiries} emphasis />
        <Figure label="문제 근거" value={volume.issueEvidence} />
      </section>

      {data.signals.coverage.some((c) => c.coverage !== "COVERED") ? (
        <p className="break-keep rounded-xl bg-warn/10 px-4 py-3 text-sm text-warn">
          일부 신호는 이 상품에 연결되지 않아 위 숫자에 포함되지 않았을 수 있습니다.
          {" "}
          {data.signals.coverage
            .filter((c) => c.coverage !== "COVERED")
            .map((c) => `${SIGNAL_KO[c.signal] ?? c.signal} ${c.unlinked}건 미연결`)
            .join(" · ")}
        </p>
      ) : null}

      {/* SUPPORTING — where it is sold. */}
      <section className="space-y-3">
        <SectionHeader title="채널 리스팅" hint="이 상품이 각 채널에 어떻게 올라가 있는지" />
        {data.listings.length === 0 ? (
          <p className="text-muted">
            채널 리스팅 정보를 갖고 있지 않습니다. (이 상품이 어디에도 올라가 있지 않다는 뜻은 아닙니다.)
          </p>
        ) : (
          <DataTable
            caption="채널별 리스팅 이름, 가격, 판매 상태"
            head={
              <>
                <Th>채널</Th>
                <Th>리스팅 이름</Th>
                <Th numeric>가격</Th>
                <Th>판매 상태</Th>
              </>
            }
          >
            {data.listings.map((listing, i) => (
              <tr key={`${listing.channelCode}-${listing.channelProductId ?? i}`}>
                <Td>{listing.channelNameKo ?? listing.channelCode}</Td>
                <Td>
                  {listing.productUrl ? (
                    <a
                      href={listing.productUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg text-ink underline decoration-line underline-offset-4 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
                    >
                      {listing.listingName ?? "이름 없음"}
                    </a>
                  ) : (
                    (listing.listingName ?? "이름 없음")
                  )}
                </Td>
                <Td numeric muted={listing.price == null}>
                  {listing.price == null ? "—" : priceLabel(count(listing.price), listing.currency)}
                </Td>
                <Td muted>{sellingStatusLabel(listing.sellingStatus)}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>

      {/* SUPPORTING — repeated problems, from the extractor, never from raw review counts. */}
      <section className="space-y-3">
        <SectionHeader title="반복되는 문제" hint="리뷰에서 같은 문제가 반복해 나타난 것" />
        {data.signals.issues.length === 0 ? (
          <p className="text-muted">이 상품에서 반복 문제로 잡힌 것이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {data.signals.issues.slice(0, 5).map((issue) => (
              <li key={issue.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="break-keep font-medium text-ink">{issue.title}</span>
                <span className="text-sm tabular-nums text-muted">근거 {count(issue.evidenceCount)}건</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The one place a seller writes rather than reads. */}
      <section className="space-y-3">
        <SectionHeader
          title="상품 지식"
          hint="판매자가 직접 적어 두는 설명·FAQ·사용법·정책. AI가 답변의 근거로 사용합니다."
        />
        <ProductKnowledgeLibrary productId={productId} />
      </section>

      {/* REFERENCE — what we hold about this product, and what we do not. */}
      <section className="space-y-3">
        <SectionHeader title="우리가 갖고 있는 정보" />
        <ul className="flex flex-wrap gap-2">
          {data.knowledgeCoverage.map((row) => (
            <li key={row.facet}>
              <CoverageChip row={row} />
            </li>
          ))}
        </ul>
        <p className="break-keep text-sm text-muted">
          "갖고 있지 않음"은 SellerOps가 그 정보를 보유하고 있지 않다는 뜻이며, 상품에 그런 정보가
          없다는 뜻이 아닙니다.
        </p>
      </section>
    </div>
  );
}

const SIGNAL_KO: Record<string, string> = {
  REVIEW: "리뷰",
  INQUIRY: "문의",
  REVIEW_ISSUE: "리뷰 문제",
  ITEM_ANALYSIS: "문의 분석",
  CUSTOMER_MEMORY: "고객 기록",
};

const FACET_KO: Record<string, string> = {
  IDENTITY: "이름·코드",
  LISTING: "채널 리스팅",
  PRICE: "가격",
  VARIANT: "옵션",
  TAXONOMY: "브랜드·분류",
  DESCRIPTION: "상세 설명",
  SPEC: "규격",
  SIGNALS: "신호",
};

const COVERAGE_KO: Record<string, string> = {
  AVAILABLE: "있음",
  PARTIAL: "일부",
  UNAVAILABLE: "갖고 있지 않음",
  STALE: "오래됨",
};

function CoverageChip({ row }: { row: KnowledgeCoverageView }) {
  const tone =
    row.coverage === "AVAILABLE"
      ? "bg-good/10 text-good"
      : row.coverage === "UNAVAILABLE"
        ? "bg-canvas text-muted"
        : "bg-warn/10 text-warn";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${tone}`}>
      <span className="font-normal opacity-80">{FACET_KO[row.facet] ?? row.facet}</span>
      {COVERAGE_KO[row.coverage] ?? row.coverage}
    </span>
  );
}

function Figure({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        emphasis ? "border-brand/30 bg-brand-50/40" : "border-line bg-surface"
      }`}
    >
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-ink">{count(value)}</p>
    </div>
  );
}
