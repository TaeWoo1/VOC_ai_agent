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
  ConfirmPublishRequest,
  InquiryDetail,
  InquiryQueueResponse,
  ProposalResult,
  PublishCapabilityView,
  PublishStatusView,
  ReplyDraftRequest,
  ReplyDraftView,
} from "./types";

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
export class HttpSpringClient implements SpringClient {
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
