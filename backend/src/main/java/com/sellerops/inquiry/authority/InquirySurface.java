package com.sellerops.inquiry.authority;

import com.sellerops.inquiry.InquirySourceSubtype;

/**
 * Where the customer wrote — decides what may be asked back. Derived from the channel's own resource
 * ({@link InquirySourceSubtype}), never from the text. Anything not positively known to be order-attached is treated as
 * public: a wrong «public» costs one question not asked; a wrong «private» asks for identity in public.
 */
public enum InquirySurface {
    /** A listing Q&A or board post others may read (NAVER 상품 문의, Cafe24 board, Coupang, anything unknown). */
    PUBLIC_QNA,
    /** A message attached to a customer's order by the channel (NAVER 고객 문의 — 네이버페이 주문 문의). */
    ORDER_ATTACHED;

    public static InquirySurface of(String sourceSubtype) {
        return InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY.equals(sourceSubtype) ? ORDER_ATTACHED : PUBLIC_QNA;
    }
}
