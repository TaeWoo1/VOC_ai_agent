/**
 * **Inquiry execution coordinator** (pure, offline application layer).
 *
 * Drives the tail of the inquiry lifecycle from an APPROVED slice, bound to the EXACT approved reply:
 *
 *   ActionIntent → (dispatch) → ExecutionResult → VerificationResult → (COMPLETED | FAILED | unresolved)
 *
 * Everything is keyed by the ActionIntent id AND the `approvedReplyHash`: the executor is called at most once
 * per intent, the verifier confirms the observed reply MATCHES the approved hash, and execution success alone
 * never completes the work item.
 *
 * **Private state vs. sanitized status.** The raw approved reply text lives ONLY in `privateState`; the
 * work-item aggregate and {@link toSanitizedSnapshot} never contain inquiry or reply text.
 *
 * **Ambiguous-dispatch durability.** `dispatchStarted` is set BEFORE the external write; in production the
 * caller persists the slice at that point. After a crash + rehydration, `dispatchStarted` with no recorded
 * outcome is AMBIGUOUS — the coordinator verifies FIRST and never blindly calls the executor again (the
 * in-memory attempt flag alone cannot guarantee external exactly-once; the production executor must enforce
 * the idempotency key + reply hash). See the slice-model note.
 *
 * Resolution matrix:
 *  - not approved                       → `NOT_READY` (before any executor call);
 *  - executor `CONFLICT` (key reused w/ different hash) → `EXECUTION_CONFLICT`;
 *  - `NOT_EXECUTED`                     → `EXECUTION_FAILED` (not verified);
 *  - `EXECUTED + VERIFIED`              → `COMPLETED`;
 *  - `EXECUTED + NOT_VERIFIED`          → `VERIFICATION_FAILED`;
 *  - `EXECUTED + INDETERMINATE`         → `EXECUTED_UNRESOLVED`;
 *  - `UNKNOWN`/ambiguous + `VERIFIED`   → `COMPLETED`;
 *  - `UNKNOWN`/ambiguous + `NOT_VERIFIED`/`INDETERMINATE` → `MANUAL_RECONCILIATION_REQUIRED`.
 *
 * No live write, connector, browser, HTTP, persistence, LLM, or auto-retry of an ambiguous write; no
 * wall-clock read (`atMs` is supplied).
 */

import { recordExecution, recordVerification } from "../work/work-item";
import type { CommerceSignal, WorkItemAggregate, WorkItemPhase } from "../work/types";
import type { CommerceChannel } from "../connection/sync-state";
import type { InquirySourceIds } from "./intake";
import { approvedReplyHash, canonicalizeApprovedReply } from "./reply-hash";
import { dispatchBindingHash } from "./dispatch-binding";
import type { InquiryReplyExecutor, InquiryExecutionStatus } from "./reply-executor";
import type { InquiryReplyVerifier, InquiryVerificationStatus } from "./reply-verifier";

const POST_INQUIRY_REPLY = "POST_INQUIRY_REPLY";

/** The coordinator-level resolution of an inquiry execution. */
export type InquiryResolution =
  | "COMPLETED"
  | "EXECUTION_FAILED"
  | "VERIFICATION_FAILED"
  | "EXECUTION_CONFLICT"
  | "EXECUTED_UNRESOLVED"
  | "MANUAL_RECONCILIATION_REQUIRED";

/** Terminal resolutions never re-run; non-terminal ones (`EXECUTED_UNRESOLVED`, manual) re-verify. */
const TERMINAL: ReadonlySet<InquiryResolution> = new Set<InquiryResolution>(["COMPLETED", "EXECUTION_FAILED", "VERIFICATION_FAILED", "EXECUTION_CONFLICT"]);

