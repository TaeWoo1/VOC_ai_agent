/** The workload composition's own rules: classification by phase and basis, the closed topic table, the detail cap. */
import { describe, expect, it } from "vitest";
import { classify, listInquiryWorkload, matchesTopic, WORKLOAD_DETAIL_CAP } from "../../src/operator/tools/inquiryWorkload";
import { FakeSpringClient } from "../support/FakeSpringClient";
import type { InquiryDetail } from "../../src/spring/types";

function detail(basis: string | null): InquiryDetail {
  return { workItemId: "w", inquiryId: "i", sellerAccountId: "a", channelId: "c", channelCode: null, channelNameKo: null, isSecret: null,
    phase: "PROPOSED", status: "UNANSWERED", informStatus: null, title: "t", details: null, receivedAt: "2026-08-27T00:00:00Z", proposal: null,
    draft: { version: 1, answerStatus: 0, title: "t", comments: "c", contentFingerprint: "f", fingerprintAlgorithm: "x", createdAt: "2026-08-27T00:00:00Z", answerBasis: basis } };
}

describe("classification", () => {
  // CONTRACT CHANGED (Operational Workspace UX System v1). The last line used to read
  // `classify("PROPOSED", null) → DRAFT_READY`, on the premise that a PROPOSED item has a draft "by
  // the phase's own meaning". It does not: `PROPOSED` is written when a PROPOSAL is recorded and a
  // proposal carries no reply text. Eight of the demo org's ten PROPOSED rows had no draft, and the
  // chat lane grouped all ten under 「초안 준비됨」.
  it("a draft is what groups a row — no draft is 아직 초안이 없는 문의, whatever the phase", () => {
    expect(classify({ phase: "OPEN" }, null).group).toBe("UNANSWERED");
    expect(classify({ phase: "PROPOSED", hasDraft: false }, null).group).toBe("UNANSWERED");
    expect(classify({ phase: "PROPOSED", hasDraft: true }, detail("GROUNDED")).group).toBe("DRAFT_READY");
    expect(classify({ phase: "PROPOSED", hasDraft: true }, detail("NEEDS_CLARIFICATION")).group).toBe("NEEDS_CLARIFICATION");
    expect(classify({ phase: "PROPOSED", hasDraft: true }, detail("NO_ANSWER_BASIS")).group).toBe("KNOWLEDGE_MISSING");
    expect(classify({ phase: "PROPOSED", hasDraft: true }, detail(null))).toEqual({ group: "DRAFT_READY", answerBasis: "GROUNDED" });
    // The queue says a draft exists but the detail read did not happen (budget) or failed: the row is
    // ready to read, and its basis is honestly unknown.
    expect(classify({ phase: "PROPOSED", hasDraft: true }, null)).toEqual({ group: "DRAFT_READY", answerBasis: null });
    // A backend too old to report the fact keeps the old behaviour: the detail read decides.
    expect(classify({ phase: "PROPOSED" }, detail("GROUNDED")).group).toBe("DRAFT_READY");
    expect(classify({ phase: "PROPOSED" }, null).group).toBe("UNANSWERED");
  });

  it("the topic table is closed and literal; OTHER is what matches nothing", () => {
    expect(matchesTopic("SHIPPING", ["택배가 아직이에요"])).toBe(true);
    expect(matchesTopic("EXCHANGE_RETURN", ["환불 부탁드립니다"])).toBe(true);
    expect(matchesTopic("PRODUCT_SPEC", ["폭이 몇 mm"])).toBe(true);
    expect(matchesTopic("USAGE", ["설치 방법"])).toBe(true);
    expect(matchesTopic("SHIPPING", ["색상 문의"])).toBe(false);
    expect(matchesTopic("OTHER", ["색상 문의"])).toBe(true);
    expect(matchesTopic("OTHER", ["배송 문의"])).toBe(false);
  });
});

describe("bounded detail reads", () => {
  it(`spends at most ${WORKLOAD_DETAIL_CAP} detail reads, only on PROPOSED rows, and discloses truncation`, async () => {
    const seeds = Array.from({ length: 12 }, (_, i) => ({
      workItemId: `w-${i}`, inquiryId: `i-${i}`, sellerAccountId: "a", channelId: "c", title: `문의 ${i}`, details: "본문",
      receivedAt: `2026-08-${String(10 + i).padStart(2, "0")}T00:00:00Z`,
    }));
    const client = new FakeSpringClient(seeds);
    for (let i = 0; i < 10; i += 1) await client.proposeInquiry(`w-${i}`);
    const before = client.calls.detail;
    const result = await listInquiryWorkload(client, {});
    expect(client.calls.detail - before).toBe(WORKLOAD_DETAIL_CAP);
    expect(result.items).toHaveLength(12);
    expect(result.truncated).toBe(true);
    expect(result.items.filter((i) => i.phase === "OPEN").every((i) => !i.detailRead)).toBe(true);
    expect(result.items.map((i) => i.workItemId)).toEqual(seeds.map((s) => s.workItemId));
  });

  it("narrows by work-item ids and by product ids before spending anything", async () => {
    const client = new FakeSpringClient([
      { workItemId: "w-a", inquiryId: "i-a", sellerAccountId: "a", channelId: "c", title: "a", details: "", receivedAt: "2026-08-01T00:00:00Z", productId: "p-1" },
      { workItemId: "w-b", inquiryId: "i-b", sellerAccountId: "a", channelId: "c", title: "b", details: "", receivedAt: "2026-08-02T00:00:00Z", productId: "p-2" },
    ]);
    expect((await listInquiryWorkload(client, { workItemIds: ["w-b"] })).items.map((i) => i.workItemId)).toEqual(["w-b"]);
    expect((await listInquiryWorkload(client, { productIds: ["p-1"] })).items.map((i) => i.workItemId)).toEqual(["w-a"]);
    expect(client.calls.detail).toBe(0);
  });
});
