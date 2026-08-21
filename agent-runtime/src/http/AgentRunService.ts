/**
 * The transport-agnostic Agent Runtime service — the brain behind the HTTP surface.
 *
 * It parses a goal, routes it onto a subgraph domain, and drives the matching runtime, then
 * projects the result into a sanitized {@link AgentRunView}. It is stateless per request: each call
 * builds fresh runtimes bound to (a) the caller's forwarded bearer token and (b) that caller's
 * TENANT-SCOPED durable stores. Because the runtimes are fresh, every resume takes the durable
 * reconstruction path, which is idempotent (deterministic commandId + DONE-snapshot guard), so a
 * double resume replays the recorded outcome and a restart resumes correctly.
 *
 * Tenant safety: EVERY start/resume/get first calls the backend `whoami` with the forwarded token.
 * That both VERIFIES the token (a missing/forged token is rejected at the backend, surfaced as 401)
 * and yields the org the backend derived from the JWT — the service never sees or spoofs an org.
 * The org fingerprints into a store scope, so a run is only ever readable/resumable by the same org;
 * a foreign or unknown `threadId` resolves to absent (404) within that scope, and a client-supplied
 * `threadId` cannot collide or shadow across orgs. Mutating paths are additionally backstopped by the
 * fail-closed execution guard and by the backend's own org-scoped rejection of a foreign account.
 *
 * No view carries a token, a credential, or raw customer 원문.
 */
import { randomUUID } from "node:crypto";
import { InquiryAgentRuntime } from "../runtime";
import type { RunResult } from "../runtime";
import { InquiryDraftAgentRuntime } from "../inquiryDraftRuntime";
import type { InquiryDraftRunResult } from "../inquiryDraftRuntime";
import { ReviewAgentRuntime } from "../reviewRuntime";
import type { ReviewRunResult } from "../reviewRuntime";
import { IssueAgentRuntime } from "../issueRuntime";
import type { IssueRunResult } from "../issueRuntime";
import { OperatorAgentRuntime } from "../operator/operatorRuntime";
import type { OperatorRunResult } from "../operator/operatorRuntime";
import type { OperatorSpringClient } from "../spring/OperatorSpringClient";
import { SpringDraftProvider } from "../provider/SpringDraftProvider";
import { parseGoal, routeIntent, UnrecognizedGoalError } from "../goal/parseGoal";
import type { GoalRequest } from "../goal/parseGoal";
import type { SpringClient } from "../spring/SpringClient";
import type { ReviewSpringClient } from "../spring/ReviewSpringClient";
import type { IssueSpringClient } from "../spring/IssueSpringClient";
import type { IdentitySpringClient } from "../spring/IdentitySpringClient";
import type { CheckpointDecision } from "../checkpoint/CheckpointContract";
import { log } from "../log";
import { HttpError } from "./errors";
import { SERVICE_VERSION } from "./config";
import { RunStoreProvider, scopeFor } from "./runStoreProvider";
import type { RunStores } from "./runStoreProvider";
import type {
  AgentRunDomain,
  AgentRunView,
  CapabilitiesView,
  InquiryCheckpointView,
  InquiryDraftPreparationView,
  ResumeRunRequest,
  ReviewCheckpointView,
  StartRunRequest,
} from "./contract";

/** The backend clients for one operator token. In production all four are one HttpSpringClient. */
export interface SpringClientBundle {
  readonly inquiry: SpringClient;
  readonly review: ReviewSpringClient;
  readonly issue: IssueSpringClient;
  readonly identity: IdentitySpringClient;
  readonly operator: OperatorSpringClient;
}

/** Builds the backend clients for a forwarded operator token. Injectable for tests. */
export type SpringClientFactory = (token: string) => SpringClientBundle;

export interface AgentRunServiceDeps {
  readonly storeProvider: RunStoreProvider;
  readonly clientFactory: SpringClientFactory;
  readonly env: string;
}

/**
 * The static intent catalogue, also surfaced on /capabilities so the frontend can discover it.
 *
 * <b>`sampleGoals` are illustrations, not a menu.</b> The Operator's entry is free text interpreted by
 * a planner; there is no set of blessed sentences, and the field was renamed from `examples` because
 * the old name was being read as one — the frontend turned three of them into chips and a demo script
 * turned four of them into an acceptance criterion.
 */
