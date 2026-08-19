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
  // The seam widened to `Promise<DraftCandidate>` so a provider that reaches a model fits behind it.
  // The rule provider stays deterministic in substance — it resolves immediately, does no I/O, and
  // gives the same answer to the same input — which is exactly what these assertions still check.
  it("is deterministic: same input -> same output", async () => {
    const a = await provider.draft(input("배송 언제 오나요"));
    const b = await provider.draft(input("배송 언제 오나요"));
    expect(a).toEqual(b);
  });

  it("selects a category from keyword hits", async () => {
    expect((await provider.draft(input("배송 문의"))).category).toBe("delivery_status_reply");
    expect((await provider.draft(input("환불 해주세요"))).category).toBe("exchange_return_reply");
    expect((await provider.draft(input("재고 있나요"))).category).toBe("stock_restock_reply");
    expect((await provider.draft(input("사이즈 알려주세요"))).category).toBe("product_info_reply");
  });

  it("falls back to a general reply and tags rule-based provenance", async () => {
    const c = await provider.draft(input("그냥 궁금해서요"));
    expect(c.category).toBe("general_reply");
    expect(c.provenance).toEqual({ providerKind: "RULE_BASED", name: "rule-drafter", version: "rules-v1" });
    expect(c.title.startsWith("[답변]")).toBe(true);
    expect(c.comments.length).toBeGreaterThan(0);
  });

  /**
   * `draftNow` is the synchronous truth the fallback path uses — `SpringDraftProvider` calls it after
   * the model has already refused, so a fallback that could itself be pending would put a second
   * failure mode inside the one that exists to have none.
   */
  it("draftNow answers without awaiting, and identically", async () => {
    expect(provider.draftNow(input("배송 문의"))).toEqual(await provider.draft(input("배송 문의")));
  });

  /**
   * The SEAM stays pure. The real model lives behind `SpringDraftProvider`, which is a different
   * module for exactly this reason: this file is the one every graph imports, and it must stay
   * something a reader can be sure reaches nothing.
   */
  it("purity: the seam module reaches no network / fs / LLM", () => {
    const src = readFileSync(fileURLToPath(new URL("../../src/provider/DraftModelSeam.ts", import.meta.url)), "utf8");
    const codeLines = src.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("/*"));
    const code = codeLines.join("\n");
    for (const forbidden of ["fetch(", "import(", "require(", "openai", "anthropic", "langchain", "http", "node:fs", "node:net"]) {
      expect(code.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
