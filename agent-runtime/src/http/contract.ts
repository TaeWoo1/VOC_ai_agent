/**
 * The HTTP wire contract for the Agent Runtime service.
 *
 * This is the ONE surface the SellerOps frontend calls. It is deliberately thin: a request
 * names a goal (free text or an explicit intent) plus a scope, and the service routes it onto
 * one of the three subgraphs (inquiry / review / issue) and returns a sanitized run view. The
 * frontend never talks to a subgraph, a tool, or the Spring backend through this surface — it
 * only sends goals and decisions and reads back sanitized views.
 *
 * <b>Privacy is enforced at this boundary, not just downstream.</b> The response views below
 * carry NO raw customer text:
 *  - the inquiry checkpoint exposes the rule-based reply DRAFT (a closed-vocabulary template,
 *    operator-approvable) plus coarse locating metadata, but NOT the echoed customer subject
 *    (`candidate.title`) and never the customer body/details;
 *  - the review checkpoint carries no body and no reply text at all (only a version + fingerprint
 *    and coarse locating aids — the operator reads the actual draft on the authorized review-reply
 *    screen);
 *  - the issue brief is quote-free by construction.
 * The raw customer 원문 is read only on the existing authorized detail screens, never here.
 */
import { z } from "zod";
import type { DraftProvenance } from "../provider/DraftModelSeam";
import type { RunOutcome } from "../state/AgentState";
import type { ReviewRunOutcome } from "../state/ReviewAgentState";
import type { IssueOperationsBrief } from "../state/IssueAgentState";
import type { OperatorAnswer } from "../operator/state/OperatorState";

export type AgentRunDomain = "OPERATOR" | "INQUIRY" | "INQUIRY_DRAFT" | "REVIEW" | "ISSUE";
/**
 * How a run ended, on the wire.
 *
 * <b>`FAILED` is new in Operator Graph v2 and it is load-bearing.</b> An Agent-chat run whose plan
 * cannot be made does not degrade to a keyword route and does not return an empty success — it fails,
 * and the frontend renders the reason. Adding the state to the union is what stops a client from
 * having to infer failure from "DONE with no findings", which is a different and much worse thing.
 */
export type AgentRunStatus = "AWAITING_APPROVAL" | "DONE" | "FAILED";

// --------------------------------------------------------------------------- requests

/**
 * POST /api/agent-runs body. Either `goalText` (free text, keyword-routed) or an explicit
 * `intent` must be present. `accountId` is the seller-account scope (required for the review
 * domain); `referenceDate` pins the issue domain's trend judgements. `threadId` is optional —
 * when absent the service mints one and returns it. `size`/`page` are paging hints.
 */
export const StartRunRequestSchema = z
  .object({
    // Restricted charset: a threadId is a store key, so it must be filename-safe and free of any
    // character the file store would collapse (which could alias two ids to one file).
    threadId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._-]+$/, "threadId may contain only letters, digits, dot, underscore, hyphen")
      .optional(),
    goalText: z.string().min(1).max(2000).optional(),
    intent: z.string().min(1).max(120).optional(),
    accountId: z.string().min(1).max(200).optional(),
    // The screen the seller asked from, as an id. Verified by an org-scoped read before it means
    // anything — see `GoalRequest.productId`.
    productId: z.string().min(1).max(200).optional(),
    // The inquiry work item the seller was standing on. Same rule as productId: a hint, verified by
    // one org-scoped read, dropped in silence otherwise — see `GoalRequest.workItemId`.
    workItemId: z.string().min(1).max(200).optional(),
    referenceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "referenceDate must be YYYY-MM-DD")
      .optional(),
    page: z.number().int().min(0).max(100000).optional(),
    size: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .refine((r) => Boolean(r.goalText) || Boolean(r.intent), {
    message: "request must carry either goalText or intent",
  });

export type StartRunRequest = z.infer<typeof StartRunRequestSchema>;

/**
 * POST /api/agent-runs/{threadId}/resume body — the human checkpoint decision. The superset
 * of the inquiry and review decisions: the review runtime uses only {approved, approvedBy};
 * the inquiry runtime additionally honours `editedComments` (operator-authored reply text —
 * never customer content). `editedTitle` is accepted for completeness but the UI does not send
 * it (the reply title is derived on the backend). `approvedBy` is a cosmetic label; the
 * authoritative approver identity is the JWT principal recorded by the backend.
 */
export const ResumeRunRequestSchema = z
  .object({
    approved: z.boolean(),
    approvedBy: z.string().min(1).max(200).optional(),
    editedComments: z.string().max(4000).optional(),
    editedTitle: z.string().max(500).optional(),
  })
  .strict();

export type ResumeRunRequest = z.infer<typeof ResumeRunRequestSchema>;

// --------------------------------------------------------------------------- responses

/**
 * The inquiry checkpoint as surfaced over HTTP. `replyDraft` is the rule-based template reply
 * the operator approves/edits — it carries NO customer text (the customer subject echoed into
 * `candidate.title` is dropped, and the customer body never reaches here). `replyDraft` is
 * present only in the live start/resume response (the interrupt payload); a GET of a paused run
 * omits it, because the durable store never persists draft content.
 */
export interface InquiryCheckpointView {
  readonly kind: "INQUIRY_REPLY_APPROVAL";
  readonly domain: "INQUIRY";
  readonly workItemId: string;
  readonly inquiryId: string;
  readonly phase: string;
  readonly priorityBucket: string;
  readonly category: string;
  readonly provenance?: DraftProvenance;
  readonly replyDraft?: string;
}

