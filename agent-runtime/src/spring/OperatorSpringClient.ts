/**
 * The boundary to the Spring backend for the OPERATOR domain — a sibling of {@link SpringClient},
 * {@link ReviewSpringClient} and {@link IssueSpringClient}, kept separate for the same reason they
 * are separate from each other: the existing surfaces and their fakes must not have to change for a
 * new specialist to exist.
 *
 * <b>Every method is READ, and every one maps onto exactly one existing endpoint</b> — except the two
 * model seams (`plan`, `judge`), which write nothing either: they look nothing up, move no state and
 * store no row, exactly like the inquiry-draft seam.
 *
 * <b>What is deliberately absent.</b> There is no method here that changes an issue, sends a reply,
 * edits an FAQ, touches a credential, starts a collection run, or mints a guided-submission ref. The
 * Operator selects its own tools, so anything reachable from this interface is something it could
 * decide to do on its own — which is exactly why the privileged plane is not on it.
 */
import type {
  AgentJudgeView,
  AgentPlanView,
  CustomerMemorySearch,
  DashboardSummary,
  InboxSummary,
  ProductFact,
  ProductKnowledge,
  ProductSignals,
  ProductSummary,
  RepeatedInquiry,
} from "./types";
import type { ChannelCoverageRow } from "./types";

/**
 * One inquiry's context WITHOUT its body.
 *
 * The body is read by `get_inquiry_detail` and only for drafting. This shape exists so a specialist can
 * decide WHETHER a product fact or a precedent is needed without first loading the customer's words —
 * the read that used to be the only way in, and the reason "look at the inquiry" cost more exposure
 * than the question deserved.
 */
export interface InquiryThreadContext {
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly channelCode: string | null;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly status: string;
  readonly phase: string;
  readonly receivedAt: string;
  readonly isSecret: boolean | null;
  /** How many precedents the customer-memory index holds for this inquiry's own cue. */
  readonly precedentCount: number;
  readonly hasApprovedPastReply: boolean;
}

/**
 * One Channel Knowledge entry as the Operator sees it.
 *
 * `source` and `verifiedAt` ride along deliberately. The Operator can and does quote these to a
 * seller, and a menu label someone half-remembered must not read exactly like a scope requirement
 * proven on a live run — the judge weighs them differently, and so should the answer.
 */
export interface ChannelKnowledgeHit {
  readonly id: string;
  readonly channel: string;
  readonly topic: string;
  readonly kind: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string | null;
  readonly capabilities: string[];
  readonly source: string;
  readonly sourceRef: string;
  readonly verifiedAt: string | null;
}

/** What SellerOps can do with one data type on one channel, composed from the backend's registries. */
export interface ChannelCapabilityAnswer {
  readonly channel: string;
  readonly dataType: string;
  readonly supported: boolean;
  readonly verificationStatus: string | null;
  readonly acquisitionPaths: { method: string; verificationStatus: string; recurrence: string }[];
  readonly apiGaps: string[];
  readonly knowledge: ChannelKnowledgeHit[];
}

export interface CustomerMemorySearchParams {
  /** Derive the cue from this inquiry's own index row — no customer text ever becomes a query string. */
  readonly inquiryId?: string;
  readonly signatureKey?: string;
  readonly topic?: string;
  readonly productId?: string;
  readonly limit?: number;
}

