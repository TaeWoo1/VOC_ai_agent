/**
 * Draft-model seam — the pluggable "intelligence" behind reply-draft generation.
 *
 * This mirrors the backend's established pattern of a provider interface with a
 * `providerKind`/`name`/`version` provenance and a rule-based implementation
 * (`RuleBasedInquiryProposalProvider`, `RuleBasedReviewReplyProvider`).
 *
 * **A real model now drops in behind this interface** (`SpringDraftProvider`), which is what the
 * original note reserved it for: "a real model drops in behind this same interface later, under its
 * own gate and its own privacy review — inquiry title/body is PII and must not egress until that
 * decision." Both halves of that condition are met, and neither is met HERE:
 *
 *  - the **gate** is `sellerops.agent.draft.*` on the backend — off by default, keyed, and opt-in per
 *    organisation;
 *  - the **payload floor** is `AgentDraftPrompt.user`, asserted on the serialized request bytes by
 *    `AgentDraftPayloadFloorTest`. Exactly the inquiry's own title and body leave; no id, no buyer
 *    field, no channel, no phase, no timestamp.
 *
 * Both live in the backend rather than here, and that is the point: this service holds NO vendor key
 * (its own `.env.example` opens by saying it holds no credential of any kind), so the LLM call is one
 * more backend capability reached with the operator's forwarded bearer — the backend stays the only
 * LLM egress in the repository, and there is still exactly one place a key lives.
 *
 * **`draft` is async because a model call is.** The rule provider still answers synchronously in
 * substance (it resolves immediately, no I/O, same input → same output); the signature widened so a
 * provider that reaches the network fits behind it without every graph node needing to know which
 * kind it got.
 *
 * The provider produces a **starter draft** for a human to review and edit at the checkpoint; it is
 * never sent anywhere and is explicitly provenance-tagged so the UI can say which one wrote it —
 * "규칙 기반" (rule-based) or an AI draft — and never claim the wrong one.
 */

export interface DraftProvenance {
  /** `RULE_BASED` or `LLM`. The UI's label is derived from this and must never be hardcoded. */
  readonly providerKind: string;
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
  /**
   * What this provider WOULD stamp. The candidate carries its own provenance, which is what a caller
   * must read — a provider that fell back mid-flight returns a candidate whose provenance says
   * `RULE_BASED` even though this field says `LLM`, and the candidate is the one that is true.
   */
  readonly provenance: DraftProvenance;
  draft(input: DraftInput): Promise<DraftCandidate>;
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

  draft(input: DraftInput): Promise<DraftCandidate> {
    return Promise.resolve(this.draftNow(input));
  }

  /**
   * The synchronous truth behind {@link draft}.
   *
   * Exposed because the fallback path needs a draft WITHOUT awaiting anything — `SpringDraftProvider`
   * calls it after the model has already refused, and a fallback that could itself be pending would
   * put a second failure mode inside the one that exists to have none.
   */
  draftNow(input: DraftInput): DraftCandidate {
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
