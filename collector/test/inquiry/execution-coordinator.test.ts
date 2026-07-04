/**
 * Pure offline tests for the inquiry execution coordinator + the permit-gated persist-before-dispatch
 * protocol.
 *
 * Focus: only a valid ephemeral permit issued by this runtime can execute; a JSON-rehydrated prepared slice
 * (no permit) can never execute and must recover verify-first; the resolution matrix
 * (EXECUTED/NOT_EXECUTED/UNKNOWN × VERIFIED/NOT_VERIFIED/INDETERMINATE); verification is bound to the
 * approved-reply hash; the executor gets the canonical payload; and no raw text leaks into a sanitized
 * outcome or snapshot.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { InquiryExecutionCoordinator, executionSliceFrom, lifecycleIds, toSanitizedSnapshot, DispatchPermit, type InquiryExecutionSlice } from "../../src/inquiry/execution-coordinator";
import { InquiryApprovalCoordinator } from "../../src/inquiry/approval-coordinator";
import { approvedReplyHash, canonicalizeApprovedReply } from "../../src/inquiry/reply-hash";
import { dispatchBindingHash } from "../../src/inquiry/dispatch-binding";
import type { InquiryObservation } from "../../src/inquiry/observation";
import { proposedSlice, seller, APPROVED_REPLY, FakeExecutor, FakeVerifier } from "./lifecycle-fixtures";

async function approvedSlice(over: Partial<InquiryObservation> = {}, payload = APPROVED_REPLY): Promise<InquiryExecutionSlice> {
  const out = new InquiryApprovalCoordinator().approve({ slice: await proposedSlice(over), actor: seller("seller-1"), connectionId: "conn-1", approvedReplyPayload: payload, atMs: 200 });
  if (!out.ok) throw new Error(`approval failed: ${out.reason}`);
  return out.slice;
}

/** The fresh happy path through the durable protocol: prepare (issue permit) → executePrepared. */
async function runFresh(coord: InquiryExecutionCoordinator, slice: InquiryExecutionSlice, atMs = 300) {
  const prep = coord.prepareDispatch(slice);
  if (!prep.ok) throw new Error(`prepare failed: ${prep.reason}`);
  return coord.executePrepared(prep.slice, prep.permit, atMs);
}

describe("unapproved inquiry never prepares or calls the executor", () => {
  it("a PROPOSED (unapproved) slice cannot be prepared (NOT_READY), so nothing executes", async () => {
    const p = await proposedSlice();
    const unapproved = executionSliceFrom(
      { ids: p.ids, signal: p.signal, aggregate: p.aggregate },
      { connectionId: "conn-1", channelInquiryRef: "INQ-1", approvedReplyPayload: APPROVED_REPLY, approvedReplyHash: approvedReplyHash(APPROVED_REPLY), actionIdempotencyKey: lifecycleIds(p.ids.sourceKey).actionIntentId },
    );
    const exec = new FakeExecutor();
    const coord = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    expect(coord.prepareDispatch(unapproved)).toEqual({ ok: false, reason: "NOT_READY" });
    expect(await coord.resolve(unapproved, 300)).toEqual({ ok: false, reason: "NOT_READY" });
    expect(exec.calls).toHaveLength(0);
  });
});

