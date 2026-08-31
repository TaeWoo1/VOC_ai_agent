/**
 * Working Context v1 §1 — the focus contract, backwards.
 *
 * A seller can now SEE which object the conversation is anchored on, and a state that can be seen has
 * to be one the seller can leave. CLEAR travels the same seam a click does: it drops the anchor and the
 * task in flight, it leaves the SET on screen alone, it appends nothing to the transcript, and it costs
 * no read and no model call. Those five are what the assertions below are for.
 */
import { describe, it, expect } from "vitest";
import { TODAY, TOKEN, artifact, harness } from "./support";

async function conversationId(h: ReturnType<typeof harness>): Promise<string> {
  const { conversationId: id } = await h.service.create(TOKEN);
  return id;
}

describe("CLEAR — leaving the anchored object", () => {
  it("drops the selection and the task, keeps the set, and reads nothing", async () => {
    const h = harness();
    const id = await conversationId(h);
    const listed = await h.service.turn(TOKEN, id, { text: "미응답 문의 중 가장 시급한 건?", referenceDate: TODAY } as never, () => undefined);
    const rows = artifact(listed, "INQUIRY_LIST").groups.flatMap((g) => g.items);
    expect(rows.length).toBeGreaterThan(0);
    const set = listed.continuation.workingSet;
    expect(set).not.toBeNull();

    const selected = await h.service.turn(
      TOKEN, id, { select: { kind: "INQUIRY", inquiryId: rows[0]!.inquiryId, workItemId: rows[0]!.workItemId } } as never, () => undefined,
    );
    expect(selected.continuation.workingSet?.selectedInquiry?.inquiryId).toBe(rows[0]!.inquiryId);
    expect(selected.continuation.activeTask).toBe("INSPECT");

    // `calls` is a COUNTER OBJECT, not an array — `.length` on it is `undefined`, and comparing two
    // undefineds is an assertion that always passes. Sum the counters.
    const reads = (): number =>
      Object.values(h.inquiry.calls as Record<string, number>).reduce((a, b) => a + b, 0)
      + Object.values(h.operator.calls as Record<string, number>).reduce((a, b) => a + b, 0);
    const readsBefore = reads();
    const cleared = await h.service.turn(TOKEN, id, { select: { kind: "CLEAR" } } as never, () => undefined);

    // The anchor and the task are gone…
    expect(cleared.continuation.workingSet?.selectedInquiry ?? null).toBeNull();
    expect(cleared.continuation.activeTask ?? null).toBeNull();
    // …the set the seller is looking at is not.
    expect(cleared.continuation.workingSet?.ids).toEqual(set?.ids);
    expect(cleared.continuation.workingSet?.count).toBe(set?.count);
    // Nothing was said, nothing was read, nothing was planned.
    expect(cleared.message).toBe("");
    expect(cleared.artifacts).toEqual([]);
    expect(reads()).toBe(readsBefore);
  });

  it("survives a reload — the cleared state is what the next turn is given", async () => {
    const h = harness();
    const id = await conversationId(h);
    const listed = await h.service.turn(TOKEN, id, { text: "미응답 문의 중 가장 시급한 건?", referenceDate: TODAY } as never, () => undefined);
    const first = artifact(listed, "INQUIRY_LIST").groups.flatMap((g) => g.items)[0]!;
    await h.service.turn(TOKEN, id, { select: { kind: "INQUIRY", inquiryId: first.inquiryId, workItemId: first.workItemId } } as never, () => undefined);
    await h.service.turn(TOKEN, id, { select: { kind: "CLEAR" } } as never, () => undefined);
    const view = await h.service.get(TOKEN, id);
    expect(view.workingSet?.selectedInquiry ?? null).toBeNull();
    expect(view.workingSet?.ids.length).toBeGreaterThan(0);
  });

  /**
   * Found by the CLEAR test above, and older than it: a work-queue set is keyed by WORK-ITEM ids while
   * `anchoredSet` recognised the previous set by INQUIRY id only, so a click on a queue row dropped the
   * other rows — 「세 번째 거」 and 「그중 …만」 after a click then acted on a set of one.
   */
  it("selecting a row of a work-queue list keeps the whole list as the set", async () => {
    const h = harness();
    const id = await conversationId(h);
    const listed = await h.service.turn(TOKEN, id, { text: "오늘 내가 답해야 할 문의 정리해줘", referenceDate: TODAY } as never, () => undefined);
    const rows = artifact(listed, "INQUIRY_LIST").groups.flatMap((g) => g.items);
    expect(rows.length).toBeGreaterThan(1);
    const before = listed.continuation.workingSet!;
    // A work-queue set is keyed by work items, not inquiries — the shape that used to break this.
    expect(before.ids).toEqual(before.workItemIds);
    const selected = await h.service.turn(
      TOKEN, id, { select: { kind: "INQUIRY", inquiryId: rows[0]!.inquiryId, workItemId: rows[0]!.workItemId } } as never, () => undefined,
    );
    expect(selected.continuation.workingSet?.ids).toEqual(before.ids);
    expect(selected.continuation.workingSet?.count).toBe(before.count);
    expect(selected.continuation.workingSet?.selectedInquiry?.inquiryId).toBe(rows[0]!.inquiryId);
  });

  it("clearing when nothing is anchored is a no-op, not an error", async () => {
    const h = harness();
    const id = await conversationId(h);
    const cleared = await h.service.turn(TOKEN, id, { select: { kind: "CLEAR" } } as never, () => undefined);
    expect(cleared.status).toBe("DONE");
    expect(cleared.continuation.workingSet).toBeNull();
  });
});