/** The serializable state of an inquiry as it moves through execution + verification. */
export interface InquiryExecutionSlice {
  ids: InquirySourceIds;
  signal: CommerceSignal;
  aggregate: WorkItemAggregate;
  /** Where the write goes; `connectionId` is not on the sanitized signal, so it is carried here. */
  target: { connectionId: string; channel: CommerceChannel; channelInquiryRef: string };
  /** Hash of the normalized approved reply — the binding fingerprint for executor + verifier. */
  approvedReplyHash: string;
  /** The ActionIntent id, used as the executor's idempotency key. */
  actionIdempotencyKey: string;
  /** Explicitly seller-private execution state — the ONLY place the raw approved reply text lives. */
  privateState: { approvedReplyPayload: string };
  /** Set (persisted) BEFORE the external write; started-without-outcome after rehydration = ambiguous. */
  dispatchStarted: boolean;
  /** Set once the executor returned an outcome (any status) — guarantees at-most-one write per intent. */
  executionAttempted: boolean;
  lastExecutionStatus: InquiryExecutionStatus | null;
  lastVerificationStatus: InquiryVerificationStatus | null;
  resolution: InquiryResolution | null;
}

/** A sanitized status snapshot — hashes/enums/ids only, NEVER inquiry or reply text. */
export interface InquiryExecutionSnapshot {
  sourceKey: string;
  workItemId: string;
  channel: CommerceChannel;
  phase: WorkItemPhase;
  resolution: InquiryResolution | null;
  dispatchStarted: boolean;
  executionAttempted: boolean;
  lastExecutionStatus: InquiryExecutionStatus | null;
  lastVerificationStatus: InquiryVerificationStatus | null;
  approvedReplyHash: string;
  actionIdempotencyKey: string;
}

/** Project a slice to its sanitized snapshot — safe to log/return; contains no inquiry or reply text. */
export function toSanitizedSnapshot(slice: InquiryExecutionSlice): InquiryExecutionSnapshot {
  return {
    sourceKey: slice.ids.sourceKey,
    workItemId: slice.aggregate.workItem.workItemId,
    channel: slice.target.channel,
    phase: slice.aggregate.workItem.phase,
    resolution: slice.resolution,
    dispatchStarted: slice.dispatchStarted,
    executionAttempted: slice.executionAttempted,
    lastExecutionStatus: slice.lastExecutionStatus,
    lastVerificationStatus: slice.lastVerificationStatus,
    approvedReplyHash: slice.approvedReplyHash,
    actionIdempotencyKey: slice.actionIdempotencyKey,
  };
}

/** Deterministic lifecycle command/artifact ids derived from the source key (stable across replays/JSON). */
export function lifecycleIds(sourceKey: string) {
  return {
    approveCommandId: `cmd-approve-${sourceKey}`,
    intentCommandId: `cmd-intent-${sourceKey}`,
    actionIntentId: `ai-${sourceKey}`,
    execCommandId: `cmd-exec-${sourceKey}`,
    executionResultId: `ex-${sourceKey}`,
    verifyCommandId: `cmd-verify-${sourceKey}`,
    verificationResultId: `ve-${sourceKey}`,
  };
}

/** Build a not-yet-executed execution slice around a work-item slice (used by the approval coordinator). */
export function executionSliceFrom(
  base: { ids: InquirySourceIds; signal: CommerceSignal; aggregate: WorkItemAggregate },
  opts: { connectionId: string; channelInquiryRef: string; approvedReplyPayload: string; approvedReplyHash: string; actionIdempotencyKey: string },
): InquiryExecutionSlice {
  return {
    ids: base.ids,
    signal: base.signal,
    aggregate: base.aggregate,
    target: { connectionId: opts.connectionId, channel: base.signal.channel, channelInquiryRef: opts.channelInquiryRef },
    approvedReplyHash: opts.approvedReplyHash,
    actionIdempotencyKey: opts.actionIdempotencyKey,
    privateState: { approvedReplyPayload: opts.approvedReplyPayload },
    dispatchStarted: false,
    executionAttempted: false,
    lastExecutionStatus: null,
    lastVerificationStatus: null,
    resolution: null,
  };
}

/**
 * Failure reasons. `NOT_READY` = not approved; `NOT_PREPARED` = not dispatch-prepared; `INVALID_PERMIT` =
 * permit missing / consumed / mismatched / not issued by this runtime; `INVALID_DISPATCH_STATE` = the slice
 * is internally inconsistent (see {@link validateDispatchSlice}); `BINDING_CONFLICT` = the slice's envelope
 * does not match the ActionIntent fingerprint or the registry's immutable binding for this action id.
 */
export type ExecutionFailureReason = "NOT_READY" | "NOT_PREPARED" | "INVALID_PERMIT" | "INVALID_DISPATCH_STATE" | "BINDING_CONFLICT";

