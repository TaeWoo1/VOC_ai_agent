/**
 * A contract-faithful in-memory stand-in for the Spring OPERATOR backend.
 *
 * It mirrors the reads the Operator's specialists make, plus the two model seams. Every method is
 * deterministic: the same call returns the same value, so an Operator run is reproducible and two runs
 * of the same goal can be compared.
 *
 * <b>It has no write method, and cannot be given one</b> — the interface it implements has none. That
 * is the same property {@code FakeIssueSpringClient} carries and for the same reason: a fake that could
 * mutate would let a test pass that a real deployment could not.
 *
 * `calls` counts every read, which is how the budget tests observe that a run stopped spending rather
 * than merely stopped reporting.
 */
import type {
  AgentJudgeView,
  AgentPlanView,
  CustomerMemorySearch,
  DashboardSummary,
  InboxSummary,
  ProductFact,
  ProductKnowledge,
  ProductMatchSurface,
  ProductSignals,
  ProductSummary,
  RepeatedInquiry,
  ChannelCapabilityOverview,
  ChannelCoverageRow,
  ChannelSummary,
  DashboardOverview,
  InquiryReplyTransportRow,
  KnowledgeSearchResult,
  ReviewChannelCapabilityView,
  OrderSummaryParams,
  OrderSummaryResponse,
  RecentReviewsParams,
  RecentReviewsResponse,
} from "../../src/spring/types";
import type {
  CustomerMemorySearchParams,
  InquiryThreadContext,
  OperatorSpringClient,
} from "../../src/spring/OperatorSpringClient";
import { SpringApiError } from "../../src/spring/SpringClient";

/**
 * A product as the catalogue holds it, plus the listing titles the channels show for it.
 *
 * <b>Not a `ProductSummary`.</b> `matchedOn`/`matchedName` are properties of a QUERY, not of a
 * product, so they are produced by the resolver below rather than seeded — a fixture that could set
 * them would let a test assert a match surface no query would ever return.
 */
export interface SeedProduct {
  readonly id: string;
  readonly name: string;
  readonly sku: string | null;
  readonly status: string;
  /** Channel listing titles, which `resolve_product` also searches — exactly, and only exactly. */
  readonly listingNames?: readonly string[];
}

