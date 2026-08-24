package com.sellerops.inquiry.draft;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.coverage.ChannelDataState;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOrderBinding;
import com.sellerops.order.ChannelOrder;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.order.NormalizedOrderStatus;
import com.sellerops.order.fact.OrderFact;
import com.sellerops.order.fact.OrderCancellationState;
import com.sellerops.order.fact.OrderFactProvenance;
import com.sellerops.order.fact.OrderFactState;
import com.sellerops.order.fact.OrderFulfillmentState;
import com.sellerops.order.fact.OrderPaymentState;
import com.sellerops.order.fact.OrderStoreFreshness;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Binding an inquiry to an order — exactly, or not at all.
 *
 * <p>Every test here is really the same test asked from a different side: <b>can this class ever
 * produce an order the channel did not name?</b> A wrong product attribution shows a seller the wrong
 * spec sheet; a wrong order attribution tells a customer the state of a stranger's parcel.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryOrderFactReaderTest {

    @Autowired ChannelOrderRepository orders;
    @Autowired ChannelRepository channels;
    @Autowired OrganizationRepository organizations;
    @Autowired SellerAccountRepository accounts;

    private UUID org;
    private UUID channelId;
    private UUID accountId;

    private static OrderStoreFreshness freshness(ChannelDataState state) {
        return (orgId, code, account, rows) -> state;
    }

    @BeforeEach
    void setUp() {
        Organization o = new Organization();
        o.setName("테스트 상점");
        org = organizations.save(o).getId();

        Channel channel = new Channel();
        channel.setCode("NAVER-" + UUID.randomUUID().toString().substring(0, 8));
        channel.setNameKo("네이버");
        channel.setStatus(ChannelStatus.CONNECTED);
        channelId = channels.save(channel).getId();

        SellerAccount account = new SellerAccount();
        account.setOrgId(org);
        account.setChannelId(channelId);
        account.setAlias("테스트 계정");
        account.setConnectionStatus(ChannelStatus.CONNECTED);
        accountId = accounts.save(account).getId();
    }

    @Test
    @DisplayName("an inquiry that names no order gets no order — and that is not a failure")
    void noReferenceIsNotAFailure() {
        seedOrder("PO-1", "ORD-1", "PAYED");

        OrderFact fact = read(inquiry(null, null));

        assertThat(fact.state()).isEqualTo(OrderFactState.NO_ORDER_REFERENCE);
        assertThat(fact.available()).isFalse();
        assertThat(fact.messageKo()).contains("주문 번호가 함께 오지 않아");
    }

    @Test
    @DisplayName("the per-line identifier resolves exactly")
    void productOrderIdResolves() {
        seedOrder("PO-1", "ORD-1", "PAYED");

        OrderFact fact = read(inquiry("PO-1", InquiryOrderBinding.SOURCE_EXACT));

        assertThat(fact.state()).isEqualTo(OrderFactState.OBSERVED_FRESH);
        assertThat(fact.payment()).isEqualTo(OrderPaymentState.PAID);
        assertThat(fact.provenance()).isEqualTo(OrderFactProvenance.STORED_CANONICAL);
        assertThat(fact.messageKo()).contains("결제는 완료되었습니다");
        assertThat(fact.messageKo())
                .as("payment says nothing about dispatch, and the sentence says so out loud")
                .contains("발송 상태는 확인되지 않았습니다");
    }

    @Test
    @DisplayName("the payment-unit identifier resolves too — channels name orders in two spaces")
    void parentOrderIdResolves() {
        seedOrder("PO-1", "ORD-1", "PAYED");

        OrderFact fact = read(inquiry("ORD-1", InquiryOrderBinding.SOURCE_EXACT));

        assertThat(fact.state()).isEqualTo(OrderFactState.OBSERVED_FRESH);
    }

    @Test
    @DisplayName("a payment-unit reference spanning two lines does NOT resolve to the first one")
    void anAmbiguousReferenceRefuses() {
        seedOrder("PO-1", "ORD-1", "PAYED");
        seedOrder("PO-2", "ORD-1", "PAYED");

        OrderFact fact = read(inquiry("ORD-1", InquiryOrderBinding.SOURCE_EXACT));

        assertThat(fact.state())
                .as("\"이 주문 취소됐나요?\" about a two-line order has no single true answer")
                .isEqualTo(OrderFactState.ORDER_NOT_FOUND);
        assertThat(fact.available()).isFalse();
    }

    @Test
    @DisplayName("a reference with no matching row is not-found — never an absence claim")
    void anUnmatchedReferenceIsNotFound() {
        seedOrder("PO-1", "ORD-1", "PAYED");

        OrderFact fact = read(inquiry("PO-999", InquiryOrderBinding.SOURCE_EXACT));

        assertThat(fact.state()).isEqualTo(OrderFactState.ORDER_NOT_FOUND);
        assertThat(fact.messageKo())
                .as("neither 'it does not exist' nor 'it was cancelled' — only that we did not find it")
                .contains("찾지 못해");
    }

    @Test
    @DisplayName("a reference with no binding is ignored — a value alone is not a decision")
    void aReferenceWithoutABindingIsIgnored() {
        seedOrder("PO-1", "ORD-1", "PAYED");

        OrderFact fact = read(inquiry("PO-1", null));

        assertThat(fact.state()).isEqualTo(OrderFactState.NO_ORDER_REFERENCE);
    }

    @Test
    @DisplayName("a matched row on an unproven-freshness channel may be cited, with its date")
    void freshnessUnprovenCitesWithADate() {
        seedOrder("PO-1", "ORD-1", "PAYED");

        OrderFact fact = read(inquiry("PO-1", InquiryOrderBinding.SOURCE_EXACT),
                ChannelDataState.OBSERVED_FRESHNESS_UNPROVEN);

        assertThat(fact.state()).isEqualTo(OrderFactState.OBSERVED_FRESHNESS_UNPROVEN);
        assertThat(fact.available()).isTrue();
        assertThat(fact.state().mayStateAsCurrent()).isFalse();
        assertThat(fact.messageKo())
                .contains("확인 시점 기준")
                .contains("이후 변경되었을 수 있습니다");
    }

    @Test
    @DisplayName("a blocked channel yields no state even though the row is right there")
    void aBlockedChannelYieldsNothing() {
        seedOrder("PO-1", "ORD-1", "PAYED");

        OrderFact fact = read(inquiry("PO-1", InquiryOrderBinding.SOURCE_EXACT),
                ChannelDataState.BLOCKED);

        assertThat(fact.state()).isEqualTo(OrderFactState.SOURCE_UNAVAILABLE);
        assertThat(fact.channelState())
                .as("the remedy differs from NOT_CONNECTED and the screen keeps them apart")
                .isEqualTo(ChannelDataState.BLOCKED);
    }

    @Test
    @DisplayName("an unobserved status code never becomes a shipping meaning")
    void anUnobservedCodeStaysUnknown() {
        seedOrder("PO-1", "ORD-1", "DELIVERING");

        OrderFact fact = read(inquiry("PO-1", InquiryOrderBinding.SOURCE_EXACT));

        assertThat(fact.payment()).isEqualTo(OrderPaymentState.UNKNOWN);
        assertThat(fact.fulfillment()).isEqualTo(OrderFulfillmentState.UNKNOWN);
        assertThat(fact.rawStatusCode()).isEqualTo("DELIVERING");
        assertThat(fact.messageKo())
                .as("Coupang's DELIVERING is in the store and has never been live-confirmed")
                .contains("의미를 확정하지 못했습니다");
        assertThat(fact.messageKo()).doesNotContain("배송");
    }

    @Test
    @DisplayName("cancellation is never reported as FALSE — no stored code proves a negative")
    void cancellationIsNeverProvenFalse() {
        seedOrder("PO-1", "ORD-1", "PAYED");

        OrderFact fact = read(inquiry("PO-1", InquiryOrderBinding.SOURCE_EXACT));

        assertThat(fact.cancellation()).isEqualTo(OrderCancellationState.UNKNOWN);
        assertThat(fact.messageKo()).doesNotContain("취소되지 않");
    }

    @Test
    @DisplayName("a resolved fact never carries an order identifier out of this class")
    void theFactNamesNoOrder() {
        seedOrder("PO-1", "ORD-1", "PAYED");

        OrderFact fact = read(inquiry("PO-1", InquiryOrderBinding.SOURCE_EXACT));

        assertThat(fact.messageKo()).doesNotContain("PO-1").doesNotContain("ORD-1");
        for (var component : OrderFact.class.getRecordComponents()) {
            assertThat(component.getName().toLowerCase())
                    .as("the reference stays on the inquiry row, where the join needs it")
                    .doesNotContain("orderid")
                    .doesNotContain("reference");
        }
    }

    private OrderFact read(Inquiry inquiry) {
        return read(inquiry, ChannelDataState.OBSERVED_FRESH);
    }

    private OrderFact read(Inquiry inquiry, ChannelDataState state) {
        return com.sellerops.order.fact.StoredOnlyOrderFacts.reader(orders, channels, freshness(state))
                .read(org, inquiry);
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

    private void seedOrder(String externalOrderId, String parentOrderId, String rawStatus) {
        ChannelOrder order = new ChannelOrder();
        order.setOrgId(org);
        order.setSellerAccountId(accountId);
        order.setChannelId(channelId);
        order.setExternalOrderId(externalOrderId);
        order.setParentOrderId(parentOrderId);
        order.setRawStatusCode(rawStatus);
        order.setNormalizedStatus(NormalizedOrderStatus.fromRaw(rawStatus));
        order.setPaymentAmount(10000L);
        order.setSummaryDate(LocalDate.parse("2026-08-21"));
        order.setPaidAt(Instant.parse("2026-08-21T01:00:00Z"));
        order.setFirstSeenAt(Instant.parse("2026-08-21T02:00:00Z"));
        order.setLastSeenAt(Instant.parse("2026-08-25T02:00:00Z"));
        orders.save(order);
    }
}
