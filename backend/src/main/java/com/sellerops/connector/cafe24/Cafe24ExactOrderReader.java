package com.sellerops.connector.cafe24;

import com.sellerops.order.fact.ExactOrderObservation;
import com.sellerops.order.fact.ExactOrderReadOutcome;
import com.sellerops.order.fact.ExactOrderReader;
import com.sellerops.order.fact.OrderCancellationState;
import com.sellerops.order.fact.OrderFulfillmentState;
import com.sellerops.order.fact.OrderPaymentState;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Optional;
import java.util.UUID;

/**
 * Reads one Cafe24 order by its own order id, and translates the mall's three state fields into the
 * three states a reply may be grounded in.
 *
 * <p><b>Cafe24 is the channel where this is possible at all</b>, because it is the one whose
 * single-order contract is vendored ({@code docs/vendor/cafe24-admin-api/get-orders-order-id.md},
 * {@code GET /api/v2/admin/orders/{order_id}}, scope {@code mall.read_order}). The scope is already
 * in the connection's grant — the same one {@code ORDER_SUMMARY} has used since 2026-08-18 — so this
 * asks the seller for nothing new and reads nothing wider.
 *
 * <p><b>The translation is a table, and every unrecognized token is UNKNOWN.</b> The mall publishes
 * {@code paid} as {@code T}/{@code F}/{@code M}, {@code canceled} as {@code T}/{@code F}/{@code M},
 * and {@code shipping_status} as {@code F}/{@code M}/{@code T}/{@code W}/{@code X}. Note that
 * {@code T} means "paid"/"canceled" in the first two and "Delivered" in the third, and {@code F}
 * means "unpaid"/"not canceled" in the first two and "Awaiting shipment" in the third — the same
 * letter, three meanings. Reading them through one shared mapper would be a plausible-looking way to
 * tell a customer their order was delivered because it was not cancelled, so each field is read
 * through its own switch and none of them shares a default.
 *
 * <p><b>It exists only when the Cafe24 connector does.</b> Wired as a bean in
 * {@link Cafe24ConnectorConfiguration}, behind {@code sellerops.connector.cafe24.enabled}, beside the
 * authorizer it needs. With the flag off there is no reader, {@code ExactOrderReaders} holds nothing
 * for Cafe24, and an inquiry naming an order resolves to "찾지 못했습니다" — which is true, because
 * with no connector there is nothing to ask.
 *
 * <p><b>{@code F} on {@code canceled} is a claim we now make.</b> "Not Canceled", stated by the mall
 * about that order at the instant we asked, is exactly what a customer asking "취소됐나요?" needs.
 * It survives only because this is an {@code EXACT_READ} — the same value coming from a stored row
 * is downgraded to unknown by {@code OrderFact}'s own constructor.
 */
public class Cafe24ExactOrderReader implements ExactOrderReader {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final Cafe24Authorizer authorizer;
    private final Cafe24OrdersClient ordersClient;
    private final Clock clock;

    public Cafe24ExactOrderReader(Cafe24Authorizer authorizer, Cafe24OrdersClient ordersClient,
                                  Clock clock) {
        this.authorizer = authorizer;
        this.ordersClient = ordersClient;
        this.clock = clock;
    }

    @Override
    public String channelCode() {
        return Cafe24ApiConnector.CHANNEL_CODE;
    }

