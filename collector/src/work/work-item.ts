/**
 * **Work item lifecycle transitions** (pure, offline).
 *
 * The one auditable lifecycle both product tracks run:
 *
 *   Signal → WorkItem → Proposal → Approval → ActionIntent → ExecutionResult → VerificationResult
 *
 * Every transition is a pure function `(aggregate, command) → TransitionOutcome`: it never mutates its
 * input and appends exactly one immutable {@link AuditEvent} (stamped with the originating `commandId`) on a
 * real state change.
 *
 * **Idempotency is command-id based, not positional.** Every state-changing command carries an explicit
 * `commandId`. The aggregate keeps an applied-command ledger; re-applying the same command returns the
 * unchanged aggregate (`idempotent: true`, no new event), and reusing a `commandId` for a DIFFERENT
 * transition is refused (`CONFLICT`). Idempotency is NEVER derived from audit length or event index, so it
 * survives serialization.
 *
 * **Authority ≠ visibility.** A read grant does not confer action authority: `authorizeAction`
 * (`action-authority.ts`) governs WHO may drive an action — a manufacturer can `REQUEST_SELLER_ACTION` but
 * never directly create an executable seller-channel `ActionIntent` (`AUTHORITY_DENIED`).
 *
 * **Grant is re-evaluated on every manufacturer-owned transition.** Proposing and creating an action intent
 * on a manufacturer work item re-check the scoped grant against the caller's `referenceTimeMs`; a revoked or
 * expired grant returns `ACCESS_REVOKED` — an existing work item never keeps riding a previously valid grant.
 *
 * Other invariants: proposals never execute; an action intent needs `APPROVED` first (`APPROVAL_REQUIRED`);
 * execution success is not completion (a passing `VerificationResult` is required, else `FAILED`); each
 * aggregate is independent; and no wall clock is read (audit time is the caller-supplied `atMs`).
 */

import type {
  ActionIntent,
  ActionKind,
  AgentProposal,
  AppliedCommand,
  ApprovalDecision,
  AuditEvent,
  AuditEventType,
  CommerceSignal,
  ExecutionResult,
  Party,
  TransitionError,
  TransitionErrorCode,
  TransitionOutcome,
  VerificationResult,
  WorkItem,
  WorkItemAggregate,
  WorkItemPhase,
} from "./types";
import { samePartyAs } from "./types";
import { requiresApproval, type ApprovalPolicy } from "./approval-policy";
import { authorizeAction } from "./action-authority";
import { evaluateGrant, type DataGrant } from "./data-grant";

// ── Commands (caller supplies an explicit commandId + ids + reference time — no id generation, no clock) ──

export interface OpenWorkItemCommand {
  commandId: string;
  workItemId: string;
  actor: Party;
  atMs: number;
}
export interface ProposeActionCommand {
  commandId: string;
  proposalId: string;
  actor: Party;
  actionKind: ActionKind;
  summaryCategory: string;
  atMs: number;
}
export interface ApprovalCommand {
  commandId: string;
  actor: Party;
  atMs: number;
}
export interface CreateActionIntentCommand {
  commandId: string;
  actionIntentId: string;
  actor: Party;
  paramsCategory: string;
  atMs: number;
}
export interface RecordExecutionCommand {
  commandId: string;
  executionResultId: string;
  actor: Party;
  success: boolean;
  outcomeCategory: string;
  atMs: number;
}
export interface RecordVerificationCommand {
  commandId: string;
  verificationResultId: string;
  actor: Party;
  verified: boolean;
  checkCategory: string;
  atMs: number;
}

/** The scoped-grant context re-evaluated on a manufacturer-owned transition (ignored for seller-owned). */
export interface GrantAuthzContext {
  grant: DataGrant | null;
  referenceTimeMs: number;
}

// ── Internal helpers ─────────────────────────────────────────────────────────────────────────────────

const fail = (code: TransitionErrorCode, message: string): TransitionOutcome => ({ ok: false, error: { code, message } });
const idempotent = (aggregate: WorkItemAggregate): TransitionOutcome => ({ ok: true, aggregate, emitted: null, idempotent: true });

