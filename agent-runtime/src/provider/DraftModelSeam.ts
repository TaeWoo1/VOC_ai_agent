/**
 * Draft-model seam — the pluggable "intelligence" behind reply-draft generation.
 *
 * This mirrors the backend's established pattern of a provider interface with a
 * `providerKind`/`name`/`version` provenance and a rule-based implementation
 * (`RuleBasedInquiryProposalProvider`, `RuleBasedReviewReplyProvider`).
 *
 * **The drafter behind this interface is the product's own composer** (`ComposerDraftProvider` →
 * `DraftPreparer` → `POST /api/inquiries/{id}/draft/generate`, i.e. `InquiryDraftComposer`). The
 * earlier `SpringDraftProvider`, which sent title and body to a retrieval-free model endpoint, is gone
 * (Knowledge Context v1-A closure, 2026-08-30): one grounded drafter, and no second one that could
 * say something the first would refuse. The gate, the payload floor, the retrieval, the applicability
 * check and the answer style all live in the backend, which stays the only LLM egress; this service
 * holds NO vendor key.
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

import type { DraftEvidenceSummary } from "../conversation/contract";

export interface DraftProvenance {
  /** `RULE_BASED` or `LLM`. The UI's label is derived from this and must never be hardcoded. */
  readonly providerKind: string;
  readonly name: string;
  readonly version: string;
}

/** In-memory input; seller-owned content that must stay off every log line. */
export interface DraftInput {
  /** The work item, when the caller has one — what the composer path drafts FOR. Without it: no text. */
  readonly workItemId?: string;
  /** Ids/labels the composer artifact names (never customer text). All optional; the id above suffices. */
  readonly inquiryId?: string | null;
  readonly channelCode?: string | null;
  readonly channelNameKo?: string | null;
  readonly productId?: string | null;
  readonly productName?: string | null;
  readonly title: string;
  readonly details: string | null;
  readonly status: string;
  readonly informStatus: string | null;
}

export interface DraftCandidate {
  readonly title: string;
  /** Empty when no evidence-grounded text exists — a checkpoint may show it, nothing may record it. */
  readonly comments: string;
  readonly category: string;
  readonly provenance: DraftProvenance;
  /**
   * The backend's answer-basis state for this candidate — `GROUNDED` / `NEEDS_CLARIFICATION` /
   * `NO_ANSWER_BASIS` — as the composer computed it. `NO_ANSWER_BASIS` with an empty body is the gap
   * the legacy lanes surface; `performRecord` refuses to save an approval without text.
   */
  readonly answerBasis?: string | null;
  /** The backend's own sentence about what is missing / what to ask; never composed here. */
  readonly answerBasisNote?: string | null;
  /** The operational reason nothing was written (capability off, budget, vendor), when that is why. */
  readonly unavailableMessage?: string | null;
  /** The saved append-only version this text IS, when it came from the composer. */
  readonly draftVersion?: number | null;
  readonly contentFingerprint?: string | null;
  /** Passages per lane the composer stood on — counts by lane word, never text (Knowledge Context v1-A). */
  readonly evidenceSummary?: ReadonlyArray<DraftEvidenceSummary>;
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
 * Deterministic, closed-vocabulary CATEGORISER — and, since Knowledge Context v1-A, no longer a drafter.
 *
 * It used to return a templated starter reply per category: 「배송 진행 상황을 확인하여 빠르게 안내
 * 드리겠습니다」, 「교환/반품/환불 절차를 확인하여 처리 방법을 안내드리겠습니다」. Those were promises
 * made in the seller's voice with no evidence behind them — the same shape the backend deleted from
 * its own draft path on 2026-08-26 — and a checkpoint that showed one looked reviewed while being
 * grounded in a keyword. The category survives (it names what the inquiry is about and is safe to
 * log); the text does not. A candidate from here carries `answerBasis: NO_ANSWER_BASIS` and an empty
 * body, which the legacy graphs surface as a gap and which `performRecord` refuses to record.
 * Pure: no network, no LLM, no clock, no fs. Same input → same output.
 */
export class RuleBasedDraftProvider implements DraftModelProvider {
  readonly provenance: DraftProvenance = {
    providerKind: "RULE_BASED",
    name: "rule-drafter",
    version: "rules-v2-no-basis",
  };

  private static readonly RULES: ReadonlyArray<{ category: string; keywords: readonly string[] }> = [
    { category: "delivery_status_reply", keywords: ["배송", "택배", "발송", "출고", "송장", "delivery", "shipping"] },
    { category: "exchange_return_reply", keywords: ["교환", "반품", "환불", "취소", "return", "refund", "exchange"] },
    { category: "stock_restock_reply", keywords: ["재고", "품절", "입고", "재입고", "stock", "restock"] },
    { category: "product_info_reply", keywords: ["사이즈", "색상", "옵션", "사양", "size", "color", "option", "spec"] },
  ];

  private static readonly GENERAL_CATEGORY = "general_reply";

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
    const category = matched?.category ?? RuleBasedDraftProvider.GENERAL_CATEGORY;
    // No text. A sentence here would be a promise nobody grounded.
    const comments = "";
    // Echo the seller's own subject back as the reply title, prefixed — deterministic.
    const title = input.title ? `[답변] ${input.title}` : "[답변]";
    return { title, comments, category, provenance: this.provenance, answerBasis: "NO_ANSWER_BASIS" };
  }
}
