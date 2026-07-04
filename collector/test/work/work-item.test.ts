/**
 * Pure offline tests for the work-item lifecycle transitions.
 *
 * Focus: the phase machine (Signal → WorkItem → Proposal → Approval → ActionIntent → Execution →
 * Verification); the conservative approval policy (an inquiry reply cannot auto-approve; internal
 * classification can); the approval GATE (no action intent before approval); execution-success-but-
 * verification-failure; commandId-based idempotency (replay is a no-op, even after serialization; a reused
 * commandId for a different transition is CONFLICT); and one immutable audit event, stamped with its
 * command id, per real transition.
 */

import { describe, it, expect } from "vitest";

import {
  openSellerWorkItem,
  proposeAction,
  approve,
  autoApprove,
  reject,
  createActionIntent,
  recordExecution,
  recordVerification,
} from "../../src/work/work-item";
import { DEFAULT_APPROVAL_POLICY } from "../../src/work/approval-policy";
import type { TransitionOutcome, WorkItemAggregate } from "../../src/work/types";
import { seller, manufacturer, signal, openCmd, proposeCmd, approveCmd, intentCmd, execCmd, verifyCmd } from "./fixtures";

const policy = DEFAULT_APPROVAL_POLICY;

/** Unwrap a successful outcome, or fail the test with the refusal code. */
function unwrap(o: TransitionOutcome): WorkItemAggregate {
  if (!o.ok) throw new Error(`expected ok, got ${o.error.code}: ${o.error.message}`);
  return o.aggregate;
}

/** A fresh seller work item (phase OPEN) for the owning seller. */
const open = (): WorkItemAggregate => unwrap(openSellerWorkItem(signal(), openCmd()));

describe("work-item lifecycle — happy path (seller-approved inquiry reply)", () => {
  it("runs OPEN → PROPOSED → APPROVED (human) → ACTION_PENDING → EXECUTED → COMPLETED", () => {
    const proposed = unwrap(proposeAction(open(), proposeCmd({ actionKind: "POST_INQUIRY_REPLY" }), policy));
    expect(proposed.proposal!.requiresApproval).toBe(true); // conservative: a channel write needs a human
    const approved = unwrap(approve(proposed, approveCmd()));
    expect(approved.approval).toEqual({ approved: true, approver: seller("seller-1"), mode: "HUMAN" });

    const intent = unwrap(createActionIntent(approved, intentCmd()));
    expect(intent.workItem.phase).toBe("ACTION_PENDING");
    const executed = unwrap(recordExecution(intent, execCmd({ success: true })));
    expect(executed.workItem.phase).toBe("EXECUTED"); // success is NOT completion
    const completed = unwrap(recordVerification(executed, verifyCmd({ verified: true })));
    expect(completed.workItem.phase).toBe("COMPLETED");

    // One immutable audit event per real transition, each stamped with its originating command id.
    expect(completed.audit.map((e) => e.type)).toEqual(["WORK_ITEM_OPENED", "PROPOSAL_ADDED", "APPROVAL_GRANTED", "ACTION_INTENT_CREATED", "EXECUTION_RECORDED", "VERIFICATION_RECORDED"]);
    expect(completed.audit.map((e) => e.commandId)).toEqual(["c-open", "c-prop", "c-appr", "c-int", "c-exec", "c-ver"]);
  });
});

describe("conservative approval policy", () => {
  it("an inquiry reply cannot auto-approve (a seller-channel write requires human approval)", () => {
    const proposed = unwrap(proposeAction(open(), proposeCmd({ actionKind: "POST_INQUIRY_REPLY" }), policy));
    expect(proposed.proposal!.requiresApproval).toBe(true);
    expect(autoApprove(proposed, approveCmd())).toMatchObject({ ok: false, error: { code: "APPROVAL_REQUIRED" } });
  });

  it("internal classification MAY auto-approve (no external side effect)", () => {
    const proposed = unwrap(proposeAction(open(), proposeCmd({ actionKind: "CLASSIFY_SIGNAL", summaryCategory: "triage" }), policy));
    expect(proposed.proposal!.requiresApproval).toBe(false);
    const approved = unwrap(autoApprove(proposed, approveCmd()));
    expect(approved.approval).toEqual({ approved: true, approver: null, mode: "AUTO" });
  });

  it("other seller-channel writes (review reply, refund, order change, external write) also require approval", () => {
    for (const actionKind of ["POST_REVIEW_REPLY", "ISSUE_CANCELLATION_REFUND_OR_CLAIM", "CHANGE_ORDER_OR_SHIPMENT", "EXTERNAL_CHANNEL_WRITE"] as const) {
      const proposed = unwrap(proposeAction(open(), proposeCmd({ actionKind, summaryCategory: "c" }), policy));
      expect(proposed.proposal!.requiresApproval, actionKind).toBe(true);
    }
  });
});

