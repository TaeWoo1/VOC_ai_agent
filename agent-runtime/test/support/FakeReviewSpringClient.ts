/**
 * A contract-faithful in-memory stand-in for the Spring review-reply backend.
 *
 * It mirrors the endpoints the review subgraph uses AND the invariants the runtime relies on:
 *  - listReplyWork: the RESPONSE_NEEDED worklist (todo), metadata only;
 *  - getReviewReplyPrep: redacted body + a deterministic rule-based suggestion body + the
 *    current draft/approval + server-computed capabilities;
 *  - saveReviewDraft: append-only versions, deterministic fingerprint, optimistic concurrency
 *    with an exact-retry idempotence, gated on RESPONSE_NEEDED + not-frozen;
 *  - decideReviewApproval: binds (version, fingerprint), idempotent by commandId (a replay of
 *    the same command+version returns replayed=true; a different one is a 409), gated on a
 *    saved draft + RESPONSE_NEEDED + baseVersion==head;
 *  - startReviewSubmissionRun: mints a FRESH ref on EVERY call (matching the backend — single
 *    use is enforced at record time, not here), so `mintCount` is a real signal the runtime's
 *    DONE-guard mints exactly once across double/restart resume.
 *
 * There is no send method, mirroring the real surface. `getPublishCapability` ties to the
 * same fail-closed flag as the inquiry backend.
 */
import { createHash } from "node:crypto";
import type {
  PublishCapabilityView,
  ReviewReplyApprovalRequest,
  ReviewReplyApprovalResponse,
  ReviewReplyApprovalView,
  ReviewReplyCapabilities,
  ReviewReplyDraftRequest,
  ReviewReplyDraftView,
  ReviewReplyPrepView,
  ReviewReplySubmissionRunRequest,
  ReviewReplySubmissionRunResponse,
  ReviewReplySuggestionView,
  ReviewReplyWorkResponse,
  ReviewWorkItem,
} from "../../src/spring/types";
import { SpringApiError } from "../../src/spring/SpringClient";
import type { ListReplyWorkParams, ReviewSpringClient } from "../../src/spring/ReviewSpringClient";

export interface SeedReview {
  readonly actionRef: string; // "review:<uuid>"
  readonly rating: number; // 1..5
  readonly body: string; // review content (redacted-equivalent for the fake)
  readonly sourceCreatedDate: string | null; // KST date-only
  readonly productName?: string | null;
  readonly channelReplyState?: string; // PENDING | ANSWERED | UNKNOWN; default PENDING
  readonly disposition?: string; // default RESPONSE_NEEDED
  readonly channelReviewIdFingerprint?: string | null;
}

interface DraftRow {
  version: number;
  body: string;
  contentFingerprint: string;
  createdAt: string;
}
interface ApprovalRow {
  state: "APPROVED" | "WITHDRAWN";
  approvedVersion: number | null;
  approvedFingerprint: string | null;
  decidedAt: string;
}
interface ReviewState {
  readonly seed: SeedReview;
  disposition: string;
  drafts: DraftRow[];
  approval: ApprovalRow | null;
}

function fingerprint(body: string): string {
  return createHash("sha256").update(JSON.stringify(["review-reply-v1", body.trim()])).digest("hex").slice(0, 16);
}

function bodyFingerprint(body: string): string {
  return createHash("sha256").update(JSON.stringify(["review-body-fingerprint/v1", body.trim()])).digest("hex").slice(0, 16);
}

/** Deterministic, keyword/rating-driven suggestion — stands in for the backend's rule provider. */
function suggest(body: string, rating: number | null): ReviewReplySuggestionView {
  const low = rating != null && rating <= 2;
  const category = low ? "apology_recovery" : "appreciation";
  const text = low
    ? "안녕하세요, 불편을 드려 죄송합니다. 말씀해 주신 내용을 확인하여 빠르게 개선하겠습니다."
    : "안녕하세요, 소중한 후기 감사합니다. 앞으로도 좋은 상품과 서비스로 보답하겠습니다.";
  void body;
  return { body: text, category, providerKind: "RULE_BASED", providerName: "rule-review-drafter", providerVersion: "rules-v1" };
}

