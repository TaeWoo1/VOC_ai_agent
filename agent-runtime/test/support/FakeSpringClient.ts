/**
 * A contract-faithful in-memory stand-in for the Spring backend.
 *
 * It mirrors the endpoints the slice uses AND the invariants the runtime relies on:
 *  - propose: OPEN -> PROPOSED, idempotent replay;
 *  - saveDraft: append-only versions on a PROPOSED item, deterministic fingerprint,
 *    optimistic-concurrency with an exact-retry idempotence;
 *  - confirmPublish: binds the approval (records an APPROVAL_GRANTED audit, deduped by
 *    (workItemId, commandId)), moves to ACTION_PENDING, and — fail closed, no channel
 *    adapter — dispatches NOTHING (`externalSendAttempts` stays 0). A replay with the
 *    same commandId+fingerprint is idempotent; a different commandId is a 409.
 *
 * This lets `npm test` exercise the whole graph without a real backend, and lets the
 * tests assert the audit/idempotency/no-send guarantees directly.
 */
import { createHash } from "node:crypto";
import type { SpringClient, ListInquiriesParams } from "../../src/spring/SpringClient";
import { SpringApiError } from "../../src/spring/SpringClient";
import type {
  ConfirmPublishRequest,
  InquiryDetail,
  InquiryQueueItem,
  InquiryQueueResponse,
  ProposalResult,
  PublishCapabilityView,
  PublishStatusView,
  ReplyDraftRequest,
  ReplyDraftView,
} from "../../src/spring/types";

export interface AuditRecord {
  readonly workItemId: string;
  readonly commandId: string;
  readonly event: string;
  readonly phaseFrom: string | null;
  readonly phaseTo: string;
  readonly actor: string;
}

export interface SeedInquiry {
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly sellerAccountId: string;
  readonly channelId: string;
  readonly title: string;
  readonly details: string;
  readonly receivedAt: string; // ISO-8601
  readonly status?: string; // canonical status; defaults UNANSWERED
  readonly channelCode?: string | null; // resolved catalog label; defaults null
  readonly channelNameKo?: string | null; // resolved catalog label; defaults null
  readonly isSecret?: boolean | null; // Cafe24 비밀글 flag; defaults null (unclassified)
}

interface ItemState {
  phase: string;
  status: string;
  informStatus: string | null;
  readonly seed: SeedInquiry;
  proposalCategory: string | null;
  drafts: ReplyDraftView[];
  approval: { commandId: string; version: number; fingerprint: string } | null;
}

function fingerprint(title: string, comments: string): string {
  return createHash("sha256").update(JSON.stringify([title, comments])).digest("hex").slice(0, 16);
}

export class FakeSpringClient implements SpringClient {
  private readonly items = new Map<string, ItemState>();
  readonly audit: AuditRecord[] = [];
  /** Standing invariant: the runtime must never cause an external send. */
  externalSendAttempts = 0;
  /** Call counters for idempotency assertions. */
  readonly calls = { list: 0, detail: 0, propose: 0, saveDraft: 0, confirmPublish: 0 };

  /**
   * When true, models a backend with live execution ENABLED and a channel adapter
   * registered — i.e. confirm-publish actually dispatches. Default false = the
   * fail-closed production default. This makes {@link externalSendAttempts} a real
   * signal: it can only move when a dispatch path exists, which the runtime never
   * enables. It also documents the M3 truth — no-send is a backend-config property.
   */
  private readonly dispatchAdapterEnabled: boolean;

  constructor(seeds: readonly SeedInquiry[] = [], opts: { dispatchAdapterEnabled?: boolean } = {}) {
    this.dispatchAdapterEnabled = opts.dispatchAdapterEnabled ?? false;
    for (const s of seeds) {
      this.items.set(s.workItemId, {
        phase: "OPEN",
        status: s.status ?? "UNANSWERED",
        informStatus: null,
        seed: s,
        proposalCategory: null,
        drafts: [],
        approval: null,
      });
    }
  }

  async getPublishCapability(): Promise<PublishCapabilityView> {
    // Ties to the same flag as dispatch: an execution-enabled backend reports a
    // registered adapter, which the runtime's fail-closed startup check rejects.
    return this.dispatchAdapterEnabled
      ? { executionEnabled: true, replyAdapterChannelCodes: ["MOCK"] }
      : { executionEnabled: false, replyAdapterChannelCodes: [] };
  }

