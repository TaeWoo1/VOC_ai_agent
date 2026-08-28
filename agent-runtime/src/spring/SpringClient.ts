/**
 * The boundary to the Spring backend — the system of record.
 *
 * `SpringClient` is the seam every inquiry tool calls. The runtime NEVER talks to a
 * marketplace, a database, or a message bus directly; it only calls these methods, and
 * the backend owns connectors, transactions, idempotency, policy, and audit. Tests
 * inject a FakeSpringClient that mirrors the same contract (status codes + phase
 * transitions), so `npm test` reaches no real backend.
 *
 * Auth: the org is derived from the JWT on the backend (`principal.orgId()`), never
 * passed by the client — so no method here takes an orgId. The HTTP implementation
 * carries a bearer token; obtaining that token (operator login) is out of this slice's
 * scope and is done by the caller.
 */
import type {
  AgentDraftView,
  AgentJudgeView,
  AgentPlanView,
  CustomerMemorySearch,
  DashboardSummary,
  InboxSummary,
  ProductSignals,
  ProductSummary,
  RepeatedInquiry,
  ConfirmPublishRequest,
  InquiryDetail,
  InquiryQueueResponse,
  IssueContext,
  IssueEvidenceSummary,
  IssueTrend,
  ProposalResult,
  PublishCapabilityView,
  PublishStatusView,
  ReplyDraftRequest,
  ReplyDraftView,
  ReviewIssueSummary,
  ReviewReplyApprovalRequest,
  ReviewReplyApprovalResponse,
  ReviewReplyDraftRequest,
  ReviewReplyDraftView,
  ReviewReplyPrepView,
  ReviewReplySubmissionRunRequest,
  ReviewReplySubmissionRunResponse,
  ReviewReplyWorkResponse,
  UserIdentity,
  ProductFact,
  ProductKnowledge,
  ChannelCoverageRow,
  KnowledgeSearchResult,
  ChannelSummary,
  DashboardOverview,
  GeneratedDraftView,
  OrderSummaryParams,
  OrderSummaryResponse,
  RecentReviewsParams,
  RecentReviewsResponse,
  SellerAccountSummary,
  SyncRunParams,
  SyncRunSummary,
  ChannelCapabilityOverview,
  InquiryReplyTransportRow,
  ReviewChannelCapabilityView,
  ManualSyncRequest,
} from "./types";
import type { ListReplyWorkParams, ReviewSpringClient } from "./ReviewSpringClient";
import type { IssueSpringClient, ListReviewIssuesParams } from "./IssueSpringClient";
import type { IdentitySpringClient } from "./IdentitySpringClient";
import type {
  CustomerMemorySearchParams,
  InquiryThreadContext,
  OperatorSpringClient,
  ChannelKnowledgeHit,
  ChannelCapabilityAnswer,
} from "./OperatorSpringClient";

export interface ListInquiriesParams {
  readonly phase?: string;
  readonly page?: number;
  readonly size?: number;
}

export interface SpringClient {
  /** Read-only fail-closed status of the external reply-send path. */
  getPublishCapability(): Promise<PublishCapabilityView>;
  listInquiries(params: ListInquiriesParams): Promise<InquiryQueueResponse>;
  getInquiryDetail(workItemId: string): Promise<InquiryDetail>;
  proposeInquiry(workItemId: string): Promise<ProposalResult>;
  saveDraft(workItemId: string, request: ReplyDraftRequest): Promise<ReplyDraftView>;
  confirmPublish(workItemId: string, request: ConfirmPublishRequest): Promise<PublishStatusView>;
  /**
   * Ask the backend's model seam for a starter reply draft.
   *
   * **OPTIONAL on purpose.** The graph's drafting node must work against a client that does not have
   * it — every test fake, and any deployment whose backend predates the endpoint — and the honest
   * behaviour there is the same one an org outside the allow-list gets: the deterministic rule draft.
   * Making it required would have turned "this backend has no draft endpoint" into a crash instead of
   * a fallback.
   *
   * The runtime holds NO vendor key; this call carries the operator's own bearer, and the backend
   * derives the org from it. That is what keeps the backend the only LLM egress in the repository.
   */
  generateInquiryDraft?(request: { title: string; details: string | null }): Promise<AgentDraftView>;

  /* ── Agentic Operating Workspace v2 (2026-08-27) ── */

