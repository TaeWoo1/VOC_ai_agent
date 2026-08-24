package com.sellerops.inquiry.publish;

/**
 * How — if at all — a reply can reach a given channel's inquiry.
 *
 * <p><b>Reading a channel's inquiries and answering them are different capabilities.</b> SellerOps
 * has collected NAVER 상품 문의 and 고객 문의 live, and Cafe24 board-6 문의 live, and none of that is
 * evidence that a reply can be posted back. The four values below are answers to the second question
 * only, and the registry that holds them cites what each answer was derived from.
 */
public enum InquiryReplyTransport {

    /**
     * The channel publishes an official answer endpoint, and SellerOps implements it. The only value
     * that may be claimed from a real endpoint in the code — never from vendor documentation alone.
     */
    DIRECT_API,

    /**
     * No official endpoint, but the seller can complete the action themselves on the marketplace with
     * SellerOps detecting and validating the result (the Action Window pattern). Nothing in this
     * package produces one for inquiries yet.
     */
    GUIDED_ACTION,

    /**
     * Answering through SellerOps is structurally impossible on this channel today — including where
     * the repository itself forbids it. NAVER is this: {@code NaverReadOnlyFenceTest} refuses the
     * write paths by name, so no build of this product can post a NAVER answer, whatever the vendor
     * offers.
     */
    UNSUPPORTED,

    /**
     * Not audited to a conclusion. The vendor may or may not publish an answer endpoint; nobody has
     * read the reference and written down which. <b>This is not a synonym for "no"</b> — it is the
     * honest state of an unfinished audit, and a screen must say so rather than rendering it as an
     * absence of capability.
     */
    NEEDS_VERIFICATION
}
