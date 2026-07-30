import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RuleBasedDraftProvider } from "../../src/provider/DraftModelSeam";
import type { DraftInput } from "../../src/provider/DraftModelSeam";

const provider = new RuleBasedDraftProvider();

function input(title: string, details: string | null = null): DraftInput {
  return { title, details, status: "UNANSWERED", informStatus: null };
}

describe("RuleBasedDraftProvider", () => {
  it("is deterministic: same input -> same output", () => {
    const a = provider.draft(input("배송 언제 오나요"));
    const b = provider.draft(input("배송 언제 오나요"));
    expect(a).toEqual(b);
  });

  it("selects a category from keyword hits", () => {
    expect(provider.draft(input("배송 문의")).category).toBe("delivery_status_reply");
    expect(provider.draft(input("환불 해주세요")).category).toBe("exchange_return_reply");
    expect(provider.draft(input("재고 있나요")).category).toBe("stock_restock_reply");
    expect(provider.draft(input("사이즈 알려주세요")).category).toBe("product_info_reply");
  });

  it("falls back to a general reply and tags rule-based provenance", () => {
    const c = provider.draft(input("그냥 궁금해서요"));
    expect(c.category).toBe("general_reply");
    expect(c.provenance).toEqual({ providerKind: "RULE_BASED", name: "rule-drafter", version: "rules-v1" });
    expect(c.title.startsWith("[답변]")).toBe(true);
    expect(c.comments.length).toBeGreaterThan(0);
  });

  it("purity: the seam module reaches no network / fs / LLM", () => {
    const src = readFileSync(fileURLToPath(new URL("../../src/provider/DraftModelSeam.ts", import.meta.url)), "utf8");
    const codeLines = src.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("/*"));
    const code = codeLines.join("\n");
    for (const forbidden of ["fetch(", "import(", "require(", "openai", "anthropic", "langchain", "http", "node:fs", "node:net"]) {
      expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
