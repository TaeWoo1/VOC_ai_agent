package com.sellerops.product.library;

/**
 * <b>How this document came to exist</b> — a different axis from {@link KnowledgeSourceType}, which
 * says what KIND of document it is.
 *
 * <p>The two were one thing while the library had one filler: a person typing into SellerOps. On
 * 2026-08-26 the product-owner decided that what a seller writes on their own NAVER/Cafe24 상세페이지
 * is <b>seller-authored content, not a channel fact</b>, and may therefore enter this corpus. That is
 * correct — the seller wrote it — and it makes the corpus non-uniform for the first time, so the
 * uniformity has to be replaced by a stated distinction rather than left implied.
 *
 * <p><b>Why the third value is not the same as the second.</b> Text read out of a picture has the
 * seller's page as its SOURCE and a model as its READER. The source is trustworthy and the reading is
 * not — those are separable, and collapsing them would let an extraction error be quoted to a customer
 * with the authority of something the seller actually typed.
 *
 * <p><b>Nothing in the seller-facing UI says any of these words.</b> The customer-facing and
 * seller-facing rendering is {@link #labelKo()} — 「상품 상세페이지」 for both channel-derived kinds —
 * because "OCR", "vision" and "extraction" are our vocabulary for our problem, not the seller's.
 */
public enum KnowledgeAuthorship {

    /** A person at this company typed it into SellerOps. The original and, until 2026-08-26, the only. */
    SELLER_ENTERED_KNOWLEDGE,

    /**
     * The seller wrote it on their own listing, and SellerOps read it through the channel's API as
     * text. Same author, different keyboard — so it carries the same weight as typed knowledge.
     */
    SELLER_AUTHORED_CHANNEL_CONTENT,

    /**
     * A model read it out of an image on the seller's own detail page.
     *
     * <p>Declared before it has a producer, the way {@code FactConfidence.INFERRED} and
     * {@code ActionClass.WRITE} are: a class that is spelled and never produced is one a structural
     * test can prove absent, and the day it acquires a producer the test says so out loud.
     */
    AI_EXTRACTED_FROM_SELLER_IMAGE;

    /** What the seller reads. Two of the three are the same page, so they read the same. */
    public String labelKo() {
        return switch (this) {
            case SELLER_ENTERED_KNOWLEDGE -> "등록한 상품 지식";
            case SELLER_AUTHORED_CHANNEL_CONTENT, AI_EXTRACTED_FROM_SELLER_IMAGE -> "상품 상세페이지";
        };
    }

    /**
     * May a factual number from this document close a sentence on its own?
     *
     * <p>{@code false} for the image lane, and that is the entire operational consequence of the
     * distinction. It is not a ban on using the passage — the seller's page is still their page —
     * it is the statement that an extracted figure has one more way to be wrong than a typed one,
     * and so needs the same treatment a variant-unresolved spec already gets.
     */
    /**
     * Provenance as a TIE-BREAK between passages of equal relevance — never a weight.
     *
     * <p>Knowledge Context v1-A: a seller-typed passage outranks the same-scoring channel passage,
     * which outranks the same-scoring passage a model read off an image. Relevance and applicability
     * are decided first and are not overturned by this number; two passages that differ in coverage
     * never reach it. Lower sorts first.
     */
    public int tieBreakRank() {
        return switch (this) {
            case SELLER_ENTERED_KNOWLEDGE -> 0;
            case SELLER_AUTHORED_CHANNEL_CONTENT -> 1;
            case AI_EXTRACTED_FROM_SELLER_IMAGE -> 2;
        };
    }

    public boolean carriesExactFiguresUnaided() {
        return this != AI_EXTRACTED_FROM_SELLER_IMAGE;
    }
}
