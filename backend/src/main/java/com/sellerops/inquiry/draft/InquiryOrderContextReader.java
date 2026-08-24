package com.sellerops.inquiry.draft;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.order.ChannelOrderRepository;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The one place a draft may learn the state of an order — and, today, the place that says it cannot.
 *
 * <p><b>Why this is not a retrieval lane.</b> "이 주문 취소됐나요?" and "배송 언제 되나요?" are not
 * answered by anything anyone wrote down. They are answered by the order row, which changes without
 * an edit. Copying that row into a searchable corpus would produce a passage that was true when it
 * was written and is cited as evidence after it stopped being true — the customer would be told
 * "결제완료" about a parcel that shipped this morning, with a citation. So {@code ORDER_STATE} has no
 * corpus and is read from the deterministic source at the moment it is needed.
 *
 * <p><b>And today that read is structurally unreachable.</b> Orders are collected — the Demo Org has
 * NAVER and Coupang rows — but an inquiry carries no order reference: {@code inquiries} has no order
 * column and no channel SellerOps reads supplies one. The only way to produce an order id would be to
 * pull digits out of the customer's message, which is the same class of guess as inferring a product
 * from its name, and it fails the same way: the number in "1234번 주문 문의드립니다" may be a phone
 * number, a product code, or last year's order. So this returns a REASON, not an order, and the
 * draft states the limitation instead of inventing a status.
 *
 * <p>When an order link does arrive, the change is a lookup in this class and nothing else moves —
 * the draft already knows how to say that the context is missing.
 */
@Component
public class InquiryOrderContextReader {

    /** The inquiry names no order, so there is nothing to look up. The current state of every channel. */
    public static final String NO_ORDER_REFERENCE = "NO_ORDER_REFERENCE";

    /** This channel's orders are not collected at all, so even a reference would resolve to nothing. */
    public static final String CHANNEL_ORDERS_NOT_COLLECTED = "CHANNEL_ORDERS_NOT_COLLECTED";

    private final ChannelOrderRepository orders;

    public InquiryOrderContextReader(ChannelOrderRepository orders) {
        this.orders = orders;
    }

    /**
     * What is known about this inquiry's order.
     *
     * @param available   true only when a real order row was found and may be quoted
     * @param reasonCode  why not, when it was not — never shown raw to a seller
     * @param messageKo   the sentence a seller reads
     */
    public record OrderContext(boolean available, String reasonCode, String messageKo) {

        static OrderContext unavailable(String reasonCode, String messageKo) {
            return new OrderContext(false, reasonCode, messageKo);
        }
    }

    /**
     * Read the order behind this inquiry, or say why there is none.
     *
     * <p>Reads the customer's text for nothing. The parameters it uses are the structured ones the
     * collection stored.
     */
    public OrderContext read(UUID orgId, Inquiry inquiry) {
        boolean channelCollectsOrders = inquiry.getSellerAccountId() != null
                && !orders.findAllByOrgIdAndSellerAccountId(orgId, inquiry.getSellerAccountId()).isEmpty();
        if (!channelCollectsOrders) {
            return OrderContext.unavailable(CHANNEL_ORDERS_NOT_COLLECTED,
                    "이 채널의 주문 정보를 아직 가져오지 않아, 주문 상태를 근거로 쓰지 못했습니다.");
        }
        return OrderContext.unavailable(NO_ORDER_REFERENCE,
                "이 문의에는 주문 번호가 함께 오지 않아, 주문 상태를 근거로 쓰지 못했습니다.");
    }
}