/** Command-id gate: replay → idempotent no-op; reused id for a different transition → CONFLICT; else proceed. */
function precheckCommand(agg: WorkItemAggregate, commandId: string, intended: AppliedCommand): TransitionOutcome | null {
  const prior = agg.appliedCommands[commandId];
  if (prior === undefined) return null;
  return prior.type === intended.type && prior.artifactId === intended.artifactId
    ? idempotent(agg)
    : fail("CONFLICT", "command id reused for a different transition");
}

/** Deterministic, clock-free audit id keyed by command (not by index): work item + command id + type. */
function auditFor(agg: WorkItemAggregate, commandId: string, type: AuditEventType, phaseFrom: WorkItemPhase, phaseTo: WorkItemPhase, actor: Party, atMs: number): AuditEvent {
  return { auditId: `${agg.workItem.workItemId}:${commandId}:${type}`, commandId, workItemId: agg.workItem.workItemId, type, phaseFrom, phaseTo, actor, atMs };
}

/** Refuse unless the actor owns the work item. */
function ownerGuard(agg: WorkItemAggregate, actor: Party): TransitionError | null {
  return samePartyAs(actor, agg.workItem.owner) ? null : { code: "NOT_OWNER", message: "actor does not own this work item" };
}

/**
 * Re-evaluate the scoped grant for a manufacturer-owned work item against the caller's reference time. No-op
 * for a seller-owned item. A manufacturer transition with no grant context, or a no-longer-active grant, is
 * `ACCESS_REVOKED`.
 */
function grantGuard(agg: WorkItemAggregate, authz: GrantAuthzContext | undefined): TransitionError | null {
  const { workItem } = agg;
  if (workItem.owner.role !== "MANUFACTURER") return null;
  if (authz === undefined) return { code: "ACCESS_REVOKED", message: "a manufacturer transition requires an active grant context" };
  const decision = evaluateGrant(
    authz.grant,
    { sellerId: workItem.sourceSellerId, manufacturerId: workItem.owner.partyId, channel: workItem.channel, productId: workItem.productRef?.productId ?? null, signalKind: workItem.kind, needsSellerPrivateFields: false },
    authz.referenceTimeMs,
  );
  return decision.allowed ? null : { code: "ACCESS_REVOKED", message: `grant no longer active: ${decision.reason}` };
}

/** Apply a phase change + artifacts, appending one audit event and recording the command; returns success. */
function transition(
  agg: WorkItemAggregate,
  patch: Partial<Pick<WorkItemAggregate, "proposal" | "approval" | "actionIntent" | "execution" | "verification">>,
  workItemPatch: Partial<Pick<WorkItem, "phase" | "failureReason">>,
  event: AuditEvent,
  applied: AppliedCommand,
): TransitionOutcome {
  const aggregate: WorkItemAggregate = {
    ...agg,
    ...patch,
    workItem: { ...agg.workItem, ...workItemPatch },
    audit: [...agg.audit, event],
    appliedCommands: { ...agg.appliedCommands, [event.commandId]: applied },
  };
  return { ok: true, aggregate, emitted: event, idempotent: false };
}

// ── Opening a work item from a signal ────────────────────────────────────────────────────────────────

function openedAggregate(signal: CommerceSignal, owner: Party, cmd: OpenWorkItemCommand): WorkItemAggregate {
  const workItem: WorkItem = {
    workItemId: cmd.workItemId,
    signalId: signal.signalId,
    owner,
    sourceSellerId: signal.sellerId,
    channel: signal.channel,
    productRef: signal.productRef,
    kind: signal.kind,
    phase: "OPEN",
    failureReason: null,
  };
  const seed: WorkItemAggregate = { workItem, proposal: null, approval: null, actionIntent: null, execution: null, verification: null, audit: [], appliedCommands: {} };
  const event = auditFor(seed, cmd.commandId, "WORK_ITEM_OPENED", "OPEN", "OPEN", cmd.actor, cmd.atMs);
  return { ...seed, audit: [event], appliedCommands: { [cmd.commandId]: { type: "WORK_ITEM_OPENED", artifactId: cmd.workItemId } } };
}

