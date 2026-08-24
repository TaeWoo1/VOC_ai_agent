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
     * The channel publishes an official answer endpoint and SellerOps deliberately does not call it.
     *
     * <p>NAVER is this, and it was mis-recorded as {@link #UNSUPPORTED} until 2026-08-24. The NAVER
     * Commerce API index vendored in this repository lists three answer endpoints —
     * {@code PUT /v1/contents/qnas/&#123;questionId&#125;} (상품 문의 답변 등록/수정),
     * {@code POST /v1/pay-merchant/inquiries/&#123;inquiryNo&#125;/answer} and
     * {@code PUT .../answer/&#123;answerContentId&#125;} (고객 문의) — so the platform is not the thing
     * that refuses. {@code NaverReadOnlyFenceTest} is: it fails the build on those path fragments by
     * name, and that fence stays until an inquiry-WRITE package removes it deliberately.
     *
     * <p>The distinction is the whole point. A seller told "네이버는 지원하지 않습니다" concludes their
     * channel cannot do this and stops asking; the truth is that SellerOps has not built it yet.
     */
    PLATFORM_SUPPORTED_NOT_IMPLEMENTED,

    /**
     * The channel offers no path at all — not an API, not a seller-completable surface SellerOps could
     * validate. NAVER TalkTalk is this: the Commerce API's 문의 domain has no TalkTalk endpoint.
     *
     * <p>Reserved for a limitation that belongs to the channel. Where the refusal is SellerOps' own,
     * the answer is {@link #PLATFORM_SUPPORTED_NOT_IMPLEMENTED}, and where nobody has looked it is
     * {@link #NEEDS_VERIFICATION}.
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