export class FakeReviewSpringClient implements ReviewSpringClient {
  private readonly reviews = new Map<string, ReviewState>();
  /** commandId -> the effect it applied (org-wide, mirrors the audit UNIQUE key). */
  private readonly approvalAudit = new Map<string, { reviewRef: string; state: string; version: number | null }>();
  /** Every minted submission ref, in order — mintCount === submissionRefs.length. */
  readonly submissionRefs: string[] = [];
  /** Standing invariant: the runtime must never cause an external send. */
  externalSendAttempts = 0;
  readonly calls = { list: 0, prep: 0, saveDraft: 0, approve: 0, submissionRun: 0 };
  private mintSeq = 0;

  private readonly dispatchAdapterEnabled: boolean;

  constructor(seeds: readonly SeedReview[] = [], opts: { dispatchAdapterEnabled?: boolean } = {}) {
    this.dispatchAdapterEnabled = opts.dispatchAdapterEnabled ?? false;
    for (const s of seeds) {
      this.reviews.set(s.actionRef, {
        seed: s,
        disposition: s.disposition ?? "RESPONSE_NEEDED",
        drafts: [],
        approval: null,
      });
    }
  }

  get mintCount(): number {
    return this.submissionRefs.length;
  }

  async getPublishCapability(): Promise<PublishCapabilityView> {
    return this.dispatchAdapterEnabled
      ? { executionEnabled: true, replyAdapterChannelCodes: ["MOCK"] }
      : { executionEnabled: false, replyAdapterChannelCodes: [] };
  }

  private require(actionRef: string): ReviewState {
    const it = this.reviews.get(actionRef);
    if (!it) throw new SpringApiError(404, "NOT_FOUND", "해당 항목을 찾을 수 없습니다.");
    return it;
  }

  private head(it: ReviewState): DraftRow | null {
    return it.drafts.length ? it.drafts[it.drafts.length - 1]! : null;
  }

  private isApproved(it: ReviewState): boolean {
    return it.approval?.state === "APPROVED";
  }

  private capabilities(it: ReviewState): ReviewReplyCapabilities {
    const responseNeeded = it.disposition === "RESPONSE_NEEDED";
    const approved = this.isApproved(it);
    const channelAnswered = (it.seed.channelReplyState ?? "PENDING") === "ANSWERED";
    return {
      canSave: responseNeeded && !approved,
      canApprove: responseNeeded && !approved && this.head(it) != null,
      canWithdraw: approved,
      canCopy: responseNeeded && approved,
      canStartSubmissionRun: responseNeeded && approved && !channelAnswered,
    };
  }

  async listReplyWork(_accountId: string, params: ListReplyWorkParams): Promise<ReviewReplyWorkResponse> {
    this.calls.list += 1;
    const todo: ReviewWorkItem[] = [...this.reviews.values()]
      .filter((it) => it.disposition === "RESPONSE_NEEDED")
      .map((it) => ({
        actionRef: it.seed.actionRef,
        channelCode: "cafe24",
        channelNameKo: "카페24",
        sourceType: "REVIEW",
        productName: it.seed.productName ?? null,
        rating: it.seed.rating,
        replyStatus: it.seed.channelReplyState ?? "PENDING",
        sourceCreatedDate: it.seed.sourceCreatedDate,
        triageDisposition: "RESPONSE_NEEDED",
        hasReplyPreparation: it.drafts.length > 0 || it.approval != null,
      }))
      .slice(0, params.todoLimit ?? 50);
    return { sellerAccountId: "acct", channel: "카페24", coverage: "OK", todo, recentlyReported: [] };
  }

