package com.sellerops.inquiry.decision;

import java.util.UUID;

/**
 * One piece of CURRENT evidence the coverage judge may cite (Inquiry Decision v2). Past answers are never a candidate
 * — they are {@link PrecedentCandidate}s, a different list the judge may only propose as a prefill.
 *
 * @param id        {@code E1}, {@code E2}, … — positional; the only identifier that reaches the vendor
 * @param kind      where it came from
 * @param label     what the seller would read above it (a document title, 「옵션 목록」, 「주문 상태」)
 * @param text      what it says — what the judge reads and what a drafter would be shown
 * @param sourceId  the knowledge source / order row it came from, when there is one (never sent)
 * @param productId the listing it is about, for catalogue kinds (never sent)
 * @param factKey   the fact key, for a single catalogue fact (never sent)
 * @param scope     the entity instance it is attributed to (never sent) — Inquiry Decision v2.2
 */
public record EvidenceCandidate(String id, Kind kind, String label, String text, UUID sourceId, UUID productId,
                                String factKey, EvidenceScope scope) {

    /**
     * Scope derived from where the candidate came from: listing kinds to their listing (unattributed when the listing
     * is not known), company rules to the company, an order fact to an order it names only when told which.
     */
    public EvidenceCandidate(String id, Kind kind, String label, String text, UUID sourceId, UUID productId,
                             String factKey) {
        this(id, kind, label, text, sourceId, productId, factKey, switch (kind) {
            case PRODUCT_KNOWLEDGE, PRODUCT_FACTS, OPTIONS, ADDONS -> EvidenceScope.product(productId);
            case ORG_KNOWLEDGE -> EvidenceScope.ORG;
            case ORDER_FACT -> EvidenceScope.order(null);
        });
    }

    public enum Kind {
        PRODUCT_KNOWLEDGE, ORG_KNOWLEDGE, PRODUCT_FACTS, OPTIONS, ADDONS, ORDER_FACT;

        public String scopeLabelKo() {
            return switch (this) {
                case PRODUCT_KNOWLEDGE -> "상품 정보";
                case ORG_KNOWLEDGE -> "운영 정책";
                case PRODUCT_FACTS, OPTIONS, ADDONS -> "상품 등록 정보";
                case ORDER_FACT -> "주문 정보";
            };
        }
    }

    public EvidenceCandidate withScope(EvidenceScope newScope) {
        return new EvidenceCandidate(id, kind, label, text, sourceId, productId, factKey, newScope);
    }

    public EvidenceCandidate withId(String newId) {
        return new EvidenceCandidate(newId, kind, label, text, sourceId, productId, factKey, scope);
    }
}