describe("resolution matrix (through the permit-gated path)", () => {
  it("EXECUTED + VERIFIED → COMPLETED", async () => {
    const exec = new FakeExecutor();
    const ver = new FakeVerifier();
    const out = await runFresh(new InquiryExecutionCoordinator(exec, ver), await approvedSlice());
    expect(out.ok && out.resolution).toBe("COMPLETED");
    if (out.ok) expect(out.slice.aggregate.workItem.phase).toBe("COMPLETED");
    expect(exec.calls).toHaveLength(1);
    expect(ver.calls).toHaveLength(1);
  });

  it("EXECUTED + verification fails → VERIFICATION_FAILED", async () => {
    const ver = new FakeVerifier(); ver.status = "NOT_VERIFIED";
    const out = await runFresh(new InquiryExecutionCoordinator(new FakeExecutor(), ver), await approvedSlice());
    expect(out.ok && out.resolution).toBe("VERIFICATION_FAILED");
    if (out.ok) expect(out.slice.aggregate.workItem.failureReason).toBe("VERIFICATION_FAILED");
  });

  it("NOT_EXECUTED → EXECUTION_FAILED, no verification", async () => {
    const exec = new FakeExecutor(); exec.status = "NOT_EXECUTED";
    const ver = new FakeVerifier();
    const out = await runFresh(new InquiryExecutionCoordinator(exec, ver), await approvedSlice());
    expect(out.ok && out.resolution).toBe("EXECUTION_FAILED");
    expect(ver.calls).toHaveLength(0);
  });

  it("UNKNOWN + VERIFIED → COMPLETED (verified before any retry; executor called once)", async () => {
    const exec = new FakeExecutor(); exec.status = "UNKNOWN";
    const ver = new FakeVerifier(); ver.status = "VERIFIED";
    const out = await runFresh(new InquiryExecutionCoordinator(exec, ver), await approvedSlice());
    expect(out.ok && out.resolution).toBe("COMPLETED");
    expect(exec.calls).toHaveLength(1);
    expect(ver.calls).toHaveLength(1);
  });

  it("UNKNOWN + INDETERMINATE → MANUAL_RECONCILIATION_REQUIRED", async () => {
    const exec = new FakeExecutor(); exec.status = "UNKNOWN";
    const ver = new FakeVerifier(); ver.status = "INDETERMINATE";
    const out = await runFresh(new InquiryExecutionCoordinator(exec, ver), await approvedSlice());
    expect(out.ok && out.resolution).toBe("MANUAL_RECONCILIATION_REQUIRED");
    if (out.ok) expect(out.slice.aggregate.workItem.phase).toBe("ACTION_PENDING");
  });

  it("EXECUTED + INDETERMINATE → EXECUTED_UNRESOLVED", async () => {
    const ver = new FakeVerifier(); ver.status = "INDETERMINATE";
    const out = await runFresh(new InquiryExecutionCoordinator(new FakeExecutor(), ver), await approvedSlice());
    expect(out.ok && out.resolution).toBe("EXECUTED_UNRESOLVED");
    if (out.ok) expect(out.slice.aggregate.workItem.phase).toBe("EXECUTED");
  });

  it("UNKNOWN never causes a second executor call across recovery re-verification", async () => {
    const exec = new FakeExecutor(); exec.status = "UNKNOWN";
    const ver = new FakeVerifier(); ver.statuses = ["NOT_VERIFIED", "VERIFIED"];
    const coord = new InquiryExecutionCoordinator(exec, ver);
    const first = await runFresh(coord, await approvedSlice());
    expect(first.ok && first.resolution).toBe("MANUAL_RECONCILIATION_REQUIRED");
    if (!first.ok) return;
    const second = await coord.resolve(first.slice, 400); // recovery re-verify
    expect(second.ok && second.resolution).toBe("COMPLETED");
    expect(exec.calls).toHaveLength(1);
    expect(ver.calls).toHaveLength(2);
  });

  it("duplicate resolution of a COMPLETED slice is an idempotent no-op", async () => {
    const exec = new FakeExecutor();
    const ver = new FakeVerifier();
    const coord = new InquiryExecutionCoordinator(exec, ver);
    const first = await runFresh(coord, await approvedSlice());
    if (!first.ok) throw new Error("expected ok");
    const second = await coord.resolve(first.slice, 400);
    expect(second).toMatchObject({ ok: true, resolution: "COMPLETED", idempotent: true });
    expect(exec.calls).toHaveLength(1);
  });
});