export type InquiryExecutionOutcome =
  | { ok: true; slice: InquiryExecutionSlice; resolution: InquiryResolution; idempotent: boolean }
  | { ok: false; reason: ExecutionFailureReason };

/**
 * The outcome of preparing a dispatch — the serializable slice plus the single EPHEMERAL permit for this
 * ActionIntent. `PERMIT_UNAVAILABLE` = the permit was already consumed (no replacement is ever issued);
 * `AMBIGUOUS_PREPARED` = a rehydrated prepared slice with no ACTIVE permit in this runtime (recover, don't
 * re-prepare); `BINDING_CONFLICT` / `INVALID_DISPATCH_STATE` = envelope mismatch / inconsistent slice.
 */
export type PrepareDispatchOutcome =
  | { ok: true; slice: InquiryExecutionSlice; permit: DispatchPermit; idempotent: boolean }
  | { ok: false; reason: "NOT_READY" | "PERMIT_UNAVAILABLE" | "AMBIGUOUS_PREPARED" | "BINDING_CONFLICT" | "INVALID_DISPATCH_STATE" };

/**
 * Fail-closed validation of a slice's internal consistency BEFORE any permit is issued or consumed. Verifies
 * the ActionIntent exists and matches the action key + kind, the target agrees with the signal (channel and
 * channel inquiry reference), the canonical private reply hashes to `approvedReplyHash`, and the ActionIntent
 * fingerprint equals the recomputed dispatch binding. Returns the recomputed `dispatchBindingHash` on success.
 */
export function validateDispatchSlice(slice: InquiryExecutionSlice):
  | { ok: true; dispatchBindingHash: string }
  | { ok: false; reason: "INVALID_DISPATCH_STATE" | "BINDING_CONFLICT" } {
  const intent = slice.aggregate.actionIntent;
  if (intent === null) return { ok: false, reason: "INVALID_DISPATCH_STATE" };
  if (intent.actionIntentId !== slice.actionIdempotencyKey) return { ok: false, reason: "INVALID_DISPATCH_STATE" };
  if (intent.actionKind !== POST_INQUIRY_REPLY) return { ok: false, reason: "INVALID_DISPATCH_STATE" };
  if (slice.signal.channel !== slice.target.channel) return { ok: false, reason: "INVALID_DISPATCH_STATE" };
  if ((slice.signal.sellerPrivate.channelSourceRef ?? "") !== slice.target.channelInquiryRef) return { ok: false, reason: "INVALID_DISPATCH_STATE" };
  if (approvedReplyHash(canonicalizeApprovedReply(slice.privateState.approvedReplyPayload)) !== slice.approvedReplyHash) return { ok: false, reason: "INVALID_DISPATCH_STATE" };

  const recomputed = dispatchBindingHash({
    actionIntentId: intent.actionIntentId,
    actionKind: intent.actionKind,
    connectionId: slice.target.connectionId,
    channel: slice.target.channel,
    channelInquiryRef: slice.target.channelInquiryRef,
    approvedReplyHash: slice.approvedReplyHash,
  });
  if (intent.paramsFingerprint !== recomputed) return { ok: false, reason: "BINDING_CONFLICT" };
  return { ok: true, dispatchBindingHash: recomputed };
}

/**
 * An **ephemeral, non-serializable** authorization to call the executor exactly once for a specific
 * (actionIdempotencyKey, approvedReplyHash) binding. It is validated by RUNTIME IDENTITY (the issuing
 * coordinator's registry), not by its field values — so a JSON-rehydrated slice (which carries no permit)
 * can never reach the executor, and a reconstructed look-alike object is rejected. `toJSON` yields `undefined`
 * so it cannot even be serialized into a persisted bundle.
 */
export class DispatchPermit {
  constructor(
    readonly actionIdempotencyKey: string,
    readonly approvedReplyHash: string,
  ) {}
  /** A permit is ephemeral runtime state — it must never be serialized or persisted. */
  toJSON(): undefined {
    return undefined;
  }
}

type PermitState = "ACTIVE" | "CONSUMED";

/** A registry entry: the immutable binding this ActionIntent is bound to, plus the single permit + its state. */
interface PermitEntry {
  approvedReplyHash: string;
  dispatchBindingHash: string;
  permit: DispatchPermit;
  state: PermitState;
}

