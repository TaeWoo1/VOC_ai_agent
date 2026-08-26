package com.sellerops.knowledge.style;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>Which wording produced this draft</b> — Core Daily Loop UX Integration v1 §1.
 *
 * <p>The stamp used to be {@code style/v3}, and v3 is one org's own save counter. Two companies at
 * v3 stamped the identical string while wording replies differently; one company that changed a
 * setting and changed it back stamped v5 over a profile byte-identical to its v3. An auditor holding
 * a sent reply could not answer "was this written under the style that is configured now", which is
 * the only question the stamp exists for.
 *
 * <p>These cases fix the two properties that make it an identity: equal wording stamps equal, and
 * different wording stamps different. Everything else about the seam is unchanged — no new column,
 * no prompt snapshot, and nothing here stores the seller's sentences a second time.
 */
class AnswerStyleIdentityTest {

    private static AnswerStyleProfile profile(int version, AnswerTone tone, String greeting,
                                              List<String> required, String fallback) {
        return new AnswerStyleProfile(tone, AnswerLength.NORMAL, EmojiPolicy.NONE,
                greeting, null, null, required, List.of(), fallback, version);
    }

    @Test
    @DisplayName("B — no profile at all is DEFAULT_STYLE, and it is not a digest of anything")
    void absenceIsItsOwnIdentity() {
        assertThat(AnswerStyleProfile.defaults().identity()).isEqualTo("style/default");
        // Saving the shipped defaults is a DIFFERENT fact from never having opened the screen: one of
        // them has a save to reproduce. The counter is what separates them.
        assertThat(profile(1, AnswerTone.POLITE, null, List.of(), null).identity())
                .startsWith("style/v1@")
                .isNotEqualTo("style/default");
    }

    @Test
    @DisplayName("B — the same wording digests the same, whatever org or version it belongs to")
    void equalWordingStampsEqual() {
        String a = profile(3, AnswerTone.FRIENDLY, "안녕하세요.", List.of("정성껏 준비하겠습니다"), null)
                .digest();
        String b = profile(9, AnswerTone.FRIENDLY, "안녕하세요.", List.of("정성껏 준비하겠습니다"), null)
                .digest();
        assertThat(a).isEqualTo(b);
        assertThat(a).hasSize(12).matches("[0-9a-f]{12}");
    }

    @Test
    @DisplayName("B — every field that changes a reply changes the digest")
    void differentWordingStampsDifferent() {
        AnswerStyleProfile base = profile(1, AnswerTone.POLITE, "안녕하세요.", List.of(), null);
        assertThat(base.digest())
                .isNotEqualTo(profile(1, AnswerTone.FRIENDLY, "안녕하세요.", List.of(), null).digest())
                .isNotEqualTo(profile(1, AnswerTone.POLITE, "반갑습니다.", List.of(), null).digest())
                .isNotEqualTo(profile(1, AnswerTone.POLITE, "안녕하세요.", List.of("잘 부탁드립니다"), null)
                        .digest())
                // The unknown fallback renders no prompt section, and it IS the exact text a
                // SELLER_APPROVED_FALLBACK draft was saved from. A draft whose source sentence has
                // since been rewritten must not read as reproducible.
                .isNotEqualTo(profile(1, AnswerTone.POLITE, "안녕하세요.", List.of(),
                        "확인 후 다시 안내드리겠습니다.").digest());
    }

    @Test
    @DisplayName("B — a field boundary cannot be forged by moving text between fields")
    void fieldsAreDelimited() {
        AnswerStyleProfile greetingOnly =
                new AnswerStyleProfile(AnswerTone.POLITE, AnswerLength.NORMAL, EmojiPolicy.NONE,
                        "가나", "다라", null, List.of(), List.of(), null, 1);
        AnswerStyleProfile shifted =
                new AnswerStyleProfile(AnswerTone.POLITE, AnswerLength.NORMAL, EmojiPolicy.NONE,
                        "가나다", "라", null, List.of(), List.of(), null, 1);
        assertThat(greetingOnly.digest()).isNotEqualTo(shifted.digest());

        // Two phrases are not one phrase containing both.
        AnswerStyleProfile two = new AnswerStyleProfile(AnswerTone.POLITE, AnswerLength.NORMAL,
                EmojiPolicy.NONE, null, null, null, List.of("가", "나"), List.of(), null, 1);
        AnswerStyleProfile one = new AnswerStyleProfile(AnswerTone.POLITE, AnswerLength.NORMAL,
                EmojiPolicy.NONE, null, null, null, List.of("가나"), List.of(), null, 1);
        assertThat(two.digest()).isNotEqualTo(one.digest());
    }

    @Test
    @DisplayName("the stamp fits the column it is written to")
    void stampFitsTheColumn() {
        // The widest realistic model stamp, plus the widest style identity. `model_version` is
        // varchar(200) since V81; the point of the case is that the number is checked rather than
        // assumed, because the repair for an overflowing provenance string is never to cut it.
        String modelVersion = "agent-draft/v1+anthropic:claude-sonnet-4-5-20250929"
                + "+agent-draft-prompt/v7+schema/v1+out1200+effort:medium";
        String stamped = modelVersion + "+"
                + profile(999, AnswerTone.FRIENDLY, "안녕하세요.", List.of(), null).identity();
        assertThat(stamped.length()).isLessThanOrEqualTo(200);
    }
}