/** The review checkpoint as surfaced over HTTP — NO body, NO reply text; version + locating aids only. */
export interface ReviewCheckpointView {
  readonly kind: "REVIEW_REPLY_APPROVAL";
  readonly domain: "REVIEW";
  readonly actionRef: string;
  readonly draftVersion: number;
  readonly draftFingerprint: string;
  readonly phase: string;
  readonly priorityBucket: string;
  readonly category: string;
  readonly rating: number | null;
  readonly reviewDate: string | null;
  readonly productName: string | null;
  readonly channelReviewIdFingerprint: string | null;
}

export type CheckpointView = InquiryCheckpointView | ReviewCheckpointView;

/**
 * The DRAFT-PREPARATION result as surfaced over HTTP (domain INQUIRY_DRAFT, always DONE).
 *
 * This run reads one Cafe24/other inquiry and generates a rule-based answer draft, then STOPS at a
 * terminal human checkpoint — it proposes nothing, saves nothing to the backend, and sends nothing.
 * `replyDraft` is the templated reply text the operator reviews/edits locally; it carries NO customer
 * body (the echoed subject `candidate.title` is dropped, the customer body never reaches here) and is
 * present ONLY in the live start response — it is never persisted, so it never re-surfaces on a GET.
 * The scalar fields (channel labels, `inquiryStatus`, `isSecret`, `generatedAt`) let the UI name the
 * target channel, show the inquiry status, flag a 비밀글, and show when the draft was made — without
 * ever exposing the inquiry content. `prepared` is false (with `note`) when the OPEN queue was empty.
 */
export interface InquiryDraftPreparationView {
  readonly kind: "INQUIRY_DRAFT_PREPARATION";
  readonly domain: "INQUIRY_DRAFT";
  readonly prepared: boolean;
  readonly workItemId: string | null;
  readonly inquiryId: string | null;
  readonly phase: string | null;
  readonly priorityBucket: string | null;
  readonly category: string | null;
  readonly provenance: DraftProvenance | null;
  readonly channelId: string | null;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  readonly inquiryStatus: string | null;
  readonly informStatus: string | null;
  readonly isSecret: boolean | null;
  readonly generatedAt: string | null;
  readonly replyDraft?: string;
  readonly note?: string;
}

/** The unified run view every endpoint returns. Sanitized: no token, no credential, no customer 원문. */
export interface AgentRunView {
  readonly threadId: string;
  readonly domain: AgentRunDomain;
  readonly status: AgentRunStatus;
  readonly trail: string[];
  /** Present when status is AWAITING_APPROVAL (inquiry/review only). */
  readonly checkpoint?: CheckpointView;
  /** Present when a checkpoint-bearing run is DONE (inquiry/review). Already sanitized. */
  readonly outcome?: RunOutcome | ReviewRunOutcome | null;
  /** Present for the issue domain (no checkpoint): the quote-free operations brief. */
  readonly brief?: IssueOperationsBrief;
  /** Present for the inquiry-draft domain (no checkpoint): the sanitized draft-preparation result. */
  readonly draftPreparation?: InquiryDraftPreparationView;
  /**
   * Present for the operator domain (no checkpoint): findings, the evidence behind each one, the
   * coverage verdict of every source consulted, and what the run spent.
   *
   * Sanitized by construction rather than by filtering here: an {@code EvidenceRef} can only hold ids,
   * closed-vocabulary labels, counts and dates, and a {@code Finding.statement} is a sentence SellerOps
   * composed. No customer 원문 can reach this field because no channel upstream of it can carry one.
   */
  readonly answer?: OperatorAnswer;
  /**
   * Present only when `status` is FAILED. `failureCode` is for the client's logic, `failureReason` is
   * the seller-facing sentence — never a vendor message and never the request text.
   */
  readonly failureCode?: string;
  readonly failureReason?: string;
}

/** GET /capabilities — static service metadata. Reveals no seller data and no secret. */
export interface CapabilitiesView {
  readonly service: "sellerops-agent-runtime";
  readonly version: string;
  readonly env: string;
  readonly intents: ReadonlyArray<{
    readonly intent: string;
    readonly domain: AgentRunDomain;
    readonly hasCheckpoint: boolean;
    readonly requiresAccountScope: boolean;
    /**
     * Sentences a seller might type — <b>illustrations, not a supported list</b>.
     *
     * Renamed from `examples` in Operator Graph v2 because the old name was being read as a menu: the
     * frontend rendered the three Operator strings as chips and a demo script treated "the four
     * questions" as the acceptance criterion. There is no list of supported sentences any more; an
     * LLM planner interprets whatever is typed, and the only honest thing this field can be is a prompt
     * for someone who does not know what to ask.
     */
    readonly sampleGoals: readonly string[];
  }>;
  /**
   * Whether Agent chat can run at all right now.
   *
   * Free text needs a plan, and a plan needs the backend planner capability. When it is off this is
   * false and the frontend disables the input with a reason instead of letting a seller type a sentence
   * that is guaranteed to fail. Dashboard shortcuts are unaffected — they send an intent, not a
   * sentence.
   */
  readonly freeTextPlanning: "enabled" | "unavailable" | "unknown";
  readonly runStore: { readonly kind: string; readonly durable: boolean; readonly multiInstanceSafe: boolean };
  /**
   * Structural guarantee: this service has no send tool and its only backend writes are
   * fail-closed at the backend, so it can never dispatch an external reply.
   */
  readonly externalSend: "disabled";
}

/** GET /health — liveness only. */
export interface HealthView {
  readonly status: "ok";
  readonly service: "sellerops-agent-runtime";
  readonly version: string;
  readonly env: string;
  readonly runStore: string;
}
