/**
 * Draft-model seam — the pluggable "intelligence" behind reply-draft generation.
 *
 * This mirrors the backend's established pattern of a provider interface with a
 * `providerKind`/`name`/`version` provenance and a rule-based implementation shipped
 * while the AI adapter stays reserved (e.g. `RuleBasedInquiryProposalProvider`,
 * `RuleBasedReviewReplyProvider`). Per the product decision for this slice there is
 * **no live LLM call**: the only implementation is deterministic and local. A real
 * model drops in behind this same interface later, under its own gate and its own
 * privacy review — inquiry title/body is PII and must not egress until that decision.
 *
 * The provider produces a **starter draft** for a human to review and edit at the
 * checkpoint; it is never sent anywhere and is explicitly provenance-tagged so the UI
 * can label it "규칙 기반" (rule-based).
 */

export interface DraftProvenance {
  readonly providerKind: string; // "RULE_BASED"
  readonly name: string;
  readonly version: string;
}

/** In-memory input; seller-owned content that must stay off every log line. */
export interface DraftInput {
  readonly title: string;
  readonly details: string | null;
  readonly status: string;
  readonly informStatus: string | null;
}

export interface DraftCandidate {
  readonly title: string;
  readonly comments: string;
  readonly category: string;
  readonly provenance: DraftProvenance;
}

export interface DraftModelProvider {
  readonly provenance: DraftProvenance;
  draft(input: DraftInput): DraftCandidate;
}

/**
 * Deterministic, closed-vocabulary reply drafter. Pure: no network, no LLM, no clock,
 * no fs. Selects a coarse category from keyword hits in the seller's own title/details
 * and returns a templated starter reply for that category. Same input → same output.
 */
export class RuleBasedDraftProvider implements DraftModelProvider {
  readonly provenance: DraftProvenance = {
    providerKind: "RULE_BASED",
    name: "rule-drafter",
    version: "rules-v1",
  };

  private static readonly RULES: ReadonlyArray<{ category: string; keywords: readonly string[]; template: string }> = [
    {
      category: "delivery_status_reply",
      keywords: ["배송", "택배", "발송", "출고", "송장", "delivery", "shipping"],
      template:
        "안녕하세요, 문의해 주셔서 감사합니다. 배송 진행 상황을 확인하여 빠르게 안내드리겠습니다. 잠시만 기다려 주세요.",
    },
    {
      category: "exchange_return_reply",
      keywords: ["교환", "반품", "환불", "취소", "return", "refund", "exchange"],
      template:
        "안녕하세요, 문의해 주셔서 감사합니다. 교환/반품/환불 절차를 확인하여 처리 방법을 안내드리겠습니다.",
    },
    {
      category: "stock_restock_reply",
      keywords: ["재고", "품절", "입고", "재입고", "stock", "restock"],
      template:
        "안녕하세요, 문의해 주셔서 감사합니다. 해당 상품의 재고/입고 일정을 확인하여 안내드리겠습니다.",
    },
    {
      category: "product_info_reply",
      keywords: ["사이즈", "색상", "옵션", "사양", "size", "color", "option", "spec"],
      template:
        "안녕하세요, 문의해 주셔서 감사합니다. 상품 정보를 확인하여 자세히 안내드리겠습니다.",
    },
  ];

  private static readonly GENERAL = {
    category: "general_reply",
    template:
      "안녕하세요, 문의해 주셔서 감사합니다. 내용을 확인하여 정확하게 안내드리겠습니다. 잠시만 기다려 주세요.",
  } as const;

  draft(input: DraftInput): DraftCandidate {
    const haystack = `${input.title ?? ""} ${input.details ?? ""}`.toLowerCase();
    const matched = RuleBasedDraftProvider.RULES.find((r) =>
      r.keywords.some((k) => haystack.includes(k.toLowerCase())),
    );
    const category = matched?.category ?? RuleBasedDraftProvider.GENERAL.category;
    const comments = matched?.template ?? RuleBasedDraftProvider.GENERAL.template;
    // Echo the seller's own subject back as the reply title, prefixed — deterministic.
    const title = input.title ? `[답변] ${input.title}` : "[답변]";
    return { title, comments, category, provenance: this.provenance };
  }
}
