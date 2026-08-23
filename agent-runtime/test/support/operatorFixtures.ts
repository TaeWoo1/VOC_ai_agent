/**
 * Seeds for the Operator's end-to-end tests: an org with a real-shaped mix of signals, including the
 * partial product linkage that makes the coverage verdicts matter.
 */
import type {
  CustomerMemorySearch,
  InboxSummary,
  ProductKnowledge,
  ProductSignals,
  RepeatedInquiry,
  ReviewIssueSummary,
} from "../../src/spring/types";
import type { SeedProduct } from "./FakeOperatorSpringClient";

export const MOLDING: SeedProduct = {
  id: "p-molding", name: "전선몰딩 1호", sku: "SKU-77", status: "ACTIVE",
  listingNames: ["[패키징] 신개념 일체형 전선몰딩 선바로 2p"],
};
export const CABLE: SeedProduct = {
  id: "p-cable", name: "케이블타이 2호", sku: "SKU-88", status: "ACTIVE",
};

/**
 * A product whose canonical name is its SKU number and whose only readable name is on the listing —
 * the shape a Coupang/Cafe24-derived catalogue actually has, and the one that made a live seller's
 * own product unfindable by its own title.
 */
export const CUP_BIN: SeedProduct = {
  id: "p-cup-bin", name: "15223228019", sku: "15223228019", status: "ACTIVE",
  listingNames: ["판도리 일체형 종이컵 수거함"],
};

export function issue(overrides: Partial<ReviewIssueSummary> = {}): ReviewIssueSummary {
  return {
    id: "issue-adhesion",
    title: "접착 탈락",
    aspect: "접착",
    problem: "탈락",
    severity: "HIGH",
    lifecycleState: "NEEDS_REVIEW",
    lifecycleLabelKo: "확인 필요",
    evidenceCount: 12,
    firstEvidenceOn: "2026-06-18",
    lastEvidenceOn: "2026-08-14",
    dominantProductId: MOLDING.id,
    dominantProductName: MOLDING.name,
    dismissed: false,
    extractorKind: "RULE_BASED",
    change: {
      kinds: ["SURGING"], labelsKo: ["증가 중"], highSurge: true,
      surgeWindowCount: 6, surgeBaselineWeekly: 1.2,
    },
    ...overrides,
  };
}

export const INBOX: InboxSummary = { items: [], total: 0, unansweredInquiries: 3208 };

/** A product whose issue signal is COVERED but whose review linkage is partial — the Cafe24 case. */
export function coveredSignals(): ProductSignals {
  return {
    productId: MOLDING.id,
    productName: MOLDING.name,
    sku: MOLDING.sku,
    referenceDate: "2026-08-21",
    issues: [issue()],
    recommendedActions: [{ recommendedAction: "FAQ 후보", count: 4 }],
    volume: { reviews: 40, inquiries: 12, unansweredInquiries: 5, issueEvidence: 12 },
    linkedChannels: ["NAVER"],
    coverage: [
      { signal: "REVIEW_ISSUE", coverage: "COVERED", linked: 12, unlinked: 0, provenance: "issue-memory/RULE_BASED" },
      { signal: "ITEM_ANALYSIS", coverage: "COVERED", linked: 40, unlinked: 0, provenance: "item-analysis/RULE_BASED:v1" },
      { signal: "REVIEW", coverage: "COVERED", linked: 40, unlinked: 0, provenance: "review-store/INGEST:canonical" },
      { signal: "INQUIRY", coverage: "COVERED", linked: 12, unlinked: 0, provenance: "inquiry-store/INGEST:canonical" },
      { signal: "CUSTOMER_MEMORY", coverage: "COVERED", linked: 52, unlinked: 0, provenance: "customer-memory/LEXICAL:v1" },
    ],
  };
}

