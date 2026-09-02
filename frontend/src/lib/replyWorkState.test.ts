import { describe, expect, it } from "vitest";
import { awaitingApprovalCount, byReplyWorkState, replyWorkStateLabel } from "./replyWorkState";
import type { OperatorVocItem, ReviewReplyWorkState } from "./types";

type Row = Pick<OperatorVocItem, "replyWorkState"> & { id: string };
const row = (id: string, replyWorkState: ReviewReplyWorkState | null): Row => ({ id, replyWorkState });

/**
 * Approval Path v1 §2 — the words and the order of the seller's own worklist.
 *
 * These are presentation rules over a set the server chose. Nothing here decides membership: a row is
 * on the worklist because the backend put it there, and this module only says which of those rows the
 * seller should read first and what to call its state.
 */
describe("reply work state", () => {
  it("names each state as an instruction, and says nothing about a row that cannot carry work", () => {
    expect(replyWorkStateLabel("AWAITING_APPROVAL")).toBe("승인 대기");
    expect(replyWorkStateLabel("DRAFT_NEEDED")).toBe("초안 필요");
    // Never 완료: the step after an approval happens in the seller center, which this product does
    // not observe.
    expect(replyWorkStateLabel("APPROVED")).toBe("승인됨");
    expect(replyWorkStateLabel(null)).toBeNull();
    expect(replyWorkStateLabel(undefined)).toBeNull();
  });

  it("puts what is waiting on the seller first and sinks what is already approved", () => {
    const ordered = byReplyWorkState([
      row("approved", "APPROVED"),
      row("needs-draft", "DRAFT_NEEDED"),
      row("waiting", "AWAITING_APPROVAL"),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["waiting", "needs-draft", "approved"]);
  });

  it("is stable inside one state and keeps an unknown state at the end without dropping it", () => {
    const ordered = byReplyWorkState([
      row("stateless", null),
      row("waiting-1", "AWAITING_APPROVAL"),
      row("needs-draft", "DRAFT_NEEDED"),
      row("waiting-2", "AWAITING_APPROVAL"),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["waiting-1", "waiting-2", "needs-draft", "stateless"]);
  });

  it("counts only what the seller can finish with one press", () => {
    expect(
      awaitingApprovalCount([row("a", "AWAITING_APPROVAL"), row("b", "APPROVED"), row("c", "DRAFT_NEEDED")]),
    ).toBe(1);
    expect(awaitingApprovalCount([row("b", "APPROVED"), row("c", null)])).toBe(0);
  });
});
