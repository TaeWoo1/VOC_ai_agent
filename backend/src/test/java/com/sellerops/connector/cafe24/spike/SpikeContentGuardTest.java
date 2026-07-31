package com.sellerops.connector.cafe24.spike;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class SpikeContentGuardTest {

    @Test
    void fixedSourceUsesTheFixedHarmlessPhrase() {
        String content = SpikeContentGuard.resolveContent(
                SpikeReplyCommand.ContentSource.FIXED, "ignored");
        assertThat(content).isEqualTo(SpikeContentGuard.FIXED_TEST_CONTENT);
    }

    @Test
    void writerMarkerIsANonIdentifyingServiceLabel() {
        assertThat(SpikeContentGuard.SPIKE_WRITER_MARKER).isEqualTo("SellerOps 연결점검");
    }

    @Test
    void operatorContentIsAcceptedWhenClean() {
        String content = SpikeContentGuard.resolveContent(
                SpikeReplyCommand.ContentSource.OPERATOR, "테스트 답변 문구입니다");
        assertThat(content).isEqualTo("테스트 답변 문구입니다");
    }

    @Test
    void rejectsEmptyOperatorContent() {
        assertThatThrownBy(() -> SpikeContentGuard.resolveContent(
                SpikeReplyCommand.ContentSource.OPERATOR, "   "))
                .isInstanceOf(SpikeContentGuard.SpikeContentRejectedException.class)
                .hasMessageContaining("EMPTY");
    }

    @Test
    void rejectsEmailLikeOperatorContent() {
        assertThatThrownBy(() -> SpikeContentGuard.resolveContent(
                SpikeReplyCommand.ContentSource.OPERATOR, "연락 주세요 buyer@example.com"))
                .isInstanceOf(SpikeContentGuard.SpikeContentRejectedException.class)
                .hasMessageContaining("EMAIL");
    }

    @Test
    void rejectsLongDigitRunLikePhoneOrOrderNumber() {
        assertThatThrownBy(() -> SpikeContentGuard.resolveContent(
                SpikeReplyCommand.ContentSource.OPERATOR, "주문번호 20260731001 확인 바랍니다"))
                .isInstanceOf(SpikeContentGuard.SpikeContentRejectedException.class)
                .hasMessageContaining("CONTACT_OR_ORDER_NUMBER");
    }

    @Test
    void rejectsHyphenatedPhoneNumberWithSeparators() {
        assertThatThrownBy(() -> SpikeContentGuard.resolveContent(
                SpikeReplyCommand.ContentSource.OPERATOR, "연락처 010-1234-5678 로 주세요"))
                .isInstanceOf(SpikeContentGuard.SpikeContentRejectedException.class)
                .hasMessageContaining("CONTACT_OR_ORDER_NUMBER");
    }

    @Test
    void rejectionMessageNeverEchoesTheRejectedText() {
        try {
            SpikeContentGuard.resolveContent(
                    SpikeReplyCommand.ContentSource.OPERATOR, "secret buyer@example.com text");
        } catch (SpikeContentGuard.SpikeContentRejectedException e) {
            assertThat(e.getMessage()).doesNotContain("buyer@example.com");
            assertThat(e.getMessage()).doesNotContain("secret");
        }
    }
}
