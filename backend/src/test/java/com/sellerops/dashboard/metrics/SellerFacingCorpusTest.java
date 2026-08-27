package com.sellerops.dashboard.metrics;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Whose numbers these are — Chat-first Agent Shell Completion v1 §3.
 *
 * <p>매출·주문·문의·리뷰·부정 리뷰 are the five figures a seller reads to decide whether the week went
 * well. Until this package they were computed over whatever {@code sellerops.seed.demo-content} had
 * made visible, which on a demo deployment silently mixed rows the product wrote about itself into a
 * statement about the seller's shop. The rule is now written down and has a name.
 *
 * <p>The tests are on the rule rather than on a rendered figure on purpose: the figure is the sum of
 * three windowed reads and a coverage verdict, and asserting on it would test the arithmetic. What
 * can go wrong here is the CHOICE of corpus, and that is exactly one boolean.
 */
@DisplayName("Overview — 이 숫자는 누구의 것인가")
class SellerFacingCorpusTest {

    @Test
    @DisplayName("A — 판매자의 실제 데이터가 있으면 합성 행이 있어도 실제 데이터만 센다")
    void realDataAlwaysWins() {
        assertThat(OperationsMetricsService.fallBackToExampleData(true, true, true)).isFalse();
        assertThat(OperationsMetricsService.fallBackToExampleData(true, true, false)).isFalse();
    }

    @Test
    @DisplayName("B — 실제 데이터가 하나도 없는 데모 배포에서만 예시 데이터로 내려가고, 그때는 라벨이 붙는다")
    void seededDeploymentsFallBackAndAreLabelled() {
        assertThat(OperationsMetricsService.fallBackToExampleData(true, false, true)).isTrue();
    }

    @Test
    @DisplayName("데모 콘텐츠를 켜지 않은 배포는 어떤 경우에도 예시 데이터를 세지 않는다")
    void productionNeverFallsBack() {
        assertThat(OperationsMetricsService.fallBackToExampleData(false, false, true)).isFalse();
        assertThat(OperationsMetricsService.fallBackToExampleData(false, false, false)).isFalse();
    }

    @Test
    @DisplayName("보여줄 예시 데이터조차 없으면 내려가지 않는다 — 빈 기간은 빈 기간이다")
    void anEmptyWindowStaysEmpty() {
        assertThat(OperationsMetricsService.fallBackToExampleData(true, false, false)).isFalse();
    }
}
