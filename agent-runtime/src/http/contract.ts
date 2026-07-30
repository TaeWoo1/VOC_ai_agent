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

export type AgentRunDomain = "INQUIRY" | "REVIEW" | "ISSUE";
export type AgentRunStatus = "AWAITING_APPROVAL" | "DONE";

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
    readonly examples: readonly string[];
  }>;
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