export interface FakeOperatorSeed {
  readonly inbox?: InboxSummary;
  /** Make the inbox read fail with this HTTP status, to exercise specialist failure semantics. */
  readonly inboxErrorStatus?: number;
  readonly products?: SeedProduct[];
  readonly signals?: Record<string, ProductSignals>;
  readonly customerMemory?: CustomerMemorySearch;
  readonly repeats?: RepeatedInquiry[];
  readonly itemAnalyses?: unknown[];
  readonly dashboard?: DashboardSummary;
  /** Product Knowledge by product id — identity, listings, variants, facts and per-facet coverage. */
  readonly knowledge?: Record<string, ProductKnowledge>;
  readonly inquiryContext?: InquiryThreadContext;
  /** Per (channel × data type) coverage rows. Absent ⇒ the client has no such method at all. */
  readonly channelCoverage?: ChannelCoverageRow[];
  /**
   * The seller's own product-knowledge library, by product id.
   *
   * Seeded as a whole search RESULT rather than as documents because the fake is a transport, not a
   * second retrieval implementation — a scorer here would let a test pass against ranking the backend
   * does not do. Absent ⇒ the product has no library, which is the honest "아직 아무것도 쓰지 않음".
   */
  readonly productKnowledgeSearch?: Record<string, KnowledgeSearchResult>;
  /**
   * When absent, the client has NO planGoal method at all.
   *
   * <b>In v2 that is no longer a "fallback" case — it is a FAILING one.</b> A seed without a plan is how
   * a test reproduces "the planner capability is off", and the expected outcome is a FAILED run, not a
   * keyword-routed answer. There is no keyword route to fall back to.
   */
  readonly plan?: AgentPlanView;
  /**
   * Plans keyed by goal text, for the recorded-plan suites.
   *
   * <b>The fake is a TRANSPORT, never a strategy.</b> These are plans a real model actually produced,
   * replayed byte-for-byte, so CI runs with no vendor key while the only planning strategy in the
   * process stays the real one. A `FakePlanner` implementing `Planner` would defeat `plannerFence`,
   * which is exactly why this seam is here and not there.
   */
  readonly plansByGoal?: Record<string, AgentPlanView>;
  /**
   * Plans keyed by goal text, returned only when the request carries a repair context.
   *
   * <b>The A8 seam, faked at the transport and nowhere else.</b> When the validator refuses a plan for
   * a rule a re-plan can fix, the planner asks again with the rule in `priorContext`; a real model then
   * returns a different plan. Seeding this is how a suite replays that second answer. Absent ⇒ the same
   * plan comes back, which is how a suite replays a model that does NOT fix it — and the run then fails,
   * because two is the bound.
   */
  readonly repairedPlansByGoal?: Record<string, AgentPlanView>;
  /** When absent, the client has NO judgeFinding method at all. */
  readonly judge?: AgentJudgeView;
  /* ── Agentic Operating Workspace v2 ── */
  /**
   * `GET /api/reviews/recent` answers keyed by `${negativeOnly}:${channel ?? "ALL"}`; `"*"` is the
   * fallback for any key. The fake is a transport: it does not filter rows itself, so a test asserts
   * exactly what the backend would have returned for that request and nothing this fake invented.
   */
  readonly recentReviews?: Record<string, RecentReviewsResponse>;
  readonly overviewByDays?: Record<number, DashboardOverview>;
  readonly ordersSummary?: OrderSummaryResponse;
  readonly channels?: ChannelSummary[];
  /* ── Channel-capability completion (2026-08-28). Each attached only when seeded, like the model seams. ── */
  /** `GET /api/channels/{code}/capabilities/overview` by channel code. */
  readonly channelOverviews?: Record<string, ChannelCapabilityOverview>;
  /** `GET /api/inquiry-publish/transports`. */
  readonly inquiryReplyTransports?: InquiryReplyTransportRow[];
  /** The `channel` block of `GET /api/seller-accounts/{accountId}/channel-reviews`, by account id. */
  readonly reviewChannelCapabilities?: Record<string, ReviewChannelCapabilityView>;
}

export class FakeOperatorSpringClient implements OperatorSpringClient {
  /** Every query `resolve_product` was called with, in order. See {@link searchProducts}. */
  readonly productQueries: string[] = [];
  /** Every knowledge retrieval, so a test can assert WHAT was asked of the library and for which product. */
  readonly productKnowledgeQueries: Array<{ productId: string; query: string }> = [];

  readonly calls = {
    inbox: 0, products: 0, signals: 0, memory: 0, repeats: 0, analyses: 0, dashboard: 0,
    plan: 0, judge: 0, knowledge: 0, facts: 0, inquiryContext: 0, channelCoverage: 0,
    knowledgeSearch: 0, recentReviews: 0, overview: 0, ordersSummary: 0, channels: 0,
    channelOverview: 0, transports: 0, reviewChannelCapability: 0,
  };
  /** Every recent-reviews request, so a test can assert the window and filters the read was made with. */
  readonly recentReviewParams: RecentReviewsParams[] = [];
  readonly overviewDays: number[] = [];
  readonly ordersSummaryParams: OrderSummaryParams[] = [];

  /** Every digest the judge was sent, so a test can assert what actually left for a vendor. */
  readonly judgeDigests: string[] = [];
  /** Every catalogue the planner was sent — the payload floor's runtime half. */
  readonly planCatalogues: string[][] = [];
  /** Every goal sentence the planner was asked about. */
  readonly planGoals: string[] = [];
  /** Every re-plan progress line — asserted to be need ids and statuses only. */
  readonly planPriorContexts: string[] = [];

  private readonly seed: FakeOperatorSeed;