/**
 * Open a seller-owned work item from the seller's own signal. The actor must BE the owning seller
 * (`NOT_OWNER` otherwise). No grant is involved — the seller owns their raw channel data.
 */
export function openSellerWorkItem(signal: CommerceSignal, cmd: OpenWorkItemCommand): TransitionOutcome {
  if (cmd.actor.role !== "SELLER" || cmd.actor.partyId !== signal.sellerId) {
    return fail("NOT_OWNER", "only the owning seller can open a work item on their own signal");
  }
  return { ok: true, aggregate: openedAggregate(signal, cmd.actor, cmd), emitted: null, idempotent: false };
}

/**
 * Open a manufacturer-owned work item from a seller's signal — allowed ONLY when an active scoped grant
 * covers the base (non-private) read at `referenceTimeMs`. A missing / revoked / expired / out-of-scope
 * grant is `GRANT_DENIED` (the initial denial; later transitions re-check and return `ACCESS_REVOKED`).
 */
export function openManufacturerWorkItem(
  signal: CommerceSignal,
  cmd: OpenWorkItemCommand,
  grant: DataGrant | null,
  referenceTimeMs: number,
): TransitionOutcome {
  if (cmd.actor.role !== "MANUFACTURER") return fail("NOT_OWNER", "actor is not a manufacturer");
  const decision = evaluateGrant(
    grant,
    { sellerId: signal.sellerId, manufacturerId: cmd.actor.partyId, channel: signal.channel, productId: signal.productRef?.productId ?? null, signalKind: signal.kind, needsSellerPrivateFields: false },
    referenceTimeMs,
  );
  if (!decision.allowed) return fail("GRANT_DENIED", `manufacturer access denied: ${decision.reason}`);
  return { ok: true, aggregate: openedAggregate(signal, cmd.actor, cmd), emitted: null, idempotent: false };
}

// ── Proposal (never executes) ──────────────────────────────────────────────────────────────────────

export function proposeAction(agg: WorkItemAggregate, cmd: ProposeActionCommand, policy: ApprovalPolicy, authz?: GrantAuthzContext): TransitionOutcome {
  const gate = precheckCommand(agg, cmd.commandId, { type: "PROPOSAL_ADDED", artifactId: cmd.proposalId });
  if (gate) return gate;
  if (agg.workItem.phase !== "OPEN") return fail("WRONG_PHASE", `cannot propose from phase ${agg.workItem.phase}`);

  const authority = authorizeAction(cmd.actor, agg.workItem, cmd.actionKind);
  if (!authority.authorized) return fail("AUTHORITY_DENIED", `not authorized for ${cmd.actionKind}: ${authority.reason}`);
  const revoked = grantGuard(agg, authz);
  if (revoked) return { ok: false, error: revoked };

  const proposal: AgentProposal = {
    proposalId: cmd.proposalId,
    workItemId: agg.workItem.workItemId,
    actionKind: cmd.actionKind,
    summaryCategory: cmd.summaryCategory,
    requiresApproval: requiresApproval(policy, { actionKind: cmd.actionKind }),
    proposedBy: cmd.actor,
  };
  return transition(agg, { proposal }, { phase: "PROPOSED" }, auditFor(agg, cmd.commandId, "PROPOSAL_ADDED", "OPEN", "PROPOSED", cmd.actor, cmd.atMs), { type: "PROPOSAL_ADDED", artifactId: cmd.proposalId });
}

// ── Approval gate ─────────────────────────────────────────────────────────────────────────────────

