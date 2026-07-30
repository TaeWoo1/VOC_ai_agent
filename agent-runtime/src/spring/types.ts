/**
 * TypeScript mirrors of the Spring backend's inquiry DTOs (the JSON shapes the REST
 * endpoints return / accept). These are the wire contract only — the backend remains
 * the system of record; the runtime never re-implements any domain rule, it only
 * shuttles these shapes across the boundary.
 *
 * Kept deliberately narrow to the fields the vertical slice uses. `Instant` serializes
 * as an ISO-8601 string over HTTP, so it is typed `string` here.
 */

/** One row of GET /api/inquiries (sanitized: no buyer identity, no raw body). */
export interface InquiryQueueItem {
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly sellerAccountId: string;
  readonly channelId: string;
  readonly phase: string;
  readonly status: string;
  readonly title: string;
  readonly receivedAt: string;
}

/** GET /api/inquiries page envelope. */
export interface InquiryQueueResponse {
  readonly content: InquiryQueueItem[];
  readonly page: number;
  readonly size: number;
  readonly totalElements: number;
  readonly totalPages: number;
}

/** Sanitized proposal view (coarse category + provider provenance; no body). */
export interface ProposalView {
  readonly proposalId: string;
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly actionKind: string;
  readonly summaryCategory: string;
  readonly requiresApproval: boolean;
  readonly proposedBy: string;
  readonly providerKind: string;
  readonly providerName: string;
  readonly providerVersion: string;
}

/** Result of POST /api/inquiries/{id}/proposal (OPEN -> PROPOSED, idempotent). */
export interface ProposalResult {
  readonly workItemId: string;
  readonly phase: string;
  readonly proposal: ProposalView;
}

/**
 * GET /api/inquiries/{id} — seller-owned operational detail. `title`/`details` ARE the
 * seller's own content (not buyer identity), so they are present here; the runtime must
 * keep them in memory and out of every log line (see {@link ../log}).
 */
export interface InquiryDetail {
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly sellerAccountId: string;
  readonly channelId: string;
  readonly phase: string;
  readonly status: string;
  readonly informStatus: string | null;
  readonly title: string;
  readonly details: string | null;
  readonly receivedAt: string;
  readonly proposal: ProposalView | null;
  readonly draft: ReplyDraftView | null;
}

/** PUT /api/inquiries/{id}/draft request. */
export interface ReplyDraftRequest {
  readonly title: string;
  readonly comments: string;
  readonly baseVersion: number;
}

/** Current reply-draft view; `contentFingerprint` later binds the approval. */
export interface ReplyDraftView {
  readonly version: number;
  readonly answerStatus: number;
  readonly title: string;
  readonly comments: string;
  readonly contentFingerprint: string;
  readonly fingerprintAlgorithm: string;
  readonly createdAt: string;
}

/** POST /api/inquiries/{id}/confirm-publish request. */
export interface ConfirmPublishRequest {
  readonly commandId: string;
  readonly expectedFingerprint: string;
}

/**
 * GET /api/inquiry-publish/capability — read-only fail-closed status. `executionEnabled`
 * false + empty `replyAdapterChannelCodes` is the guarantee that confirm-publish
 * dispatches nothing (no external reply is sent). No secret.
 */
export interface PublishCapabilityView {
  readonly executionEnabled: boolean;
  readonly replyAdapterChannelCodes: string[];
}

/**
 * POST /api/inquiries/{id}/confirm-publish result. With live execution disabled and no
 * channel reply adapter registered (the fail-closed default), the backend records the
 * approval and creates the ACTION_PENDING intent but dispatches nothing — so
 * `executionStatus` stays `ACTION_PENDING` and no external reply is ever sent.
 */
export interface PublishStatusView {
  readonly workItemId: string;
  readonly phase: string;
  readonly executionStatus: string | null;
  readonly category: string;
  readonly approvedDraftVersion: number | null;
  readonly approvedFingerprint: string | null;
  readonly providerMessageNo: string | null;
  readonly resultCode: number | null;
}