  constructor(seed: FakeOperatorSeed = {}) {
    this.seed = seed;
    // The two seams are attached ONLY when seeded. A client without them is indistinguishable from a
    // backend that predates the endpoint, which is exactly the fallback path worth testing.
    if (seed.channelCoverage) {
      // Attached only when seeded, like the two model seams: a client without it is exactly a backend
      // that predates the endpoint, and a channel question against one must degrade rather than throw.
      (this as OperatorSpringClient).getChannelCoverage = async () => {
        this.calls.channelCoverage += 1;
        return seed.channelCoverage!;
      };
    }
    if (seed.channelOverviews) {
      (this as OperatorSpringClient).getChannelCapabilityOverview = async (code) => {
        this.calls.channelOverview += 1;
        const found = seed.channelOverviews![code.toUpperCase()];
        if (!found) throw new SpringApiError(404, "HTTP_404", "backend request failed (GET /capabilities/overview)");
        return found;
      };
    }
    if (seed.inquiryReplyTransports) {
      (this as OperatorSpringClient).listInquiryReplyTransports = async () => {
        this.calls.transports += 1;
        return [...seed.inquiryReplyTransports!];
      };
    }
    if (seed.reviewChannelCapabilities) {
      (this as OperatorSpringClient).getReviewChannelCapability = async (accountId) => {
        this.calls.reviewChannelCapability += 1;
        const found = seed.reviewChannelCapabilities![accountId];
        if (!found) throw new SpringApiError(404, "HTTP_404", "backend request failed (GET /channel-reviews)");
        return found;
      };
    }
    if (seed.plan || seed.plansByGoal) {
      (this as OperatorSpringClient).planGoal = async (request) => {
        this.calls.plan += 1;
        this.lastPlanInput = request;
        this.planCatalogues.push([...request.toolCatalogue]);
        this.planGoals.push(request.goalText);
        if (request.priorContext) {
          this.planPriorContexts.push(request.priorContext);
        }
        const isRepair = (request.priorContext ?? "").includes("plan-invalid:");
        const repaired = isRepair ? seed.repairedPlansByGoal?.[request.goalText] : undefined;
        if (repaired) {
          return repaired;
        }
        const recorded = seed.plansByGoal?.[request.goalText];
        if (recorded) {
          return recorded;
        }
        if (seed.plan) {
          return seed.plan;
        }
        // Seeded with recorded plans but asked about a goal none of them covers. Answering with any
        // other plan would make the suite measure this fake's improvisation rather than a model's.
        return { available: false, supported: false, specialists: [], tools: [],
          rationale: null, providerVersion: null };
      };
    }
    if (seed.judge) {
      (this as OperatorSpringClient).judgeFinding = async (request) => {
        this.calls.judge += 1;
        this.judgeDigests.push(request.evidenceDigest);
        return seed.judge!;
      };
    }
  }

  async getInbox(): Promise<InboxSummary> {
    this.calls.inbox += 1;
    // Seeded 5xx: the only way to reproduce "the read that would have answered you failed" without
    // asking a real backend to break. Status class only — no body, because the real error carries none.
    if (this.seed.inboxErrorStatus) {
      throw new SpringApiError(this.seed.inboxErrorStatus, `HTTP_${this.seed.inboxErrorStatus}`,
        "backend request failed (GET /api/inquiries/inbox)");
    }
    return this.seed.inbox ?? { items: [], total: 0, unansweredInquiries: 0 };
  }

