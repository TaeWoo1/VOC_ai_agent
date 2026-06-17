package com.sellerops.order;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.order.dto.OrderSummaryResponse;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * Windowing/filter/validation logic for the order summary. Repository + channel
 * lookups are mocked, so this exercises the date math and branch selection
 * without a database. (No DTO field rename in this slice — totals still surface
 * via {@code totalOrders7d}/{@code totalSales7d}.)
 */
class OrderServiceTest {

    private final OrderDailySummaryRepository orders = mock(OrderDailySummaryRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final OrderService service = new OrderService(orders, channels);
    private final UUID orgId = UUID.randomUUID();

    private static OrderDailySummary row(UUID channelId, LocalDate date, int orderCount, long sales) {
        OrderDailySummary r = new OrderDailySummary();
        r.setChannelId(channelId);
        r.setSummaryDate(date);
        r.setOrderCount(orderCount);
        r.setSalesAmount(sales);
        return r;
    }

    @Test
    void defaultSummaryIsLastSevenDaysAllChannels() {
        when(orders.findAllByOrgIdAndSummaryDateBetweenOrderBySummaryDateAsc(eq(orgId), any(), any()))
                .thenReturn(List.of());
        when(channels.findAll()).thenReturn(List.of());

        OrderSummaryResponse resp = service.summary(orgId);

        ArgumentCaptor<LocalDate> fromC = ArgumentCaptor.forClass(LocalDate.class);
        ArgumentCaptor<LocalDate> toC = ArgumentCaptor.forClass(LocalDate.class);
        verify(orders).findAllByOrgIdAndSummaryDateBetweenOrderBySummaryDateAsc(
                eq(orgId), fromC.capture(), toC.capture());
        assertThat(ChronoUnit.DAYS.between(fromC.getValue(), toC.getValue())).isEqualTo(6);
        assertThat(toC.getValue()).isEqualTo(LocalDate.now());
        assertThat(resp.trend()).hasSize(7);
        // never routes through the channel-scoped query when channelId is null
        verify(orders, never()).findAllByOrgIdAndChannelIdAndSummaryDateBetweenOrderBySummaryDateAsc(
                any(), any(), any(), any());
    }

    @Test
    void explicitRangeControlsWindowLengthAndTotals() {
        LocalDate to = LocalDate.of(2026, 6, 14);
        LocalDate from = to.minusDays(13); // 14-day inclusive window
        UUID ch = UUID.randomUUID();
        when(orders.findAllByOrgIdAndSummaryDateBetweenOrderBySummaryDateAsc(eq(orgId), eq(from), eq(to)))
                .thenReturn(List.of(row(ch, to, 3, 3000), row(ch, from, 2, 2000)));
        when(channels.findAll()).thenReturn(List.of());

        OrderSummaryResponse resp = service.summary(orgId, from, to, null);

        assertThat(resp.trend()).hasSize(14);
        assertThat(resp.totalOrders7d()).isEqualTo(5);
        assertThat(resp.totalSales7d()).isEqualTo(5000);
    }

    @Test
    void channelFilterUsesChannelScopedQuery() {
        LocalDate to = LocalDate.of(2026, 6, 14);
        LocalDate from = to.minusDays(6);
        UUID ch = UUID.randomUUID();
        when(orders.findAllByOrgIdAndChannelIdAndSummaryDateBetweenOrderBySummaryDateAsc(
                eq(orgId), eq(ch), eq(from), eq(to)))
                .thenReturn(List.of(row(ch, to, 4, 4000)));
        when(channels.findAll()).thenReturn(List.of());

        OrderSummaryResponse resp = service.summary(orgId, from, to, ch);

        assertThat(resp.totalOrders7d()).isEqualTo(4);
        verify(orders, never()).findAllByOrgIdAndSummaryDateBetweenOrderBySummaryDateAsc(any(), any(), any());
        verify(orders).findAllByOrgIdAndChannelIdAndSummaryDateBetweenOrderBySummaryDateAsc(
                eq(orgId), eq(ch), eq(from), eq(to));
    }

    @Test
    void fromAfterToIsRejectedAsBadRequest() {
        LocalDate to = LocalDate.of(2026, 6, 1);
        assertThatThrownBy(() -> service.summary(orgId, to.plusDays(5), to, null))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus().value()).isEqualTo(400));
    }

    @Test
    void rangeBeyondMaxIsRejectedAsBadRequest() {
        LocalDate to = LocalDate.of(2026, 6, 1);
        LocalDate from = to.minusDays(OrderService.MAX_RANGE_DAYS + 5);
        assertThatThrownBy(() -> service.summary(orgId, from, to, null))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus().value()).isEqualTo(400));
    }
}
