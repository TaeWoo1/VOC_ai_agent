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
} from "./types";
import type { ListReplyWorkParams, ReviewSpringClient } from "./ReviewSpringClient";
import type { IssueSpringClient, ListReviewIssuesParams } from "./IssueSpringClient";
import type { IdentitySpringClient } from "./IdentitySpringClient";
import type {
  CustomerMemorySearchParams,
  InquiryThreadContext,
  OperatorSpringClient,
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

  async getDashboardSummary(): Promise<{ topProductIssues?: unknown[] }> {
    return this.request<{ topProductIssues?: unknown[] }>("GET", `/api/dashboard/summary`);
  }

  async planGoal(request: {
    goalText: string;
    toolCatalogue: string[];
    priorContext?: string;
  }): Promise<AgentPlanView> {
    return this.request<AgentPlanView>("POST", `/api/agent/plan`, request);
  }

  async judgeFinding(request: { finding: string; evidenceDigest: string }): Promise<AgentJudgeView> {
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