/** Human approval: PROPOSED → APPROVED. Re-approving an approved item is idempotent. */
export function approve(agg: WorkItemAggregate, cmd: ApprovalCommand): TransitionOutcome {
  const gate = precheckCommand(agg, cmd.commandId, { type: "APPROVAL_GRANTED", artifactId: null });
  if (gate) return gate;
  if (agg.workItem.phase === "APPROVED") return idempotent(agg);
  if (agg.workItem.phase === "REJECTED") return fail("CONFLICT", "work item was already rejected");
  if (agg.workItem.phase !== "PROPOSED") return fail("WRONG_PHASE", `cannot approve from phase ${agg.workItem.phase}`);
  const notOwner = ownerGuard(agg, cmd.actor);
  if (notOwner) return { ok: false, error: notOwner };

  const approval: ApprovalDecision = { approved: true, approver: cmd.actor, mode: "HUMAN" };
  return transition(agg, { approval }, { phase: "APPROVED" }, auditFor(agg, cmd.commandId, "APPROVAL_GRANTED", "PROPOSED", "APPROVED", cmd.actor, cmd.atMs), { type: "APPROVAL_GRANTED", artifactId: null });
}

/** Auto-approval: PROPOSED → APPROVED, allowed ONLY when the proposal does not require human approval. */
export function autoApprove(agg: WorkItemAggregate, cmd: ApprovalCommand): TransitionOutcome {
  const gate = precheckCommand(agg, cmd.commandId, { type: "APPROVAL_GRANTED", artifactId: null });
  if (gate) return gate;
  if (agg.workItem.phase === "APPROVED") return idempotent(agg);
  if (agg.workItem.phase === "REJECTED") return fail("CONFLICT", "work item was already rejected");
  if (agg.workItem.phase !== "PROPOSED") return fail("WRONG_PHASE", `cannot auto-approve from phase ${agg.workItem.phase}`);
  const notOwner = ownerGuard(agg, cmd.actor);
  if (notOwner) return { ok: false, error: notOwner };
  if (agg.proposal?.requiresApproval !== false) return fail("APPROVAL_REQUIRED", "this action requires human approval; cannot auto-approve");

  const approval: ApprovalDecision = { approved: true, approver: null, mode: "AUTO" };
  return transition(agg, { approval }, { phase: "APPROVED" }, auditFor(agg, cmd.commandId, "APPROVAL_GRANTED", "PROPOSED", "APPROVED", cmd.actor, cmd.atMs), { type: "APPROVAL_GRANTED", artifactId: null });
}

/** Human rejection: PROPOSED → REJECTED (terminal). Re-rejecting is idempotent. */
export function reject(agg: WorkItemAggregate, cmd: ApprovalCommand): TransitionOutcome {
  const gate = precheckCommand(agg, cmd.commandId, { type: "APPROVAL_REJECTED", artifactId: null });
  if (gate) return gate;
  if (agg.workItem.phase === "REJECTED") return idempotent(agg);
  if (agg.workItem.phase === "APPROVED") return fail("CONFLICT", "work item was already approved");
  if (agg.workItem.phase !== "PROPOSED") return fail("WRONG_PHASE", `cannot reject from phase ${agg.workItem.phase}`);
  const notOwner = ownerGuard(agg, cmd.actor);
  if (notOwner) return { ok: false, error: notOwner };

  const approval: ApprovalDecision = { approved: false, approver: cmd.actor, mode: "HUMAN" };
  return transition(agg, { approval }, { phase: "REJECTED" }, auditFor(agg, cmd.commandId, "APPROVAL_REJECTED", "PROPOSED", "REJECTED", cmd.actor, cmd.atMs), { type: "APPROVAL_REJECTED", artifactId: null });
}

// ── Action intent (only after approval; authority + grant re-checked) ─────────────────────────────────

