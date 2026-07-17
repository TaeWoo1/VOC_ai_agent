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

    // ---------------------------------------------------------------------------------
    // redactFullBody — the reply-preparation surface's read. Same redaction rules, no
    // truncation, no suppression-on-thinness, line structure preserved.
    // ---------------------------------------------------------------------------------

    /**
     * The regression pin. {@code sanitize}'s output is what the attention drill-down renders,
     * and adding a second entry point over the shared {@link VocPreviewSanitizer#redact}
     * pipeline is exactly the kind of change that moves it by a character without anyone
     * noticing. Every assertion above already covers a rule; this one covers the boundary
     * itself — the preview still truncates, still suppresses, and still collapses newlines,
     * none of which the full-body path does.
     */
    @Test
    void previewBehaviourIsUnchangedByTheFullBodyPath() {
        assertThat(VocPreviewSanitizer.sanitize("가".repeat(70)).text())
                .hasSize(VocPreviewSanitizer.MAX_LEN + 1).endsWith("…");
        assertThat(VocPreviewSanitizer.sanitize("010-1234-5678 buyer@example.com").status())
                .isEqualTo(PreviewStatus.SUPPRESSED);
        assertThat(VocPreviewSanitizer.sanitize("첫 줄\n둘째 줄").text()).isEqualTo("첫 줄 둘째 줄");
    }

    @Test
    void fullBodyDoesNotTruncate() {
        String long200 = "가".repeat(200);
        RedactedBody r = VocPreviewSanitizer.redactFullBody(long200);
        assertThat(r.text()).hasSize(200).doesNotContain("…");
        assertThat(r.redacted()).isFalse();
    }

    /**
     * The preview suppresses this input entirely (see {@link #suppressesWhenTooMuchIsRedacted});
     * the full-body path must not. An operator writing a reply needs the review even when almost
     * all of it redacted away — showing them nothing would say "this review is empty" rather
     * than "this review was mostly contact details".
     */
    @Test
    void fullBodyDoesNotSuppressWhenAlmostEverythingIsRedacted() {
        RedactedBody r = VocPreviewSanitizer.redactFullBody("010-1234-5678 buyer@example.com");
        assertThat(r.text()).isEqualTo("[전화번호] [이메일]");
        assertThat(r.redacted()).isTrue();
    }

    @Test
    void fullBodyPreservesLineBreaksButCollapsesRunsOfSpaces() {
        RedactedBody r = VocPreviewSanitizer.redactFullBody("첫 줄\n둘째    줄\t끝");
        assertThat(r.text()).isEqualTo("첫 줄\n둘째 줄 끝");
    }

    /**
     * Every whitespace run — blank lines included — collapses to ONE character, because that
     * is what keeps the single-separator patterns working (see {@code normalizeForRedaction}).
     * Paragraph spacing is the deliberate price: preserving {@code \n\n} would put a
     * two-character run back in front of {@code redact} and reopen a leak for any body whose
     * phone/card number straddles a paragraph break.
     */
    @Test
    void fullBodyCollapsesEveryWhitespaceRunToASingleCharacter() {
        assertThat(VocPreviewSanitizer.redactFullBody("가\n\n\n\n\n나").text()).isEqualTo("가\n나");
        assertThat(VocPreviewSanitizer.redactFullBody("가 \n \n 나").text()).isEqualTo("가\n나");
        assertThat(VocPreviewSanitizer.redactFullBody("가  \t  나").text()).isEqualTo("가 나");
    }

    // ---------------------------------------------------------------------------------
    // The divergence regression. A trailing space before a line break is TWO whitespace
    // characters, and the redaction patterns admit at most one separator between digit
    // groups — so a full-body path that preserved the run leaked phone/card numbers the
    // preview caught, while reporting redacted=false. Every earlier test here used
    // single-line PII, which is the one shape that could not expose it.
    // ---------------------------------------------------------------------------------

    /** A phone number split across lines by a trailing space — ordinary in typed review text. */
    @Test
    void fullBodyRedactsAPhoneNumberBrokenAcrossLinesByATrailingSpace() {
        RedactedBody r = VocPreviewSanitizer.redactFullBody("환불해주세요 \n010 \n1234 \n5678 로 연락주세요");
        assertThat(r.text()).contains("[전화번호]")
                .doesNotContain("1234").doesNotContain("5678");
        assertThat(r.redacted()).isTrue();
    }

    @Test
    void fullBodyRedactsAPhoneNumberSplitByIndentedContinuationLines() {
        RedactedBody r = VocPreviewSanitizer.redactFullBody("연락처\n  010\n  1234\n  5678");
        assertThat(r.text()).contains("[전화번호]")
                .doesNotContain("1234").doesNotContain("5678");
        assertThat(r.redacted()).isTrue();
    }

    @Test
    void fullBodyRedactsALineWrappedCardNumber() {
        RedactedBody r = VocPreviewSanitizer.redactFullBody("카드 1234 5678 1234 \n5678 결제함");
        assertThat(r.text()).contains("[번호]").doesNotContain("1234").doesNotContain("5678");
        assertThat(r.redacted()).isTrue();
    }

    /**
     * The property that closes the whole class of bug rather than the three instances above:
     * for the same source, the two paths must agree on WHETHER anything was sensitive,
     * whatever whitespace separates it. They may disagree about presentation — one line vs
     * many, truncated vs whole — never about what is sensitive.
     *
     * <p>Written as a cross-check rather than as more example assertions on purpose: the
     * original defect was invisible precisely because each path's own tests passed. Only
     * comparing them catches a normalizer that quietly redacts less.
     */
    @Test
    void thePreviewAndTheFullBodyAlwaysAgreeOnWhetherSomethingWasSensitive() {
        // {s} is the run INSIDE the sensitive span — where the defect lived. Whitespace merely
        // surrounding a secret never mattered; a secret whose own separator is two characters
        // is what defeats `01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}`.
        String[] templates = {
                "010{s}1234{s}5678",              // mobile, internal run
                "02{s}6071{s}7001",               // landline, internal run
                "1234{s}5678{s}1234{s}5678",      // card, internal run
                "buyer@example.com",              // no internal run — must still agree
                "https://shop.example.com/p/12",
                "987654321",
        };
        // Every run a body can realistically contain: the two-character ones that defeated the
        // single-separator patterns, and the Unicode spaces that arrive from a paste or a CJK
        // IME and are not ASCII \s — NBSP, ideographic space, narrow NBSP.
        String[] separators = {
                " ", "\n", " \n", "\n ", " \n ", "\n\n", "\t", "  ", " \t \n ",
                " ", " \n", "　", "　 ", " ", "   ",
        };

        for (String template : templates) {
            for (String sep : separators) {
                String secret = template.replace("{s}", sep);
                String body = "환불 요청합니다 " + secret + " 확인 부탁드립니다";
                boolean previewRedacted =
                        VocPreviewSanitizer.sanitize(body).status() == PreviewStatus.REDACTED;
                RedactedBody full = VocPreviewSanitizer.redactFullBody(body);
                String shown = sep.replace("\n", "\\n").replace("\t", "\\t");
                assertThat(previewRedacted)
                        .as("the preview itself failed to redact %s (separator %s)", template, shown)
                        .isTrue();
                assertThat(full.redacted())
                        .as("preview and full body disagree about %s (separator %s)", template, shown)
                        .isEqualTo(previewRedacted);
                assertThat(full.text())
                        .as("digits survived the full body for %s (separator %s)", template, shown)
                        .doesNotContain("5678");
            }
        }
    }

    @Test
    void fullBodyAppliesTheSameRedactionRulesAsThePreview() {
        // 987654321 is deliberately not phone-shaped: PiiMasker's LANDLINE pattern claims any
        // 0-led 10-digit run, so a realistic-looking order number like 20260717001 tokenizes as
        // [전화번호] rather than [번호]. Both redact — the digits are gone either way, which is
        // what matters — but a test asserting the token would be asserting which pattern won
        // the race, not that the number was protected.
        RedactedBody r = VocPreviewSanitizer.redactFullBody(
                "환불 요청합니다. 연락처 010-1234-5678, 메일 buyer@example.com, "
                        + "주문번호 987654321 참고 https://shop.example.com/p/12");
        assertThat(r.text())
                .contains("[전화번호]").contains("[이메일]").contains("[번호]").contains("[링크]")
                .doesNotContain("1234").doesNotContain("buyer@example.com")
                .doesNotContain("987654321").doesNotContain("shop.example.com");
        assertThat(r.redacted()).isTrue();
        // The point of the full-body path: the operator can still read the complaint.
        assertThat(r.text()).contains("환불 요청합니다");
    }

    @Test
    void fullBodyReportsUnredactedWhenNothingWasSensitive() {
        RedactedBody r = VocPreviewSanitizer.redactFullBody("배송이 조금 늦었지만 상품은 좋았습니다");
        assertThat(r.text()).isEqualTo("배송이 조금 늦었지만 상품은 좋았습니다");
        assertThat(r.redacted()).isFalse();
    }

    @Test
    void fullBodyReturnsNullOnlyForABlankSource() {
        assertThat(VocPreviewSanitizer.redactFullBody(null).text()).isNull();
        assertThat(VocPreviewSanitizer.redactFullBody("   \n  ").text()).isNull();
        assertThat(VocPreviewSanitizer.redactFullBody(null).redacted()).isFalse();
    }
}