const INTENT_CATALOGUE: CapabilitiesView["intents"] = [
  {
    intent: "OPERATOR_GOAL",
    domain: "OPERATOR",
    hasCheckpoint: false,
    requiresAccountScope: false,
    sampleGoals: [
      "오늘 뭐부터 봐야 해?",
      "A상품 요즘 문제 있어?",
      "이번 주 대표에게 보고할 내용 정리해줘",
    ],
  },
  {
    intent: "HANDLE_UNANSWERED_INQUIRIES",
    domain: "INQUIRY",
    hasCheckpoint: true,
    requiresAccountScope: false,
    sampleGoals: ["미답변 문의 처리해줘", "답변 필요한 문의 보여줘"],
  },
  {
    intent: "PREPARE_INQUIRY_DRAFT",
    domain: "INQUIRY_DRAFT",
    hasCheckpoint: false,
    requiresAccountScope: false,
    sampleGoals: ["Cafe24 문의 답변 초안 만들어줘", "문의 답변 초안 준비해줘"],
  },
  {
    intent: "HANDLE_REVIEW_REPLIES",
    domain: "REVIEW",
    hasCheckpoint: true,
    requiresAccountScope: true,
    sampleGoals: ["리뷰 답변 초안 만들어줘", "후기 답글 준비해줘"],
  },
  {
    intent: "HANDLE_OPERATIONS_ISSUES",
    domain: "ISSUE",
    hasCheckpoint: false,
    requiresAccountScope: false,
    sampleGoals: ["최근 악화된 상품 문제 알려줘", "지금 먼저 확인할 운영 이슈는 뭐야"],
  },
];

export class AgentRunService {
  constructor(private readonly deps: AgentRunServiceDeps) {}

  capabilities(): CapabilitiesView {
    const p = this.deps.storeProvider;
    return {
      service: "sellerops-agent-runtime",
      version: SERVICE_VERSION,
      env: this.deps.env,
      intents: INTENT_CATALOGUE,
      runStore: { kind: p.kind, durable: p.durable, multiInstanceSafe: p.multiInstanceSafe },
      // `unknown` without a probe: this route is public and unauthenticated, and the planner capability
      // is per-ORG. Reporting "enabled" from a service-level guess would tell one seller that a
      // capability their org does not have is available. The frontend learns the real answer from its
      // first run, which fails honestly and says why.
      freeTextPlanning: "unknown",
      externalSend: "disabled",
    };
  }

  /**
   * Resolve the tenant: verify the token at the backend and map the derived org to its store scope.
   * Returns the request's client bundle (reused for the runtimes) and that org's stores.
   */
  private async tenant(token: string): Promise<{ bundle: SpringClientBundle; stores: RunStores }> {
    const bundle = this.deps.clientFactory(token);
    const { orgId } = await bundle.identity.whoami(); // throws (→ 401/…) on an invalid token
    // Spring store: isolated at the backend by the forwarded token. File/memory: keyed by an org
    // fingerprint. Passing both lets the provider pick per store kind without the service knowing which.
    const stores = this.deps.storeProvider.storesForRequest({ token, scope: scopeFor(orgId) });
    return { bundle, stores };
  }

  private runtimes(bundle: SpringClientBundle, stores: RunStores): {
    operator: OperatorAgentRuntime;
    inquiry: InquiryAgentRuntime;
    inquiryDraft: InquiryDraftAgentRuntime;
    review: ReviewAgentRuntime;
    issue: IssueAgentRuntime;
  } {
    return {
      // The Operator takes no store from the durable provider: every tool it can reach is READ, so a
      // run has nothing to authorize, nothing to pause for, and nothing a restart could lose. Same
      // reasoning as the draft-preparation runtime below.
      operator: new OperatorAgentRuntime({
        operator: bundle.operator,
        inquiry: bundle.inquiry,
        issue: bundle.issue,
      }),
      inquiry: new InquiryAgentRuntime({
        client: bundle.inquiry,
        runStore: stores.inquiry,
        draftProvider: new SpringDraftProvider(bundle.inquiry),
      }),
      // Draft preparation is a TERMINAL read (no checkpoint, no pause): it returns the draft in the
      // response and retains nothing. So it takes no store from the durable provider — its default
      // in-memory store is per-request scratch, and there is no paused state to survive a restart.
      // This is why it is safe even under APP_ENV=production despite not being the spring store.
      inquiryDraft: new InquiryDraftAgentRuntime({
        client: bundle.inquiry,
        draftProvider: new SpringDraftProvider(bundle.inquiry),
      }),
      review: new ReviewAgentRuntime({ client: bundle.review, runStore: stores.review }),
      issue: new IssueAgentRuntime({ client: bundle.issue, runStore: stores.issue }),
    };
  }

