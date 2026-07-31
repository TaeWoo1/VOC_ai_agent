import { describe, expect, it } from "vitest";
import { InquiryDraftAgentRuntime } from "../../src/inquiryDraftRuntime";
import { buildInquiryReadToolRegistry } from "../../src/tools/ToolRegistry";
import { InMemoryInquiryDraftRunStore } from "../../src/checkpoint/InquiryDraftRunStore";
import { FakeSpringClient } from "../support/FakeSpringClient";
import type { SeedInquiry } from "../support/FakeSpringClient";
import { twoInquiries, OLDER_WORK_ITEM, PHONE_TOKEN, EMAIL_TOKEN } from "../support/fixtures";

const FIXED_NOW = "2026-07-31T00:00:00.000Z";

/** A Cafe24 board-6 비밀글 (secret), OPEN + UNANSWERED — the v1 target shape. */
function cafe24SecretInquiry(): SeedInquiry {
  return {
    workItemId: "33333333-3333-3333-3333-333333333333",
    inquiryId: "cccc1111-0000-0000-0000-000000000003",
    sellerAccountId: "acct-1",
    channelId: "chan-cafe24",
    channelCode: "CAFE24",
    channelNameKo: "카페24",
    isSecret: true,
    title: `배송 문의 ${PHONE_TOKEN}`,
    details: `배송 언제 오나요? 연락처 ${PHONE_TOKEN}`,
    receivedAt: "2026-07-10T09:00:00Z", // oldest → prioritized first
  };
}

function runtime(client: FakeSpringClient, store = new InMemoryInquiryDraftRunStore()) {
  return {
    rt: new InquiryDraftAgentRuntime({ client, runStore: store, now: () => FIXED_NOW }),
    store,
  };
}

