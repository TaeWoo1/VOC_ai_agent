import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { DataTable, Td, Th } from "../../components/ui/DataTable";
import { Empty } from "../../components/ui/Empty";
import { BtnLink } from "../../components/ui/Btn";
import { AgentLaunch } from "../../components/ui/AgentLaunch";
import { ProductKnowledgeLibrary } from "../../components/product/ProductKnowledgeLibrary";
import {
  KnowledgeDocumentAdd,
  KnowledgeDocumentList,
} from "../../components/knowledge/KnowledgeDocuments";
import { Disclosure } from "../../components/ui/Disclosure";
import { useApiData } from "../../lib/useApiData";
import { api } from "../../lib/apiClient";
import { count } from "../../lib/format";
import type {
  KnowledgeCandidateView,
  KnowledgeCoverageView,
  KnowledgeDocumentView,
  ProductKnowledgeView,
  ReviewIssueView,
} from "../../lib/types";
import { priceLabel, sellingStatusLabel } from "../../lib/productVocabulary";
import { useAgentSurface } from "../../lib/agentPanel";

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
  // What the panel says it is looking at — the catalogue name, never customer text.
  useAgentSurface(
    data
      ? {
          surface: "product",
          productId,
          label: `이 상품 · ${data.name ?? "이름을 확인하지 못한 상품"}`,
        }
      : null,
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
            context={{ productId, surface: "product" }}
            label="이 상품에 대해 물어보기"
          />
        }
      />

      {/*
        PRIMARY — what is happening to this product, and every one of these numbers is a door.

        Each destination reads through the SAME predicate its figure was counted with: the 문의 pair
        through `/inquiries?productId=` (org, this product, ACTIVE, REAL, and the status the label
        names) and 리뷰 through `/reviews?productId=`, whose total is literally the count printed here.
        A figure and the list it opens that disagree about which rows they mean is worse than no door
        at all. Zero is not a door: there is nothing behind it, and a control that opens an empty list
        is a broken promise.

        문제 근거 used to stand here as a fourth tile. It was never an independent number — it is the
        sum of the evidence counts of the issues listed further down — and it was the one figure with
        nowhere to go. It now lives on that section's own heading, where each contributing row is a
        door of its own.
      */}
      <section className="grid grid-cols-3 gap-3" aria-label="이 상품의 신호">
        <Figure
          label="리뷰"
          value={volume.reviews}
          to={volume.reviews > 0 ? `/reviews?productId=${productId}` : undefined}
        />
        <Figure
          label="문의"
          value={volume.inquiries}
          to={volume.inquiries > 0 ? `/inquiries?productId=${productId}` : undefined}
        />
        <Figure
          label="미답변 문의"
          value={volume.unansweredInquiries}
          emphasis
          to={
            volume.unansweredInquiries > 0
              ? `/inquiries?productId=${productId}&status=UNANSWERED`
              : undefined
          }
        />
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

      {/*
        SUPPORTING — repeated problems, from the extractor, never from raw review counts.

        <b>Every row is now a door.</b> The evidence behind a repeated problem already had a surface —
        고객운영 메모리's issue detail, which shows why the issue was raised, the masked customer
        sentences behind it and the lifecycle history — and this list simply never linked to it. A
        seller reading 「접착 탈락 · 근거 19건」 could not reach one of the nineteen.

        <b>And the list no longer stops at five without saying so.</b> It showed `slice(0, 5)` of
        fifteen with nothing to indicate the other ten existed, which is the same defect as a figure
        with nowhere to go: a number the screen knows and does not tell.
      */}
      <section className="space-y-3">
        <SectionHeader
          title="반복되는 문제"
          hint={`리뷰에서 같은 문제가 반복해 나타난 것 · 근거 ${count(volume.issueEvidence)}건`}
        />
        {data.signals.issues.length === 0 ? (
          <p className="text-muted">이 상품에서 반복 문제로 잡힌 것이 없습니다.</p>
        ) : (
          <>
            <ul className="divide-y divide-line/70">
              {data.signals.issues.slice(0, ISSUES_SHOWN).map((issue) => (
                <IssueRow key={issue.id} issue={issue} />
              ))}
            </ul>
            {data.signals.issues.length > ISSUES_SHOWN ? (
              <Disclosure
                label={`문제 ${count(data.signals.issues.length - ISSUES_SHOWN)}건 더 보기`}
                summaryClassName="-ml-2"
              >
                <ul className="divide-y divide-line/70">
                  {data.signals.issues.slice(ISSUES_SHOWN).map((issue) => (
                    <IssueRow key={issue.id} issue={issue} />
                  ))}
                </ul>
              </Disclosure>
            ) : null}
          </>
        )}
      </section>

      {/* The one place a seller writes rather than reads. */}
      <section className="space-y-3">
        <SectionHeader
          title="상품 지식"
          hint="판매자가 직접 적어 두는 설명·FAQ·사용법·정책. AI가 답변의 근거로 사용합니다."
          action={<KnowledgeLink />}
        />
        <ProductKnowledgeLibrary productId={productId} />
        <ProductKnowledgeGaps productId={productId} />
      </section>

      {/*
        자료 — the material the seller already had for THIS product (Knowledge Setup & Inbox UX v1 §5).

        The API has taken a product-scoped document since Knowledge Sources & Acquisition v1 and no
        screen ever offered one, so a manual could only be filed company-wide — and the 자료 list on
        the knowledge screen showed product documents it had no way to create. Uploading from here
        means the product is already chosen: a seller holding a manual for this listing is never
        asked which listing it is for.
      */}
      <section className="space-y-3">
        <SectionHeader
          title="자료"
          hint="이 상품의 사용설명서·FAQ 같은 파일. 올리면 답변 근거로 씁니다."
          action={<KnowledgeLink />}
        />
        <ProductDocuments productId={productId} />
      </section>

      {/*
        REFERENCE — where it is sold.

        It moved below the operational sections: it is the product's own particulars, and it sat
        directly under the figure row, so the two facts a seller comes to this page for — what
        customers are saying and what reviewnary can answer with — began 300px lower than the price of
        a listing they already know.
      */}
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
          "갖고 있지 않음"은 reviewnary가 그 정보를 보유하고 있지 않다는 뜻이며, 상품에 그런 정보가
          없다는 뜻이 아닙니다.
        </p>
      </section>
    </div>
  );
}