export function createActionIntent(agg: WorkItemAggregate, cmd: CreateActionIntentCommand, authz?: GrantAuthzContext): TransitionOutcome {
  const gate = precheckCommand(agg, cmd.commandId, { type: "ACTION_INTENT_CREATED", artifactId: cmd.actionIntentId });
  if (gate) return gate;
  if (agg.workItem.phase === "PROPOSED") return fail("APPROVAL_REQUIRED", "the work item must be approved before an action intent");
  if (agg.workItem.phase !== "APPROVED") return fail("WRONG_PHASE", `cannot create an action intent from phase ${agg.workItem.phase}`);
  if (agg.proposal === null) return fail("CONFLICT", "no proposal to derive the action from");

  // Authority (who may act) is re-checked here — a manufacturer can never create a seller-channel write.
  const authority = authorizeAction(cmd.actor, agg.workItem, agg.proposal.actionKind);
  if (!authority.authorized) return fail("AUTHORITY_DENIED", `not authorized to execute ${agg.proposal.actionKind}: ${authority.reason}`);
  const revoked = grantGuard(agg, authz);
  if (revoked) return { ok: false, error: revoked };

  const actionIntent: ActionIntent = {
    actionIntentId: cmd.actionIntentId,
    workItemId: agg.workItem.workItemId,
    actionKind: agg.proposal.actionKind,
    paramsCategory: cmd.paramsCategory,
  };
  return transition(agg, { actionIntent }, { phase: "ACTION_PENDING" }, auditFor(agg, cmd.commandId, "ACTION_INTENT_CREATED", "APPROVED", "ACTION_PENDING", cmd.actor, cmd.atMs), { type: "ACTION_INTENT_CREATED", artifactId: cmd.actionIntentId });
}

// ── Execution (success ≠ completion) ─────────────────────────────────────────────────────────────────

export function recordExecution(agg: WorkItemAggregate, cmd: RecordExecutionCommand): TransitionOutcome {
  const gate = precheckCommand(agg, cmd.commandId, { type: "EXECUTION_RECORDED", artifactId: cmd.executionResultId });
  if (gate) return gate;
  if (agg.workItem.phase !== "ACTION_PENDING") return fail("WRONG_PHASE", `cannot record execution from phase ${agg.workItem.phase}`);
  const notOwner = ownerGuard(agg, cmd.actor);
  if (notOwner) return { ok: false, error: notOwner };

  const execution: ExecutionResult = { executionResultId: cmd.executionResultId, workItemId: agg.workItem.workItemId, success: cmd.success, outcomeCategory: cmd.outcomeCategory };
  // Success advances to EXECUTED (awaiting verification) — NOT to COMPLETED. Failure is terminal FAILED.
  const phaseTo: WorkItemPhase = cmd.success ? "EXECUTED" : "FAILED";
  const workItemPatch = cmd.success ? { phase: phaseTo, failureReason: null } : { phase: phaseTo, failureReason: "EXECUTION_FAILED" as const };
  return transition(agg, { execution }, workItemPatch, auditFor(agg, cmd.commandId, "EXECUTION_RECORDED", "ACTION_PENDING", phaseTo, cmd.actor, cmd.atMs), { type: "EXECUTION_RECORDED", artifactId: cmd.executionResultId });
}

// ── Verification (the only path to completion) ────────────────────────────────────────────────────────

export function recordVerification(agg: WorkItemAggregate, cmd: RecordVerificationCommand): TransitionOutcome {
  const gate = precheckCommand(agg, cmd.commandId, { type: "VERIFICATION_RECORDED", artifactId: cmd.verificationResultId });
  if (gate) return gate;
  if (agg.workItem.phase !== "EXECUTED") return fail("WRONG_PHASE", `cannot verify from phase ${agg.workItem.phase}`);
  const notOwner = ownerGuard(agg, cmd.actor);
  if (notOwner) return { ok: false, error: notOwner };

  const verification: VerificationResult = { verificationResultId: cmd.verificationResultId, workItemId: agg.workItem.workItemId, verified: cmd.verified, checkCategory: cmd.checkCategory };
  const phaseTo: WorkItemPhase = cmd.verified ? "COMPLETED" : "FAILED";
  const workItemPatch = cmd.verified ? { phase: phaseTo, failureReason: null } : { phase: phaseTo, failureReason: "VERIFICATION_FAILED" as const };
  return transition(agg, { verification }, workItemPatch, auditFor(agg, cmd.commandId, "VERIFICATION_RECORDED", "EXECUTED", phaseTo, cmd.actor, cmd.atMs), { type: "VERIFICATION_RECORDED", artifactId: cmd.verificationResultId });
}
