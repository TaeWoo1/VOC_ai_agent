package com.sellerops.common;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.common.SafePreviewResult.PreviewStatus;
import org.junit.jupiter.api.Test;

/**
 * The deterministic VOC preview redactor. All inputs are SYNTHETIC — no real PII.
 * Each case asserts the sensitive span is gone (token present, raw absent) and the
 * fail-closed paths suppress to null.
 */
class VocPreviewSanitizerTest {

    @Test
    void safeShortTextPassesUnchanged() {
        SafePreviewResult r = VocPreviewSanitizer.sanitize("배송이 빨라서 좋았어요");
        assertThat(r.status()).isEqualTo(PreviewStatus.SAFE);
        assertThat(r.text()).isEqualTo("배송이 빨라서 좋았어요");
    }

    @Test
    void redactsPhone() {
        SafePreviewResult r = VocPreviewSanitizer.sanitize("연락처 010-1234-5678 로 주세요");
        assertThat(r.status()).isEqualTo(PreviewStatus.REDACTED);
        assertThat(r.text()).contains("[전화번호]").doesNotContain("1234").doesNotContain("5678");
    }

    @Test
    void redactsEmail() {
        SafePreviewResult r = VocPreviewSanitizer.sanitize("메일은 buyer@example.com 입니다");
        assertThat(r.text()).contains("[이메일]").doesNotContain("buyer@example.com");
    }

    @Test
    void redactsUrl() {
        SafePreviewResult r = VocPreviewSanitizer.sanitize("여기 보세요 https://shop.example.com/p/12 감사합니다");
        assertThat(r.text()).contains("[링크]").doesNotContain("example.com");
    }

    @Test
    void redactsLongNumericId() {
        SafePreviewResult r = VocPreviewSanitizer.sanitize("주문번호 1234567890 확인 부탁드려요");
        assertThat(r.text()).contains("[번호]").doesNotContain("1234567890");
    }

    @Test
    void redactsResidentRegistrationNumber() {
        SafePreviewResult r = VocPreviewSanitizer.sanitize("정보 900101-1234567 첨부합니다");
        assertThat(r.text()).contains("[민감정보]").doesNotContain("900101-1234567");
    }

    @Test
    void redactsCardLikeNumber() {
        SafePreviewResult r = VocPreviewSanitizer.sanitize("카드 1111-2222-3333-4444 결제했어요");
        assertThat(r.text()).contains("[번호]").doesNotContain("3333").doesNotContain("4444");
    }

    @Test
    void redactsMessengerHandle() {
        SafePreviewResult r = VocPreviewSanitizer.sanitize("문의는 카카오톡 shopcs2026 으로 주세요");
        assertThat(r.text()).contains("[연락처]").doesNotContain("shopcs2026");
    }

    @Test
    void redactsTokenLikeBlob() {
        SafePreviewResult r = VocPreviewSanitizer.sanitize("코드 ABCDEFGH1234567890wxyz 적용");
        assertThat(r.text()).contains("[보안정보]").doesNotContain("ABCDEFGH1234567890wxyz");
    }

    @Test
    void redactsFilePathOrFilename() {
        SafePreviewResult win = VocPreviewSanitizer.sanitize("첨부 C:\\Users\\me\\order.xlsx 확인");
        assertThat(win.text()).contains("[경로]").doesNotContain("Users");
        SafePreviewResult name = VocPreviewSanitizer.sanitize("파일 receipt_2026.pdf 보냅니다");
        assertThat(name.text()).contains("[경로]").doesNotContain("receipt_2026.pdf");
    }

    @Test
    void redactsAddressLike() {
        SafePreviewResult r = VocPreviewSanitizer.sanitize("서울시 강남구 테헤란로 152 로 배송해주세요");
        assertThat(r.text()).contains("[주소]").doesNotContain("테헤란로 152");
    }

    @Test
    void normalizesWhitespace() {
        SafePreviewResult r = VocPreviewSanitizer.sanitize("  여러   줄\n\n공백   정리  ");
        assertThat(r.text()).isEqualTo("여러 줄 공백 정리");
    }

    @Test
    void limitsLengthWithEllipsis() {
        String long70 = "가".repeat(70);
        SafePreviewResult r = VocPreviewSanitizer.sanitize(long70);
        assertThat(r.text()).hasSize(VocPreviewSanitizer.MAX_LEN + 1).endsWith("…");
    }

    @Test
    void suppressesWhenTooMuchIsRedacted() {
        // Almost entirely PII → too little visible text survives → fail closed.
        SafePreviewResult r = VocPreviewSanitizer.sanitize("010-1234-5678 buyer@example.com");
        assertThat(r.status()).isEqualTo(PreviewStatus.SUPPRESSED);
        assertThat(r.text()).isNull();
    }

    @Test
    void suppressesNullOrBlank() {
        assertThat(VocPreviewSanitizer.sanitize(null).text()).isNull();
        assertThat(VocPreviewSanitizer.sanitize("   ").status()).isEqualTo(PreviewStatus.SUPPRESSED);
    }
}