/** A product with NO linked rows and a real unlinked backlog — the false-calm case. */
export function unlinkedSignals(): ProductSignals {
  return {
    productId: CABLE.id,
    productName: CABLE.name,
    sku: CABLE.sku,
    referenceDate: "2026-08-21",
    issues: [],
    recommendedActions: [],
    volume: { reviews: 0, inquiries: 0, unansweredInquiries: 0, issueEvidence: 0 },
    linkedChannels: [],
    coverage: [
      { signal: "REVIEW_ISSUE", coverage: "UNCERTAIN_PRODUCT_UNLINKED", linked: 0, unlinked: 214, provenance: "issue-memory/RULE_BASED" },
      { signal: "REVIEW", coverage: "UNCERTAIN_PRODUCT_UNLINKED", linked: 0, unlinked: 980, provenance: "review-store/INGEST:canonical" },
      { signal: "INQUIRY", coverage: "UNCERTAIN_PRODUCT_UNLINKED", linked: 0, unlinked: 3208, provenance: "inquiry-store/INGEST:canonical" },
      { signal: "ITEM_ANALYSIS", coverage: "UNCERTAIN_PRODUCT_UNLINKED", linked: 0, unlinked: 0, provenance: "item-analysis/NONE" },
      { signal: "CUSTOMER_MEMORY", coverage: "UNCERTAIN_PRODUCT_UNLINKED", linked: 0, unlinked: 52, provenance: "customer-memory/LEXICAL:v1" },
    ],
  };
}

export const REPEATS: RepeatedInquiry[] = [
  {
    axis: "SIGNATURE", key: "접착:탈락", labelKo: "접착 탈락", occurrences: 6,
    answeredOccurrences: 4, firstSeenOn: "2026-07-30", lastSeenOn: "2026-08-19", windowDays: 28,
  },
  {
    axis: "TOPIC", key: "배송", labelKo: "배송", occurrences: 3,
    answeredOccurrences: 3, firstSeenOn: "2026-08-02", lastSeenOn: "2026-08-18", windowDays: 28,
  },
];

export const MEMORY: CustomerMemorySearch = {
  cueSignatureKey: "접착:탈락",
  cueTopic: "품질",
  hits: [
    {
      kind: "INQUIRY", sourceId: "inq-past-1", productId: MOLDING.id, productName: MOLDING.name,
      channelCode: "CAFE24", topic: "품질", signatureKey: "접착:탈락", severity: "HIGH",
      occurredOn: "2026-07-12", answered: true,
      answer: "안녕하세요. 시공 면의 먼지를 먼저 닦아 주신 뒤 부착해 주세요.",
      retrieverKind: "LEXICAL", retrieverVersion: "customer-memory-lexical/v1",
    },
  ],
  coverage: {
    signal: "CUSTOMER_MEMORY", coverage: "COVERED", linked: 52, unlinked: 0,
    provenance: "customer-memory/LEXICAL:v1",
  },
};

export const ANALYSES = [
  { recommendedAction: "FAQ 후보" },
  { recommendedAction: "FAQ 후보" },
  { recommendedAction: "상세페이지 개선 후보" },
  { recommendedAction: "확인 필요" },
];


/* ─────────────────────────── Product Knowledge (Operator Graph v2) ─────────────────────────── */

/**
 * A product SellerOps genuinely knows: a channel listing, two options, and two stated specs.
 *
 * The two specs carry different `confidence` values on purpose — one stated by a channel, one parsed
 * out of the listing title — because a surface that cannot tell them apart would present a parse as a
 * catalogue fact.
 */