describe("permit-gated persist-before-dispatch protocol", () => {
  it("prepareDispatch issues a permit and performs no executor call", async () => {
    const exec = new FakeExecutor();
    const prep = new InquiryExecutionCoordinator(exec, new FakeVerifier()).prepareDispatch(await approvedSlice());
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    expect(prep.slice.dispatchStarted).toBe(true);
    expect(prep.permit).toBeInstanceOf(DispatchPermit);
    expect(exec.calls).toHaveLength(0);
  });

  it("a valid same-runtime permit executes exactly once", async () => {
    const exec = new FakeExecutor();
    const coord = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    const prep = coord.prepareDispatch(await approvedSlice());
    if (!prep.ok) throw new Error("prepare failed");
    const out = await coord.executePrepared(prep.slice, prep.permit, 300);
    expect(out.ok && out.resolution).toBe("COMPLETED");
    expect(exec.calls).toHaveLength(1);
  });

  it("a JSON-rehydrated prepared slice cannot call executePrepared (no live permit)", async () => {
    const exec = new FakeExecutor();
    const issuer = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    const prep = issuer.prepareDispatch(await approvedSlice());
    if (!prep.ok) throw new Error("prepare failed");
    const rehydrated = JSON.parse(JSON.stringify(prep.slice)) as InquiryExecutionSlice; // persisted slice

    // A new runtime (fresh coordinator) has no live permits; the old permit is not recognized.
    const recovered = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    expect(await recovered.executePrepared(rehydrated, prep.permit, 400)).toEqual({ ok: false, reason: "INVALID_PERMIT" });
    expect(exec.calls).toHaveLength(0);
  });

  it("a permit cannot be serialized and reconstructed", async () => {
    const coord = new InquiryExecutionCoordinator(new FakeExecutor(), new FakeVerifier());
    const prep = coord.prepareDispatch(await approvedSlice());
    if (!prep.ok) throw new Error("prepare failed");
    expect(JSON.stringify(prep.permit)).toBeUndefined(); // does not serialize
    // A hand-reconstructed look-alike is not a live DispatchPermit → rejected.
    const fake = { actionIdempotencyKey: prep.slice.actionIdempotencyKey, approvedReplyHash: prep.slice.approvedReplyHash } as unknown as DispatchPermit;
    expect(await coord.executePrepared(prep.slice, fake, 300)).toEqual({ ok: false, reason: "INVALID_PERMIT" });
  });

  it("a reused permit is rejected without a second executor call", async () => {
    const exec = new FakeExecutor();
    const coord = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    const prep = coord.prepareDispatch(await approvedSlice());
    if (!prep.ok) throw new Error("prepare failed");
    const first = await coord.executePrepared(prep.slice, prep.permit, 300);
    expect(first.ok).toBe(true);
    // The permit is single-use — reusing it (even on the original non-terminal prepared slice) is rejected.
    const second = await coord.executePrepared(prep.slice, prep.permit, 400);
    expect(second).toEqual({ ok: false, reason: "INVALID_PERMIT" });
    expect(exec.calls).toHaveLength(1);
  });

  it("a permit with a different action key or reply hash is rejected", async () => {
    const exec = new FakeExecutor();
    const coord = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    const prep = coord.prepareDispatch(await approvedSlice());
    if (!prep.ok) throw new Error("prepare failed");
    // Tampering the action key or reply hash makes the slice internally inconsistent → rejected pre-consume.
    expect(await coord.executePrepared({ ...prep.slice, actionIdempotencyKey: "other-key" }, prep.permit, 300)).toEqual({ ok: false, reason: "INVALID_DISPATCH_STATE" });
    expect(await coord.executePrepared({ ...prep.slice, approvedReplyHash: "deadbeef" }, prep.permit, 300)).toEqual({ ok: false, reason: "INVALID_DISPATCH_STATE" });
    expect(exec.calls).toHaveLength(0);
  });

  it("fresh convenience resolve() cannot bypass the persist boundary", async () => {
    const exec = new FakeExecutor();
    const out = await new InquiryExecutionCoordinator(exec, new FakeVerifier()).resolve(await approvedSlice(), 300);
    expect(out).toEqual({ ok: false, reason: "NOT_PREPARED" }); // must prepareDispatch first
    expect(exec.calls).toHaveLength(0);
  });

  it("rehydrated prepared state recovers verify-first and never executes", async () => {
    const exec = new FakeExecutor();
    const verVisible = new FakeVerifier(); verVisible.observedReplyHash = approvedReplyHash(APPROVED_REPLY);
    const issuer = new InquiryExecutionCoordinator(exec, verVisible);
    const prep = issuer.prepareDispatch(await approvedSlice());
    if (!prep.ok) throw new Error("prepare failed");
    const rehydrated = JSON.parse(JSON.stringify(prep.slice)) as InquiryExecutionSlice; // crash → reload

    const recovered = new InquiryExecutionCoordinator(exec, verVisible);
    const viaResolve = await recovered.resolve(rehydrated, 400);
    expect(exec.calls).toHaveLength(0); // never re-dispatched
    expect(viaResolve.ok && viaResolve.resolution).toBe("COMPLETED"); // verified visible

    // The dedicated recovery entry point with no visible reply → manual reconciliation, still no execute.
    const verMissing = new InquiryExecutionCoordinator(exec, (() => { const v = new FakeVerifier(); v.status = "NOT_VERIFIED"; return v; })());
    const viaRecover = await verMissing.recoverPrepared(JSON.parse(JSON.stringify(prep.slice)) as InquiryExecutionSlice, 500);
    expect(exec.calls).toHaveLength(0);
    expect(viaRecover.ok && viaRecover.resolution).toBe("MANUAL_RECONCILIATION_REQUIRED");
  });
});

