package com.sellerops.dashboard.metrics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.coverage.ChannelCoverageService;
import com.sellerops.coverage.ChannelDataState;
import com.sellerops.coverage.dto.ChannelCoverageRow;
import com.sellerops.dashboard.metrics.dto.ChannelMetricRow;
import com.sellerops.dashboard.metrics.dto.MetricKpi;
import com.sellerops.dashboard.metrics.dto.OperationsMetricsResponse;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 현재 미답변 문의 — the one figure on this response that has no window.
 *
 * <p><b>The defect this pins.</b> Every other number here is "what arrived between two dates", and the
 * rule that keeps a silent channel out of a total asks exactly that: did this channel contribute rows
 * IN THE WINDOW. 미답변 is the backlog standing right now, and the same rule was being asked about it
 * with the window's operand — so a channel that had received nothing in seven days had its whole
 * standing backlog dropped. Measured on the real org on 2026-09-04: 운영 숫자 printed
 * 「현재 미답변 문의 1건」 while 문의 and 리포트 printed 22 for the same words, and the channel table
 * printed 「—」 for a row whose {@code unansweredInquiries} was 21 in the very same response.
 *
 * <p>The rule is not relaxed here — {@code counted} is unchanged and still refuses to draw an unproven
 * silence as a zero. It is asked with the operand it was written for.
 */
@DisplayName("Overview — 기간이 없는 숫자에 기간의 질문을 하지 않는다")
class StandingBacklogMetricTest {

    private static final UUID ORG = UUID.randomUUID();

    @Test
    @DisplayName("이 기간에 아무것도 받지 않았어도, 지금 들고 있는 미답변은 합계에 들어간다")
    void heldBacklogCountsEvenWhenTheWindowIsEmpty() {
        OperationsMetricsResponse response = metricsFor(21L);

        MetricKpi unanswered = kpi(response, "unansweredInquiries");
        assertThat(unanswered.value()).isEqualTo(21);

        ChannelMetricRow row = response.channels().get(0);
        // The window figure and the standing figure disagree ON PURPOSE: nothing arrived this week and
        // 21 items are waiting. One row, two true verdicts.
        assertThat(row.countedInInquiries()).isFalse();
        assertThat(row.countedInUnansweredNow()).isTrue();
        assertThat(row.unansweredInquiries()).isEqualTo(21);
    }

    @Test
    @DisplayName("그 채널은 기간 문의 합계에서는 여전히 빠지고, 빠졌다고 말한다")
    void theWindowTotalStillExcludesIt() {
        OperationsMetricsResponse response = metricsFor(21L);

        assertThat(kpi(response, "inquiries").value()).isZero();
        assertThat(kpi(response, "inquiries").excludedChannels()).isEqualTo(1);
        // ...and the standing figure does NOT borrow that caveat, because it counted the channel.
        assertThat(kpi(response, "unansweredInquiries").excludedChannels()).isZero();
    }

    @Test
    @DisplayName("들고 있는 것이 0이고 최신인지도 모르면 그 0은 증거가 아니다 — 여전히 빠진다")
    void anUnprovenChannelHoldingNothingIsStillExcluded() {
        OperationsMetricsResponse response = metricsFor(0L);

        assertThat(kpi(response, "unansweredInquiries").value()).isZero();
        assertThat(response.channels().get(0).countedInUnansweredNow()).isFalse();
        assertThat(kpi(response, "unansweredInquiries").excludedChannels()).isEqualTo(1);
    }

    @Test
    @DisplayName("셀 수 있게 됐다고 최신이라고 말하지는 않는다 — 더 있을지 모른다는 단서는 남는다")
    void countingItDoesNotClaimItIsCurrent() {
        assertThat(kpi(metricsFor(21L), "unansweredInquiries").freshnessUnproven()).isTrue();
    }

    /** One channel, nothing in the window, `held` inquiries waiting, freshness unproven. */
    private static OperationsMetricsResponse metricsFor(long held) {
        UUID channelId = UUID.randomUUID();
        Channel channel = new Channel();
        channel.setId(channelId);
        channel.setCode("CAFE24");
        channel.setNameKo("카페24 자사몰");

        ChannelRepository channels = mock(ChannelRepository.class);
        when(channels.findAll()).thenReturn(List.of(channel));

        ChannelCoverageService coverage = mock(ChannelCoverageService.class);
        when(coverage.coverage(ORG, List.of("CAFE24"))).thenReturn(List.of(
                coverageRow("INQUIRY", held),
                coverageRow("REVIEW", 0L),
                coverageRow("ORDER_SUMMARY", null)));

        // No rows in either window: the series repositories return nothing for this org.
        OperationsMetricsRepository metrics = mock(OperationsMetricsRepository.class);

        return new OperationsMetricsService(channels, coverage, metrics)
                .metrics(ORG, List.of("CAFE24"), 7);
    }

    private static ChannelCoverageRow coverageRow(String dataType, Long openRows) {
        return new ChannelCoverageRow("CAFE24", "카페24 자사몰", dataType,
                ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN, true, "CONFIRMED", true, "CONNECTED",
                true, null, null, openRows == null ? 0L : openRows, openRows, null);
    }

    private static MetricKpi kpi(OperationsMetricsResponse response, String key) {
        return response.kpis().stream().filter(k -> k.key().equals(key)).findFirst().orElseThrow();
    }
}