  async getReviewReplyPrep(_accountId: string, actionRef: string): Promise<ReviewReplyPrepView> {
    this.calls.prep += 1;
    const it = this.require(actionRef);
    const head = this.head(it);
    const draft: ReviewReplyDraftView | null = head
      ? { version: head.version, body: head.body, contentFingerprint: head.contentFingerprint, fingerprintAlgorithm: "sha256-16", createdAt: head.createdAt }
      : null;
    const approval: ReviewReplyApprovalView | null = it.approval
      ? {
          state: it.approval.state,
          approvedVersion: it.approval.approvedVersion,
          approvedFingerprint: it.approval.approvedFingerprint,
          body: this.isApproved(it) && this.capabilities(it).canCopy && it.approval.approvedVersion != null
            ? it.drafts.find((d) => d.version === it.approval!.approvedVersion)?.body ?? null
            : null,
          decidedAt: it.approval.decidedAt,
        }
      : null;
    return {
      actionRef,
      redactedBody: it.seed.body,
      bodyRedacted: false,
      triageDisposition: it.disposition,
      suggestion: suggest(it.seed.body, it.seed.rating),
      draft,
      approval,
      capabilities: this.capabilities(it),
      channelReviewIdFingerprint: it.seed.channelReviewIdFingerprint ?? "idfp-" + fingerprint(actionRef),
      rating: it.seed.rating,
      channelReplyState: it.seed.channelReplyState ?? "PENDING",
      productName: it.seed.productName ?? null,
      reviewDate: it.seed.sourceCreatedDate,
    };
  }

  async saveReviewDraft(_accountId: string, actionRef: string, request: ReviewReplyDraftRequest): Promise<ReviewReplyDraftView> {
    this.calls.saveDraft += 1;
    const it = this.require(actionRef);
    if (it.disposition !== "RESPONSE_NEEDED") throw new SpringApiError(409, "CONFLICT", "'대응 필요' 리뷰만 초안을 준비할 수 있습니다.");
    if (this.isApproved(it)) throw new SpringApiError(409, "CONFLICT", "승인된 초안은 수정할 수 없습니다.");
    if (request.body.trim().length === 0) throw new SpringApiError(400, "BAD_REQUEST", "답변 내용을 입력하세요.");

    const fp = fingerprint(request.body);
    const head = this.head(it);
    const headVersion = head ? head.version : 0;
    // Idempotent replay/no-op: content already the head, base is head or head-1.
    if (head && head.contentFingerprint === fp && (request.baseVersion === headVersion || request.baseVersion === headVersion - 1)) {
      return { version: head.version, body: head.body, contentFingerprint: head.contentFingerprint, fingerprintAlgorithm: "sha256-16", createdAt: head.createdAt };
    }
    if (request.baseVersion !== headVersion) throw new SpringApiError(409, "CONFLICT", "이미 최신 초안이 있습니다.");
    const row: DraftRow = { version: headVersion + 1, body: request.body, contentFingerprint: fp, createdAt: "2026-01-01T00:00:00Z" };
    it.drafts.push(row);
    return { version: row.version, body: row.body, contentFingerprint: row.contentFingerprint, fingerprintAlgorithm: "sha256-16", createdAt: row.createdAt };
  }