describe("at most one ACTIVE permit per dispatch binding", () => {
  it("duplicate prepareDispatch returns the SAME permit identity (idempotent, never a second permit)", async () => {
    const coord = new InquiryExecutionCoordinator(new FakeExecutor(), new FakeVerifier());
    const slice = await approvedSlice();
    const p1 = coord.prepareDispatch(slice);
    const p2 = coord.prepareDispatch(p1.ok ? p1.slice : slice);
    expect(p1.ok && p2.ok).toBe(true);
    if (!p1.ok || !p2.ok) return;
    expect(p2.permit).toBe(p1.permit); // exact same identity — two valid permits can never coexist
    expect(p1.idempotent).toBe(false);
    expect(p2.idempotent).toBe(true);
  });

  it("preparing twice and executing with BOTH permit references results in exactly one executor call", async () => {
    const exec = new FakeExecutor();
    const coord = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    const slice = await approvedSlice();
    const p1 = coord.prepareDispatch(slice);
    const p2 = coord.prepareDispatch(slice);
    if (!p1.ok || !p2.ok) throw new Error("prepare failed");
    const first = await coord.executePrepared(p1.slice, p1.permit, 300);
    expect(first.ok && first.resolution).toBe("COMPLETED");
    const second = await coord.executePrepared(p2.slice, p2.permit, 400); // same permit, now consumed
    expect(second).toEqual({ ok: false, reason: "INVALID_PERMIT" });
    expect(exec.calls).toHaveLength(1);
  });

  it("preparing again after the permit is consumed does not issue a new permit", async () => {
    const exec = new FakeExecutor();
    const coord = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    const slice = await approvedSlice();
    const p1 = coord.prepareDispatch(slice);
    if (!p1.ok) throw new Error("prepare failed");
    await coord.executePrepared(p1.slice, p1.permit, 300); // consumes the permit
    expect(coord.prepareDispatch(p1.slice)).toEqual({ ok: false, reason: "PERMIT_UNAVAILABLE" });
    expect(exec.calls).toHaveLength(1);
  });

  it("a stale original prepared slice cannot be executed with a replacement permit", async () => {
    const exec = new FakeExecutor();
    const coord = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    const slice = await approvedSlice();
    const p1 = coord.prepareDispatch(slice);
    if (!p1.ok) throw new Error("prepare failed");
    await coord.executePrepared(p1.slice, p1.permit, 300); // consume

    // No replacement permit can be minted, so the stale prepared slice can never be re-executed.
    expect(coord.prepareDispatch(p1.slice)).toEqual({ ok: false, reason: "PERMIT_UNAVAILABLE" });
    expect(await coord.executePrepared(p1.slice, p1.permit, 400)).toEqual({ ok: false, reason: "INVALID_PERMIT" });
    expect(exec.calls).toHaveLength(1);
  });

  it("a rehydrated prepared slice cannot obtain a new permit and remains verify-first", async () => {
    const exec = new FakeExecutor();
    const ver = new FakeVerifier(); ver.observedReplyHash = approvedReplyHash(APPROVED_REPLY);
    const issuer = new InquiryExecutionCoordinator(exec, ver);
    const prep = issuer.prepareDispatch(await approvedSlice());
    if (!prep.ok) throw new Error("prepare failed");
    const rehydrated = JSON.parse(JSON.stringify(prep.slice)) as InquiryExecutionSlice;

    const recovered = new InquiryExecutionCoordinator(exec, ver); // fresh runtime, empty registry
    expect(recovered.prepareDispatch(rehydrated)).toEqual({ ok: false, reason: "AMBIGUOUS_PREPARED" }); // no new permit
    const out = await recovered.resolve(rehydrated, 500); // recovery = verify-first
    expect(exec.calls).toHaveLength(0);
    expect(out.ok && out.resolution).toBe("COMPLETED");
  });
});

