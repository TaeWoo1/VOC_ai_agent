package com.sellerops.product.library;

import java.util.UUID;

/**
 * Which 규격's knowledge a retrieval is allowed to return.
 *
 * <p><b>Two states, and the asymmetry between them is the whole point.</b> When the customer named an
 * option we know ({@link #of}), a document scoped to a DIFFERENT option is not weak evidence about
 * their item — it is evidence about someone else's, and it is excluded outright. When nobody named
 * one ({@link #unresolved()}), nothing is excluded: the per-규격 documents are exactly what proves
 * the question is answerable, and the honest reply is to ask which 규격 rather than to report an
 * empty library.
 *
 * <p>So this never suppresses evidence in order to be cautious. It suppresses evidence that has been
 * shown to be about another item, and in the case where it cannot show that, it suppresses nothing
 * and the caller asks the customer. The caution about unconfirmed 규격 is carried by
 * {@code SpecApplicability}, which is a statement about the QUESTION; this is a statement about the
 * DOCUMENT, and collapsing the two would let one of them silently answer for the other.
 */
public record KnowledgeVariantScope(UUID variantId, boolean resolved) {

    private static final KnowledgeVariantScope UNRESOLVED = new KnowledgeVariantScope(null, false);

    /** Nobody has said which 규격 this is about. Every document stays in play. */
    public static KnowledgeVariantScope unresolved() {
        return UNRESOLVED;
    }

    /** The customer named this one. Null falls back to {@link #unresolved()} rather than matching. */
    public static KnowledgeVariantScope of(UUID variantId) {
        return variantId == null ? UNRESOLVED : new KnowledgeVariantScope(variantId, true);
    }

    /**
     * May a document with this scope be retrieved?
     *
     * <p>A product-level document ({@code null}) always may — it is true for every option by the
     * seller's own statement. A variant-scoped one may only when this scope is that variant.
     */
    public boolean admits(UUID documentVariantId) {
        if (documentVariantId == null || !resolved) {
            return true;
        }
        return documentVariantId.equals(variantId);
    }
}
