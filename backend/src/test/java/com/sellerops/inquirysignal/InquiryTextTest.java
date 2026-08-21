package com.sellerops.inquirysignal;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Markup out, meaning unchanged.
 *
 * <p><b>Why this class exists at all is a measurement.</b> On the demo org 3,201 of 3,220 inquiry bodies
 * are HTML averaging 1,374 characters — Cafe24 board articles stored as the mall returned them. The
 * first bounded classification of 190 distinct texts produced 5 usable labels, because the model was
 * reading style attributes. The pipeline reported success throughout.
 *
 * <p>The tests split into two halves on purpose: what must be REMOVED, and what must SURVIVE. The
 * second half is the one that keeps a normalizer from quietly becoming an editor.
 */
class InquiryTextTest {

    @Test
    @DisplayName("a Cafe24-shaped HTML body becomes the sentence a customer wrote")
    void htmlBecomesText() {
        String body = "<p style=\"font-size:13px;color:#333\">안녕하세요.</p>"
                + "<div><span>이 상품 교환 가능한가요?</span></div>";

        assertThat(InquiryText.normalize(body)).isEqualTo("안녕하세요. 이 상품 교환 가능한가요?");
    }

    @Test
    @DisplayName("block tags become a space, so two paragraphs never fuse into one word")
    void blocksDoNotFuse() {
        assertThat(InquiryText.normalize("<p>교환</p><p>가능한가요</p>")).isEqualTo("교환 가능한가요");
        assertThat(InquiryText.normalize("색상<br>문의")).isEqualTo("색상 문의");
    }

    @Test
    @DisplayName("script and style CONTENT is removed, not just their tags")
    void scriptContentIsNotCustomerText() {
        String body = "<style>.a{color:red}</style><script>var x=1;</script><p>배송 언제 오나요</p>";

        String normalized = InquiryText.normalize(body);

        assertThat(normalized).isEqualTo("배송 언제 오나요");
        assertThat(normalized).doesNotContain("color").doesNotContain("var");
    }

    @Test
    @DisplayName("the entities Korean mall content actually contains are decoded")
    void entitiesAreDecoded() {
        assertThat(InquiryText.normalize("A&nbsp;B")).isEqualTo("A B");
        assertThat(InquiryText.normalize("3&lt;5 &amp; 좋아요")).isEqualTo("3<5 & 좋아요");
    }

    @Test
    @DisplayName("an unknown entity is left as written rather than guessed at")
    void unknownEntitiesSurvive() {
        // A wrong expansion would change what the customer said; a stray token only costs a model one
        // meaningless word.
        assertThat(InquiryText.normalize("가격&euro;문의")).contains("&euro;");
    }

    @Test
    @DisplayName("plain text passes through unchanged except for whitespace")
    void plainTextIsNotEdited() {
        assertThat(InquiryText.normalize("  교환   가능한가요?  ")).isEqualTo("교환 가능한가요?");
        assertThat(InquiryText.normalize("이 상품 폭이 몇 mm인가요?")).isEqualTo("이 상품 폭이 몇 mm인가요?");
    }

    @Test
    @DisplayName("a body that is only markup normalizes to nothing, and nothing is not a blank question")
    void markupOnlyIsEmpty() {
        assertThat(InquiryText.normalize("<div><br></div>")).isEmpty();
        assertThat(InquiryText.normalize(null)).isEmpty();
        assertThat(InquiryText.normalize("   ")).isEmpty();
    }

    @Test
    @DisplayName("title and body join as two clauses, and a title with punctuation is not double-punctuated")
    void titleAndBodyJoinCleanly() {
        assertThat(InquiryText.forClassification("교환 문의", "<p>가능한가요?</p>"))
                .isEqualTo("교환 문의. 가능한가요?");
        assertThat(InquiryText.forClassification("교환 되나요?", "<p>답변 부탁드립니다</p>"))
                .isEqualTo("교환 되나요? 답변 부탁드립니다");
        assertThat(InquiryText.forClassification(null, "<p>가능한가요?</p>")).isEqualTo("가능한가요?");
        assertThat(InquiryText.forClassification("교환 문의", null)).isEqualTo("교환 문의");
    }

    @Test
    @DisplayName("two HTML renderings of one question hash to one cache row — one egress, not two")
    void renderingDifferencesShareOneRow() {
        String a = InquiryText.normalize("<p>교환 가능한가요?</p>");
        String b = InquiryText.normalize("<div style=\"margin:0\">교환 가능한가요?</div>");

        assertThat(InquirySignatureService.hashOf(a)).isEqualTo(InquirySignatureService.hashOf(b));
    }
}
