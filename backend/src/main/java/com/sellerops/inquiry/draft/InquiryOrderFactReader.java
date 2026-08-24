package com.sellerops.inquiry.draft;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.coverage.ChannelDataState;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOrderBinding;
import com.sellerops.order.ChannelOrder;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.order.NormalizedOrderStatus;
import com.sellerops.order.fact.ExactOrderLookupCapability;
import com.sellerops.order.fact.ExactOrderObservation;
import com.sellerops.order.fact.ExactOrderReadAudit;
import com.sellerops.order.fact.ExactOrderReadOutcome;
import com.sellerops.order.fact.ExactOrderReader;
import com.sellerops.order.fact.ExactOrderReaders;
import com.sellerops.order.fact.OrderFact;
import com.sellerops.order.fact.OrderFactCache;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.order.fact.OrderFactProvenance;
import com.sellerops.order.fact.OrderFactState;
import com.sellerops.order.fact.OrderStoreFreshness;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The one place a reply may learn the state of an order.
 *
 * <p><b>Why this is a read and not a retrieval lane.</b> "이 주문 취소됐나요?" is not answered by
 * anything anyone wrote down. It is answered by the order, which changes without an edit. Copying
 * that into a searchable corpus would produce a passage that was true when it was written and is
 * cited after it stopped being true — the customer told "결제완료" about a parcel that shipped this
 * morning, with a citation under it. So {@code ORDER_STATE} has no corpus, and this class reads a
 * deterministic source at the moment the fact is needed.
 *
 * <p><b>The fact-source priority, in order.</b>
 *
 * <ol>
 *   <li>A stored canonical order matched EXACTLY by the reference the source supplied — and used
 *       only while it is {@code OBSERVED_FRESH}. A stale row is not preferred over asking.</li>
 *   <li>One bounded exact READ of that one order, when the caller asked for
 *       {@link OrderFactLookup#EXACT_ALLOWED} and the channel has a vendored contract
 *       ({@link ExactOrderLookupCapability}). Cafe24 does; NAVER and Coupang do not.</li>
 *   <li>The stale stored row, if there was one — cited with its own date, never as current.</li>
 *   <li>{@link OrderFactState} says which of the reasons applies, and the draft states the
 *       limitation.</li>
 * </ol>
 *
 * <p><b>Having a reference is not a reason to call a channel.</b> The network is reached only when
 * the CALLER says so, and only two callers do: the inquiry detail a person is looking at, and the
 * drafting path about to ground a sentence. Ingestion and the coverage audit are
 * {@link OrderFactLookup#STORED_ONLY}, which is what keeps the inquiry collector from becoming an
 * order collector one request per inquiry.
 *
 * <p><b>Nothing here reads the customer's text.</b> Not for an order number, not for a date, not for
 * an amount. The only input is {@code inquiries.source_order_ref}, which the CHANNEL wrote — see
 * {@link InquiryOrderBinding} for why there is no second lane.
 *
 * <p><b>A reference that matches more than one stored row does not resolve.</b> A payment-unit id can
 * span several product orders, and this class refuses rather than picking one: "이 주문 취소됐나요?"
 * about a three-line order where one line was cancelled has no single true answer, and the first row
 * is not it.
 */
@Component
public class InquiryOrderFactReader {

    private final ChannelOrderRepository orders;
    private final ChannelRepository channels;
    private final OrderStoreFreshness freshness;
    private final ExactOrderReaders exactReaders;
    private final OrderFactCache cache;
    private final ExactOrderReadAudit audit;

    public InquiryOrderFactReader(ChannelOrderRepository orders, ChannelRepository channels,
                                  OrderStoreFreshness freshness, ExactOrderReaders exactReaders,
                                  OrderFactCache cache, ExactOrderReadAudit audit) {
        this.orders = orders;
        this.channels = channels;
        this.freshness = freshness;
        this.exactReaders = exactReaders;
        this.cache = cache;
        this.audit = audit;
    }

    /** Stored facts only. The default, and what every batch and audit path gets. */
    public OrderFact read(UUID orgId, Inquiry inquiry) {
        return read(orgId, inquiry, OrderFactLookup.STORED_ONLY);
    }

    /** What is known about this inquiry's order — or which of the reasons says nothing is. */
    public OrderFact read(UUID orgId, Inquiry inquiry, OrderFactLookup lookup) {
        String channelCode = channels.findById(inquiry.getChannelId())
                .map(Channel::getCode)
                .orElse(null);

        // Step 0 — is there anything to look up at all. Asked first because it is the answer for
        // every Cafe24 board-6 article that named no order and every NAVER 상품 문의, and because a
        // channel's freshness is irrelevant to an inquiry that names no order.
        String reference = inquiry.getSourceOrderRef();
        if (reference == null || reference.isBlank()
                || inquiry.orderBinding() != InquiryOrderBinding.SOURCE_EXACT) {
            return OrderFact.unavailable(OrderFactState.NO_ORDER_REFERENCE, null, channelCode);
        }
        UUID accountId = inquiry.getSellerAccountId();
        if (accountId == null) {
            // A reference with no connection to resolve it against — a legacy or uploaded row. Not
            // "not found": we have nowhere to look, which is a different sentence.
            return OrderFact.unavailable(OrderFactState.SOURCE_UNAVAILABLE, ChannelDataState.NOT_CONNECTED,
                    channelCode);
        }

        // Step 1 — the stored canonical fact, used as current only while it is fresh.
        OrderFact stored = storedFact(orgId, accountId, channelCode, reference);
        if (stored != null && stored.state() == OrderFactState.OBSERVED_FRESH) {
            return stored;
        }
        if (lookup == OrderFactLookup.STORED_ONLY) {
            return stored != null ? stored
                    : OrderFact.unavailable(OrderFactState.ORDER_NOT_FOUND, null, channelCode);
        }

        // Step 2 — one exact READ of this one order.
        Optional<ExactOrderReader> reader = exactReaders.forChannel(channelCode);
        if (reader.isEmpty()) {
            audit.record(orgId, inquiry.getId(), channelCode, ExactOrderReadOutcome.NOT_CAPABLE);
            return stored != null ? stored
                    : OrderFact.unavailable(OrderFactState.ORDER_NOT_FOUND, null, channelCode);
        }
        ExactOrderObservation observed = cache.get(orgId, accountId, channelCode, reference);
        if (observed != null) {
            audit.recordSuppressed(orgId, inquiry.getId(), channelCode);
        } else {
            observed = reader.get().read(orgId, accountId, reference);
            audit.record(orgId, inquiry.getId(), channelCode, observed.outcome());
            cache.put(orgId, accountId, channelCode, reference, observed);
        }
        if (observed.ok()) {
            return exactFact(channelCode, observed);
        }
        // Step 3 — a stale stored row is still a real observation, cited with its own date. Preferred
        // over a bare failure, because "8월 21일 기준" answers more than "확인할 수 없습니다".
        if (stored != null) {
            return stored;
        }
        return OrderFact.unavailable(observed.outcome().asFactState(),
                observed.outcome() == ExactOrderReadOutcome.UNAUTHORIZED ? ChannelDataState.BLOCKED : null,
                channelCode);
    }

    /** The stored row for this reference, or null when the store cannot answer exactly. */
    private OrderFact storedFact(UUID orgId, UUID accountId, String channelCode, String reference) {
        List<ChannelOrder> matched = orders.findAllByReference(orgId, accountId, reference);
        if (matched.size() != 1) {
            return null;
        }
        ChannelOrder order = matched.get(0);
        long held = orders.findAllByOrgIdAndSellerAccountId(orgId, accountId).size();
        ChannelDataState channelState = freshness.perOrderState(orgId, channelCode, accountId, held);
        NormalizedOrderStatus normalized = order.getNormalizedStatus() == null
                ? NormalizedOrderStatus.UNKNOWN : order.getNormalizedStatus();
        // Cancellation and fulfillment are UNPROVEN from the store, not false. This repository has
        // live-observed exactly one NAVER status token (PAYED) and has never confirmed what Coupang's
        // DELIVERING or FINAL_DELIVERY mean, so no stored code proves a cancellation or a dispatch —
        // and a FALSE here would let a draft write "취소되지 않았습니다", which nothing proves.
        return new OrderFact(OrderFactState.fromChannel(channelState),
                OrderFactProvenance.STORED_CANONICAL, channelState, channelCode,
                OrderFact.paymentFrom(normalized), null, null,
                order.getRawStatusCode(), order.getPaidAt(), null,
                order.getStatusChangedAt(), order.getSummaryDate(), order.getLastSeenAt());
    }

    /** An exact read is fresh by construction: the channel answered about this order just now. */
    private static OrderFact exactFact(String channelCode, ExactOrderObservation observed) {
        return new OrderFact(OrderFactState.OBSERVED_FRESH, OrderFactProvenance.EXACT_READ,
                ChannelDataState.OBSERVED_FRESH, channelCode,
                observed.payment(), observed.cancellation(), observed.fulfillment(),
                observed.rawStatusCode(), observed.paidAt(), observed.cancelledAt(),
                null, observed.orderedAt(), observed.observedAt());
    }
}