  /** The seller's connected accounts (`GET /api/seller-accounts`). Ids and labels; no credential. */
  listSellerAccounts(): Promise<SellerAccountSummary[]>;
  /** Collection run history (`GET /api/sync-runs?…`) — how a paused conversation learns a step finished. */
  listSyncRuns(params: SyncRunParams): Promise<SyncRunSummary[]>;
  /**
   * Ask the backend to PREPARE one reply draft (`POST /api/inquiries/{id}/draft/generate`).
   *
   * A PREPARE, not a WRITE: it saves an append-only draft version and moves nothing toward a channel.
   * Deliberately NOT an Operator tool — the registry stays 100% READ — and reached only from the
   * conversation lane's `DraftPreparer`, on the seller's explicit sentence.
   */
  generateDraftFor(workItemId: string, tone: "SOFTER" | "MORE_FORMAL" | "SHORTER" | null): Promise<GeneratedDraftView>;

  /**
   * The product's own one-press collection (`POST /api/seller-accounts/{accountId}/sync {dataType}`) —
   * `CollectControlService.manualSync`: a synchronous READ of a channel the seller already connected,
   * single-flight and rate-budgeted on the backend.
   *
   * <b>Not an Operator tool and not reachable from the conversation lane except through
   * `conversation/Refresher.ts`</b> (`conversationWriteFence.test.ts` pins the one caller). It is the
   * AUTOMATIC-acquisition half of the freshness decision: a channel whose review rows are stale and whose
   * acquisition is the API is refreshed once, bounded, and the outcome is reported honestly — never
   * retried, never a substitute for a seller's own step.
   */
  manualSync(accountId: string, request: ManualSyncRequest): Promise<SyncRunSummary>;
}

/**
 * A backend error surfaced without leaking a response body. Carries the HTTP status
 * and a coarse code only — never the raw body, which could contain seller content.
 */
export class SpringApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SpringApiError";
  }
}

