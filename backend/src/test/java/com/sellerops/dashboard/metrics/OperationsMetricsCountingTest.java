package com.sellerops.dashboard.metrics;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.coverage.ChannelDataState;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The one rule that decides whether a channel's silence is a zero — the dashboard's whole honesty.
 *
 * <p>Every case here is a sentence the product could otherwise print. The one that matters most is the
 * last: on 2026-08-24 NAVER 문의 was live-proven and then locked out at token issuance, so a seven-day
 * window holds nothing for it. Adding that nothing to a total prints "이번 주 문의 69건" over a channel
 * nobody looked at.
 */
@DisplayName("Overview — 무엇을 합계에 넣어도 되는가")
class OperationsMetricsCountingTest {

    @Test
    @DisplayName("수집이 최신임이 증명된 채널의 0은 측정된 0이므로 합계에 들어간다")
    void freshChannelsCountEvenAtZero() {
        assertThat(OperationsMetricsService.counted(ChannelDataState.OBSERVED_FRESH, 0)).isTrue();
        assertThat(OperationsMetricsService.counted(ChannelDataState.ZERO, 0)).isTrue();
    }

    @Test
    @DisplayName("최신인지 모르는 채널도 실제로 행을 냈다면 뺄 수 없다 — 빼면 실제 숫자를 축소한다")
    void unprovenChannelsCountWhenTheyContributed() {
        assertThat(OperationsMetricsService.counted(ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN, 12))
                .isTrue();
    }

    @Test
    @DisplayName("최신인지 모르는 채널이 이 기간에 아무것도 내지 않았다면 그 0은 증거가 아니다")
    void unprovenChannelsWithNothingAreNotCounted() {
        assertThat(OperationsMetricsService.counted(ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN, 0))
                .isFalse();
    }

    @Test
    @DisplayName("연결이 끊긴 채널의 0은 차트에 들어가지 않는다 — 2026-08-24 NAVER 문의")
    void blockedChannelsAreNeverDrawnAsZero() {
        assertThat(OperationsMetricsService.counted(ChannelDataState.BLOCKED, 0)).isFalse();
    }

    @Test
    @DisplayName("연결되지 않은 채널과 수집 경로가 없는 채널도 마찬가지다")
    void unreachableChannelsAreNotCounted() {
        assertThat(OperationsMetricsService.counted(ChannelDataState.NOT_CONNECTED, 0)).isFalse();
        assertThat(OperationsMetricsService.counted(ChannelDataState.NOT_SUPPORTED, 0)).isFalse();
    }

    @Test
    @DisplayName("보유한 행은 상태가 무엇이든 지워지지 않는다 — NAVER 리뷰 4,340건")
    void heldRowsSurviveAnUnsupportedVerdict() {
        // NAVER offers no review API and this org holds 4,340 NAVER reviews from an approved export.
        // "미지원"이라는 참인 사실 때문에 그 행들이 사라지면, 그것이 더 나쁜 답이다.
        assertThat(OperationsMetricsService.counted(ChannelDataState.NOT_SUPPORTED, 4_340)).isTrue();
    }

    @Test
    @DisplayName("매출·주문 정의는 응답과 함께 나간다 — 숫자만 나가면 그것은 주장이 된다")
    void semanticsShipWithTheNumber() {
        assertThat(OperationsMetricsService.REVENUE_BASIS)
                .contains("결제 시점")
                .contains("취소")
                .contains("채널마다");
        assertThat(OperationsMetricsService.ORDER_COUNT_BASIS)
                .contains("상품주문")
                .contains("배송건")
                .contains("주문");
    }
}