  private goalRequest(input: StartRunRequest): GoalRequest {
    return {
      intent: input.intent,
      text: input.goalText,
      accountId: input.accountId,
      referenceDate: input.referenceDate,
      page: input.page,
      size: input.size,
    };
  }

  /**
   * Route without running — used by the server to validate/log the target domain.
   *
   * <b>Two lanes, and this method is the fork.</b> An explicit `intent` is a value a BUTTON sent: it is
   * validated against the closed catalogue and an unknown one is still a 400, because a client naming
   * an intent is asserting it knows the catalogue and a silent reroute would hide its bug. Free TEXT is
   * a sentence a person typed, and it always goes to the OPERATOR — not as a fallback for text the
   * keyword table refused (there is no keyword table since v2), but because interpreting a sentence is
   * the Operator's job and nothing else in this process is allowed to do it.
   */
  route(input: StartRunRequest): AgentRunDomain {
    try {
      return routeIntent(parseGoal(this.goalRequest(input)).intent);
    } catch (err) {
      if (err instanceof UnrecognizedGoalError) {
        throw new HttpError(400, "UNRECOGNIZED_GOAL", "could not resolve a supported intent from the request");
      }
      throw err;
    }
  }

  async start(token: string, input: StartRunRequest): Promise<AgentRunView> {
    const request = this.goalRequest(input);
    const domain = this.route(input);
    const threadId = input.threadId ?? randomUUID();

    if (domain === "REVIEW" && !request.accountId) {
      throw new HttpError(400, "MISSING_ACCOUNT_SCOPE", "review runs require an accountId scope");
    }

    const { bundle, stores } = await this.tenant(token);
    log("http_start", { domain, hasThreadId: input.threadId != null, hasAccount: request.accountId != null });
    const rt = this.runtimes(bundle, stores);

    if (domain === "OPERATOR") return this.operatorView(threadId, await rt.operator.run(threadId, request));
    if (domain === "INQUIRY") return this.inquiryView(threadId, await rt.inquiry.start(threadId, request));
    if (domain === "INQUIRY_DRAFT") return this.draftView(threadId, await rt.inquiryDraft.run(threadId, request));
    if (domain === "REVIEW") return this.reviewView(threadId, await rt.review.start(threadId, request));
    return this.issueView(threadId, await rt.issue.run(threadId, request));
  }

  async resume(token: string, threadId: string, decision: ResumeRunRequest): Promise<AgentRunView> {
    const { bundle, stores } = await this.tenant(token);
    const domain = await this.resolveDomain(stores, threadId);
    if (!domain) throw new HttpError(404, "UNKNOWN_THREAD", "no run found for this thread");
    if (domain === "ISSUE") {
      throw new HttpError(409, "NO_CHECKPOINT", "issue-memory runs have no checkpoint to resume; start again to refresh");
    }
    if (domain === "OPERATOR") {
      throw new HttpError(409, "NO_CHECKPOINT", "operator runs have no checkpoint to resume; start again to re-answer");
    }

    const rt = this.runtimes(bundle, stores);
    const runner = domain === "REVIEW" ? rt.review : rt.inquiry;
    const store = domain === "REVIEW" ? stores.review : stores.inquiry;

    // Fail closed BEFORE claiming, so a refused run never leaves a wasted claim behind.
    await runner.assertExecutionDisabled();

    // Exactly-once gate. Claim the resume BEFORE driving the (possibly non-idempotent) mutation — the
    // review guided-session mint is not idempotent, so only the claim winner may run it. A concurrent
    // resume that lost the claim fails closed; a run that already finished replays through the runtime's
    // own DONE-snapshot guard (idempotent double resume).
    const claim = await store.claim(threadId);
    if (claim.outcome === "CONFLICT") {
      throw new HttpError(409, "RESUME_IN_PROGRESS", "a concurrent resume is already in progress for this run");
    }
    log("http_resume", { domain, approved: decision.approved, claim: claim.outcome });

    // The inquiry decision is the superset; the review runtime reads only {approved, approvedBy}.
    const full: CheckpointDecision = {
      approved: decision.approved,
      approvedBy: decision.approvedBy ?? "operator",
      ...(decision.editedTitle !== undefined ? { editedTitle: decision.editedTitle } : {}),
      ...(decision.editedComments !== undefined ? { editedComments: decision.editedComments } : {}),
    };

    if (domain === "REVIEW") {
      return this.reviewView(threadId, await rt.review.resume(threadId, full));
    }
    return this.inquiryView(threadId, await rt.inquiry.resume(threadId, full));
  }

