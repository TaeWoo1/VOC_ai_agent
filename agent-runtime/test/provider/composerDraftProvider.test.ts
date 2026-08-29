/**
 * Knowledge Context v1-A closure — the ONE drafter behind the legacy `/api/agent-runs` lanes is the
 * product's own composer, reached through `DraftPreparer`. These tests pin what it returns and what it
 * refuses, and that no title/body-only model seam exists in this service any more.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ComposerDraftProvider } from "../../src/provider/ComposerDraftProvider";
import { FakeSpringClient } from "../support/FakeSpringClient";
import type { SeedInquiry } from "../support/FakeSpringClient";
import { twoInquiries, OLDER_WORK_ITEM } from "../support/fixtures";

const INPUT = (seed: SeedInquiry) => ({
  workItemId: seed.workItemId,
  inquiryId: seed.inquiryId,
  channelCode: seed.channelCode ?? null,
  channelNameKo: seed.channelNameKo ?? null,
  productId: null,
  productName: null,
  title: seed.title,
  details: seed.details,
  status: "UNANSWERED",
  informStatus: null,
});

function older(extra: Partial<SeedInquiry> = {}): SeedInquiry {
  return { ...twoInquiries().find((s) => s.workItemId === OLDER_WORK_ITEM)!, ...extra };
}

describe("ComposerDraftProvider — the legacy lanes draft through InquiryDraftComposer", () => {
  it("GROUNDED: proposes the OPEN item, generates once, returns the saved version's text + basis + lane counts", async () => {
    const seed = older({ draftGeneration: { comments: "안녕하세요. 교환은 수령 후 7일 이내 가능합니다.", evidence: [
      { scopeLabel: "상품 정보", count: 1 } as never, { scopeLabel: "운영 정책", count: 1 } as never,
    ] } });
    const fake = new FakeSpringClient([seed]);
    const c = await new ComposerDraftProvider(fake).draft(INPUT(seed));

    expect(c.comments).toBe("안녕하세요. 교환은 수령 후 7일 이내 가능합니다.");
    expect(c.category).toBe("exchange_return_reply");
    expect(c.provenance).toEqual({ providerKind: "LLM", name: "inquiry-draft-composer", version: "composer/v1" });
    expect(c.answerBasis).toBe("GROUNDED");
    expect(c.draftVersion).toBe(1);
    expect(c.contentFingerprint).toBeTruthy();
    expect(c.evidenceSummary).toEqual([{ scopeLabel: "상품 정보", count: 1 }, { scopeLabel: "운영 정책", count: 1 }]);
    expect(fake.calls.propose).toBe(1);
    expect(fake.calls.generate).toBe(1);
    expect(fake.calls.saveDraft).toBe(0);
    expect(fake.calls.confirmPublish).toBe(0);
    expect(fake.phaseOf(OLDER_WORK_ITEM)).toBe("PROPOSED");
  });

  it("NO_ANSWER_BASIS: no text, the backend's own note, and no sentence invented in its place", async () => {
    const seed = older({ draftGeneration: { answerBasis: "NO_ANSWER_BASIS", answerBasisNote: "'교환' 관련 내용이 없습니다." } });
    const fake = new FakeSpringClient([seed]);
    const c = await new ComposerDraftProvider(fake).draft(INPUT(seed));

    expect(c.comments).toBe("");
    expect(c.answerBasis).toBe("NO_ANSWER_BASIS");
    expect(c.answerBasisNote).toBe("'교환' 관련 내용이 없습니다.");
    expect(c.draftVersion).toBeUndefined();
    expect(c.provenance.providerKind).toBe("RULE_BASED");
    expect(fake.calls.generate).toBe(1);
  });

  it("capability off / vendor failure: no text, the unavailable reason, still no invented sentence", async () => {
    const seed = older({ draftGeneration: { unavailableMessage: "AI 초안 기능이 꺼져 있습니다." } });
    const fake = new FakeSpringClient([seed]);
    const c = await new ComposerDraftProvider(fake).draft(INPUT(seed));
    expect(c.comments).toBe("");
    expect(c.unavailableMessage).toBe("AI 초안 기능이 꺼져 있습니다.");
  });

  it("the seller's registered fallback is labelled as theirs, not as AI", async () => {
    const seed = older({ draftGeneration: { authorKind: "SELLER_APPROVED_FALLBACK", answerBasis: "GROUNDED", comments: "확인 후 안내드리겠습니다." } });
    const fake = new FakeSpringClient([seed]);
    const c = await new ComposerDraftProvider(fake).draft(INPUT(seed));
    expect(c.provenance.providerKind).toBe("SELLER_APPROVED_FALLBACK");
  });

  it("without a work item there is no composer to ask — category only, no text", async () => {
    const fake = new FakeSpringClient(twoInquiries());
    const c = await new ComposerDraftProvider(fake).draft({ title: "배송 언제 오나요", details: null, status: "UNANSWERED", informStatus: null });
    expect(c.comments).toBe("");
    expect(c.category).toBe("delivery_status_reply");
    expect(fake.calls.generate).toBe(0);
    expect(fake.calls.propose).toBe(0);
  });

  it("an already PROPOSED item is not proposed again; a second call is a regenerate (v2)", async () => {
    const seed = older({ draftGeneration: { comments: "안녕하세요." } });
    const fake = new FakeSpringClient([seed]);
    const p = new ComposerDraftProvider(fake);
    const a = await p.draft(INPUT(seed));
    const b = await p.draft(INPUT(seed));
    expect(a.draftVersion).toBe(1);
    expect(b.draftVersion).toBe(2);
    expect(fake.calls.propose).toBe(1);
  });
});

describe("structural: no title/body-only draft seam remains in this service", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
  }
  it("`/api/agent/inquiry-draft` is called from nowhere and `SpringDraftProvider` does not exist", () => {
    const src = join(__dirname, "..", "..", "src");
    const files = walk(src);
    expect(files.some((f) => f.endsWith("SpringDraftProvider.ts"))).toBe(false);
    for (const f of files) {
      const code = readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
      expect(code, f).not.toContain("/api/agent/inquiry-draft");
      expect(code, f).not.toContain("generateInquiryDraft");
    }
  });
});
