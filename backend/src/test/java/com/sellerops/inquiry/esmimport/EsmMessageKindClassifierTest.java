package com.sellerops.inquiry.esmimport;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * The message-kind gate classifies from structured 등록구분 (with 문의유형 available), never
 * from free-text body content, and fails closed on anything unrecognized.
 */
class EsmMessageKindClassifierTest {

    @Test
    void emergencyMessageIsPlatformOperationalNotice() {
        // The observed shipping-delay emergency-message kind.
        assertThat(EsmMessageKindClassifier.classify("긴급메시지", "배송"))
                .isEqualTo(EsmMessageKind.PLATFORM_OPERATIONAL_NOTICE);
    }

    @Test
    void productInquiryIsBuyerInquiry() {
        assertThat(EsmMessageKindClassifier.classify("상품문의", "배송"))
                .isEqualTo(EsmMessageKind.BUYER_INQUIRY);
    }

    @Test
    void blankOrNullRegistrationKindIsUnsupported() {
        assertThat(EsmMessageKindClassifier.classify(null, "배송"))
                .isEqualTo(EsmMessageKind.UNSUPPORTED_OR_UNKNOWN);
        assertThat(EsmMessageKindClassifier.classify("   ", "배송"))
                .isEqualTo(EsmMessageKind.UNSUPPORTED_OR_UNKNOWN);
    }

    @Test
    void unknownRegistrationKindFailsClosed() {
        assertThat(EsmMessageKindClassifier.classify("알수없는구분", "배송"))
                .isEqualTo(EsmMessageKind.UNSUPPORTED_OR_UNKNOWN);
    }

    @Test
    void inquiryTypeAloneDoesNotMakeABuyerInquiry() {
        // 문의유형 배송 on an emergency message stays operational — 등록구분 is the primary key.
        assertThat(EsmMessageKindClassifier.classify("긴급메시지", "배송"))
                .isEqualTo(EsmMessageKind.PLATFORM_OPERATIONAL_NOTICE);
    }
}