    @Override
    public ExactOrderObservation read(UUID orgId, UUID sellerAccountId, String reference) {
        Cafe24Authorizer.Authorized authorized;
        try {
            authorized = authorizer.authorize(orgId, sellerAccountId);
        } catch (RuntimeException authFailed) {
            // Includes a missing/expired grant and a vault that will not open. Nothing about the
            // order is known; the message is not propagated because it may name the connection.
            return ExactOrderObservation.failed(ExactOrderReadOutcome.UNAUTHORIZED);
        }

        Optional<Cafe24OrderDetailRow> found;
        try {
            found = ordersClient.fetchOne(authorized.accessToken(), authorized.mallId(), reference);
        } catch (Cafe24RateLimitedException rateLimited) {
            return ExactOrderObservation.failed(ExactOrderReadOutcome.RATE_LIMITED);
        } catch (Cafe24OrderReadException readFailed) {
            return ExactOrderObservation.failed(readFailed.unauthorized()
                    ? ExactOrderReadOutcome.UNAUTHORIZED : ExactOrderReadOutcome.TRANSPORT_ERROR);
        } catch (RuntimeException transportFailed) {
            // A refused order-id shape lands here too, and "we would not ask" is not "it is missing".
            return ExactOrderObservation.failed(ExactOrderReadOutcome.TRANSPORT_ERROR);
        }

        if (found.isEmpty()) {
            return ExactOrderObservation.failed(ExactOrderReadOutcome.NOT_FOUND);
        }
        Cafe24OrderDetailRow row = found.get();
        if (row.orderId() != null && !row.orderId().equals(reference)) {
            // The mall answered about a different order. That is not a fact about ours.
            return ExactOrderObservation.failed(ExactOrderReadOutcome.TRANSPORT_ERROR);
        }
        return new ExactOrderObservation(ExactOrderReadOutcome.OK,
                payment(row.paid()), cancellation(row.canceled()), fulfillment(row.shippingStatus()),
                row.rawStatusCode(), day(row.orderDate()), instant(row.paymentDate()),
                instant(row.cancelDate()), clock.instant());
    }

    /** {@code paid}: {@code T} Paid / {@code F} Unpaid / {@code M} Partially paid. */
    static OrderPaymentState payment(String paid) {
        if (paid == null) {
            return OrderPaymentState.UNKNOWN;
        }
        return switch (paid) {
            case "T" -> OrderPaymentState.PAID;
            case "F" -> OrderPaymentState.UNPAID;
            case "M" -> OrderPaymentState.PARTIALLY_PAID;
            default -> OrderPaymentState.UNKNOWN;
        };
    }

    /** {@code canceled}: {@code T} Canceled / {@code F} Not Canceled / {@code M} Partially canceled. */
    static OrderCancellationState cancellation(String canceled) {
        if (canceled == null) {
            return OrderCancellationState.UNKNOWN;
        }
        return switch (canceled) {
            case "T" -> OrderCancellationState.CANCELLED;
            case "F" -> OrderCancellationState.NOT_CANCELLED;
            case "M" -> OrderCancellationState.PARTIALLY_CANCELLED;
            default -> OrderCancellationState.UNKNOWN;
        };
    }

    /**
     * {@code shipping_status}: {@code F} Awaiting shipment / {@code M} In transit / {@code T}
     * Delivered / {@code W} Shipment on hold / {@code X} Awaiting confirmation.
     */
    static OrderFulfillmentState fulfillment(String shippingStatus) {
        if (shippingStatus == null) {
            return OrderFulfillmentState.UNKNOWN;
        }
        return switch (shippingStatus) {
            case "F" -> OrderFulfillmentState.AWAITING_SHIPMENT;
            case "M" -> OrderFulfillmentState.IN_TRANSIT;
            case "T" -> OrderFulfillmentState.DELIVERED;
            case "W" -> OrderFulfillmentState.ON_HOLD;
            case "X" -> OrderFulfillmentState.AWAITING_CONFIRMATION;
            default -> OrderFulfillmentState.UNKNOWN;
        };
    }

    /**
     * A mall timestamp, only when it carries its own offset.
     *
     * <p>Same discipline as {@code Cafe24BoardArticleMapper}: a timezone-less value stays unknown
     * rather than being assumed KST. A dispatch time that is nine hours wrong is worse than absent.
     */
    private static Instant instant(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(value).toInstant();
        } catch (RuntimeException notOffsetBearing) {
            return null;
        }
    }

    /** The order's calendar day, KST, so it buckets identically to the daily summary. */
    private static LocalDate day(String orderDate) {
        Instant at = instant(orderDate);
        return at == null ? null : at.atZone(KST).toLocalDate();
    }
}
