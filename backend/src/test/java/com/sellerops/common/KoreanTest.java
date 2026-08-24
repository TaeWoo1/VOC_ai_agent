package com.sellerops.common;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The two sentences the product has already shipped wrong, pinned.
 *
 * <p>Both were caught by reading a live answer, not by a test — "쿠팡는" in Cross-Channel v1 and
 * "쿠팡가 매출의 60%" in the first Overview read. A channel name is data, and a particle glued to data
 * without looking at it is a defect that reappears with every new channel.
 */
@DisplayName("한국어 조사")
class KoreanTest {

    @Test
    @DisplayName("받침 있는 이름 — 쿠팡은 / 쿠팡이")
    void finalConsonant() {
        assertThat(Korean.withTopic("쿠팡")).isEqualTo("쿠팡은");
        assertThat(Korean.withSubject("쿠팡")).isEqualTo("쿠팡이");
    }

    @Test
    @DisplayName("받침 없는 이름 — 스토어는 / 스토어가")
    void noFinalConsonant() {
        assertThat(Korean.withTopic("스토어")).isEqualTo("스토어는");
        assertThat(Korean.withSubject("스토어")).isEqualTo("스토어가");
    }

    @Test
    @DisplayName("이 저장소의 실제 채널 이름들")
    void theChannelsThisProductShows() {
        assertThat(Korean.withTopic("네이버 스마트스토어")).isEqualTo("네이버 스마트스토어는");
        assertThat(Korean.withSubject("네이버 스마트스토어")).isEqualTo("네이버 스마트스토어가");
        assertThat(Korean.withTopic("카페24 자사몰")).isEqualTo("카페24 자사몰은");
        assertThat(Korean.withSubject("카페24 자사몰")).isEqualTo("카페24 자사몰이");
    }

    @Test
    @DisplayName("한글이 아닌 끝은 추측하지 않고 기본형을 쓴다")
    void nonHangulFallsBackRatherThanGuessing() {
        // "Cafe24" ends in a digit whose reading depends on how the seller says it. The default
        // stands; inventing a rule for it would be wrong in a way nobody could see coming.
        assertThat(Korean.withTopic("Cafe24")).isEqualTo("Cafe24는");
        assertThat(Korean.endsWithFinalConsonant("Cafe24")).isFalse();
    }

    @Test
    @DisplayName("빈 이름은 조사만 남기지 않는다")
    void emptyNameProducesNothing() {
        assertThat(Korean.withTopic("")).isEmpty();
        assertThat(Korean.withSubject(null)).isEmpty();
    }
}
