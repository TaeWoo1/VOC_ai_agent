package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class OptionSemanticsTest {

    private static NaverProductDetail.Option option(String label) {
        return new NaverProductDetail.Option("1", label);
    }

    @Test
    @DisplayName("자릿수는 남기지 않는다 — 값이 아니라 단어만 로그로 나간다")
    void masksEveryDigit() {
        assertThat(OptionSemantics.mask("16x10mm")).isEqualTo("##x##mm");
        assertThat(OptionSemantics.mask("2~3가닥")).isEqualTo("#~#가닥");
    }

    @Test
    @DisplayName("숫자가 있다는 이유만으로 수용량이라고 읽지 않는다")
    void aSizeIsNotACapacity() {
        String described = OptionSemantics.describe(List.of(option("16x10mm"), option("25x15mm")));

        assertThat(described).contains("spec_bearing=2");
        assertThat(described).contains("capacity_bearing=0");
    }

    @Test
    @DisplayName("관계를 말하는 단어가 있을 때만 수용량으로 센다")
    void onlyARelationWordCounts() {
        String described = OptionSemantics.describe(
                List.of(option("16x10mm / 2~3가닥"), option("25x15mm")));

        assertThat(described).contains("capacity_bearing=1");
    }

    @Test
    @DisplayName("보고되는 패턴 수에는 상한이 있다 — 카탈로그를 덤프하지 않는다")
    void reportsAtMostThreePatterns() {
        List<NaverProductDetail.Option> many = List.of(option("a1"), option("b2"), option("c3"),
                option("d4"), option("e5"), option("f6"));

        String described = OptionSemantics.describe(many);

        assertThat(described).contains("options=6");
        assertThat(described).doesNotContain("f#");
    }

    @Test
    @DisplayName("옵션이 없으면 없다고만 말한다")
    void emptyIsNotAnError() {
        assertThat(OptionSemantics.describe(List.of())).contains("options=0");
        assertThat(OptionSemantics.describe(null)).contains("options=0");
    }
}