/** How many repeated problems stand open on the page; the rest are one disclosure away, counted. */
const ISSUES_SHOWN = 5;

/**
 * One repeated problem — and the way to the evidence behind it.
 *
 * The destination is the issue surface that already exists (고객운영 메모리): why it was raised, the
 * masked customer sentences recorded as evidence, and the lifecycle history. Nothing new detects,
 * ranks or explains an issue here; this row only stops the number from being a dead end.
 */
function IssueRow({ issue }: { issue: ReviewIssueView }) {
  return (
    <li>
      <Link
        to={`/memory/${issue.id}`}
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg py-3 transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
      >
        <span className="break-keep font-medium text-ink">{issue.title}</span>
        <span className="text-sm tabular-nums text-muted">
          근거 {count(issue.evidenceCount)}건
          <span className="ml-1 text-brand-700" aria-hidden="true">›</span>
        </span>
      </Link>
    </li>
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

/**
 * One of this product's numbers — and, when there is something behind it, the way in.
 *
 * `to` is given only for a figure whose list exists and is scoped to this exact product. Without it
 * the tile is what it always was: a fact, not a control.
 */
function Figure({
  label,
  value,
  emphasis,
  to,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
  to?: string;
}) {
  const shell = `block rounded-2xl border px-4 py-3 ${
    emphasis ? "border-brand/30 bg-brand-50/40" : "border-line bg-surface"
  }`;
  const body = (
    <>
      <p className="text-sm font-medium text-muted">
        {label}
        {to ? <span className="ml-1 text-brand-700" aria-hidden="true">›</span> : null}
      </p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-ink">{count(value)}</p>
    </>
  );
  if (!to) return <div className={shell}>{body}</div>;
  return (
    <Link
      to={to}
      aria-label={`${label} ${count(value)}건 보기`}
      className={`${shell} transition hover:border-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700`}
    >
      {body}
    </Link>
  );
}

/**
 * Where the knowledge written here lives when the seller looks at the company's whole library.
 *
 * <b>It says 회사 전체, and that wording is the point.</b> A product knowledge source and a product
 * document really are the same objects on 알고 있는 정보 — the library lists product-scoped rows
 * beside company ones — but that screen has no product filter, so a link promising 「이 상품의 자료」
 * would land on a page showing every product's. The link says where it goes.
 */
function KnowledgeLink() {
  return (
    <Link
      to="/knowledge"
      className="rounded text-sm font-semibold text-brand-700 underline-offset-4 hover:text-brand-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
    >
      회사 전체 지식에서 보기
    </Link>
  );
}

/**
 * What is still waiting to be confirmed FOR THIS PRODUCT — 확인 필요, narrowed by the binding.
 *
 * <b>It is a pointer, not a second inbox.</b> The editor, the accept/dismiss decisions and the ask's
 * own wording all live on 알고 있는 정보, and duplicating them here would create a second place to
 * answer the same question. This says how many there are and opens the one place that answers them.
 *
 * <p>The read is the company's open list — the only one that exists — filtered by {@code productId},
 * which is the binding and not the display name. A failed read renders nothing rather than 「0건」:
 * this component cannot tell an empty list from an unread one, and must not claim it can.
 */
function ProductKnowledgeGaps({ productId }: { productId: string }) {
  const [open, setOpen] = useState<KnowledgeCandidateView[] | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getKnowledgeCandidates()
      .then((rows) => {
        if (live) setOpen(rows.filter((row) => row.productId === productId));
      })
      .catch(() => {
        if (live) setOpen(null);
      });
    return () => {
      live = false;
    };
  }, [productId]);

  if (open === null || open.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="break-keep text-ink">
        이 상품에 대해 확인이 필요한 항목이 {count(open.length)}건 있습니다.
      </span>
      <Link
        to="/knowledge"
        className="rounded font-semibold text-brand-700 underline-offset-4 hover:text-brand-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
      >
        확인하러 가기
      </Link>
    </p>
  );
}

/**
 * This product's uploaded files, and the control that adds one.
 *
 * <p>Its own read (`?productId=`) rather than a filter over the company's whole list: a shop with
 * three hundred products would read three hundred products' documents to show this one's two.
 */
function ProductDocuments({ productId }: { productId: string }) {
  const [documents, setDocuments] = useState<KnowledgeDocumentView[] | null>(null);

  const load = useCallback(async () => {
    setDocuments(await api.getKnowledgeDocuments(productId).catch(() => []));
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      {documents === null ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : (
        <KnowledgeDocumentList documents={documents} onChanged={load} />
      )}
      <KnowledgeDocumentAdd scope="PRODUCT" productId={productId} onImported={load} />
    </>
  );
}

