package com.sellerops.product;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The title parser reads what a seller wrote and infers nothing.
 *
 * <p>It exists because real SmartStore titles carry much of the spec themselves — measured in
 * {@code docs/slices/product-context-diagnosis-groundwork.md} §3 — and with no channel product read
 * available, the title is the only thing the seller has actually stated. That makes the boundary
 * between PARSING and GUESSING the whole safety property, so every test here is about the boundary.
 */
class ProductTitleFactsTest {

    @Test
    @DisplayName("a number stated with a unit becomes a fact, with the unit kept as written")
    void statedMeasurementsAreParsed() {
        Map<String, ProductTitleFacts.Measure> parsed =
                ProductTitleFacts.parse("세모금컵 4000매 일회용 종이컵 200ml");

        assertThat(parsed).containsKeys(ProductTitleFacts.QUANTITY, ProductTitleFacts.VOLUME);
        assertThat(parsed.get(ProductTitleFacts.QUANTITY).value()).isEqualTo("4000");
        assertThat(parsed.get(ProductTitleFacts.QUANTITY).unit()).isEqualTo("매");
        assertThat(parsed.get(ProductTitleFacts.VOLUME).value()).isEqualTo("200");
    }

    @Test
    @DisplayName("a title that states nothing measurable produces nothing")
    void nothingStatedIsNothingParsed() {
        assertThat(ProductTitleFacts.parse("선바로 일체형 전선몰딩 열고 닫기 편한 전선몰드")).isEmpty();
        assertThat(ProductTitleFacts.parse("")).isEmpty();
        assertThat(ProductTitleFacts.parse(null)).isEmpty();
    }

    @Test
    @DisplayName("a family stated twice is dropped, because choosing one would be the guess")
    void ambiguityYieldsNothing() {
        // "2m 3m 세트" states two lengths. Picking either is an invention; reporting neither is honest.
        assertThat(ProductTitleFacts.parse("전선몰딩 2m 3m 세트"))
                .doesNotContainKey(ProductTitleFacts.LENGTH);
    }

    @Test
    @DisplayName("a unit inside a longer token is not a measurement")
    void unitsMustBeAnchored() {
        // 2000mAh is a battery capacity in a unit this parser does not know; reading "2000m" out of it
        // would produce a length that the seller never wrote.
        assertThat(ProductTitleFacts.parse("보조배터리 2000mAh")).isEmpty();
    }

    @Test
    @DisplayName("the parser can only ever emit its four declared keys")
    void theKeySetIsClosed() {
        for (String title : new String[] {
            "컵 4000매 200ml 1.5kg 2m", "이상한 상품 999xyz", "무선 청소기 3단 흡입",
        }) {
            assertThat(ProductTitleFacts.parse(title).keySet()).isSubsetOf(ProductTitleFacts.KEYS);
        }
    }
}
