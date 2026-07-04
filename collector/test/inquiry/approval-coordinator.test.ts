/**
 * Pure offline tests for the inquiry approval coordinator.
 *
 * Focus: the owning Seller's approval creates exactly one POST_INQUIRY_REPLY ActionIntent; approval by
 * another seller or a manufacturer is denied; a duplicate approval is an idempotent no-op that never creates
 * a second action intent.
 */

import { describe, it, expect } from "vitest";

import { InquiryApprovalCoordinator } from "../../src/inquiry/approval-coordinator";
import { approvedReplyHash } from "../../src/inquiry/reply-hash";
import { dispatchBindingHash } from "../../src/inquiry/dispatch-binding";
import type { InquiryExecutionSlice } from "../../src/inquiry/execution-coordinator";
import type { InquirySlice } from "../../src/inquiry/coordinator";
import { proposedSlice, seller, manufacturer, APPROVED_REPLY } from "./lifecycle-fixtures";

/** Recompute the expected full dispatch binding hash for an already-bound execution slice. */
const expectedBinding = (slice: InquiryExecutionSlice, replyHash: string) =>
  dispatchBindingHash({ actionIntentId: slice.actionIdempotencyKey, actionKind: "POST_INQUIRY_REPLY", connectionId: slice.target.connectionId, channel: slice.target.channel, channelInquiryRef: slice.target.channelInquiryRef, approvedReplyHash: replyHash });

const approve = (slice: InquirySlice, actor = seller("seller-1")) =>
  new InquiryApprovalCoordinator().approve({ slice, actor, connectionId: "conn-1", approvedReplyPayload: APPROVED_REPLY, atMs: 200 });

describe("seller approval creates exactly one action intent", () => {
  it("approves the proposal and creates one POST_INQUIRY_REPLY intent (ACTION_PENDING)", async () => {
    const out = approve(await proposedSlice());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.slice.aggregate.workItem.phase).toBe("ACTION_PENDING");
    expect(out.slice.aggregate.approval).toMatchObject({ approved: true, approver: seller("seller-1"), mode: "HUMAN" });
    expect(out.slice.aggregate.actionIntent!.actionKind).toBe("POST_INQUIRY_REPLY");
    expect(out.slice.aggregate.audit.filter((e) => e.type === "ACTION_INTENT_CREATED")).toHaveLength(1);
    expect(out.slice.actionIdempotencyKey).toBe(out.slice.aggregate.actionIntent!.actionIntentId);
    expect(out.slice.target).toMatchObject({ connectionId: "conn-1", channel: "NAVER", channelInquiryRef: "INQ-1" });
    // The intent fingerprint is the COMPLETE dispatch binding; the reply hash is kept separately.
    expect(out.slice.aggregate.actionIntent!.paramsFingerprint).toBe(expectedBinding(out.slice, approvedReplyHash(APPROVED_REPLY)));
    expect(out.slice.approvedReplyHash).toBe(approvedReplyHash(APPROVED_REPLY));
    expect(out.slice.aggregate.actionIntent!.proposalId).toBe(out.slice.aggregate.proposal!.proposalId);
    expect(JSON.stringify(out.slice.aggregate).includes(APPROVED_REPLY)).toBe(false);
  });
});

describe("approval by a non-owner is denied", () => {
  it("another seller and a manufacturer are both denied (no state change)", async () => {
    const slice = await proposedSlice();
    expect(approve(slice, seller("seller-2"))).toEqual({ ok: false, reason: "APPROVAL_DENIED" });
    expect(approve(slice, manufacturer("maker-1"))).toEqual({ ok: false, reason: "APPROVAL_DENIED" });
  });
});

describe("canonical payload binding via reaffirm", () => {
  const MULTILINE = "안녕하세요.\n재고 있습니다.\n  감사합니다.  "; // meaningful line breaks + leading/trailing spaces

  async function firstApproval(payload = MULTILINE) {
    const coord = new InquiryApprovalCoordinator();
    const out = coord.approve({ slice: await proposedSlice(), actor: seller("seller-1"), connectionId: "conn-1", approvedReplyPayload: payload, atMs: 200 });
    if (!out.ok) throw new Error("approval failed");
    return { coord, bound: out.slice };
  }

  it("CRLF vs LF is idempotent (canonicalizes equal) and returns the ORIGINAL bound private payload", async () => {
    const { coord, bound } = await firstApproval(MULTILINE);
    const crlf = MULTILINE.replace(/\n/g, "\r\n");
    const again = coord.reaffirm(bound, crlf);
    expect(again).toMatchObject({ ok: true, idempotent: true });
    if (!again.ok) return;
    expect(again.slice).toBe(bound); // the exact original slice — never rebuilt from the new raw payload
    expect(again.slice.privateState.approvedReplyPayload).toBe(bound.privateState.approvedReplyPayload);
  });

  it("a line-break difference is a PAYLOAD_CONFLICT", async () => {
    const { coord, bound } = await firstApproval(MULTILINE);
    const extraBreak = MULTILINE.replace("재고 있습니다.\n", "재고 있습니다.\n\n"); // an extra blank line
    expect(coord.reaffirm(bound, extraBreak)).toEqual({ ok: false, reason: "PAYLOAD_CONFLICT" });
  });

  it("a spacing difference is a PAYLOAD_CONFLICT", async () => {
    const { coord, bound } = await firstApproval(MULTILINE);
    expect(coord.reaffirm(bound, MULTILINE.replace("감사합니다.", "감사 합니다."))).toEqual({ ok: false, reason: "PAYLOAD_CONFLICT" });
  });

  it("a duplicate approval cannot replace the original private payload", async () => {
    const { coord, bound } = await firstApproval(MULTILINE);
    const originalPayload = bound.privateState.approvedReplyPayload;
    expect(coord.reaffirm(bound, "완전히 다른 답변")).toEqual({ ok: false, reason: "PAYLOAD_CONFLICT" });
    expect(bound.privateState.approvedReplyPayload).toBe(originalPayload); // unchanged
  });

  it("binds ONE canonical value across fingerprint, private payload, executor hash, and verifier hash", async () => {
    const { bound } = await firstApproval(MULTILINE);
    const canonical = MULTILINE.normalize("NFC"); // MULTILINE has only LF already
    expect(bound.privateState.approvedReplyPayload).toBe(canonical); // canonical form, not the raw (no CRLF here)
    expect(bound.approvedReplyHash).toBe(approvedReplyHash(canonical)); // reply hash from the one canonical value
    // The fingerprint is the full dispatch binding, itself derived from that same reply hash.
    expect(bound.aggregate.actionIntent!.paramsFingerprint).toBe(expectedBinding(bound, approvedReplyHash(canonical)));
  });
});