export function knownProduct(): ProductKnowledge {
  return {
    productId: MOLDING.id,
    name: MOLDING.name,
    sku: MOLDING.sku,
    status: "ACTIVE",
    listings: [
      {
        channelCode: "NAVER", channelNameKo: "네이버", channelProductId: "6473457702",
        listingName: "선바로 일체형 전선몰딩 2m", productUrl: "https://smartstore.naver.com/x/6473457702",
        price: 12900, currency: "KRW", sellingStatus: "SELLING",
        source: "NAVER:PRODUCT_API:v1", observedAt: "2026-08-20T02:00:00Z",
      },
    ],
    variants: [
      { channelCode: "NAVER", externalVariantId: "opt-1", optionName: "화이트 / 2m", sku: "SKU-77-W",
        price: 12900, sellingStatus: "SELLING", source: "NAVER:PRODUCT_API:v1",
        observedAt: "2026-08-20T02:00:00Z" },
      { channelCode: "NAVER", externalVariantId: "opt-2", optionName: "블랙 / 2m", sku: "SKU-77-B",
        price: 13900, sellingStatus: "SELLING", source: "NAVER:PRODUCT_API:v1",
        observedAt: "2026-08-20T02:00:00Z" },
    ],
    facts: [
      { factKey: "spec:길이", value: "2", unit: "m", source: "DERIVED:TITLE", sourceRef: "SKU-77",
        observedAt: "2026-08-20T02:00:00Z", confidence: "DERIVED" },
      { factKey: "spec:원산지", value: "대한민국", unit: null, source: "NAVER:PRODUCT_API:v1",
        sourceRef: "6473457702", observedAt: "2026-08-20T02:00:00Z", confidence: "SOURCE_STATED" },
    ],
    signals: coveredSignals(),
    knowledgeCoverage: [
      { facet: "IDENTITY", coverage: "AVAILABLE", known: 2, newestObservedAt: null, provenance: "products" },
      { facet: "LISTING", coverage: "AVAILABLE", known: 1, newestObservedAt: "2026-08-20T02:00:00Z",
        provenance: "NAVER:PRODUCT_API:v1" },
      { facet: "PRICE", coverage: "AVAILABLE", known: 1, newestObservedAt: "2026-08-20T02:00:00Z",
        provenance: "NAVER:PRODUCT_API:v1" },
      { facet: "VARIANT", coverage: "AVAILABLE", known: 2, newestObservedAt: "2026-08-20T02:00:00Z",
        provenance: "NAVER:PRODUCT_API:v1" },
      { facet: "SPEC", coverage: "PARTIAL", known: 2, newestObservedAt: "2026-08-20T02:00:00Z",
        provenance: "DERIVED:TITLE+NAVER:PRODUCT_API:v1" },
      { facet: "DESCRIPTION", coverage: "UNAVAILABLE", known: 0, newestObservedAt: null, provenance: "" },
      { facet: "SIGNALS", coverage: "AVAILABLE", known: 5, newestObservedAt: null, provenance: "issue-memory/RULE_BASED" },
    ],
  };
}

/**
 * A product SellerOps knows almost nothing about — no listing, no option, no spec.
 *
 * This is the COMMON case on a real org, not an edge one: before the PRODUCT read runs (or on a channel
 * that has none), a product is a name and a SKU. Every facet reads UNAVAILABLE, and the assertion that
 * matters is that an answer built on it says "갖고 있지 않습니다" rather than "없습니다".
 */
export function unknownProduct(): ProductKnowledge {
  return {
    productId: CABLE.id,
    name: CABLE.name,
    sku: CABLE.sku,
    status: "ACTIVE",
    listings: [],
    variants: [],
    facts: [],
    signals: unlinkedSignals(),
    knowledgeCoverage: [
      { facet: "IDENTITY", coverage: "AVAILABLE", known: 2, newestObservedAt: null, provenance: "products" },
      { facet: "LISTING", coverage: "UNAVAILABLE", known: 0, newestObservedAt: null, provenance: "" },
      { facet: "PRICE", coverage: "UNAVAILABLE", known: 0, newestObservedAt: null, provenance: "" },
      { facet: "VARIANT", coverage: "UNAVAILABLE", known: 0, newestObservedAt: null, provenance: "" },
      { facet: "SPEC", coverage: "UNAVAILABLE", known: 0, newestObservedAt: null, provenance: "" },
      { facet: "DESCRIPTION", coverage: "UNAVAILABLE", known: 0, newestObservedAt: null, provenance: "" },
    ],
  };
}

/**
 * Signals for the SKU-named product, so its evidence has a product to be attached to.
 *
 * <b>A shape, not a claim.</b> The live row this fixture is modelled on has no issue evidence at all;
 * one issue is given here because the assertion under test is WHICH product an issue is attributed to
 * and WHAT the answer calls it, and evidence that does not exist cannot carry either.
 */