export class InquiryExecutionCoordinator {
  /**
   * Per-runtime permit registry, keyed by **`actionIdempotencyKey` only**. Each entry pins the immutable
   * (`approvedReplyHash`, `dispatchBindingHash`) this ActionIntent is bound to, its single permit, and the
   * `ACTIVE → CONSUMED` state. Non-serializable; empty after a restart. Guarantees at most ONE permit per
   * ActionIntent — a different reply/target for the same action id is a `BINDING_CONFLICT`, never a second permit.
   */
  private readonly permits = new Map<string, PermitEntry>();

  constructor(
    private readonly executor: InquiryReplyExecutor,
    private readonly verifier: InquiryReplyVerifier,
  ) {}

  /**
   * **Step 1 of the durable protocol.** Validate the slice, mark it `dispatchStarted` WITHOUT calling the
   * executor, and return the single {@link DispatchPermit} for this ActionIntent. The caller persists the
   * returned SLICE (not the permit) BEFORE executing.
   *  - inconsistent slice → `INVALID_DISPATCH_STATE` / `BINDING_CONFLICT` (fail closed);
   *  - fresh, not-prepared slice → mint ONE ACTIVE permit (`idempotent: false`);
   *  - same action id + same binding while ACTIVE → return the SAME permit (`idempotent: true`);
   *  - same action id + a different reply hash / target binding → `BINDING_CONFLICT` (never a second permit);
   *  - permit already CONSUMED → `PERMIT_UNAVAILABLE` (no replacement — recover verify-first);
   *  - rehydrated prepared slice with no ACTIVE permit → `AMBIGUOUS_PREPARED` (recover, don't re-prepare);
   *  - unapproved / terminal → `NOT_READY`.
   */
  prepareDispatch(slice: InquiryExecutionSlice): PrepareDispatchOutcome {
    if (slice.resolution !== null && TERMINAL.has(slice.resolution)) return { ok: false, reason: "NOT_READY" };
    if (slice.aggregate.workItem.phase !== "ACTION_PENDING") return { ok: false, reason: "NOT_READY" };
    const validation = validateDispatchSlice(slice);
    if (!validation.ok) return { ok: false, reason: validation.reason };

    const existing = this.permits.get(slice.actionIdempotencyKey);
    if (existing !== undefined) {
      // Same ActionIntent id: the binding must match — never mint a second permit for a different envelope.
      if (existing.approvedReplyHash !== slice.approvedReplyHash || existing.dispatchBindingHash !== validation.dispatchBindingHash) {
        return { ok: false, reason: "BINDING_CONFLICT" };
      }
      if (existing.state !== "ACTIVE") return { ok: false, reason: "PERMIT_UNAVAILABLE" };
      const prepared = slice.dispatchStarted ? slice : { ...slice, dispatchStarted: true };
      return { ok: true, slice: prepared, permit: existing.permit, idempotent: true };
    }
    // No registry entry: a fresh slice mints one; a rehydrated prepared slice is ambiguous (recover instead).
    if (slice.dispatchStarted) return { ok: false, reason: "AMBIGUOUS_PREPARED" };
    const permit = new DispatchPermit(slice.actionIdempotencyKey, slice.approvedReplyHash);
    this.permits.set(slice.actionIdempotencyKey, { approvedReplyHash: slice.approvedReplyHash, dispatchBindingHash: validation.dispatchBindingHash, permit, state: "ACTIVE" });
    return { ok: true, slice: { ...slice, dispatchStarted: true }, permit, idempotent: false };
  }