  async get(token: string, threadId: string): Promise<AgentRunView> {
    const { stores } = await this.tenant(token);
    const domain = await this.resolveDomain(stores, threadId);
    if (!domain) throw new HttpError(404, "UNKNOWN_THREAD", "no run found for this thread");

    if (domain === "INQUIRY") {
      const snap = await stores.inquiry.load(threadId);
      if (!snap) throw new HttpError(404, "UNKNOWN_THREAD", "no run found for this thread");
      const checkpoint: InquiryCheckpointView | undefined =
        snap.status === "AWAITING_APPROVAL"
          ? {
              kind: "INQUIRY_REPLY_APPROVAL",
              domain: "INQUIRY",
              workItemId: snap.workItemId,
              inquiryId: snap.inquiryId,
              phase: snap.phase,
              priorityBucket: snap.priorityBucket,
              category: snap.category,
              // No replyDraft: draft content is never persisted, so a reloaded run cannot show it.
            }
          : undefined;
      return {
        threadId,
        domain: "INQUIRY",
        status: snap.status,
        trail: snap.trail,
        ...(checkpoint ? { checkpoint } : {}),
        ...(snap.status === "DONE" ? { outcome: snap.outcome ?? null } : {}),
      };
    }

    if (domain === "REVIEW") {
      const snap = await stores.review.load(threadId);
      if (!snap) throw new HttpError(404, "UNKNOWN_THREAD", "no run found for this thread");
      const checkpoint: ReviewCheckpointView | undefined =
        snap.status === "AWAITING_APPROVAL"
          ? {
              kind: "REVIEW_REPLY_APPROVAL",
              domain: "REVIEW",
              actionRef: snap.reviewRef,
              draftVersion: snap.draftVersion,
              draftFingerprint: snap.draftFingerprint,
              phase: snap.phase,
              priorityBucket: snap.priorityBucket,
              category: "",
              rating: null,
              reviewDate: null,
              productName: null,
              channelReviewIdFingerprint: null,
            }
          : undefined;
      return {
        threadId,
        domain: "REVIEW",
        status: snap.status,
        trail: snap.trail,
        ...(checkpoint ? { checkpoint } : {}),
        ...(snap.status === "DONE" ? { outcome: snap.outcome ?? null } : {}),
      };
    }

    const snap = await stores.issue.load(threadId);
    if (!snap) throw new HttpError(404, "UNKNOWN_THREAD", "no run found for this thread");
    return { threadId, domain: "ISSUE", status: "DONE", trail: snap.trail, brief: snap.brief };
  }

  /** Which subgraph owns this thread, by probing this tenant's stores. */
  private async resolveDomain(stores: RunStores, threadId: string): Promise<AgentRunDomain | null> {
    if (await stores.review.load(threadId)) return "REVIEW";
    if (await stores.issue.load(threadId)) return "ISSUE";
    if (await stores.inquiry.load(threadId)) return "INQUIRY";
    return null;
  }

  // ----------------------------------------------------------------- view projection (sanitize)

