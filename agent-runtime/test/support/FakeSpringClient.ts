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
  ExecutableIdentity,
  GeneratedDraftView,
  ManualSyncRequest,
  SellerAccountSummary,
  SyncRunParams,
  SyncRunSummary,
  InquiryDetail,
  InquiryQueueItem,
  InquiryQueueResponse,
  InquiryRowsParams,
  InquiryRowsResponse,
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
  readonly productId?: string | null; // bound product, mirrors InquiryDetail.productId; defaults null
  readonly productName?: string | null;
  readonly productBinding?: string | null; // SOURCE_EXACT | USER_CONFIRMED
  /** NAVER subtype; null/absent for a single-source channel. */
  readonly sourceSubtype?: string | null;
  /**
   * What the backend decided from provenance (Lane A). Defaults to MARKETPLACE for a connector-written
   * row; a test seeds NONE to model a file-imported record with the same channel label.
   */
  readonly executableIdentity?: ExecutableIdentity;
  /**
   * What `generateDraftFor` answers for this item (Agentic Operating Workspace v2). Absent ⇒ a
   * GROUNDED draft is written. `answerBasis: "NO_ANSWER_BASIS"` ⇒ no draft is saved, as live.
   */
  readonly draftGeneration?: Partial<GeneratedDraftView> & { readonly comments?: string };
}

/** One recorded backend call — method name plus the ids it was made with. Never content. */
export interface RecordedCall {
  readonly method: string;
  readonly workItemId?: string;
  readonly tone?: string | null;
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
  readonly calls = { list: 0, detail: 0, propose: 0, saveDraft: 0, confirmPublish: 0, generate: 0,
    sellerAccounts: 0, syncRuns: 0, rows: 0 };
  /** Query Accuracy v1: every `listInquiryRows` request, verbatim — how a test proves spec → tool args. */
  readonly rowsParams: InquiryRowsParams[] = [];
  /** EVERY method call, in order — how a conversation test proves the lane made only READs + PREPARE. */
  readonly methodCalls: RecordedCall[] = [];
  /** Seeded connected accounts (`GET /api/seller-accounts`). */
  sellerAccounts: SellerAccountSummary[] = [];
  /** Seeded collection runs (`GET /api/sync-runs`). A test appends one to "finish" a human step. */
  syncRuns: SyncRunSummary[] = [];
  /**
   * What `POST /api/seller-accounts/{id}/sync` does (`CollectControlService.manualSync`). Default: a
   * SUCCESS run with 2 rows, recorded in `syncRuns`. A test sets a status to make the backend refuse
   * (409 single-flight, 429 rate budget, 503 connector off) or a `runStatus` to finish FAILED/RUNNING.
   */
  manualSyncBehavior: { errorStatus?: number; runStatus?: string; successRows?: number; onCall?: () => void } = {};
  /** Every manual sync the lane asked for — account + data type only. */
  readonly manualSyncCalls: Array<{ accountId: string; dataType: string }> = [];

  /**
   * When true, models a backend with live execution ENABLED and a channel adapter
   * registered — i.e. confirm-publish actually dispatches. Default false = the
   * fail-closed production default. This makes {@link externalSendAttempts} a real
   * signal: it can only move when a dispatch path exists, which the runtime never
   * enables. It also documents the M3 truth — no-send is a backend-config property.
   */
  private readonly dispatchAdapterEnabled: boolean;
  /** When set, `getPublishCapability` answers this instead of the dispatch-flag derivation. */
  publishCapability: PublishCapabilityView | null = null;

  /** Query Accuracy v1: inquiries with NO work item (answered on the channel) — visible to the rows read only. */
  readonly answeredSeeds: SeedInquiry[] = [];

  constructor(seeds: readonly SeedInquiry[] = [], opts: { dispatchAdapterEnabled?: boolean; answered?: readonly SeedInquiry[] } = {}) {
    this.dispatchAdapterEnabled = opts.dispatchAdapterEnabled ?? false;
    this.answeredSeeds.push(...(opts.answered ?? []));
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
    if (this.publishCapability) return this.publishCapability;
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
    this.methodCalls.push({ method: "listInquiries" });
    const phase = params.phase ?? "OPEN";
    const all: InquiryQueueItem[] = [...this.items.values()]
      .filter((it) => it.phase === phase)
      .map((it) => ({
        workItemId: it.seed.workItemId,
        inquiryId: it.seed.inquiryId,
        sellerAccountId: it.seed.sellerAccountId,
        channelId: it.seed.channelId,
        channelCode: it.seed.channelCode ?? null,
        channelNameKo: it.seed.channelNameKo ?? null,
        productId: it.seed.productId ?? null,
        productName: it.seed.productName ?? null,
        phase: it.phase,
        status: it.status,
        title: it.seed.title,
        receivedAt: it.seed.receivedAt,
        sourceSubtype: it.seed.sourceSubtype ?? null,
        executableIdentity: it.seed.executableIdentity ?? "MARKETPLACE",
      }));
    return { content: all, page: params.page ?? 0, size: params.size ?? 20, totalElements: all.length, totalPages: 1 };
  }