describe("approval-required action gating", () => {
  it("an approval-required action cannot reach an action intent before approval", () => {
    const proposed = unwrap(proposeAction(open(), proposeCmd({ actionKind: "CHANGE_ORDER_OR_SHIPMENT", summaryCategory: "reship" }), policy));
    expect(createActionIntent(proposed, intentCmd())).toMatchObject({ ok: false, error: { code: "APPROVAL_REQUIRED" } });
    const approved = unwrap(approve(proposed, approveCmd()));
    expect(unwrap(createActionIntent(approved, intentCmd())).workItem.phase).toBe("ACTION_PENDING");
  });

  it("a rejected work item is terminal and cannot create an action intent", () => {
    const rejected = unwrap(reject(unwrap(proposeAction(open(), proposeCmd({ actionKind: "ISSUE_CANCELLATION_REFUND_OR_CLAIM" }), policy)), approveCmd({ commandId: "c-rej" })));
    expect(rejected.workItem.phase).toBe("REJECTED");
    expect(createActionIntent(rejected, intentCmd())).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });
  });
});

describe("execution success is not completion", () => {
  function toActionPending(): WorkItemAggregate {
    const approved = unwrap(approve(unwrap(proposeAction(open(), proposeCmd({ actionKind: "POST_INQUIRY_REPLY" }), policy)), approveCmd()));
    return unwrap(createActionIntent(approved, intentCmd()));
  }

  it("execution failure → FAILED (EXECUTION_FAILED), never verified", () => {
    const failed = unwrap(recordExecution(toActionPending(), execCmd({ success: false, outcomeCategory: "post_rejected" })));
    expect(failed.workItem.phase).toBe("FAILED");
    expect(failed.workItem.failureReason).toBe("EXECUTION_FAILED");
    expect(recordVerification(failed, verifyCmd())).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });
  });

  it("execution SUCCEEDS but verification FAILS → FAILED (VERIFICATION_FAILED), not COMPLETED", () => {
    const executed = unwrap(recordExecution(toActionPending(), execCmd({ success: true })));
    const failed = unwrap(recordVerification(executed, verifyCmd({ verified: false, checkCategory: "reply_missing" })));
    expect(failed.workItem.phase).toBe("FAILED");
    expect(failed.workItem.failureReason).toBe("VERIFICATION_FAILED");
    expect(failed.execution!.success).toBe(true); // the execution itself did succeed
  });
});

describe("commandId-based idempotency", () => {
  it("replaying the same command is a no-op (unchanged aggregate, no new audit event)", () => {
    const proposed = unwrap(proposeAction(open(), proposeCmd({ actionKind: "CLASSIFY_SIGNAL" }), policy));
    const again = proposeAction(proposed, proposeCmd({ actionKind: "CLASSIFY_SIGNAL" }), policy);
    expect(again).toMatchObject({ ok: true, idempotent: true, emitted: null });
    if (again.ok) expect(again.aggregate).toBe(proposed); // unchanged reference
    expect(proposed.audit.filter((e) => e.type === "PROPOSAL_ADDED")).toHaveLength(1);
  });

  it("replay AFTER SERIALIZATION remains idempotent (idempotency is not positional)", () => {
    const proposed = unwrap(proposeAction(open(), proposeCmd({ actionKind: "CLASSIFY_SIGNAL" }), policy));
    const roundTripped: WorkItemAggregate = JSON.parse(JSON.stringify(proposed));
    const replay = proposeAction(roundTripped, proposeCmd({ actionKind: "CLASSIFY_SIGNAL" }), policy);
    expect(replay).toMatchObject({ ok: true, idempotent: true, emitted: null });
    if (replay.ok) expect(replay.aggregate.audit).toHaveLength(roundTripped.audit.length); // no growth
  });

  it("reusing a commandId for a DIFFERENT transition is rejected (CONFLICT)", () => {
    const proposed = unwrap(proposeAction(open(), proposeCmd({ commandId: "c-x", proposalId: "p-1", actionKind: "CLASSIFY_SIGNAL" }), policy));
    // Same commandId, different intended artifact (a different proposal) → conflict, not replay.
    const conflict = proposeAction(proposed, proposeCmd({ commandId: "c-x", proposalId: "p-2", actionKind: "CLASSIFY_SIGNAL" }), policy);
    expect(conflict).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });
});

describe("ownership & authority guards", () => {
  it("only the owning seller can open a work item on their own signal", () => {
    expect(openSellerWorkItem(signal(), openCmd({ actor: seller("seller-2") }))).toMatchObject({ ok: false, error: { code: "NOT_OWNER" } });
    expect(openSellerWorkItem(signal(), openCmd({ actor: manufacturer("maker-1") }))).toMatchObject({ ok: false, error: { code: "NOT_OWNER" } });
  });

  it("a non-owner cannot propose", () => {
    expect(proposeAction(open(), proposeCmd({ actor: seller("seller-2"), actionKind: "POST_INQUIRY_REPLY" }), policy)).toMatchObject({ ok: false, error: { code: "AUTHORITY_DENIED" } });
  });
});