  private inquiryView(threadId: string, result: RunResult): AgentRunView {
    if (result.status === "AWAITING_APPROVAL") {
      const cp = result.checkpoint;
      const checkpoint: InquiryCheckpointView = {
        kind: "INQUIRY_REPLY_APPROVAL",
        domain: "INQUIRY",
        workItemId: cp.workItemId,
        inquiryId: cp.inquiryId,
        phase: cp.phase,
        priorityBucket: cp.priorityBucket,
        category: cp.category,
        provenance: cp.candidate.provenance,
        // Expose ONLY the templated reply comments — never candidate.title (which echoes the
        // customer subject) and never the customer body.
        replyDraft: cp.candidate.comments,
      };
      return { threadId, domain: "INQUIRY", status: "AWAITING_APPROVAL", trail: result.trail, checkpoint };
    }
    return { threadId, domain: "INQUIRY", status: "DONE", trail: result.trail, outcome: result.outcome };
  }

  private reviewView(threadId: string, result: ReviewRunResult): AgentRunView {
    if (result.status === "AWAITING_APPROVAL") {
      const cp = result.checkpoint;
      const checkpoint: ReviewCheckpointView = {
        kind: "REVIEW_REPLY_APPROVAL",
        domain: "REVIEW",
        actionRef: cp.actionRef,
        draftVersion: cp.draftVersion,
        draftFingerprint: cp.draftFingerprint,
        phase: cp.phase,
        priorityBucket: cp.priorityBucket,
        category: cp.category,
        rating: cp.rating,
        reviewDate: cp.reviewDate,
        productName: cp.productName,
        channelReviewIdFingerprint: cp.channelReviewIdFingerprint,
      };
      return { threadId, domain: "REVIEW", status: "AWAITING_APPROVAL", trail: result.trail, checkpoint };
    }
    return { threadId, domain: "REVIEW", status: "DONE", trail: result.trail, outcome: result.outcome };
  }

  /**
   * The operator answer as surfaced over HTTP.
   *
   * No filtering happens here and none is needed: every channel this projects from is already
   * sanitized by construction (ids, closed-vocabulary labels, counts, dates, and sentences SellerOps
   * composed). A projection that had to strip fields would mean the state upstream was carrying
   * something it should not have been.
   */
  private operatorView(threadId: string, result: OperatorRunResult): AgentRunView {
    if (result.status === "FAILED") {
      // A failure is a first-class outcome on this surface, not an HTTP error: the run was accepted,
      // executed and honestly could not answer. Returning 500 would make an off-by-default capability
      // look like an outage, and returning DONE-with-nothing would make it look like a clean answer.
      return {
        threadId,
        domain: "OPERATOR",
        status: "FAILED",
        trail: result.trail,
        failureCode: result.failureCode,
        failureReason: result.reason,
      };
    }
    return { threadId, domain: "OPERATOR", status: "DONE", trail: result.trail, answer: result.answer };
  }

  private issueView(threadId: string, result: IssueRunResult): AgentRunView {
    return { threadId, domain: "ISSUE", status: "DONE", trail: result.trail, brief: result.brief };
  }

  private draftView(threadId: string, result: InquiryDraftRunResult): AgentRunView {
    const p = result.preparation;
    const m = p.meta;
    const draftPreparation: InquiryDraftPreparationView = {
      kind: "INQUIRY_DRAFT_PREPARATION",
      domain: "INQUIRY_DRAFT",
      prepared: p.prepared,
      workItemId: m?.workItemId ?? null,
      inquiryId: m?.inquiryId ?? null,
      phase: m?.phase ?? null,
      priorityBucket: m?.priorityBucket ?? null,
      category: m?.category ?? null,
      provenance: m?.provenance ?? null,
      channelId: m?.channelId ?? null,
      channelCode: m?.channelCode ?? null,
      channelNameKo: m?.channelNameKo ?? null,
      inquiryStatus: m?.inquiryStatus ?? null,
      informStatus: m?.informStatus ?? null,
      isSecret: m?.isSecret ?? null,
      generatedAt: m?.generatedAt ?? null,
      // The generated reply text — the ONLY content here (no customer subject/body). Present in this
      // live response only; never persisted, so a reloaded run cannot re-surface it.
      ...(p.replyDraft != null ? { replyDraft: p.replyDraft } : {}),
      ...(p.note != null ? { note: p.note } : {}),
    };
    return { threadId, domain: "INQUIRY_DRAFT", status: "DONE", trail: result.trail, draftPreparation };
  }
}

// Re-export so the server/main can construct a provider without a second import site.
export { RunStoreProvider };
