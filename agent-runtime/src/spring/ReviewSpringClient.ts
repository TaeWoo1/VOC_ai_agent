/**
 * The boundary to the Spring backend for the review-reply domain — a sibling of
 * {@link SpringClient} kept deliberately separate so the merged inquiry surface (and its
 * FakeSpringClient) is untouched. Every method maps onto ONE existing review-reply
 * endpoint under `/api/seller-accounts/{accountId}/attention/items/{actionRef}/reply`,
 * plus the account-scoped reply-work worklist and the global publish-capability read.
 *
 * The backend owns all review-reply domain rules (version binding, approval idempotency,
 * the single-use submission ref, audit). The runtime only shuttles these shapes.
 *
 * <b>There is no send method, because there is no send endpoint.</b> The review-reply
 * surface offers nothing that dispatches to a marketplace — no-send is structural here,
 * not a config flag. `getPublishCapability` is reused only as a defence-in-depth
 * fail-closed check that no reply adapter is registered anywhere.
 */
import type {
  PublishCapabilityView,
  ReviewReplyApprovalRequest,
  ReviewReplyApprovalResponse,
  ReviewReplyDraftRequest,
  ReviewReplyDraftView,
  ReviewReplyPrepView,
  ReviewReplySubmissionRunRequest,
  ReviewReplySubmissionRunResponse,
  ReviewReplyWorkResponse,
} from "./types";

export interface ListReplyWorkParams {
  readonly todoLimit?: number;
  readonly recentLimit?: number;
}

export interface ReviewSpringClient {
  /** Read-only fail-closed status of the external reply-send path (global). */
  getPublishCapability(): Promise<PublishCapabilityView>;
  /** The operator's committed reply worklist (RESPONSE_NEEDED reviews) for one account. */
  listReplyWork(accountId: string, params: ListReplyWorkParams): Promise<ReviewReplyWorkResponse>;
  /** Full reply-preparation context for one review (redacted body, suggestion, draft, approval). */
  getReviewReplyPrep(accountId: string, actionRef: string): Promise<ReviewReplyPrepView>;
  /** Save an append-only reply-draft version; returns the version + content fingerprint. */
  saveReviewDraft(
    accountId: string,
    actionRef: string,
    request: ReviewReplyDraftRequest,
  ): Promise<ReviewReplyDraftView>;
  /** Approve (or withdraw) the current draft; idempotent by commandId. */
  decideReviewApproval(
    accountId: string,
    actionRef: string,
    request: ReviewReplyApprovalRequest,
  ): Promise<ReviewReplyApprovalResponse>;
  /** Mint a single-use guided reply-submission ref bound to the approved head. NEVER a send. */
  startReviewSubmissionRun(
    accountId: string,
    actionRef: string,
    request: ReviewReplySubmissionRunRequest,
  ): Promise<ReviewReplySubmissionRunResponse>;
}
