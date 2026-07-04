/**
 * **Commerce work domain — core types** (pure, offline).
 *
 * The minimal FDE work spine both product tracks converge on
 * (`docs/two-track-product-architecture.md`): a sanitized `CommerceSignal` is turned into a `WorkItem`
 * that moves through one auditable lifecycle
 *
 *   Signal → WorkItem → Proposal → Approval → ActionIntent → ExecutionResult → VerificationResult
 *
 * This module is **types only** — no I/O, no DB, no HTTP, no LLM, no connector call, no UI, no scheduler,
 * and (per the collector recency rules) no wall-clock read: every time value is a caller-supplied epoch-ms
 * (`atMs` / `referenceTimeMs`), never `Date.now`/`new Date`.
 *
 * **Ownership & visibility are explicit.** A `Party` is a `SELLER` or a `MANUFACTURER`. The seller owns raw
 * channel data; a `CommerceSignal` carries a `sellerId` owner and separates `shareable` (sanitized,
 * grantable) content from `sellerPrivate` (order/customer references, withheld unless a `DataGrant` grants
 * them). See `data-grant.ts` / `access.ts` for the enforcement, `work-item.ts` for the transitions.
 *
 * Everything crossing the boundary is a sanitized enum / boolean / coarse bucket / opaque hash — never raw
 * review/inquiry/claim text, reference codes, exact amounts, identity, tokens, or raw timestamps.
 */

import type { CommerceChannel } from "../connection/sync-state";
import type { RecencyBucket } from "../events/recency-bucket";

// ── Parties, ownership ──────────────────────────────────────────────────────────────────────────────

/** The two audiences. The seller runs a store; the manufacturer sits upstream of many sellers. */
export type PartyRole = "SELLER" | "MANUFACTURER";

/** A concrete actor/owner. `partyId` is a non-PII party identifier (a seller id / manufacturer id). */
export interface Party {
  role: PartyRole;
  partyId: string;
}

/** Structural equality for two parties (role + id). */
export function samePartyAs(a: Party, b: Party): boolean {
  return a.role === b.role && a.partyId === b.partyId;
}

// ── Signals ─────────────────────────────────────────────────────────────────────────────────────────

/** The commerce signal categories a work item can originate from. */
export type SignalKind = "review" | "cs_inquiry" | "order_exception" | "claim" | "product_voc";

/** Coarse severity bucket — never a raw score or count. */
export type SeverityBucket = "low" | "mid" | "high";

/** A coarse, non-PII product reference used for manufacturer-side aggregation. */
export interface ProductRef {
  /** Catalog-level product id (non-PII); shared with a manufacturer only within grant scope. */
  productId: string;
}

/** Sanitized, grantable signal content — safe to expose to a manufacturer WITHIN an active grant. */
export interface SignalShareable {
  severityBucket: SeverityBucket;
  /** Coarse topic category (e.g. "sizing", "shipping_delay") — never the raw text. */
  topicCategory: string;
  /** Coarse recency bucket; `unknown` when the source time was unknown. */
  recencyBucket: RecencyBucket;
}

/**
 * Seller-private data — the raw operational values an operator/executor needs later (draft a reply,
 * reconcile an order, execute a channel action), plus optional one-way hashes for matching. Withheld from a
 * manufacturer unless the grant explicitly includes seller-private fields; the projection layer
 * (`access.ts`) strips this WHOLE object to `null` otherwise, so the raw values never cross the boundary
 * without an explicit grant. Hashes are retained ADDITIONALLY, never as the sole retained value.
 */
export interface SignalSellerPrivate {
  /** Raw source content (e.g. the inquiry/review/claim text). */
  sourceText: string | null;
  /** Raw order reference. */
  orderRef: string | null;
  /** The channel-side source reference needed for later execution (e.g. the channel inquiry id). */
  channelSourceRef: string | null;
  /** Response deadline (epoch ms) when present. */
  responseDeadlineAt: number | null;
  /** One-way hash of the order reference, kept additionally for matching/dedup. */
  orderRefHash: string | null;
  /** One-way hash of any customer reference, kept additionally for matching/dedup. */
  customerRefHash: string | null;
}