/**
 * The live product's signals: seven reviews, one inquiry, and NO issue evidence at all.
 *
 * <b>The default is the demo org's actual shape, and the empty issue list is the point.</b> The
 * backend selects this list from `review_issue_evidence` rows belonging to this product, so an empty
 * one under `COVERED` is a measured zero and not a blind spot — the case a product question most often
 * lands on, and the one that used to produce silence. Pass issues in to exercise the attributed path;
 * pass ONLY ids the issue-store fake also holds, or the two fakes describe different orgs.
 */
export function cupBinSignals(issues: ReviewIssueSummary[] = []): ProductSignals {
  const issueEvidence = issues.reduce((sum, i) => sum + i.evidenceCount, 0);
  return {
    productId: CUP_BIN.id,
    productName: CUP_BIN.name,
    sku: CUP_BIN.sku,
    referenceDate: "2026-08-23",
    issues,
    recommendedActions: [],
    volume: { reviews: 7, inquiries: 1, unansweredInquiries: 0, issueEvidence },
    linkedChannels: ["COUPANG"],
    coverage: [
      { signal: "REVIEW_ISSUE", coverage: "COVERED", linked: issueEvidence, unlinked: 0,
        provenance: "issue-memory/RULE_BASED" },
      { signal: "REVIEW", coverage: "COVERED", linked: 7, unlinked: 0, provenance: "review-store/INGEST:canonical" },
      { signal: "INQUIRY", coverage: "COVERED", linked: 1, unlinked: 0, provenance: "inquiry-store/INGEST:canonical" },
    ],
  };
}

/**
 * The same product, on an org whose issue evidence is NOT all attributed.
 *
 * <b>The one case where the product's own issue index cannot answer.</b> `UNCERTAIN_PRODUCT_UNLINKED`
 * means rows exist that belong to no product, so an empty list for this product proves nothing and
 * ProductOps correctly says nothing. That is when ReviewOps' bounded org sweep is the only path there
 * is — and the case its "read six of nineteen" honesty rules exist for.
 */
export function cupBinSignalsUnlinked(): ProductSignals {
  const base = cupBinSignals();
  return {
    ...base,
    coverage: base.coverage.map((c) => c.signal === "REVIEW_ISSUE"
      ? { ...c, coverage: "UNCERTAIN_PRODUCT_UNLINKED" as const, linked: 0, unlinked: 12 }
      : c),
  };
}

/**
 * Product Knowledge for a product whose only readable name is on its listing.
 *
 * `name` is the SKU number, exactly as a Coupang-derived catalogue stores it; the human name lives in
 * `listings[0].listingName`. That asymmetry is the whole point of the fixture.
 */
export function cupBinKnowledge(signals: ProductSignals = cupBinSignals()): ProductKnowledge {
  return {
    productId: CUP_BIN.id,
    name: CUP_BIN.name,
    sku: CUP_BIN.sku,
    status: "ACTIVE",
    listings: [
      {
        channelCode: "COUPANG", channelNameKo: "쿠팡", channelProductId: "15223228019",
        listingName: "판도리 일체형 종이컵 수거함", productUrl: null,
        price: 18900, currency: "KRW", sellingStatus: "SELLING",
        source: "COUPANG:PRODUCT_API:v1", observedAt: "2026-08-22T02:00:00Z",
      },
    ],
    variants: [],
    facts: [],
    signals,
    knowledgeCoverage: [
      { facet: "IDENTITY", coverage: "AVAILABLE", known: 2, newestObservedAt: null, provenance: "products" },
      { facet: "LISTING", coverage: "AVAILABLE", known: 1, newestObservedAt: "2026-08-22T02:00:00Z",
        provenance: "COUPANG:PRODUCT_API:v1" },
      { facet: "SPEC", coverage: "UNAVAILABLE", known: 0, newestObservedAt: null, provenance: "" },
      { facet: "SIGNALS", coverage: "AVAILABLE", known: 3, newestObservedAt: null, provenance: "issue-memory/RULE_BASED" },
    ],
  };
}

export const KNOWLEDGE: Record<string, ProductKnowledge> = {
  [MOLDING.id]: knownProduct(),
  [CABLE.id]: unknownProduct(),
};