  /**
   * **Step 2 of the durable protocol.** Execute a prepared slice at most once. Validation order (fail closed,
   * NEVER consuming the permit or calling the executor on any failure): prepared state → immutable dispatch
   * binding (self-consistency + registry match) → single ACTIVE permit identity. Only then is the permit
   * atomically marked CONSUMED and the executor called. A JSON-rehydrated prepared slice (no live permit)
   * cannot execute; it must recover via {@link recoverPrepared} / {@link resolve}.
   */
  async executePrepared(slice: InquiryExecutionSlice, permit: DispatchPermit, atMs: number): Promise<InquiryExecutionOutcome> {
    if (slice.resolution !== null && TERMINAL.has(slice.resolution)) {
      return { ok: true, slice, resolution: slice.resolution, idempotent: true };
    }
    // 1. Prepared state — an unprepared/stale slice must NOT consume the permit.
    if (!slice.dispatchStarted) return { ok: false, reason: "NOT_PREPARED" };
    // 2. Immutable dispatch binding — slice self-consistency, then the registry's pinned binding.
    const validation = validateDispatchSlice(slice);
    if (!validation.ok) return { ok: false, reason: validation.reason };
    const entry = this.permits.get(slice.actionIdempotencyKey);
    if (entry === undefined) return { ok: false, reason: "INVALID_PERMIT" };
    if (entry.approvedReplyHash !== slice.approvedReplyHash || entry.dispatchBindingHash !== validation.dispatchBindingHash) {
      return { ok: false, reason: "BINDING_CONFLICT" };
    }
    // 3. Single ACTIVE permit identity.
    if (!(permit instanceof DispatchPermit) || entry.state !== "ACTIVE" || entry.permit !== permit) {
      return { ok: false, reason: "INVALID_PERMIT" };
    }
    // 4. Atomically consume BEFORE the write; 5. call the executor.
    entry.state = "CONSUMED";
    if (slice.executionAttempted) return this.verifyAndSettle({ ...slice }, atMs, slice.aggregate.execution !== null);
    return this.runExecutorThenVerify(slice, atMs);
  }

  /**
   * **Recovery.** For a rehydrated prepared slice (dispatched, but no permit and no recorded outcome), the
   * external write is AMBIGUOUS — verify FIRST and NEVER execute. `VERIFIED` → COMPLETED; `NOT_VERIFIED` /
   * `INDETERMINATE` → `MANUAL_RECONCILIATION_REQUIRED`. A slice that already has an outcome re-verifies;
   * a never-dispatched slice has nothing to recover (`NOT_PREPARED`).
   */
  async recoverPrepared(slice: InquiryExecutionSlice, atMs: number): Promise<InquiryExecutionOutcome> {
    if (slice.resolution !== null && TERMINAL.has(slice.resolution)) {
      return { ok: true, slice, resolution: slice.resolution, idempotent: true };
    }
    if (slice.executionAttempted) return this.verifyAndSettle({ ...slice }, atMs, slice.aggregate.execution !== null);
    if (!slice.dispatchStarted) return { ok: false, reason: "NOT_PREPARED" };
    const ambiguous: InquiryExecutionSlice = { ...slice, executionAttempted: true, lastExecutionStatus: "UNKNOWN" };
    return this.verifyAndSettle(ambiguous, atMs, false);
  }

  /**
   * Convenience router that NEVER auto-executes a fresh slice (that would bypass the caller's persist
   * boundary): terminal → idempotent; has-outcome → re-verify; already-dispatched (recovery) → verify-first;
   * a fresh not-yet-dispatched slice → `NOT_PREPARED` (the caller must `prepareDispatch` + `executePrepared`).
   */
  async resolve(slice: InquiryExecutionSlice, atMs: number): Promise<InquiryExecutionOutcome> {
    if (slice.resolution !== null && TERMINAL.has(slice.resolution)) {
      return { ok: true, slice, resolution: slice.resolution, idempotent: true };
    }
    if (slice.executionAttempted || slice.dispatchStarted) return this.recoverPrepared(slice, atMs);
    if (slice.aggregate.workItem.phase !== "ACTION_PENDING") return { ok: false, reason: "NOT_READY" };
    return { ok: false, reason: "NOT_PREPARED" }; // fresh slice must go through prepareDispatch/executePrepared
  }