/**
 * A sanitized observation derived from a seller's channel data. The seller (`sellerId`) OWNS it; a
 * manufacturer sees it only through an active scoped {@link DataGrant} (see `access.ts`).
 */
export interface CommerceSignal {
  signalId: string;
  channel: CommerceChannel;
  kind: SignalKind;
  /** The owning seller — raw channel data belongs to them. */
  sellerId: string;
  /** Coarse product reference for manufacturer aggregation; null when not product-scoped. */
  productRef: ProductRef | null;
  shareable: SignalShareable;
  sellerPrivate: SignalSellerPrivate;
}

// ── Work item lifecycle ───────────────────────────────────────────────────────────────────────────

/**
 * The lifecycle phase of a work item. `REJECTED` and `FAILED` are terminal non-success; `COMPLETED` is the
 * only terminal success (verification passed). Execution success alone is `EXECUTED`, NOT completion.
 */
export type WorkItemPhase =
  | "OPEN"
  | "PROPOSED"
  | "APPROVED"
  | "REJECTED"
  | "ACTION_PENDING"
  | "EXECUTED"
  | "COMPLETED"
  | "FAILED";

/** Why a work item reached the terminal `FAILED` phase. */
export type WorkItemFailureReason = "EXECUTION_FAILED" | "VERIFICATION_FAILED";

/**
 * The action a proposal/intent would perform, grouped by side-effect class (see `action-authority.ts`).
 * Coarse kinds only — no free-form payload.
 *  - INTERNAL (no external side effect): `CLASSIFY_SIGNAL`, `CREATE_INTERNAL_TASK`;
 *  - SELLER_ACTION_REQUEST (a manufacturer asking a seller to act — NOT a direct side effect):
 *    `REQUEST_SELLER_ACTION`;
 *  - SELLER_CHANNEL_WRITE (an external write on the seller's channel — inquiry/review reply, order/shipment
 *    change, cancellation/refund/claim, any external channel write): the rest.
 */
export type ActionKind =
  | "CLASSIFY_SIGNAL"
  | "CREATE_INTERNAL_TASK"
  | "REQUEST_SELLER_ACTION"
  | "POST_INQUIRY_REPLY"
  | "POST_REVIEW_REPLY"
  | "CHANGE_ORDER_OR_SHIPMENT"
  | "ISSUE_CANCELLATION_REFUND_OR_CLAIM"
  | "EXTERNAL_CHANNEL_WRITE";

/** The owned unit of work a signal rolls up into. */
export interface WorkItem {
  workItemId: string;
  signalId: string;
  /** The responsible party (a seller for own-store work; a manufacturer for granted product/VOC work). */
  owner: Party;
  /**
   * The seller who owns the underlying channel data — the subject of grant re-evaluation on every
   * manufacturer-owned transition. Equals `owner.partyId` for a seller-owned item.
   */
  sourceSellerId: string;
  channel: CommerceChannel;
  productRef: ProductRef | null;
  kind: SignalKind;
  phase: WorkItemPhase;
  /** Set only in the `FAILED` phase; null otherwise. */
  failureReason: WorkItemFailureReason | null;
}

/** A suggested action for a work item. Purely advisory — a proposal NEVER executes anything. */
export interface AgentProposal {
  proposalId: string;
  workItemId: string;
  actionKind: ActionKind;
  /** Coarse summary category of the suggestion — never raw drafted content. */
  summaryCategory: string;
  /** Whether this action needs human approval before it can become an action intent (per policy). */
  requiresApproval: boolean;
  proposedBy: Party;
}

/** A recorded approval decision. `mode` distinguishes an auto-approval from a human sign-off. */
export interface ApprovalDecision {
  approved: boolean;
  /** The human approver; null for an `AUTO` decision. */
  approver: Party | null;
  mode: "AUTO" | "HUMAN";
}

/** An intent to act — created ONLY after approval. It describes what WOULD run; it performs no side effect. */
export interface ActionIntent {
  actionIntentId: string;
  workItemId: string;
  actionKind: ActionKind;
  /** Coarse category of the (sanitized) parameters — never raw content. */
  paramsCategory: string;
}