describe("inquiry draft-preparation runtime", () => {
  it("prepares a rule-based draft for the top OPEN inquiry and mutates nothing", async () => {
    const client = new FakeSpringClient(twoInquiries());
    const { rt } = runtime(client);

    const res = await rt.run("t-draft", { intent: "PREPARE_INQUIRY_DRAFT" });

    expect(res.status).toBe("DONE");
    expect(res.preparation.prepared).toBe(true);
    const m = res.preparation.meta!;
    // Oldest-first: the 환불 요청 item is selected; its body keys the exchange/return category.
    expect(m.workItemId).toBe(OLDER_WORK_ITEM);
    expect(m.category).toBe("exchange_return_reply");
    expect(m.provenance.providerKind).toBe("RULE_BASED");
    expect(m.inquiryStatus).toBe("UNANSWERED");
    expect(m.phase).toBe("OPEN");
    expect(m.generatedAt).toBe(FIXED_NOW);
    expect(res.preparation.replyDraft).toContain("안녕하세요");
    expect(res.trail).toEqual(["searched", "prioritized", "detailed", "drafted"]);

    // NO backend mutation, NO send: propose/saveDraft/confirmPublish never called.
    expect(client.calls.propose).toBe(0);
    expect(client.calls.saveDraft).toBe(0);
    expect(client.calls.confirmPublish).toBe(0);
    expect(client.externalSendAttempts).toBe(0);

    // Work item phase is UNCHANGED — re-reading detail still shows OPEN / UNANSWERED.
    const after = await client.getInquiryDetail(OLDER_WORK_ITEM);
    expect(after.phase).toBe("OPEN");
    expect(after.status).toBe("UNANSWERED");
  });

  it("surfaces the target channel + secret flag for a Cafe24 board-6 비밀글, without exposing the body", async () => {
    const client = new FakeSpringClient([cafe24SecretInquiry()]);
    const { rt, store } = runtime(client);

    const res = await rt.run("t-secret", { intent: "PREPARE_INQUIRY_DRAFT" });

    const m = res.preparation.meta!;
    expect(m.channelCode).toBe("CAFE24");
    expect(m.channelNameKo).toBe("카페24");
    expect(m.isSecret).toBe(true);
    expect(m.category).toBe("delivery_status_reply");

    // The generated draft is a generic template — it never echoes the customer body/contact.
    expect(res.preparation.replyDraft).not.toContain(PHONE_TOKEN);
    expect(res.preparation.replyDraft).not.toContain("배송 언제 오나요");

    // The durable snapshot is BODY-FREE: metadata only, no draft text, no customer content.
    const snap = await store.load("t-secret");
    expect(snap).not.toBeNull();
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain(PHONE_TOKEN);
    expect(serialized).not.toContain("배송 언제 오나요");
    expect(serialized).not.toContain(res.preparation.replyDraft!);
    // But the sanitized scalars ARE retained.
    expect(snap!.meta!.isSecret).toBe(true);
    expect(snap!.meta!.channelCode).toBe("CAFE24");
  });

  it("is deterministic: replaying the same request reproduces an identical draft (idempotent, no cumulative effect)", async () => {
    const client = new FakeSpringClient(twoInquiries());
    const { rt } = runtime(client);

    const first = await rt.run("t-replay", { intent: "PREPARE_INQUIRY_DRAFT" });
    const second = await rt.run("t-replay", { intent: "PREPARE_INQUIRY_DRAFT" });

    expect(second.preparation).toEqual(first.preparation);
    // Still no mutation after a replay.
    expect(client.calls.propose).toBe(0);
    expect(client.calls.saveDraft).toBe(0);
    expect(client.calls.confirmPublish).toBe(0);
    expect(client.externalSendAttempts).toBe(0);
  });

  it("reports nothing to draft when the OPEN queue is empty — no detail read, no mutation", async () => {
    const client = new FakeSpringClient([]);
    const { rt } = runtime(client);

    const res = await rt.run("t-empty", { intent: "PREPARE_INQUIRY_DRAFT" });

    expect(res.preparation.prepared).toBe(false);
    expect(res.preparation.meta).toBeNull();
    expect(res.preparation.replyDraft).toBeNull();
    expect(res.preparation.note).toBeTruthy();
    expect(client.calls.detail).toBe(0);
    expect(client.calls.propose).toBe(0);
  });

  it("does not draft an ANSWERED inquiry: the OPEN search never returns it", async () => {
    // Seed an ANSWERED inquiry only. The queue filters to OPEN work items, so the draft run finds
    // nothing to prepare — it never opens a new OPEN draft flow against an answered inquiry.
    const answered: SeedInquiry = { ...cafe24SecretInquiry(), status: "ANSWERED" };
    const client = new FakeSpringClient([answered]);
    // Force the item to a terminal phase so it is not OPEN.
    // (FakeSpringClient seeds phase OPEN; emulate answered by transitioning it out of OPEN.)
    await client.proposeInquiry(answered.workItemId); // OPEN -> PROPOSED (no longer in the OPEN queue)
    const { rt } = runtime(client);

    const res = await rt.run("t-answered", { intent: "PREPARE_INQUIRY_DRAFT" });
    expect(res.preparation.prepared).toBe(false);
  });

  it("rejects a non-draft intent", async () => {
    const client = new FakeSpringClient(twoInquiries());
    const { rt } = runtime(client);
    await expect(rt.run("t-bad", { intent: "HANDLE_REVIEW_REPLIES", accountId: "a" })).rejects.toThrow(
      /cannot handle intent/,
    );
  });
});

describe("read-only tool registry (structural no-mutation)", () => {
  it("exposes only the two read tools — no propose/save/record capability to reach", () => {
    const registry = buildInquiryReadToolRegistry(new FakeSpringClient(twoInquiries()));
    expect(registry.names()).toEqual(["get_inquiry_detail", "search_unanswered_inquiries"]);
    expect(registry.has("propose_inquiry_reply")).toBe(false);
    expect(registry.has("save_inquiry_reply_draft")).toBe(false);
    expect(registry.has("record_inquiry_reply_approval")).toBe(false);
  });
});