  /**
   * Query Accuracy v1: the rows read over the same seeds. `answered` (constructor opts) models inquiries
   * that have no work item at all — an inquiry answered on the channel, which the queue never shows.
   */
  async listInquiryRows(params: InquiryRowsParams): Promise<InquiryRowsResponse> {
    this.calls.rows += 1;
    this.rowsParams.push(params);
    this.methodCalls.push({ method: "listInquiryRows" });
    const status = params.status ?? "ALL";
    const channel = params.channel ? params.channel.toUpperCase() : null;
    const all = [
      ...[...this.items.values()].map((it) => ({
        seed: it.seed, status: it.status, phase: it.phase as string | null,
        workItemId: (it.phase === "OPEN" || it.phase === "PROPOSED" ? it.seed.workItemId : null) as string | null,
      })),
      ...this.answeredSeeds.map((seed) => ({ seed, status: seed.status ?? "ANSWERED", phase: null as string | null, workItemId: null as string | null })),
    ]
      .filter((r) => !channel || (r.seed.channelCode ?? "").toUpperCase() === channel)
      .filter((r) => status === "ALL" || r.status === status)
      .filter((r) => !params.from || r.seed.receivedAt.slice(0, 10) >= params.from)
      .filter((r) => !params.to || r.seed.receivedAt.slice(0, 10) <= params.to)
      .sort((a, b) => params.order === "OLDEST"
        ? a.seed.receivedAt.localeCompare(b.seed.receivedAt)
        : b.seed.receivedAt.localeCompare(a.seed.receivedAt));
    const limit = params.limit ?? 20;
    const items = all.slice(0, limit).map((r) => ({
      inquiryId: r.seed.inquiryId, workItemId: r.workItemId, sellerAccountId: r.seed.sellerAccountId,
      channelId: r.seed.channelId, channelCode: r.seed.channelCode ?? null, channelNameKo: r.seed.channelNameKo ?? null,
      productId: r.seed.productId ?? null, productName: r.seed.productName ?? null,
      phase: r.workItemId ? r.phase : null, status: r.status, title: r.seed.title, receivedAt: r.seed.receivedAt,
      answeredAt: null, sourceSubtype: r.seed.sourceSubtype ?? null,
      executableIdentity: r.seed.executableIdentity ?? "MARKETPLACE",
    }));
    return {
      from: params.from ?? null, to: params.to ?? "2099-12-31", channel, status, order: params.order ?? "NEWEST",
      limit, totalCount: all.length, items,
    };
  }