  private require(workItemId: string): ItemState {
    const it = this.items.get(workItemId);
    if (!it) throw new SpringApiError(404, "NOT_FOUND", "문의 작업을 찾을 수 없습니다.");
    return it;
  }

  async listInquiries(params: ListInquiriesParams): Promise<InquiryQueueResponse> {
    this.calls.list += 1;
    const phase = params.phase ?? "OPEN";
    const all: InquiryQueueItem[] = [...this.items.values()]
      .filter((it) => it.phase === phase)
      .map((it) => ({
        workItemId: it.seed.workItemId,
        inquiryId: it.seed.inquiryId,
        sellerAccountId: it.seed.sellerAccountId,
        channelId: it.seed.channelId,
        phase: it.phase,
        status: it.status,
        title: it.seed.title,
        receivedAt: it.seed.receivedAt,
      }));
    return { content: all, page: params.page ?? 0, size: params.size ?? 20, totalElements: all.length, totalPages: 1 };
  }

  async getInquiryDetail(workItemId: string): Promise<InquiryDetail> {
    this.calls.detail += 1;
    const it = this.require(workItemId);
    return {
      workItemId: it.seed.workItemId,
      inquiryId: it.seed.inquiryId,
      sellerAccountId: it.seed.sellerAccountId,
      channelId: it.seed.channelId,
      channelCode: it.seed.channelCode ?? null,
      channelNameKo: it.seed.channelNameKo ?? null,
      isSecret: it.seed.isSecret ?? null,
      phase: it.phase,
      status: it.status,
      informStatus: it.informStatus,
      title: it.seed.title,
      details: it.seed.details,
      receivedAt: it.seed.receivedAt,
      proposal: null,
      draft: it.drafts.length ? it.drafts[it.drafts.length - 1]! : null,
    };
  }

  async proposeInquiry(workItemId: string): Promise<ProposalResult> {
    this.calls.propose += 1;
    const it = this.require(workItemId);
    // Idempotency precheck mirrors the real InquiryProposalService: an existing proposal
    // is a replay (returned as-is regardless of the item's current phase); a fresh propose
    // requires OPEN and transitions to PROPOSED.
    if (it.proposalCategory === null) {
      if (it.phase !== "OPEN") {
        throw new SpringApiError(409, "CONFLICT", "OPEN 상태의 문의만 제안할 수 있습니다.");
      }
      it.phase = "PROPOSED";
      it.proposalCategory = "general_reply";
      this.pushAudit(workItemId, `propose:${workItemId}`, "PROPOSAL_ADDED", "OPEN", "PROPOSED", "SYSTEM:RULE_PROPOSER");
    }
    return {
      workItemId,
      phase: it.phase,
      proposal: {
        proposalId: `prop-${workItemId}`,
        workItemId,
        inquiryId: it.seed.inquiryId,
        actionKind: "POST_INQUIRY_REPLY",
        summaryCategory: it.proposalCategory ?? "general_reply",
        requiresApproval: true,
        proposedBy: "SYSTEM:RULE_PROPOSER",
        providerKind: "RULE_BASED",
        providerName: "rule-proposer",
        providerVersion: "rules-v1",
      },
    };
  }

  async saveDraft(workItemId: string, request: ReplyDraftRequest): Promise<ReplyDraftView> {
    this.calls.saveDraft += 1;
    const it = this.require(workItemId);
    if (it.phase !== "PROPOSED") {
      throw new SpringApiError(409, "CONFLICT", "PROPOSED 상태에서만 초안을 저장할 수 있습니다.");
    }
    // Mirror the backend's content validation (InquiryReplyDraftService rejects blanks),
    // so a human edit that would 400 live also fails offline.
    if (request.title.trim().length === 0 || request.comments.trim().length === 0) {
      throw new SpringApiError(400, "BAD_REQUEST", "제목과 내용은 비어 있을 수 없습니다.");
    }
    const head = it.drafts.length ? it.drafts[it.drafts.length - 1]! : null;
    const headVersion = head ? head.version : 0;
    if (request.baseVersion === headVersion) {
      const view: ReplyDraftView = {
        version: headVersion + 1,
        answerStatus: 0,
        title: request.title,
        comments: request.comments,
        contentFingerprint: fingerprint(request.title, request.comments),
        fingerprintAlgorithm: "sha256-16",
        createdAt: it.seed.receivedAt,
      };
      it.drafts.push(view);
      return view;
    }
    // Exact idempotent retry: re-saving the head's own content from its base.
    if (head && request.baseVersion === head.version - 1 && head.title === request.title && head.comments === request.comments) {
      return head;
    }
    throw new SpringApiError(409, "CONFLICT", "초안이 변경되었습니다. 최신 초안을 확인하세요.");
  }

