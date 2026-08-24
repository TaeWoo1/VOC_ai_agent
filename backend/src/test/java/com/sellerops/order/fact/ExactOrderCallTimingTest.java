package com.sellerops.order.fact;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.coverage.ChannelDataState;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOrderBinding;
import com.sellerops.inquiry.draft.InquiryOrderFactReader;
import com.sellerops.order.ChannelOrder;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.order.NormalizedOrderStatus;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * WHEN a marketplace is asked about an order — the question this package answers with a counter.
 *
 * <p><b>The failure being tested for is not wrongness, it is volume.</b> Every mapping here could be
 * perfect and the design still broken, if holding a reference were enough to make a request. Then
 * the inquiry collector becomes an order collector: one call per inquiry, per sync, for nobody. So
 * every test below asserts a CALL COUNT, and the stub reader counts.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ExactOrderCallTimingTest {

    private static final Instant NOW = Instant.parse("2026-08-25T02:00:00Z");

    @Autowired ChannelOrderRepository orders;
    @Autowired ChannelRepository channels;
    @Autowired OrganizationRepository organizations;
    @Autowired SellerAccountRepository accounts;

    private UUID org;
    private UUID channelId;
    private UUID accountId;
    private CountingReader stub;
    private OrderFactCache cache;

    @BeforeEach
    void setUp() {
        Organization o = new Organization();
        o.setName("테스트 상점");
        org = organizations.save(o).getId();

        Channel channel = new Channel();
        channel.setCode("CAFE24");
        channel.setNameKo("카페24");
        channel.setStatus(ChannelStatus.CONNECTED);
        channelId = channels.findByCode("CAFE24").map(Channel::getId)
                .orElseGet(() -> channels.save(channel).getId());

        SellerAccount account = new SellerAccount();
        account.setOrgId(org);
        account.setChannelId(channelId);
        account.setAlias("테스트 계정");
        account.setConnectionStatus(ChannelStatus.CONNECTED);
        accountId = accounts.save(account).getId();

        stub = new CountingReader();
        cache = new OrderFactCache(Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    @DisplayName("an inquiry that names no order makes no call — ever, at any lookup level")
    void noReferenceMeansNoCall() {
        OrderFact fact = reader().read(org, inquiry(null, null), OrderFactLookup.EXACT_ALLOWED);

        assertThat(fact.state()).isEqualTo(OrderFactState.NO_ORDER_REFERENCE);
        assertThat(stub.calls).isEmpty();
    }

    @Test
    @DisplayName("STORED_ONLY never calls, even with a reference and a capable channel")
    void storedOnlyNeverCalls() {
        OrderFact fact = reader().read(org, inquiry("20260825-0001", InquiryOrderBinding.SOURCE_EXACT),
                OrderFactLookup.STORED_ONLY);

        assertThat(fact.state()).isEqualTo(OrderFactState.ORDER_NOT_FOUND);
        assertThat(stub.calls)
                .as("the coverage audit classifies thousands of rows and none of them is waiting")
                .isEmpty();
    }

    @Test
    @DisplayName("one bound reference is exactly one request")
    void oneReferenceIsOneRequest() {
        stub.answer = observed(OrderCancellationState.NOT_CANCELLED);

        OrderFact fact = reader().read(org, inquiry("20260825-0001", InquiryOrderBinding.SOURCE_EXACT),
                OrderFactLookup.EXACT_ALLOWED);

        assertThat(stub.calls).containsExactly("20260825-0001");
        assertThat(fact.state()).isEqualTo(OrderFactState.OBSERVED_FRESH);
        assertThat(fact.provenance()).isEqualTo(OrderFactProvenance.EXACT_READ);
        assertThat(fact.cancellation()).isEqualTo(OrderCancellationState.NOT_CANCELLED);
    }

    @Test
    @DisplayName("the same order asked twice in one sitting is one request")
    void aRepeatWithinTheWindowIsSuppressed() {
        stub.answer = observed(OrderCancellationState.NOT_CANCELLED);
        InquiryOrderFactReader reader = reader();

        reader.read(org, inquiry("20260825-0001", InquiryOrderBinding.SOURCE_EXACT),
                OrderFactLookup.EXACT_ALLOWED);
        OrderFact second = reader.read(org, inquiry("20260825-0001", InquiryOrderBinding.SOURCE_EXACT),
                OrderFactLookup.EXACT_ALLOWED);

        assertThat(stub.calls)
                .as("open the inquiry, then press 초안 생성 — one order, one sitting, one request")
                .hasSize(1);
        assertThat(second.state()).isEqualTo(OrderFactState.OBSERVED_FRESH);
    }

    @Test
    @DisplayName("after the window the mall is asked again — a cached state is not a current one")
    void aRepeatAfterTheWindowAsksAgain() {
        stub.answer = observed(OrderCancellationState.NOT_CANCELLED);
        InquiryOrderFactReader reader = reader();
        reader.read(org, inquiry("20260825-0001", InquiryOrderBinding.SOURCE_EXACT),
                OrderFactLookup.EXACT_ALLOWED);

        cache = new OrderFactCache(Clock.fixed(NOW.plus(OrderFactCache.TTL).plus(Duration.ofSeconds(1)),
                ZoneOffset.UTC));
        // A fresh cache instance stands in for the clock moving past the TTL.
        reader().read(org, inquiry("20260825-0001", InquiryOrderBinding.SOURCE_EXACT),
                OrderFactLookup.EXACT_ALLOWED);

        assertThat(stub.calls).hasSize(2);
    }

    @Test
    @DisplayName("a failed read is not cached — one bad minute is not five")
    void aFailureIsNotCached() {
        stub.answer = ExactOrderObservation.failed(ExactOrderReadOutcome.RATE_LIMITED);
        InquiryOrderFactReader reader = reader();

        reader.read(org, inquiry("20260825-0001", InquiryOrderBinding.SOURCE_EXACT),
                OrderFactLookup.EXACT_ALLOWED);
        reader.read(org, inquiry("20260825-0001", InquiryOrderBinding.SOURCE_EXACT),
                OrderFactLookup.EXACT_ALLOWED);

        assertThat(stub.calls).hasSize(2);
    }

    @Test
    @DisplayName("a fresh stored fact answers without a call")
    void aFreshStoredFactSuppressesTheCall() {
        seedOrder("20260825-0001", "PAYED");

        OrderFact fact = reader(ChannelDataState.OBSERVED_FRESH)
                .read(org, inquiry("20260825-0001", InquiryOrderBinding.SOURCE_EXACT),
                        OrderFactLookup.EXACT_ALLOWED);

        assertThat(stub.calls).isEmpty();
        assertThat(fact.provenance()).isEqualTo(OrderFactProvenance.STORED_CANONICAL);
    }

    @Test
    @DisplayName("a stale stored fact does NOT suppress the call — and never becomes a current claim")
    void aStaleStoredFactIsRefreshedAndNeverStatedAsNow() {
        seedOrder("20260825-0001", "PAYED");
        stub.answer = ExactOrderObservation.failed(ExactOrderReadOutcome.TRANSPORT_ERROR);

        OrderFact fact = reader(ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN)
                .read(org, inquiry("20260825-0001", InquiryOrderBinding.SOURCE_EXACT),
                        OrderFactLookup.EXACT_ALLOWED);

        assertThat(stub.calls).hasSize(1);
        assertThat(fact.state()).isEqualTo(OrderFactState.OBSERVED_FRESHNESS_UNPROVEN);
        assertThat(fact.messageKo())
                .as("the stale row is still worth citing — with its own date on it")
                .contains("확인 시점 기준이며")
                .doesNotContain("현재 확인된 상태");
    }

    @Test
    @DisplayName("a reference belonging to another connection does not resolve here")
    void anotherAccountsOrderIsNotOurs() {
        seedOrder("20260825-0001", "PAYED");
        SellerAccount other = new SellerAccount();
        other.setOrgId(org);
        other.setChannelId(channelId);
        other.setAlias("다른 계정");
        other.setConnectionStatus(ChannelStatus.CONNECTED);
        UUID otherAccount = accounts.save(other).getId();

        Inquiry q = inquiry("20260825-0001", InquiryOrderBinding.SOURCE_EXACT);
        q.setSellerAccountId(otherAccount);
        OrderFact fact = reader(ChannelDataState.OBSERVED_FRESH)
                .read(org, q, OrderFactLookup.STORED_ONLY);

        assertThat(fact.state())
                .as("the store is keyed by (org, account, reference); a neighbour's row is not ours")
                .isEqualTo(OrderFactState.ORDER_NOT_FOUND);
    }

    @Test
    @DisplayName("a channel with no reader makes no call and claims nothing")
    void anUncontractedChannelMakesNoCall() {
        InquiryOrderFactReader reader = new InquiryOrderFactReader(orders, channels,
                (o, code, account, rows) -> ChannelDataState.OBSERVED_FRESH,
                new ExactOrderReaders(List.of()), cache, new ExactOrderReadAudit());

        OrderFact fact = reader.read(org, inquiry("20260825-0001", InquiryOrderBinding.SOURCE_EXACT),
                OrderFactLookup.EXACT_ALLOWED);

        assertThat(fact.state()).isEqualTo(OrderFactState.ORDER_NOT_FOUND);
        assertThat(stub.calls).isEmpty();
    }

    private InquiryOrderFactReader reader() {
        return reader(ChannelDataState.OBSERVED_FRESH);
    }

    private InquiryOrderFactReader reader(ChannelDataState state) {
        return new InquiryOrderFactReader(orders, channels, (o, code, account, rows) -> state,
                new ExactOrderReaders(List.of(stub)), cache, new ExactOrderReadAudit());
    }

    private static ExactOrderObservation observed(OrderCancellationState cancellation) {
        return new ExactOrderObservation(ExactOrderReadOutcome.OK, OrderPaymentState.PAID,
                cancellation, OrderFulfillmentState.AWAITING_SHIPMENT,
                "paid=T;canceled=F;shipping=F", LocalDate.parse("2026-08-25"), NOW, null, NOW);
    }

    private Inquiry inquiry(String orderRef, InquiryOrderBinding binding) {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(channelId);
        q.setSellerAccountId(accountId);
        q.setTitle("주문 문의");
        q.setBody("확인 부탁드립니다.");
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.parse("2026-08-24T00:00:00Z"));
        q.setSourceOrderRef(orderRef);
        q.setOrderBinding(binding == null ? null : binding.name());
        return q;
    }

    private void seedOrder(String externalOrderId, String rawStatus) {
        ChannelOrder order = new ChannelOrder();
        order.setOrgId(org);
        order.setSellerAccountId(accountId);
        order.setChannelId(channelId);
        order.setExternalOrderId(externalOrderId);
        order.setRawStatusCode(rawStatus);
        order.setNormalizedStatus(NormalizedOrderStatus.fromRaw(rawStatus));
        order.setPaymentAmount(10000L);
        order.setSummaryDate(LocalDate.parse("2026-08-21"));
        order.setPaidAt(Instant.parse("2026-08-21T01:00:00Z"));
        order.setFirstSeenAt(Instant.parse("2026-08-21T02:00:00Z"));
        order.setLastSeenAt(Instant.parse("2026-08-21T02:00:00Z"));
        orders.save(order);
    }

    /** Counts what it was asked for. The only thing standing where a marketplace would be. */
    private static final class CountingReader implements ExactOrderReader {

        private final List<String> calls = new ArrayList<>();
        private ExactOrderObservation answer =
                ExactOrderObservation.failed(ExactOrderReadOutcome.NOT_FOUND);

        @Override
        public String channelCode() {
            return "CAFE24";
        }

        @Override
        public ExactOrderObservation read(UUID orgId, UUID sellerAccountId, String reference) {
            calls.add(reference);
            return answer;
        }
    }
}
