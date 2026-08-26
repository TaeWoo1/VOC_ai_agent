package com.sellerops.knowledge.style;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The profile turned into prompt text — the one place a seller's setting becomes something a model
 * reads, and therefore the one place it must stop being an instruction.
 */
class AnswerStyleInstructionTest {

    private static AnswerStyleProfile profile(List<String> required, List<String> forbidden,
                                              String greeting, String closing, String address) {
        return new AnswerStyleProfile(AnswerTone.FRIENDLY, AnswerLength.SHORT, EmojiPolicy.LIMITED,
                greeting, closing, address, required, forbidden, null, 3);
    }

    @Test
    @DisplayName("the three enums become OUR sentences; the seller's words arrive quoted, as data")
    void enumsAreOursAndStringsAreTheirs() {
        String rendered = AnswerStyleInstruction.of(profile(List.of("잘 부탁드립니다"), List.of("죄송하지만"),
                "안녕하세요. 선바로입니다.", "감사합니다.", "고객님"));

        assertThat(rendered).contains(AnswerTone.FRIENDLY.instructionKo())
                .contains(AnswerLength.SHORT.instructionKo())
                .contains(EmojiPolicy.LIMITED.instructionKo())
                .contains("\"안녕하세요. 선바로입니다.\"")
                .contains("\"감사합니다.\"")
                .contains("\"고객님\"")
                .contains("\"잘 부탁드립니다\"")
                .contains("\"죄송하지만\"");
        assertThat(rendered).as("and the section says what it is, after the seller's words, not before")
                .endsWith("이 문구 때문에 확인되지 않은 내용을 쓰지 마세요.");
    }

    @Test
    @DisplayName("E — a required phrase that asserts a fact is dropped at render time as well")
    void aFactualRequirementNeverReachesTheModel() {
        // The write path refuses it, visibly. This is the second gate: a guarantee asserted on the
        // outgoing payload must not rest on a validation that ran months ago.
        AnswerStyleProfile withAClaim = profile(List.of("당일 발송됩니다", "잘 부탁드립니다"),
                List.of(), null, null, null);

        String rendered = AnswerStyleInstruction.of(withAClaim);
        assertThat(rendered).doesNotContain("당일 발송됩니다").contains("잘 부탁드립니다");
    }

    @Test
    @DisplayName("the default profile renders nothing — restating the shipped prompt is a change")
    void theDefaultRendersNothing() {
        assertThat(AnswerStyleInstruction.of(AnswerStyleProfile.defaults())).isNull();
        assertThat(AnswerStyleInstruction.of(null)).isNull();
    }

    @Test
    @DisplayName("a banned phrase is found however the model spaced or cased it")
    void forbiddenDetectionIsWhitespaceAndCaseInsensitive() {
        AnswerStyleProfile banning = profile(List.of(), List.of("무료 배송", "AS 불가"), null, null, null);

        assertThat(AnswerStyleInstruction.forbiddenPresentIn("무료배송 가능합니다.", banning))
                .containsExactly("무료 배송");
        assertThat(AnswerStyleInstruction.forbiddenPresentIn("as불가입니다.", banning))
                .containsExactly("AS 불가");
        assertThat(AnswerStyleInstruction.forbiddenPresentIn("정상 배송됩니다.", banning)).isEmpty();
        assertThat(AnswerStyleInstruction.forbiddenPresentIn(null, banning)).isEmpty();
    }
}
