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
import com.sellerops.order.fact.OrderFact;
import com.sellerops.order.fact.OrderFactState;
import com.sellerops.order.fact.OrderStoreFreshness;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The one place a reply may learn the state of an order.
 *
 * <p><b>Why this is a read and not a retrieval lane.</b> "이 주문 취소됐나요?" is not answered by
 * anything anyone wrote down. It is answered by the order row, which changes without an edit. Copying
 * that row into a searchable corpus would produce a passage that was true when it was written and is
 * cited after it stopped being true — the customer told "결제완료" about a parcel that shipped this
 * morning, with a citation under it. So {@code ORDER_STATE} has no corpus, and this class reads the
 * deterministic source at the moment the fact is needed.
 *
 * <p><b>The fact-source priority, in order, and the middle one is currently empty.</b>
 *
 * <ol>
 *   <li>A stored canonical order matched EXACTLY by the reference the source supplied.</li>
 *   <li>An exact live READ of that one order — {@link ExactOrderLookupCapability}, which today
 *       declares no channel has a vendored contract for it. Nothing here invents one: a date sweep
 *       wide enough to contain the order is a history walk, not a lookup.</li>
 *   <li>{@link OrderFactState} says which of the reasons applies, and the draft states the
 *       limitation.</li>
 * </ol>
 *
 * <p><b>Nothing here reads the customer's text.</b> Not for an order number, not for a date, not for
 * an amount. The only input is {@code inquiries.source_order_ref}, which the CHANNEL wrote — see
 * {@link InquiryOrderBinding} for why there is no second lane.
 *
 * <p><b>A reference that matches more than one row does not resolve.</b> A payment-unit id can span
 * several product orders, and this class refuses rather than picking one: "이 주문 취소됐나요?" about a
 * three-line order where one line was cancelled has no single true answer, and the first row is not
 * it.
 */
@Component
public class InquiryOrderFactReader {

    private final ChannelOrderRepository orders;
    private final ChannelRepository channels;
    private final OrderStoreFreshness freshness;

    public InquiryOrderFactReader(ChannelOrderRepository orders, ChannelRepository channels,
                                  OrderStoreFreshness freshness) {
        this.orders = orders;
        this.channels = channels;
        this.freshness = freshness;
    }

    /** What is known about this inquiry's order — or which of the five reasons says nothing is. */
    public OrderFact read(UUID orgId, Inquiry inquiry) {
        String channelCode = channels.findById(inquiry.getChannelId())
                .map(Channel::getCode)
                .orElse(null);

        // Step 0 — is there anything to look up at all. Asked first because it is the answer for
        // every Cafe24 board-6 article and every NAVER 상품 문의, and because a channel's freshness is
        // irrelevant to an inquiry that names no order.
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

        // Step 1 — the stored canonical fact.
        List<ChannelOrder> matched = orders.findAllByReference(orgId, accountId, reference);
        if (matched.size() != 1) {
            // Step 2 — an exact live READ, if any channel had a contract for one. None does.
            if (ExactOrderLookupCapability.isAvailable(channelCode)) {
                throw new IllegalStateException(
                        "exact order lookup declared but not implemented: " + channelCode);
            }
            // Step 3.
            return OrderFact.unavailable(OrderFactState.ORDER_NOT_FOUND, null, channelCode);
        }

        ChannelOrder order = matched.get(0);
        long held = orders.findAllByOrgIdAndSellerAccountId(orgId, accountId).size();
        ChannelDataState channelState = freshness.perOrderState(orgId, channelCode, accountId, held);
        return new OrderFact(OrderFactState.fromChannel(channelState), channelState, channelCode,
                order.getNormalizedStatus() == null ? NormalizedOrderStatus.UNKNOWN
                        : order.getNormalizedStatus(),
                order.getRawStatusCode(),
                // Cancellation is UNPROVEN, not false. This repository has live-observed exactly one
                // NAVER status token (PAYED) and has never confirmed what Coupang's DELIVERING or
                // FINAL_DELIVERY mean, so there is no code here that proves a cancellation — and
                // returning FALSE would let a draft write "취소되지 않았습니다", which nothing proves.
                null,
                order.getPaidAt(), order.getStatusChangedAt(), order.getSummaryDate(),
                order.getLastSeenAt());
    }
}