  async confirmPublish(workItemId: string, request: ConfirmPublishRequest): Promise<PublishStatusView> {
    this.calls.confirmPublish += 1;
    if (!request.commandId) throw new SpringApiError(400, "BAD_REQUEST", "commandId가 필요합니다.");
    if (!request.expectedFingerprint) throw new SpringApiError(400, "BAD_REQUEST", "expectedFingerprint가 필요합니다.");
    const it = this.require(workItemId);

    if (it.approval) {
      const replay = it.approval.commandId === request.commandId && it.approval.fingerprint === request.expectedFingerprint;
      if (!replay) throw new SpringApiError(409, "CONFLICT", "이미 확정된 문의입니다. (명령/지문 불일치)");
      // Idempotent replay: re-attempt only the (fail-closed) dispatch — never re-bind, never re-audit.
      return this.maybeDispatch(it);
    }

    if (it.phase !== "PROPOSED") throw new SpringApiError(409, "CONFLICT", "PROPOSED 상태의 문의만 확정할 수 있습니다.");
    const head = it.drafts.length ? it.drafts[it.drafts.length - 1]! : null;
    if (!head) throw new SpringApiError(400, "BAD_REQUEST", "확정할 답변 초안이 없습니다.");
    if (head.contentFingerprint !== request.expectedFingerprint) {
      throw new SpringApiError(409, "CONFLICT", "초안이 변경되었습니다. 최신 초안을 확인하세요.");
    }

    it.approval = { commandId: request.commandId, version: head.version, fingerprint: head.contentFingerprint };
    it.phase = "ACTION_PENDING";
    // Binding audit, deduped by (workItemId, commandId).
    this.pushAudit(workItemId, request.commandId, "APPROVAL_GRANTED", "PROPOSED", "ACTION_PENDING", "SELLER:test");
    return this.maybeDispatch(it);
  }

  /**
   * Dispatch only when a channel adapter is present (execution enabled). The fail-closed
   * default has none, so nothing is sent and the item stays ACTION_PENDING. Only the
   * enabled path increments {@link externalSendAttempts} — so the runtime's tests, which
   * never enable it, prove a real fail-closed decision rather than an inert counter.
   */
  private maybeDispatch(it: ItemState): PublishStatusView {
    if (this.dispatchAdapterEnabled && it.phase === "ACTION_PENDING") {
      this.externalSendAttempts += 1;
      it.phase = "EXECUTED";
      return {
        workItemId: it.seed.workItemId,
        phase: it.phase,
        executionStatus: "EXECUTED",
        category: "PUBLISHING",
        approvedDraftVersion: it.approval?.version ?? null,
        approvedFingerprint: it.approval?.fingerprint ?? null,
        providerMessageNo: "fake-provider-ref",
        resultCode: 0,
      };
    }
    return {
      workItemId: it.seed.workItemId,
      phase: it.phase,
      executionStatus: it.phase === "EXECUTED" ? "EXECUTED" : "ACTION_PENDING",
      category: "PENDING",
      approvedDraftVersion: it.approval?.version ?? null,
      approvedFingerprint: it.approval?.fingerprint ?? null,
      providerMessageNo: null,
      resultCode: null,
    };
  }

  private pushAudit(
    workItemId: string,
    commandId: string,
    event: string,
    phaseFrom: string | null,
    phaseTo: string,
    actor: string,
  ): void {
    // UNIQUE (workItemId, commandId): no duplicate audit rows on replay.
    if (this.audit.some((a) => a.workItemId === workItemId && a.commandId === commandId)) return;
    this.audit.push({ workItemId, commandId, event, phaseFrom, phaseTo, actor });
  }

  // Test helpers.
  phaseOf(workItemId: string): string {
    return this.require(workItemId).phase;
  }
  auditEvents(workItemId: string): string[] {
    return this.audit.filter((a) => a.workItemId === workItemId).map((a) => a.event);
  }
}