describe("the permit is bound to the immutable dispatch envelope (validate before consume)", () => {
  /** Re-derive a slice's dispatch binding for a possibly-different reply. */
  const bindingFor = (slice: InquiryExecutionSlice, replyHash: string) =>
    dispatchBindingHash({ actionIntentId: slice.actionIdempotencyKey, actionKind: "POST_INQUIRY_REPLY", connectionId: slice.target.connectionId, channel: slice.target.channel, channelInquiryRef: slice.target.channelInquiryRef, approvedReplyHash: replyHash });

  it("valid unchanged dispatch still executes once and verifies normally", async () => {
    const exec = new FakeExecutor();
    const ver = new FakeVerifier();
    const out = await runFresh(new InquiryExecutionCoordinator(exec, ver), await approvedSlice());
    expect(out.ok && out.resolution).toBe("COMPLETED");
    expect(exec.calls).toHaveLength(1);
    expect(ver.calls).toHaveLength(1);
  });

  it("same action id with a DIFFERENT reply hash cannot obtain another permit (BINDING_CONFLICT)", async () => {
    const coord = new InquiryExecutionCoordinator(new FakeExecutor(), new FakeVerifier());
    const slice = await approvedSlice();
    const p1 = coord.prepareDispatch(slice);
    if (!p1.ok) throw new Error("prepare failed");
    // A fully self-consistent forged envelope: same action id, different reply, fingerprint recomputed to match.
    const forgedReply = canonicalizeApprovedReply("완전히 다른 승인 답변");
    const forgedHash = approvedReplyHash(forgedReply);
    const forged: InquiryExecutionSlice = {
      ...slice,
      approvedReplyHash: forgedHash,
      privateState: { approvedReplyPayload: forgedReply },
      aggregate: { ...slice.aggregate, actionIntent: { ...slice.aggregate.actionIntent!, paramsFingerprint: bindingFor(slice, forgedHash) } },
    };
    expect(coord.prepareDispatch(forged)).toEqual({ ok: false, reason: "BINDING_CONFLICT" }); // never a second permit
  });

  it("a tampered private reply payload is rejected before the executor call (permit not consumed)", async () => {
    const exec = new FakeExecutor();
    const coord = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    const p = coord.prepareDispatch(await approvedSlice());
    if (!p.ok) throw new Error("prepare failed");
    const tampered: InquiryExecutionSlice = { ...p.slice, privateState: { approvedReplyPayload: "몰래 바꾼 답변" } };
    expect(await coord.executePrepared(tampered, p.permit, 300)).toEqual({ ok: false, reason: "INVALID_DISPATCH_STATE" });
    expect(exec.calls).toHaveLength(0);
    // The permit was NOT consumed — the correct prepared slice still executes afterward.
    const ok = await coord.executePrepared(p.slice, p.permit, 400);
    expect(ok.ok && ok.resolution).toBe("COMPLETED");
    expect(exec.calls).toHaveLength(1);
  });

  it("a tampered connection id is rejected (BINDING_CONFLICT), permit intact", async () => {
    const exec = new FakeExecutor();
    const coord = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    const p = coord.prepareDispatch(await approvedSlice());
    if (!p.ok) throw new Error("prepare failed");
    const tampered: InquiryExecutionSlice = { ...p.slice, target: { ...p.slice.target, connectionId: "evil-conn" } };
    expect(await coord.executePrepared(tampered, p.permit, 300)).toEqual({ ok: false, reason: "BINDING_CONFLICT" });
    expect(exec.calls).toHaveLength(0);
    expect((await coord.executePrepared(p.slice, p.permit, 400)).ok).toBe(true); // permit still valid
  });

  it("a tampered channel inquiry reference is rejected before the executor call", async () => {
    const exec = new FakeExecutor();
    const coord = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    const p = coord.prepareDispatch(await approvedSlice());
    if (!p.ok) throw new Error("prepare failed");
    const tampered: InquiryExecutionSlice = { ...p.slice, target: { ...p.slice.target, channelInquiryRef: "evil-ref" } };
    expect(await coord.executePrepared(tampered, p.permit, 300)).toEqual({ ok: false, reason: "INVALID_DISPATCH_STATE" });
    expect(exec.calls).toHaveLength(0);
  });

  it("a tampered ActionIntent fingerprint is rejected (BINDING_CONFLICT)", async () => {
    const exec = new FakeExecutor();
    const coord = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    const p = coord.prepareDispatch(await approvedSlice());
    if (!p.ok) throw new Error("prepare failed");
    const tampered: InquiryExecutionSlice = { ...p.slice, aggregate: { ...p.slice.aggregate, actionIntent: { ...p.slice.aggregate.actionIntent!, paramsFingerprint: "forged-fingerprint" } } };
    expect(await coord.executePrepared(tampered, p.permit, 300)).toEqual({ ok: false, reason: "BINDING_CONFLICT" });
    expect(exec.calls).toHaveLength(0);
  });

  it("a valid permit with an UNPREPARED stale slice does not consume it; the same permit still executes the prepared slice", async () => {
    const exec = new FakeExecutor();
    const coord = new InquiryExecutionCoordinator(exec, new FakeVerifier());
    const p = coord.prepareDispatch(await approvedSlice());
    if (!p.ok) throw new Error("prepare failed");
    const unprepared: InquiryExecutionSlice = { ...p.slice, dispatchStarted: false };
    expect(await coord.executePrepared(unprepared, p.permit, 300)).toEqual({ ok: false, reason: "NOT_PREPARED" });
    expect(exec.calls).toHaveLength(0);
    // Permit survived the invalid attempt → the correct prepared slice executes exactly once.
    const ok = await coord.executePrepared(p.slice, p.permit, 400);
    expect(ok.ok && ok.resolution).toBe("COMPLETED");
    expect(exec.calls).toHaveLength(1);
  });
});