  /**
   * Mirrors `ProductQueryService`: exact SKU, exact canonical name, exact listing title, then a
   * substring of the canonical name — each carrying the surface it matched on.
   *
   * <b>Faithful ranking is the point, not a detail.</b> An earlier version of this fake filtered by
   * substring and returned seed order, which made a test pass while production picked a different
   * product — precisely the failure the live run found, and a fake that cannot express it cannot guard
   * against it. One real product name being a prefix of another is ordinary in a seller's catalog.
   *
   * The alias surface is EXACT only, and normalization is the four steps `ProductNameKey` allows.
   * A fake that matched aliases loosely would green-light a resolver that guessed.
   */
  async searchProducts(query: string, limit?: number): Promise<ProductSummary[]> {
    this.calls.products += 1;
    // <b>What was searched FOR, not just how often.</b> C5 is a defect about the query itself: a run
    // that spends a resolve call on the word "상품" is looking for a product by that name, and a
    // counter alone cannot tell that apart from a legitimate lookup.
    this.productQueries.push(query);
    const key = (raw: string | null | undefined): string =>
      (raw ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
    const needle = key(query);
    const matched = (p: SeedProduct): { on: ProductMatchSurface; name: string | null } | null => {
      if (key(p.sku).length > 0 && key(p.sku) === needle) return { on: "SKU_EXACT", name: null };
      if (key(p.name) === needle) return { on: "CANONICAL_NAME_EXACT", name: null };
      const alias = (p.listingNames ?? []).find((n) => key(n) === needle);
      if (alias != null) return { on: "CHANNEL_PRODUCT_NAME_EXACT", name: alias.trim() };
      if (key(p.name).includes(needle)) return { on: "CANONICAL_NAME_PARTIAL", name: null };
      return null;
    };
    const order: ProductMatchSurface[] = [
      "SKU_EXACT", "CANONICAL_NAME_EXACT", "CHANNEL_PRODUCT_NAME_EXACT", "CANONICAL_NAME_PARTIAL",
      "CATALOG_HEAD",
    ];
    return (this.seed.products ?? [])
      .flatMap((p) => {
        const hit = matched(p);
        return hit == null ? [] : [{ p, hit }];
      })
      .sort((a, b) =>
        order.indexOf(a.hit.on) - order.indexOf(b.hit.on) || a.p.name.localeCompare(b.p.name))
      .slice(0, limit ?? 10)
      .map(({ p, hit }) => ({
        id: p.id, name: p.name, sku: p.sku, status: p.status,
        matchedOn: hit.on, matchedName: hit.name,
      }));
  }

  async getProductSignals(productId: string): Promise<ProductSignals> {
    this.calls.signals += 1;
    const found = this.seed.signals?.[productId];
    if (!found) {
      throw new Error(`no seeded signals for product ${productId}`);
    }
    return found;
  }

  /** The last plan request as the backend would have seen it — what the planner was TOLD. */
  lastPlanInput: { goalText: string; toolCatalogue: string[]; priorContext?: string; runId?: string } | null = null;
  /** The anchor the last customer-memory search was made with — what a test asserts, not the count. */
  lastMemoryParams: CustomerMemorySearchParams | null = null;

  async searchCustomerMemory(params: CustomerMemorySearchParams): Promise<CustomerMemorySearch> {
    this.calls.memory += 1;
    this.lastMemoryParams = params;
    // <b>The fake enforces the real endpoint's precondition.</b> `/api/customer-memory/search` refuses
    // a call with no inquiryId / signatureKey / topic / productId — deliberately, because without an
    // anchor a "past cases" lookup is a whole-org trawl. A fake that answered anyway would have made
    // the Q5 crash unreproducible in CI, which is exactly how it reached a live seller.
    if (!params.inquiryId && !params.signatureKey && !params.topic && !params.productId) {
      throw new SpringApiError(400, "HTTP_400", "backend request failed (GET /api/customer-memory/search)");
    }
    return (
      this.seed.customerMemory ?? {
        cueSignatureKey: null,
        cueTopic: null,
        hits: [],
        coverage: {
          signal: "CUSTOMER_MEMORY",
          coverage: "UNCERTAIN_UNSUPPORTED_CHANNEL",
          linked: 0,
          unlinked: 0,
          provenance: "customer-memory/LEXICAL:v1",
        },
      }
    );
  }

  async listRepeatedInquiries(): Promise<RepeatedInquiry[]> {
    this.calls.repeats += 1;
    return this.seed.repeats ?? [];
  }

  async listItemAnalyses(): Promise<unknown[]> {
    this.calls.analyses += 1;
    return this.seed.itemAnalyses ?? [];
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    this.calls.dashboard += 1;
    return this.seed.dashboard ?? { topProductIssues: [] };
  }

  async getProductKnowledge(productId: string): Promise<ProductKnowledge> {
    this.calls.knowledge += 1;
    const found = this.seed.knowledge?.[productId];
    if (found) {
      return found;
    }
    // A product with signals but no seeded catalogue is a REAL state (the derivation has not run, or
    // the channel has no product read), so the fake models it as empty-with-UNAVAILABLE rather than by
    // throwing. A throw would make "we do not hold this" untestable.
    const signals = this.seed.signals?.[productId];
    if (!signals) {
      throw new Error(`no seeded knowledge or signals for product ${productId}`);
    }
    return {
      productId,
      name: signals.productName,
      sku: signals.sku,
      status: "ACTIVE",
      listings: [],
      variants: [],
      facts: [],
      signals,
      knowledgeCoverage: [
        { facet: "IDENTITY", coverage: signals.sku ? "AVAILABLE" : "PARTIAL", known: 1,
          newestObservedAt: null, provenance: "products" },
        { facet: "LISTING", coverage: "UNAVAILABLE", known: 0, newestObservedAt: null, provenance: "" },
        { facet: "SPEC", coverage: "UNAVAILABLE", known: 0, newestObservedAt: null, provenance: "" },
        { facet: "VARIANT", coverage: "UNAVAILABLE", known: 0, newestObservedAt: null, provenance: "" },
      ],
    };
  }

  async searchProductFacts(productId: string, factKeys: string[]): Promise<ProductFact[]> {
    this.calls.facts += 1;
    const all = this.seed.knowledge?.[productId]?.facts ?? [];
    if (factKeys.length === 0) {
      return all;
    }
    // Mirrors the backend's expansion: a bare name matches its namespaced key. A fake that required the
    // full key would let a specialist ship a lookup that silently finds nothing in production.
    return all.filter((f) => factKeys.some((k) => f.factKey === k || f.factKey.endsWith(`:${k}`)));
  }

  async searchProductKnowledge(
    productId: string,
    query: string,
    limit?: number,
  ): Promise<KnowledgeSearchResult> {
    this.calls.knowledgeSearch += 1;
    this.productKnowledgeQueries.push({ productId, query });
    const seeded = this.seed.productKnowledgeSearch?.[productId];
    if (!seeded) {
      // A product with no library. NOT an error and NOT an empty match: the two are different
      // absences and the response shape is what keeps them apart.
      return { productId, query, documentsSearched: 0, passagesSearched: 0, passages: [] };
    }
    const cap = limit && limit > 0 ? limit : seeded.passages.length;
    return { ...seeded, query, passages: seeded.passages.slice(0, cap) };
  }

  async listRecentReviews(params: RecentReviewsParams): Promise<RecentReviewsResponse> {
    this.calls.recentReviews += 1;
    this.recentReviewParams.push(params);
    const table = this.seed.recentReviews ?? {};
    const key = `${params.negativeOnly ?? false}:${params.channel ?? "ALL"}`;
    const found = table[key] ?? table["*"];
    if (!found) {
      throw new SpringApiError(404, "HTTP_404", "backend request failed (GET /api/reviews/recent)");
    }
    return {
      ...found,
      from: params.from ?? found.from,
      to: params.to ?? found.to,
      negativeOnly: params.negativeOnly ?? found.negativeOnly,
      items: found.items.slice(0, params.size ?? found.items.length),
    };
  }

  async getDashboardOverview(days: number): Promise<DashboardOverview> {
    this.calls.overview += 1;
    this.overviewDays.push(days);
    const found = this.seed.overviewByDays?.[days];
    if (!found) {
      throw new SpringApiError(404, "HTTP_404", "backend request failed (GET /api/dashboard/overview)");
    }
    return found;
  }

  async getOrdersSummary(params: OrderSummaryParams): Promise<OrderSummaryResponse> {
    this.calls.ordersSummary += 1;
    this.ordersSummaryParams.push(params);
    if (!this.seed.ordersSummary) {
      throw new SpringApiError(404, "HTTP_404", "backend request failed (GET /api/orders/summary)");
    }
    return this.seed.ordersSummary;
  }

  async listChannels(): Promise<ChannelSummary[]> {
    this.calls.channels += 1;
    return this.seed.channels ?? [
      { id: "chan-naver", code: "NAVER", nameKo: "네이버" },
      { id: "chan-coupang", code: "COUPANG", nameKo: "쿠팡" },
      { id: "chan-cafe24", code: "CAFE24", nameKo: "카페24" },
    ];
  }

  async getInquiryThreadContext(workItemId: string): Promise<InquiryThreadContext> {
    this.calls.inquiryContext += 1;
    return this.seed.inquiryContext ?? {
      workItemId,
      inquiryId: "inq-fake",
      channelCode: null,
      productId: null,
      productName: null,
      status: "UNANSWERED",
      phase: "OPEN",
      receivedAt: "2026-08-01T00:00:00Z",
      isSecret: null,
      precedentCount: 0,
      hasApprovedPastReply: false,
    };
  }
}
