package com.sellerops.inquiry.publish;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.InquirySourceSubtype;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The audit, asserted — because the whole value of this registry is that it says four different
 * things where a screen would otherwise say one.
 *
 * <p>"We read this channel's inquiries" and "we can answer them" are separate claims, and the second
 * has three separate negatives: structurally forbidden, unaudited, and unknown. A registry that
 * collapsed them would let an unfinished audit render as a vendor limitation.
 */
class InquiryReplyCapabilityRegistryTest {

    private final InquiryReplyCapabilityRegistry registry = new InquiryReplyCapabilityRegistry();

    @Test
    @DisplayName("COUPANG is the only DIRECT_API, and it cites the class that implements it")
    void coupangIsDirect() {
        var view = registry.capability("COUPANG", null);
        assertThat(view.transport()).isEqualTo(InquiryReplyTransport.DIRECT_API.name());
        assertThat(view.evidence()).contains("CoupangInquiryReplyClient").contains("라이브 미실행");
    }

    @Test
    @DisplayName("두 NAVER subtype은 서로 다른 계약으로 구현됐고, 그 차이가 근거에 적혀 있다")
    void naverSubtypesAreImplementedSeparately() {
        for (String subtype : new String[]{
                InquirySourceSubtype.NAVER_PRODUCT_QNA, InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY}) {
            var view = registry.capability("NAVER", subtype);
            assertThat(view.transport()).isEqualTo(InquiryReplyTransport.DIRECT_API.name());
            assertThat(view.sourceSubtype()).isEqualTo(subtype);
        }
        // Implemented is not live-proven, and the row must not let the two be read as one claim — in
        // EITHER direction. 상품 문의 landed on 2026-08-26 and 고객 문의 has still never been run, so
        // a row that says the same thing about both is wrong whichever sentence it picks.
        assertThat(registry.capability("NAVER", InquirySourceSubtype.NAVER_PRODUCT_QNA).evidence())
                .contains("LIVE_VERIFIED 2026-08-26").doesNotContain("라이브 미실행");
        assertThat(registry.capability("NAVER", InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY).evidence())
                .contains("라이브 미실행");
        // The two bodies are different field names on different endpoints. A row that did not say so
        // would make "a generic NAVER write" look like a thing that exists.
        var qna = registry.capability("NAVER", InquirySourceSubtype.NAVER_PRODUCT_QNA);
        var customer = registry.capability("NAVER", InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY);
        assertThat(qna.evidence()).contains("commentContent").contains("덮어쓰기");
        assertThat(customer.evidence()).contains("answerComment").contains("ERR-NC-101010");
        assertThat(qna.evidence()).isNotEqualTo(customer.evidence());
    }

    @Test
    @DisplayName("no row calls a channel UNSUPPORTED — that value is for a channel-side limitation")
    void unsupportedIsNotUsedForOurOwnRefusal() {
        // The regression this guards is the one that actually happened: NAVER's rows said UNSUPPORTED
        // while NAVER publishes three answer endpoints, so a screen reported our fence as the
        // vendor's limit. No channel currently in the registry has a channel-side "no".
        assertThat(registry.all())
                .noneMatch(r -> InquiryReplyTransport.UNSUPPORTED.name().equals(r.transport()));
    }

    @Test
    @DisplayName("CAFE24 is live-verified, and the row still says what a send needs before it happens")
    void cafe24IsLiveVerifiedButNotUnconditional() {
        // It moved on 2026-08-25 after two approved READs and then an actual send verified by an
        // exact read-back. Live-proven, and unlike every other DIRECT_API row it names preconditions a
        // deployment/seller must satisfy — being proven once did not make those go away.
        //
        // This assertion used to require "라이브 미실행", which stayed true in the string for two weeks
        // after it stopped being true in the world. The field is not a comment: it reaches the browser
        // through PublishCapabilityController.transports().
        var view = registry.capability("CAFE24", null);
        assertThat(view.transport()).isEqualTo(InquiryReplyTransport.DIRECT_API.name());
        assertThat(view.reasonKo())
                .as("a seller must be told the permission is a separate agreement")
                .contains("동의");
        assertThat(view.evidence())
                .contains("VERIFIED 2026-08-25")
                .doesNotContain("라이브 미실행")
                .contains("mall.write_community")
                .contains("client_ip")
                .contains("ANSWER_POSTED_STATUS_UNRESOLVED");
    }

    @Test
    @DisplayName("a channel nobody entered resolves to NEEDS_VERIFICATION, never to UNSUPPORTED")
    void unauditedChannelDefaultsHonestly() {
        var view = registry.capability("ELEVENST", null);
        assertThat(view.transport()).isEqualTo(InquiryReplyTransport.NEEDS_VERIFICATION.name());
        assertThat(view.evidence()).isEqualTo("감사 기록 없음");
    }

    @Test
    @DisplayName("a NAVER row is never answered by a channel-wide fallback that does not exist")
    void naverHasNoSubtypelessRow() {
        // If someone later adds a subtype-less NAVER row, an approval for 상품 문의 could be answered
        // by it and the subtype distinction would quietly stop mattering.
        assertThat(registry.all())
                .filteredOn(r -> "NAVER".equals(r.channelCode()))
                .allSatisfy(r -> assertThat(r.sourceSubtype()).isNotNull());
    }
}