export interface HttpSpringClientOptions {
  readonly baseUrl: string;
  /** Bearer token for the seated operator. The org is derived from it on the backend. */
  readonly token: string;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Real HTTP adapter over the backend REST API. This is the production wiring; it is NOT
 * exercised by `npm test` (which injects a fake). Live cross-process integration
 * against a running backend is the next step and is intentionally out of this slice.
 */
export class HttpSpringClient
  implements SpringClient, ReviewSpringClient, IssueSpringClient, IdentitySpringClient, OperatorSpringClient
{
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpSpringClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async getPublishCapability(): Promise<PublishCapabilityView> {
    return this.request<PublishCapabilityView>("GET", `/api/inquiry-publish/capability`);
  }

  // --- identity (IdentitySpringClient) ----------------------------------------------
  // Verifies the forwarded bearer at the backend and returns the org derived from the JWT.

  async whoami(): Promise<UserIdentity> {
    const me = await this.request<{ id: string; orgId: string }>("GET", `/api/users/me`);
    return { userId: me.id, orgId: me.orgId };
  }

  async listInquiries(params: ListInquiriesParams): Promise<InquiryQueueResponse> {
    const q = new URLSearchParams();
    if (params.phase) q.set("phase", params.phase);
    if (params.page != null) q.set("page", String(params.page));
    if (params.size != null) q.set("size", String(params.size));
    return this.request<InquiryQueueResponse>("GET", `/api/inquiries?${q.toString()}`);
  }

  async getInquiryDetail(workItemId: string): Promise<InquiryDetail> {
    return this.request<InquiryDetail>("GET", `/api/inquiries/${encodeURIComponent(workItemId)}`);
  }

  async proposeInquiry(workItemId: string): Promise<ProposalResult> {
    return this.request<ProposalResult>(
      "POST",
      `/api/inquiries/${encodeURIComponent(workItemId)}/proposal`,
    );
  }

  async saveDraft(workItemId: string, request: ReplyDraftRequest): Promise<ReplyDraftView> {
    return this.request<ReplyDraftView>(
      "PUT",
      `/api/inquiries/${encodeURIComponent(workItemId)}/draft`,
      request,
    );
  }

  async confirmPublish(
    workItemId: string,
    request: ConfirmPublishRequest,
  ): Promise<PublishStatusView> {
    return this.request<PublishStatusView>(
      "POST",
      `/api/inquiries/${encodeURIComponent(workItemId)}/confirm-publish`,
      request,
    );
  }

  /**
   * The model seam. Takes the two fields that may leave and no id: the runtime already holds the
   * detail (it fetched it through its own authorized tool call), and passing a work-item id would
   * make the endpoint a second reader of inquiry content with its own authorization story to get
   * right. Reads nothing, writes nothing, moves no state.
   */
  async generateInquiryDraft(request: { title: string; details: string | null }): Promise<AgentDraftView> {
    return this.request<AgentDraftView>("POST", `/api/agent/inquiry-draft`, request);
  }

  // --- review-reply domain (ReviewSpringClient) -------------------------------------

  private reviewBase(accountId: string, actionRef: string): string {
    return `/api/seller-accounts/${encodeURIComponent(accountId)}/attention/items/${encodeURIComponent(actionRef)}/reply`;
  }

  async listReplyWork(accountId: string, params: ListReplyWorkParams): Promise<ReviewReplyWorkResponse> {
    const q = new URLSearchParams();
    if (params.todoLimit != null) q.set("todoLimit", String(params.todoLimit));
    if (params.recentLimit != null) q.set("recentLimit", String(params.recentLimit));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.request<ReviewReplyWorkResponse>(
      "GET",
      `/api/seller-accounts/${encodeURIComponent(accountId)}/reply-work${suffix}`,
    );
  }

  async getReviewReplyPrep(accountId: string, actionRef: string): Promise<ReviewReplyPrepView> {
    return this.request<ReviewReplyPrepView>("GET", this.reviewBase(accountId, actionRef));
  }

  async saveReviewDraft(
    accountId: string,
    actionRef: string,
    request: ReviewReplyDraftRequest,
  ): Promise<ReviewReplyDraftView> {
    return this.request<ReviewReplyDraftView>("PUT", `${this.reviewBase(accountId, actionRef)}/draft`, request);
  }

  async recordReviewTriage(
    accountId: string,
    actionRef: string,
    request: { commandId: string; disposition: "RESPONSE_NEEDED" | "MONITOR" | "NO_ACTION" },
  ): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/api/seller-accounts/${encodeURIComponent(accountId)}/attention/items/${encodeURIComponent(actionRef)}/triage`,
      request,
    );
  }

  async decideReviewApproval(
    accountId: string,
    actionRef: string,
    request: ReviewReplyApprovalRequest,
  ): Promise<ReviewReplyApprovalResponse> {
    return this.request<ReviewReplyApprovalResponse>(
      "POST",
      `${this.reviewBase(accountId, actionRef)}/approval`,
      request,
    );
  }

  async startReviewSubmissionRun(
    accountId: string,
    actionRef: string,
    request: ReviewReplySubmissionRunRequest,
  ): Promise<ReviewReplySubmissionRunResponse> {
    return this.request<ReviewReplySubmissionRunResponse>(
      "POST",
      `${this.reviewBase(accountId, actionRef)}/submission-run`,
      request,
    );
  }

  // --- review-issue-memory domain (IssueSpringClient) -------------------------------
  // All GET, all read-only. The subgraph never calls the mutating issue endpoints
  // (/extract, /lifecycle-pass, /acting, /remediated, /dismiss, /restore).

  async searchReviewIssues(params: ListReviewIssuesParams): Promise<ReviewIssueSummary[]> {
    const q = new URLSearchParams();
    if (params.referenceDate) q.set("referenceDate", params.referenceDate);
    if (params.dismissed != null) q.set("dismissed", String(params.dismissed));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.request<ReviewIssueSummary[]>("GET", `/api/review-issues${suffix}`);
  }

  async getIssueContext(issueId: string, referenceDate?: string): Promise<IssueContext> {
    const suffix = referenceDate ? `?referenceDate=${encodeURIComponent(referenceDate)}` : "";
    return this.request<IssueContext>(
      "GET",
      `/api/review-issues/${encodeURIComponent(issueId)}/context${suffix}`,
    );
  }

  async getIssueEvidenceSummary(issueId: string): Promise<IssueEvidenceSummary> {
    return this.request<IssueEvidenceSummary>(
      "GET",
      `/api/review-issues/${encodeURIComponent(issueId)}/evidence-summary`,
    );
  }

  async getIssueTrend(issueId: string, referenceDate?: string): Promise<IssueTrend> {
    const suffix = referenceDate ? `?referenceDate=${encodeURIComponent(referenceDate)}` : "";
    return this.request<IssueTrend>(
      "GET",
      `/api/review-issues/${encodeURIComponent(issueId)}/trend${suffix}`,
    );
  }

  // ─────────────────────────── Operator domain (all READ) ───────────────────────────
  // Every one of these maps onto an existing endpoint, and none of them mutates anything. The two
  // model seams below (plan/judge) look nothing up and store nothing either — they are the same
  // shape as generateInquiryDraft: the runtime holds no vendor key, so a model call is one more
  // backend capability reached with the operator's own forwarded bearer.

  async getInbox(limit?: number): Promise<InboxSummary> {
    const suffix = limit != null ? `?limit=${encodeURIComponent(String(limit))}` : "";
    return this.request<InboxSummary>("GET", `/api/inbox${suffix}`);
  }

  async searchProducts(query: string, limit?: number): Promise<ProductSummary[]> {
    const q = new URLSearchParams();
    if (query) q.set("q", query);
    if (limit != null) q.set("limit", String(limit));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.request<ProductSummary[]>("GET", `/api/products${suffix}`);
  }

  async getProductSignals(productId: string, referenceDate?: string): Promise<ProductSignals> {
    const suffix = referenceDate ? `?referenceDate=${encodeURIComponent(referenceDate)}` : "";
    return this.request<ProductSignals>(
      "GET",
      `/api/products/${encodeURIComponent(productId)}/signals${suffix}`,
    );
  }

  async getProductKnowledge(productId: string, referenceDate?: string): Promise<ProductKnowledge> {
    const suffix = referenceDate ? `?referenceDate=${encodeURIComponent(referenceDate)}` : "";
    return this.request<ProductKnowledge>(
      "GET",
      `/api/products/${encodeURIComponent(productId)}/knowledge${suffix}`,
    );
  }

  async searchProductFacts(productId: string, factKeys: string[]): Promise<ProductFact[]> {
    const q = new URLSearchParams();
    for (const key of factKeys) {
      if (key && key.trim().length > 0) q.append("keys", key.trim());
    }
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.request<ProductFact[]>(
      "GET",
      `/api/products/${encodeURIComponent(productId)}/facts${suffix}`,
    );
  }

  async getInquiryThreadContext(workItemId: string): Promise<InquiryThreadContext> {
    return this.request<InquiryThreadContext>(
      "GET",
      `/api/inquiries/${encodeURIComponent(workItemId)}/context`,
    );
  }

  async searchCustomerMemory(params: CustomerMemorySearchParams): Promise<CustomerMemorySearch> {
    const q = new URLSearchParams();
    if (params.inquiryId) q.set("inquiryId", params.inquiryId);
    if (params.signatureKey) q.set("signatureKey", params.signatureKey);
    if (params.topic) q.set("topic", params.topic);
    if (params.productId) q.set("productId", params.productId);
    if (params.limit != null) q.set("limit", String(params.limit));
    return this.request<CustomerMemorySearch>("GET", `/api/customer-memory/search?${q.toString()}`);
  }

  async listRepeatedInquiries(referenceDate?: string, windowDays?: number): Promise<RepeatedInquiry[]> {
    const q = new URLSearchParams();
    if (referenceDate) q.set("referenceDate", referenceDate);
    if (windowDays != null) q.set("windowDays", String(windowDays));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.request<RepeatedInquiry[]>("GET", `/api/customer-memory/repeats${suffix}`);
  }

  async listItemAnalyses(): Promise<unknown[]> {
    return this.request<unknown[]>("GET", `/api/item-analysis`);
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    return this.request<DashboardSummary>("GET", `/api/dashboard/summary`);
  }

  async searchChannelKnowledge(params: {
    query?: string;
    channel?: string;
    topic?: string;
    capability?: string;
    limit?: number;
  }): Promise<ChannelKnowledgeHit[]> {
    const q = new URLSearchParams();
    if (params.query) q.set("q", params.query);
    if (params.channel) q.set("channel", params.channel);
    if (params.topic) q.set("topic", params.topic);
    if (params.capability) q.set("capability", params.capability);
    if (params.limit != null) q.set("limit", String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.request<ChannelKnowledgeHit[]>("GET", `/api/channel-knowledge/search${suffix}`);
  }

  async getChannelCapability(channel: string, dataType: string): Promise<ChannelCapabilityAnswer> {
    return this.request<ChannelCapabilityAnswer>(
      "GET",
      `/api/channel-knowledge/channels/${encodeURIComponent(channel)}/capabilities/${encodeURIComponent(dataType)}`,
    );
  }

  async getConnectionGuidance(channel: string): Promise<ChannelKnowledgeHit[]> {
    return this.request<ChannelKnowledgeHit[]>(
      "GET",
      `/api/channel-knowledge/channels/${encodeURIComponent(channel)}/connection`,
    );
  }

  async getChannelCoverage(): Promise<ChannelCoverageRow[]> {
    return this.request<ChannelCoverageRow[]>("GET", `/api/channels/coverage`);
  }

  /**
   * The seller's own writing about one product, narrowed to the passages that answer `query`.
   *
   * <b>Retrieval is scoped to one product and the backend enforces it.</b> The corpus is small by
   * construction, which is why there is no index to keep warm and why the same question returns the
   * same passages on every run — reproducibility an answer's evidence depends on.
   */
  async searchProductKnowledge(
    productId: string,
    query: string,
    limit?: number,
  ): Promise<KnowledgeSearchResult> {
    const params = new URLSearchParams({ query });
    if (limit && limit > 0) params.set("limit", String(limit));
    return this.request<KnowledgeSearchResult>(
      "GET",
      `/api/products/${encodeURIComponent(productId)}/knowledge/search?${params.toString()}`,
    );
  }

  // ─────────────── Agentic Operating Workspace v2 (2026-08-27) ───────────────

  async listRecentReviews(params: RecentReviewsParams): Promise<RecentReviewsResponse> {
    const q = new URLSearchParams();
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.negativeOnly != null) q.set("negativeOnly", String(params.negativeOnly));
    if (params.channel) q.set("channel", params.channel);
    if (params.productId) q.set("productId", params.productId);
    if (params.size != null) q.set("size", String(params.size));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.request<RecentReviewsResponse>("GET", `/api/reviews/recent${suffix}`);
  }

  async getDashboardOverview(days: number): Promise<DashboardOverview> {
    return this.request<DashboardOverview>("GET", `/api/dashboard/overview?days=${encodeURIComponent(String(days))}`);
  }

  async getOrdersSummary(params: OrderSummaryParams): Promise<OrderSummaryResponse> {
    const q = new URLSearchParams();
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.channelId) q.set("channelId", params.channelId);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.request<OrderSummaryResponse>("GET", `/api/orders/summary${suffix}`);
  }

  async listChannels(): Promise<ChannelSummary[]> {
    return this.request<ChannelSummary[]>("GET", `/api/channels`);
  }

  async listSellerAccounts(): Promise<SellerAccountSummary[]> {
    return this.request<SellerAccountSummary[]>("GET", `/api/seller-accounts`);
  }

  async listSyncRuns(params: SyncRunParams): Promise<SyncRunSummary[]> {
    const q = new URLSearchParams();
    if (params.sellerAccountId) q.set("sellerAccountId", params.sellerAccountId);
    if (params.channelId) q.set("channelId", params.channelId);
    if (params.dataType) q.set("dataType", params.dataType);
    if (params.status) q.set("status", params.status);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.request<SyncRunSummary[]>("GET", `/api/sync-runs${suffix}`);
  }

  async manualSync(accountId: string, request: ManualSyncRequest): Promise<SyncRunSummary> {
    return this.request<SyncRunSummary>(
      "POST",
      `/api/seller-accounts/${encodeURIComponent(accountId)}/sync`,
      request,
    );
  }

  async getChannelCapabilityOverview(channelCode: string): Promise<ChannelCapabilityOverview> {
    return this.request<ChannelCapabilityOverview>(
      "GET",
      `/api/channels/${encodeURIComponent(channelCode)}/capabilities/overview`,
    );
  }

  async listInquiryReplyTransports(): Promise<InquiryReplyTransportRow[]> {
    return this.request<InquiryReplyTransportRow[]>("GET", `/api/inquiry-publish/transports`);
  }

  async getReviewChannelCapability(accountId: string): Promise<ReviewChannelCapabilityView> {
    // One page of size 1 is the smallest read that carries the `channel` block; the rows are dropped
    // here so nothing review-shaped leaves the transport for a capability question.
    const page = await this.request<{ channel: ReviewChannelCapabilityView }>(
      "GET",
      `/api/seller-accounts/${encodeURIComponent(accountId)}/channel-reviews?page=0&size=1`,
    );
    return page.channel;
  }

  async generateDraftFor(
    workItemId: string,
    tone: "SOFTER" | "MORE_FORMAL" | "SHORTER" | null,
  ): Promise<GeneratedDraftView> {
    // The body is sent only when a tone was asked for: the no-body caller is the existing screen.
    return this.request<GeneratedDraftView>(
      "POST",
      `/api/inquiries/${encodeURIComponent(workItemId)}/draft/generate`,
      tone ? { tone } : undefined,
    );
  }

  async planGoal(request: {
    goalText: string;
    toolCatalogue: string[];
    priorContext?: string;
    runId?: string;
  }): Promise<AgentPlanView> {
    return this.request<AgentPlanView>("POST", `/api/agent/plan`, request);
  }

  async judgeFinding(request: {
    finding: string;
    evidenceDigest: string;
    runId?: string;
  }): Promise<AgentJudgeView> {
    return this.request<AgentJudgeView>("POST", `/api/agent/judge`, request);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      // Never echo the response body — it may carry seller content. Status + a coarse
      // code label only.
      throw new SpringApiError(res.status, `HTTP_${res.status}`, `backend request failed (${method} ${path})`);
    }
    return (await res.json()) as T;
  }
}
