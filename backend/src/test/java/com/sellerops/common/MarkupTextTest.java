package com.sellerops.common;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The inputs here are not invented. They are the strings the 문의 queue was actually rendering on
 * 2026-08-24 — a Cafe24 backlog of forwarded mail and shop-editor HTML — copied down to the stray
 * {@code &nbsp;} and the unterminated {@code <table>} attribute that a 60-character preview cut in
 * half. The seller could not read their own queue, and every assertion below is one of the rows they
 * could not read.
 */
class MarkupTextTest {

    @Test
    @DisplayName("a forwarded-mail body reads as the sentence the customer wrote")
    void forwardedMail() {
        String body = "<br /> [ Original Message ] <br /> <p>방금 통화했던 어린이집입니다.</p> <p>";
        assertThat(MarkupText.toSingleLine(body))
                .isEqualTo("[ Original Message ] 방금 통화했던 어린이집입니다.");
    }

    @Test
    @DisplayName("a table-wrapped post does not spend its whole preview on attributes")
    void tableWrapped() {
        String body = "<table border=\"1\" style='width: 1240px; border-width: 0px 1px'>"
                + "<tr><td>세금계산서 발행 부탁드립니다</td></tr></table>";
        assertThat(MarkupText.toSingleLine(body)).isEqualTo("세금계산서 발행 부탁드립니다");
    }

    @Test
    @DisplayName("&nbsp; is a space and &amp; is an ampersand — the entities a Korean board emits")
    void entities() {
        assertThat(MarkupText.toSingleLine("&nbsp;늦어서 죄송합니다<p>확인후 취소 처리 되었습니다</p>"))
                .isEqualTo("늦어서 죄송합니다 확인후 취소 처리 되었습니다");
        assertThat(MarkupText.toSingleLine("A&amp;B &#48176;&#49569;")).isEqualTo("A&B 배송");
    }

    @Test
    @DisplayName("an escaped tag decodes to visible characters, never to an element")
    void escapedTagStaysText() {
        // Decoding runs AFTER tag removal, so this can only ever become text a renderer escapes.
        assertThat(MarkupText.toPlainText("&lt;script&gt;alert(1)&lt;/script&gt;"))
                .isEqualTo("<script>alert(1)</script>");
    }

    @Test
    @DisplayName("block tags become line breaks; everything else disappears")
    void blockStructureSurvives() {
        assertThat(MarkupText.toPlainText("<p>첫 줄</p><div>둘째 줄</div><span>같은 줄</span>"))
                .isEqualTo("첫 줄\n둘째 줄\n같은 줄");
    }

    @Test
    @DisplayName("an unaudited entity is left exactly as written rather than guessed at")
    void unknownEntityUntouched() {
        assertThat(MarkupText.toSingleLine("&hellip; 확인 부탁드립니다")).isEqualTo("&hellip; 확인 부탁드립니다");
    }

    @Test
    @DisplayName("a huge body is bounded — a preview must not cost a scan of a whole mail thread")
    void scanIsBounded() {
        String huge = "머리말 " + "가".repeat(MarkupText.SCAN_LIMIT * 2);
        assertThat(MarkupText.toSingleLine(huge)).hasSizeLessThanOrEqualTo(MarkupText.SCAN_LIMIT);
    }

    @Test
    @DisplayName("null and empty are empty, not the word null")
    void nullSafe() {
        assertThat(MarkupText.toPlainText(null)).isEmpty();
        assertThat(MarkupText.toSingleLine("")).isEmpty();
    }

    @Test
    @DisplayName("plain text with no markup is returned unchanged")
    void plainTextUntouched() {
        assertThat(MarkupText.toSingleLine("선바로 한개당 길이가 몇m인가요?"))
                .isEqualTo("선바로 한개당 길이가 몇m인가요?");
    }
}
