import { describe, expect, it } from "vitest";
import { InquiryDraftAgentRuntime } from "../../src/inquiryDraftRuntime";
import { SpringDraftProvider } from "../../src/provider/SpringDraftProvider";
import { RuleBasedDraftProvider } from "../../src/provider/DraftModelSeam";
import type { DraftInput } from "../../src/provider/DraftModelSeam";
import { FakeSpringClient } from "../support/FakeSpringClient";
import type { SeedInquiry } from "../support/FakeSpringClient";

const FIXED_NOW = "2026-08-20T00:00:00.000Z";

function input(title = "배송 언제 오나요", details: string | null = "아직 발송 전이라고 나옵니다"): DraftInput {
  return { title, details, status: "UNANSWERED", informStatus: null };
}

/** The backend's answer when the capability is ON for this org and the model answered. */
const MODEL_ANSWER = {
  available: true,
  category: "delivery_status_reply",
  title: "배송 일정 확인 후 안내드리겠습니다",
  comments: "확인 후 신속히 안내드리겠습니다.",
  providerVersion: "agent-draft/v1+openai:gpt-5-2025-08-07+agent-draft-prompt/v1+schema/v1+out4000+effort:low",
};

describe("SpringDraftProvider — the model, and the fallback that is the shipped behaviour", () => {
  it("sends exactly the inquiry's title and body — no status, no informStatus, no id", async () => {
    let seen: unknown = null;
    const provider = new SpringDraftProvider({
      generateInquiryDraft: async (req) => {
        seen = req;
        return MODEL_ANSWER;
      },
    });

    await provider.draft(input());

    // The seam's own payload floor, one hop before the backend's. `DraftInput` carries four fields and
    // only two of them may leave; a provider that forwarded the whole input would widen the exposure
    // without touching the backend test that is supposed to be guarding it.
    expect(seen).toEqual({ title: "배송 언제 오나요", details: "아직 발송 전이라고 나옵니다" });
  });

  it("returns the model's draft, stamped LLM with the BACKEND's version string", async () => {
    const provider = new SpringDraftProvider({ generateInquiryDraft: async () => MODEL_ANSWER });

    const candidate = await provider.draft(input());

    expect(candidate.comments).toBe(MODEL_ANSWER.comments);
    expect(candidate.title).toBe(MODEL_ANSWER.title);
    expect(candidate.category).toBe("delivery_status_reply");
    expect(candidate.provenance.providerKind).toBe("LLM");
    // The vendor, the model, the prompt version and the knobs — so a recorded run can be read back
    // without consulting configuration, and the UI's "생성 방식" line is not a guess.
    expect(candidate.provenance.version).toBe(MODEL_ANSWER.providerVersion);
  });

  /**
   * The four ways there is no model draft, and all four land in the SAME place: a rule-based candidate
   * whose provenance says so. This is the property the whole seam rests on — a human at the checkpoint
   * always sees a usable starter draft, and the label above it is always true.
   */
  it.each([
    ["the capability is off for this org", { available: false, category: null, title: null, comments: null, providerVersion: null }],
    ["the model declined", { available: false, category: null, title: null, comments: null, providerVersion: "agent-draft/v1+openai:m" }],
    ["a partial body arrived", { available: true, category: "general_reply", title: "t", comments: null, providerVersion: "v" }],
  ])("falls back to the rule draft when %s", async (_label, answer) => {
    const provider = new SpringDraftProvider({ generateInquiryDraft: async () => answer as never });

    const candidate = await provider.draft(input());

    expect(candidate.provenance.providerKind).toBe("RULE_BASED");
    expect(candidate).toEqual(await new RuleBasedDraftProvider().draft(input()));
  });

  it("falls back when the call THROWS — a backend outage is not a failed run", async () => {
    const provider = new SpringDraftProvider({
      generateInquiryDraft: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    const candidate = await provider.draft(input());
    expect(candidate.provenance.providerKind).toBe("RULE_BASED");
  });

  it("falls back when the backend has no such endpoint at all", async () => {
    // A client that predates the endpoint, and every test fake. Indistinguishable from "off" to the
    // graph, and it should be: both mean no model draft, and both leave the shipped behaviour.
    const candidate = await new SpringDraftProvider({}).draft(input());
    expect(candidate.provenance.providerKind).toBe("RULE_BASED");
  });
});

/** A Cafe24 OPEN + UNANSWERED inquiry — the shape the draft-preparation run selects. */
function seedInquiry(): SeedInquiry {
  return {
    workItemId: "44444444-4444-4444-4444-444444444444",
    inquiryId: "dddd1111-0000-0000-0000-000000000004",
    sellerAccountId: "acct-1",
    channelId: "chan-cafe24",
    channelCode: "CAFE24",
    channelNameKo: "카페24",
    isSecret: false,
    title: "배송 언제 오나요",
    details: "주말에 주문했는데 아직 발송 전이라고 떠서요",
    receivedAt: "2026-08-10T09:00:00Z",
  };
}

/**
 * The JOINT: the LangGraph draft node actually awaits this provider and puts its output into the run.
 *
 * Proven here rather than in the browser because a browser run depends on the OPEN queue having an
 * item in it — a proof that stops working the first time someone answers the last inquiry is not one.
 */
describe("the graph's drafting node uses the seam", () => {
  it("carries the model's draft and provenance all the way into the prepared run", async () => {
    const client = new FakeSpringClient([seedInquiry()]);
    const runtime = new InquiryDraftAgentRuntime({
      client,
      draftProvider: new SpringDraftProvider({ generateInquiryDraft: async () => MODEL_ANSWER }),
      now: () => FIXED_NOW,
    });

    const { preparation } = await runtime.run("t-llm", { intent: "PREPARE_INQUIRY_DRAFT" });

    expect(preparation.prepared).toBe(true);
    // The MODEL's text reached the caller — not the template table's.
    expect(preparation.replyDraft).toBe(MODEL_ANSWER.comments);
    expect(preparation.meta?.category).toBe("delivery_status_reply");
    expect(preparation.meta?.provenance.providerKind).toBe("LLM");
    // …and the version the UI renders under "생성 방식" is the backend's, not a placeholder.
    expect(preparation.meta?.provenance.version).toBe(MODEL_ANSWER.providerVersion);
  });

  it("and its rule-based fallback, when the model is not available", async () => {
    const client = new FakeSpringClient([seedInquiry()]);
    const runtime = new InquiryDraftAgentRuntime({
      client,
      draftProvider: new SpringDraftProvider({}),
      now: () => FIXED_NOW,
    });

    const { preparation } = await runtime.run("t-rule", { intent: "PREPARE_INQUIRY_DRAFT" });

    expect(preparation.prepared).toBe(true);
    expect(preparation.meta?.provenance.providerKind).toBe("RULE_BASED");
    expect(preparation.replyDraft).not.toBe(MODEL_ANSWER.comments);
  });
});