describe("verification is bound to the expected approved-reply hash", () => {
  it("the verifier receives the expected hash but no raw text", async () => {
    const ver = new FakeVerifier();
    await runFresh(new InquiryExecutionCoordinator(new FakeExecutor(), ver), await approvedSlice());
    expect(ver.calls[0]!.expectedReplyHash).toBe(approvedReplyHash(APPROVED_REPLY));
    expect(JSON.stringify(ver.calls[0]).includes(APPROVED_REPLY)).toBe(false);
  });

  it("a DIFFERENT visible reply does not verify (hash mismatch → VERIFICATION_FAILED)", async () => {
    const ver = new FakeVerifier(); ver.observedReplyHash = approvedReplyHash("완전히 다른 답변입니다");
    const out = await runFresh(new InquiryExecutionCoordinator(new FakeExecutor(), ver), await approvedSlice());
    expect(out.ok && out.resolution).toBe("VERIFICATION_FAILED");
  });
});

describe("the executor receives the canonical payload whose hash is on the ActionIntent", () => {
  it("passes the canonicalized reply (CRLF→LF) and its hash matches the intent fingerprint", async () => {
    const raw = "첫 줄입니다.\r\n둘째 줄입니다.";
    const canonical = canonicalizeApprovedReply(raw);
    const slice = await approvedSlice({}, raw);
    const exec = new FakeExecutor();
    await runFresh(new InquiryExecutionCoordinator(exec, new FakeVerifier()), slice);
    expect(exec.calls[0]!.sellerPrivate.replyPayload).toBe(canonical); // canonical reply posted
    expect(exec.calls[0]!.approvedReplyHash).toBe(approvedReplyHash(canonical)); // reply hash for matching
    // The ActionIntent fingerprint is the full dispatch binding, itself derived from that reply hash.
    expect(slice.aggregate.actionIntent!.paramsFingerprint).toBe(dispatchBindingHash({ actionIntentId: slice.actionIdempotencyKey, actionKind: "POST_INQUIRY_REPLY", connectionId: slice.target.connectionId, channel: slice.target.channel, channelInquiryRef: slice.target.channelInquiryRef, approvedReplyHash: approvedReplyHash(canonical) }));
  });
});