/** The recorded outcome of executing an action intent (the side effect itself is out of this domain). */
export interface ExecutionResult {
  executionResultId: string;
  workItemId: string;
  success: boolean;
  /** Coarse outcome category. */
  outcomeCategory: string;
}

/** The recorded outcome of verifying an execution. A work item is complete ONLY when `verified` is true. */
export interface VerificationResult {
  verificationResultId: string;
  workItemId: string;
  verified: boolean;
  /** Coarse category of the verification check. */
  checkCategory: string;
}

// ── Immutable audit ───────────────────────────────────────────────────────────────────────────────

/** One immutable audit event per lifecycle transition. */
export type AuditEventType =
  | "WORK_ITEM_OPENED"
  | "PROPOSAL_ADDED"
  | "APPROVAL_GRANTED"
  | "APPROVAL_REJECTED"
  | "ACTION_INTENT_CREATED"
  | "EXECUTION_RECORDED"
  | "VERIFICATION_RECORDED";

/**
 * An append-only audit record. `commandId` is the originating (idempotency) command id. `atMs` is the
 * CALLER-supplied reference time (the domain never reads a wall clock). Carries only ids / enums / the
 * acting party — never raw content.
 */
export interface AuditEvent {
  auditId: string;
  /** The id of the command that produced this transition. */
  commandId: string;
  workItemId: string;
  type: AuditEventType;
  phaseFrom: WorkItemPhase;
  phaseTo: WorkItemPhase;
  actor: Party;
  atMs: number;
}

/**
 * The record of a command that has already been applied — keyed by its `commandId` in the aggregate. Stores
 * the transition it produced so a replay (same `commandId`, same intent) is a no-op while a reused
 * `commandId` for a DIFFERENT transition is a `CONFLICT`. This is the authoritative idempotency ledger —
 * idempotency is NEVER derived from audit length or event index.
 */
export interface AppliedCommand {
  type: AuditEventType;
  /** The primary artifact id the command created (proposal/intent/execution/verification id), or null. */
  artifactId: string | null;
}

/**
 * The full state of one work item: the item plus each lifecycle artifact, the immutable audit trail, and
 * the applied-command ledger. Transitions return a NEW aggregate (never mutated in place); `audit` is
 * append-only and `appliedCommands` grows by one entry per real transition. Fully serializable — replay
 * idempotency survives a JSON round-trip because it reads only this data.
 */
export interface WorkItemAggregate {
  workItem: WorkItem;
  proposal: AgentProposal | null;
  approval: ApprovalDecision | null;
  actionIntent: ActionIntent | null;
  execution: ExecutionResult | null;
  verification: VerificationResult | null;
  audit: readonly AuditEvent[];
  /** Idempotency ledger: `commandId` → the transition it produced. */
  appliedCommands: Readonly<Record<string, AppliedCommand>>;
}

// ── Transition results ──────────────────────────────────────────────────────────────────────────────

/**
 * Why a transition was refused. Sanitized codes — safe to surface.
 *  - `AUTHORITY_DENIED` — the actor lacks action authority (e.g. a manufacturer attempting a seller-channel
 *    write); distinct from read visibility.
 *  - `ACCESS_REVOKED`   — a manufacturer transition re-evaluated its scoped grant and it is no longer active
 *    (revoked / expired / out of scope). Distinct from `GRANT_DENIED`, which is the INITIAL open-time denial.
 */
export type TransitionErrorCode =
  | "WRONG_PHASE"
  | "NOT_OWNER"
  | "APPROVAL_REQUIRED"
  | "AUTHORITY_DENIED"
  | "GRANT_DENIED"
  | "ACCESS_REVOKED"
  | "CONFLICT";

export interface TransitionError {
  code: TransitionErrorCode;
  message: string;
}

/**
 * The outcome of a transition. On success, `idempotent` is true when the command had already been applied
 * (the aggregate is unchanged and `emitted` is null) — re-applying a transition is always safe.
 */
export type TransitionOutcome =
  | { ok: true; aggregate: WorkItemAggregate; emitted: AuditEvent | null; idempotent: boolean }
  | { ok: false; error: TransitionError };