  async decideReviewApproval(_accountId: string, actionRef: string, request: ReviewReplyApprovalRequest): Promise<ReviewReplyApprovalResponse> {
    this.calls.approve += 1;
    if (!request.commandId) throw new SpringApiError(400, "BAD_REQUEST", "commandId가 필요합니다.");
    const it = this.require(actionRef);

    // Idempotency: a spent command replays if the effect matches, else 409.
    const prior = this.approvalAudit.get(request.commandId);
    if (prior) {
      const bound = request.state === "APPROVED" ? request.baseVersion ?? null : null;
      if (prior.reviewRef !== actionRef || prior.state !== request.state || prior.version !== bound) {
        throw new SpringApiError(409, "CONFLICT", "commandId가 이미 다른 결정에 사용되었습니다.");
      }
      return { actionRef, state: it.approval?.state ?? request.state, replayed: true };
    }

    if (request.state === "WITHDRAWN") {
      if (!this.isApproved(it)) throw new SpringApiError(409, "CONFLICT", "승인된 초안이 없습니다.");
      it.approval = { state: "WITHDRAWN", approvedVersion: null, approvedFingerprint: null, decidedAt: "2026-01-01T00:00:00Z" };
      this.approvalAudit.set(request.commandId, { reviewRef: actionRef, state: "WITHDRAWN", version: null });
      return { actionRef, state: "WITHDRAWN", replayed: false };
    }

    // APPROVED
    if (it.disposition !== "RESPONSE_NEEDED") throw new SpringApiError(409, "CONFLICT", "'대응 필요' 리뷰만 승인할 수 있습니다.");
    if (this.isApproved(it)) throw new SpringApiError(409, "CONFLICT", "승인된 초안은 수정할 수 없습니다.");
    if (request.baseVersion == null) throw new SpringApiError(400, "BAD_REQUEST", "승인할 초안 버전이 필요합니다.");
    const bound = it.drafts.find((d) => d.version === request.baseVersion);
    if (!bound) throw new SpringApiError(409, "CONFLICT", "승인할 초안이 없습니다.");
    const head = this.head(it)!;
    if (request.baseVersion !== head.version) throw new SpringApiError(409, "CONFLICT", "이미 최신 초안이 있습니다.");

    it.approval = { state: "APPROVED", approvedVersion: bound.version, approvedFingerprint: bound.contentFingerprint, decidedAt: "2026-01-01T00:00:00Z" };
    this.approvalAudit.set(request.commandId, { reviewRef: actionRef, state: "APPROVED", version: bound.version });
    return { actionRef, state: "APPROVED", replayed: false };
  }

  async startReviewSubmissionRun(_accountId: string, actionRef: string, request: ReviewReplySubmissionRunRequest): Promise<ReviewReplySubmissionRunResponse> {
    this.calls.submissionRun += 1;
    const it = this.require(actionRef);
    if (it.disposition !== "RESPONSE_NEEDED") throw new SpringApiError(409, "CONFLICT", "'대응 필요' 리뷰만 제출을 시작할 수 있습니다.");
    if ((it.seed.channelReplyState ?? "PENDING") === "ANSWERED") throw new SpringApiError(409, "CONFLICT", "채널에 이미 답변이 등록된 리뷰입니다.");
    if (!this.isApproved(it) || it.approval?.approvedVersion == null) throw new SpringApiError(409, "CONFLICT", "승인된 답변이 없습니다.");

    let targetHint: ReviewReplySubmissionRunResponse["targetHint"] = null;
    let asOfDate: string | null = null;
    if (request.requireTargetHint) {
      const rating = it.seed.rating;
      const body = it.seed.body;
      if (rating < 1 || rating > 5 || body.trim().length === 0) {
        throw new SpringApiError(409, "CONFLICT", "이 리뷰로는 제출 대상 힌트를 만들 수 없습니다.");
      }
      targetHint = { rating, recencyBucket: "PAST_30_DAYS", bodyFingerprint: bodyFingerprint(body) };
      asOfDate = "2026-01-01";
    }
    // Mint a FRESH ref on every call — single use is enforced at record time, not here.
    this.mintSeq += 1;
    const ref = createHash("sha256").update(`${actionRef}:${this.mintSeq}`).digest("hex").slice(0, 16);
    this.submissionRefs.push(ref);
    return { actionRef, submissionRef: ref, approvedVersion: it.approval!.approvedVersion, targetHint, asOfDate };
  }

  // Test helpers.
  dispositionOf(actionRef: string): string {
    return this.require(actionRef).disposition;
  }
  approvalStateOf(actionRef: string): string | null {
    return this.require(actionRef).approval?.state ?? null;
  }
  draftVersionsOf(actionRef: string): number[] {
    return this.require(actionRef).drafts.map((d) => d.version);
  }
}