describe("no raw reply text leaks into a sanitized outcome or snapshot", () => {
  it("the aggregate, verifier input, and snapshot never contain the raw reply or inquiry text", async () => {
    const exec = new FakeExecutor();
    const ver = new FakeVerifier();
    const out = await runFresh(new InquiryExecutionCoordinator(exec, ver), await approvedSlice());
    if (!out.ok) throw new Error("expected ok");
    expect(JSON.stringify(out.slice.aggregate).includes(APPROVED_REPLY)).toBe(false);
    expect(JSON.stringify(ver.calls[0]).includes(APPROVED_REPLY)).toBe(false);
    expect(exec.calls[0]!.sellerPrivate.replyPayload).toBe(APPROVED_REPLY); // executor gets it, in its private field

    const snapshot = toSanitizedSnapshot(out.slice);
    const serialized = JSON.stringify(snapshot);
    expect(serialized.includes(APPROVED_REPLY)).toBe(false);
    expect(serialized.includes("이 상품 재고 있나요")).toBe(false);
    expect(snapshot.dispatchStarted).toBe(true); // dispatch state IS exposed
    expect(snapshot.approvedReplyHash).toBe(approvedReplyHash(APPROVED_REPLY));
  });
});

describe("one failed inquiry does not affect another", () => {
  it("a NOT_EXECUTED inquiry fails while an independent one completes", async () => {
    const failExec = new FakeExecutor(); failExec.status = "NOT_EXECUTED";
    const outA = await runFresh(new InquiryExecutionCoordinator(failExec, new FakeVerifier()), await approvedSlice({ connectionId: "conn-A", channelInquiryId: "INQ-A" }));
    const outB = await runFresh(new InquiryExecutionCoordinator(new FakeExecutor(), new FakeVerifier()), await approvedSlice({ connectionId: "conn-B", channelInquiryId: "INQ-B" }));
    expect(outA.ok && outA.resolution).toBe("EXECUTION_FAILED");
    expect(outB.ok && outB.resolution).toBe("COMPLETED");
    if (outA.ok && outB.ok) expect(outA.slice.aggregate.workItem.workItemId).not.toBe(outB.slice.aggregate.workItem.workItemId);
  });
});

describe("the approval/execution slice is pure/offline", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcDir = pathResolve(here, "..", "..", "src", "inquiry");
  const files = ["reply-executor.ts", "reply-verifier.ts", "reply-hash.ts", "dispatch-binding.ts", "approval-coordinator.ts", "execution-coordinator.ts"];

  it("reads no wall clock and imports no http / browser / connector / upload", () => {
    for (const file of files) {
      const raw = readFileSync(pathResolve(srcDir, file), "utf8");
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const forbidden of ["Date.now", "new Date", "Date.parse", "Date.UTC", "Math.random", "fetch("]) {
        expect(code.includes(forbidden), `${file} must not use ${forbidden}`).toBe(false);
      }
      for (const badImport of ["node:http", "node:https", "playwright", "../connector/", "../naver/", "../esm/", "../upload"]) {
        expect(code.includes(`from "${badImport}"`), `${file} must not import ${badImport}`).toBe(false);
      }
    }
  });
});