export interface OperatorSpringClient {
  /** The org's inbox summary. `unansweredInquiries` is server-side and uncapped — the canonical number. */
  getInbox(limit?: number): Promise<InboxSummary>;
  /** Resolve a seller's own words ("A상품", a SKU) to candidate products. Best match first. */
  searchProducts(query: string, limit?: number): Promise<ProductSummary[]>;
  /** One product's signals AND the coverage verdict for each source behind them. */
  getProductSignals(productId: string, referenceDate?: string): Promise<ProductSignals>;
  /**
   * Everything SellerOps knows about one product — identity, listings, variants, facts, signals, and
   * the per-facet availability verdict. Kept separate from {@link getProductSignals} so a caller that
   * only needs "what is happening" does not pay for the catalogue, and so a caller that reads the
   * catalogue cannot get it without the coverage rows that qualify it.
   */
  getProductKnowledge(productId: string, referenceDate?: string): Promise<ProductKnowledge>;
  /**
   * A few named facts about one product — the targeted read an information need makes.
   *
   * Accepts a bare name ({@code 길이}) as well as a full key ({@code spec:길이}): a planner names what
   * it wants in the seller's words, and making a need depend on a storage namespace would turn a
   * spelling difference into a silent "규격 정보가 없습니다".
   */
  searchProductFacts(productId: string, factKeys: string[]): Promise<ProductFact[]>;
  /** Precedents for an inquiry (or a closed-vocabulary cue), with the index's coverage verdict. */
  searchCustomerMemory(params: CustomerMemorySearchParams): Promise<CustomerMemorySearch>;
  /** Repeat candidates in a trailing window. */
  listRepeatedInquiries(referenceDate?: string, windowDays?: number): Promise<RepeatedInquiry[]>;
  /** Stored item analyses for this org — the FAQ / 상세페이지 후보 tallies read from their source. */
  listItemAnalyses(): Promise<unknown[]>;
  /**
   * The dashboard rollup. `topProductIssues` is the org's negative reviews grouped by canonical
   * product — the one read that answers "어느 상품에 부정 리뷰가" without being told which product.
   */
  getDashboardSummary(): Promise<DashboardSummary>;
  /** One inquiry's operational context — metadata, product link and past-response summary. No body. */
  getInquiryThreadContext(workItemId: string): Promise<InquiryThreadContext>;

  /**
   * Search platform knowledge about how a sales channel works.
   *
   * Platform knowledge, not seller data: nothing here is scoped to an org, and nothing here is about
   * what this seller sells or what their customers said. Those are Product Knowledge and Customer
   * Operations Memory, and keeping the three apart is what stops one seller's shipping policy being
   * answered from another seller's channel documentation.
   */
  searchChannelKnowledge?(params: {
    query?: string;
    channel?: string;
    topic?: string;
    capability?: string;
    limit?: number;
  }): Promise<ChannelKnowledgeHit[]>;

  /** What SellerOps can do with one data type on one channel — from the registries, not from prose. */
  getChannelCapability?(channel: string, dataType: string): Promise<ChannelCapabilityAnswer>;

  /** What connecting this channel requires, and what to check first when it fails. */
  getConnectionGuidance?(channel: string): Promise<ChannelKnowledgeHit[]>;

  /**
   * Per (seller-visible channel × data type): what that channel can currently say, and why.
   *
   * <b>The read that makes "없습니다" answerable — or refusable.</b> Every other read here returns
   * rows; this one returns the shape of what is MISSING and the reason for it, which is the half of a
   * cross-channel answer that rows cannot supply. A channel with no account is a row here, not an
   * absence, because an omitted channel is counted as a zero by anything that counts what it is given.
   */
  getChannelCoverage?(): Promise<ChannelCoverageRow[]>;

  /**
   * Ask the backend's planner seam to interpret a goal.
   *
   * <b>Optional on the TYPE, mandatory in effect.</b> It stays optional so a client predating the
   * endpoint still type-checks — but a runtime whose client lacks it cannot plan, and Operator Graph v2
   * ends that run FAILED rather than routing it some other way. There is no other way.
   */
  planGoal?(request: {
    goalText: string;
    toolCatalogue: string[];
    /** Re-plan only: need ids and statuses in closed vocabulary. Never evidence, never customer text. */
    priorContext?: string;
  }): Promise<AgentPlanView>;

  /** Ask the backend's judge seam to check one finding. OPTIONAL for the same reason. */
  judgeFinding?(request: { finding: string; evidenceDigest: string }): Promise<AgentJudgeView>;
}
