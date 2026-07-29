package com.sellerops.order;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * Current per-order (product-order granularity) state for one seller connection. Identity is
 * {@code (org_id, seller_account_id, external_order_id)} — the channel's stable per-line id
 * (NAVER's {@code productOrderId}). Upserted idempotently on every sync; raw-status changes append
 * a {@link ChannelOrderStatusEvent} row.
 *
 * <p><b>Privacy:</b> holds no buyer PII (name / phone / address / memo) and no raw payload — only
 * the order/payment/status fields the channel returns, plus first/last-seen provenance.
 */
@Getter
@Setter
@Entity
@Table(name = "channel_orders")
public class ChannelOrder extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false)
    private UUID sellerAccountId;

    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    /** The channel's stable per-line id (NAVER productOrderId). Unique within (org, account). */
    @Column(name = "external_order_id", nullable = false)
    private String externalOrderId;

    /** The payment-unit grouping id (NAVER orderId); not unique. */
    @Column(name = "parent_order_id")
    private String parentOrderId;

    /** The channel's status code, stored verbatim. */
    @Column(name = "raw_status_code", nullable = false)
    private String rawStatusCode;

    @Enumerated(EnumType.STRING)
    @Column(name = "normalized_status", nullable = false)
    private NormalizedOrderStatus normalizedStatus;

    @Column(name = "payment_amount", nullable = false)
    private long paymentAmount;

    /** KST bucket, identical to the daily summary's; keeps the two aggregations consistent. */
    @Column(name = "summary_date", nullable = false)
    private LocalDate summaryDate;

    @Column(name = "paid_at")
    private Instant paidAt;

    @Column(name = "status_changed_at")
    private Instant statusChangedAt;

    @Column(name = "first_seen_at", nullable = false)
    private Instant firstSeenAt;

    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt;
}