  async getInquiryDetail(workItemId: string): Promise<InquiryDetail> {
    this.calls.detail += 1;
    this.methodCalls.push({ method: "getInquiryDetail", workItemId });
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
      productId: it.seed.productId ?? null,
      productName: it.seed.productName ?? null,
      productBinding: it.seed.productBinding ?? null,
      sourceSubtype: it.seed.sourceSubtype ?? null,
      executableIdentity: it.seed.executableIdentity ?? "MARKETPLACE",
    };
  }

  async proposeInquiry(workItemId: string): Promise<ProposalResult> {
    this.calls.propose += 1;
    this.methodCalls.push({ method: "proposeInquiry", workItemId });
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
    this.methodCalls.push({ method: "saveDraft", workItemId });
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
    this.methodCalls.push({ method: "confirmPublish", workItemId });
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

  // ─────────────── Agentic Operating Workspace v2 ───────────────

  async listSellerAccounts(): Promise<SellerAccountSummary[]> {
    this.calls.sellerAccounts += 1;
    this.methodCalls.push({ method: "listSellerAccounts" });
    return [...this.sellerAccounts];
  }

  async manualSync(accountId: string, request: ManualSyncRequest): Promise<SyncRunSummary> {
    this.methodCalls.push({ method: "manualSync" });
    this.manualSyncCalls.push({ accountId, dataType: request.dataType });
    const b = this.manualSyncBehavior;
    if (b.errorStatus) throw new SpringApiError(b.errorStatus, `HTTP_${b.errorStatus}`, "backend request failed (POST /sync)");
    b.onCall?.();
    const account = this.sellerAccounts.find((a) => a.id === accountId);
    const run: SyncRunSummary = {
      id: `manual-${this.manualSyncCalls.length}`, sellerAccountId: accountId, channelId: account?.channelId ?? null,
      dataType: request.dataType, trigger: "MANUAL", status: b.runStatus ?? "SUCCESS", successRows: b.successRows ?? 2,
      startedAt: "2099-01-01T00:00:00Z", finishedAt: (b.runStatus ?? "SUCCESS") === "RUNNING" ? null : "2099-01-01T00:00:30Z",
    };
    this.syncRuns.push(run);
    return run;
  }

  async listSyncRuns(params: SyncRunParams): Promise<SyncRunSummary[]> {
    this.calls.syncRuns += 1;
    this.methodCalls.push({ method: "listSyncRuns" });
    return this.syncRuns.filter((r) =>
      (!params.sellerAccountId || r.sellerAccountId === params.sellerAccountId)
      && (!params.dataType || r.dataType === params.dataType)
      && (!params.status || r.status === params.status));
  }

  /**
   * Mirrors `POST /api/inquiries/{id}/draft/generate`: moves an OPEN item to PROPOSED (the backend's
   * `proposeAs` path), saves one append-only MODEL version, and reports the basis. The tone changes
   * the identity stamp and nothing about what is recorded as fact — the facts are the backend's.
   */
  async generateDraftFor(
    workItemId: string,
    tone: "SOFTER" | "MORE_FORMAL" | "SHORTER" | null,
  ): Promise<GeneratedDraftView> {
    this.calls.generate += 1;
    this.methodCalls.push({ method: "generateDraftFor", workItemId, tone });
    const it = this.require(workItemId);
    const seeded = it.seed.draftGeneration ?? {};
    const basis = seeded.answerBasis ?? "GROUNDED";
    const unavailable = seeded.unavailableMessage ?? null;
    let draft: ReplyDraftView | null = null;
    if (!unavailable && basis !== "NO_ANSWER_BASIS") {
      // Mirrors `InquiryReplyDraftService.persist`: a draft is saved only on a PROPOSED item. The backend
      // does NOT propose on the seller's behalf here — the conversation lane must do that through the
      // product's own propose seam first (Acceptance Closure: found live on the QA org).
      if (it.phase === "OPEN") {
        throw new SpringApiError(409, "CONFLICT", "PROPOSED 상태의 문의만 답변 초안을 저장할 수 있습니다.");
      }
      const head = it.drafts.length ? it.drafts[it.drafts.length - 1]! : null;
      const comments = seeded.comments ?? "안녕하세요. 문의 주신 내용 확인했습니다.";
      draft = {
        version: (head?.version ?? 0) + 1,
        answerStatus: 0,
        title: it.seed.title,
        comments,
        // The stamp is the backend's `model_version+style/…` idea in miniature: the tone is part of the
        // identity, so a softer draft is a different version with a different fingerprint.
        contentFingerprint: fingerprint(it.seed.title, `${comments}|${tone ?? "default"}`),
        fingerprintAlgorithm: "sha256-16",
        createdAt: it.seed.receivedAt,
        answerBasis: basis,
        answerBasisNote: seeded.answerBasisNote ?? null,
        answerBasisAction: seeded.answerBasisAction ?? null,
      };
      it.drafts.push(draft);
    }
    return {
      draft,
      authorKind: draft ? (seeded.authorKind ?? "MODEL") : null,
      knowledgeState: seeded.knowledgeState ?? (basis === "NO_ANSWER_BASIS" ? "NO_KNOWLEDGE" : "GROUNDED"),
      knowledgeNote: seeded.knowledgeNote ?? null,
      answerBasis: unavailable ? null : basis,
      answerBasisNote: seeded.answerBasisNote ?? (basis === "NO_ANSWER_BASIS" ? "답변 기준이 필요합니다." : null),
      answerBasisAction: seeded.answerBasisAction ?? null,
      productId: it.seed.productId ?? null,
      evidence: [],
      unavailableMessage: unavailable,
    };
  }

  // Test helpers.
  phaseOf(workItemId: string): string {
    return this.require(workItemId).phase;
  }
  auditEvents(workItemId: string): string[] {
    return this.audit.filter((a) => a.workItemId === workItemId).map((a) => a.event);
  }
}