  private async runExecutorThenVerify(slice: InquiryExecutionSlice, atMs: number): Promise<InquiryExecutionOutcome> {
    const ids = lifecycleIds(slice.ids.sourceKey);
    const owner = slice.aggregate.workItem.owner;

    // `dispatchStarted` is already set (by prepareDispatch); persistence happened before this write.
    const exec = await this.executor.execute({
      connectionId: slice.target.connectionId,
      channel: slice.target.channel,
      channelInquiryRef: slice.target.channelInquiryRef,
      actionIdempotencyKey: slice.actionIdempotencyKey,
      approvedReplyHash: slice.approvedReplyHash,
      sellerPrivate: { replyPayload: slice.privateState.approvedReplyPayload },
    });
    const attempted: InquiryExecutionSlice = { ...slice, executionAttempted: true, lastExecutionStatus: exec.status };

    if (exec.status === "CONFLICT") {
      const settled: InquiryExecutionSlice = { ...attempted, resolution: "EXECUTION_CONFLICT" };
      return { ok: true, slice: settled, resolution: "EXECUTION_CONFLICT", idempotent: false };
    }
    if (exec.status === "EXECUTED") {
      const r = recordExecution(attempted.aggregate, { commandId: ids.execCommandId, executionResultId: ids.executionResultId, actor: owner, success: true, outcomeCategory: exec.outcomeCategory, atMs });
      return this.verifyAndSettle({ ...attempted, aggregate: r.ok ? r.aggregate : attempted.aggregate }, atMs, true);
    }
    if (exec.status === "NOT_EXECUTED") {
      const r = recordExecution(attempted.aggregate, { commandId: ids.execCommandId, executionResultId: ids.executionResultId, actor: owner, success: false, outcomeCategory: exec.outcomeCategory, atMs });
      const settled: InquiryExecutionSlice = { ...attempted, aggregate: r.ok ? r.aggregate : attempted.aggregate, resolution: "EXECUTION_FAILED" };
      return { ok: true, slice: settled, resolution: "EXECUTION_FAILED", idempotent: false };
    }
    // UNKNOWN: do NOT record execution, do NOT repeat the write — verify first.
    return this.verifyAndSettle(attempted, atMs, false);
  }

  private async verifyAndSettle(slice: InquiryExecutionSlice, atMs: number, executionRecorded: boolean): Promise<InquiryExecutionOutcome> {
    const ids = lifecycleIds(slice.ids.sourceKey);
    const owner = slice.aggregate.workItem.owner;
    const v = await this.verifier.verify({
      connectionId: slice.target.connectionId,
      channel: slice.target.channel,
      channelInquiryRef: slice.target.channelInquiryRef,
      actionIdempotencyKey: slice.actionIdempotencyKey,
      expectedReplyHash: slice.approvedReplyHash,
    });
    const base: InquiryExecutionSlice = { ...slice, lastVerificationStatus: v.status };
    const settle = (aggregate: WorkItemAggregate, resolution: InquiryResolution): InquiryExecutionOutcome => ({ ok: true, slice: { ...base, aggregate, resolution }, resolution, idempotent: false });

    if (executionRecorded) {
      if (v.status === "VERIFIED") {
        const r = recordVerification(base.aggregate, { commandId: ids.verifyCommandId, verificationResultId: ids.verificationResultId, actor: owner, verified: true, checkCategory: v.checkCategory, atMs });
        return settle(r.ok ? r.aggregate : base.aggregate, "COMPLETED");
      }
      if (v.status === "NOT_VERIFIED") {
        const r = recordVerification(base.aggregate, { commandId: ids.verifyCommandId, verificationResultId: ids.verificationResultId, actor: owner, verified: false, checkCategory: v.checkCategory, atMs });
        return settle(r.ok ? r.aggregate : base.aggregate, "VERIFICATION_FAILED");
      }
      return settle(base.aggregate, "EXECUTED_UNRESOLVED"); // INDETERMINATE: remain executed, unresolved
    }

    // UNKNOWN / ambiguous path — execution not recorded.
    if (v.status === "VERIFIED") {
      // The approved reply IS visible → the write landed → record execution + verification → COMPLETED.
      const e = recordExecution(base.aggregate, { commandId: ids.execCommandId, executionResultId: ids.executionResultId, actor: owner, success: true, outcomeCategory: "confirmed_by_verification", atMs });
      const agg1 = e.ok ? e.aggregate : base.aggregate;
      const r = recordVerification(agg1, { commandId: ids.verifyCommandId, verificationResultId: ids.verificationResultId, actor: owner, verified: true, checkCategory: v.checkCategory, atMs });
      return settle(r.ok ? r.aggregate : agg1, "COMPLETED");
    }
    // NOT_VERIFIED / INDETERMINATE after an ambiguous write → a human must reconcile (no auto retry).
    return settle(base.aggregate, "MANUAL_RECONCILIATION_REQUIRED");
  }
}
