package com.sellerops.order;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One append-only row per observed raw-status change on a {@link ChannelOrder}. {@code fromStatusCode}
 * is null on the first observation (insert). {@code observedAt} is the observation's status time
 * ({@code status_changed_at}); {@code recordedAt} is when the row was written. Never updated or
 * deleted — the durable history of what the channel reported and when we saw it.
 */
@Getter
@Setter
@Entity
@Table(name = "channel_order_status_events")
public class ChannelOrderStatusEvent extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "channel_order_id", nullable = false)
    private UUID channelOrderId;

    /** Null on the first observation. */
    @Column(name = "from_status_code")
    private String fromStatusCode;

    @Column(name = "to_status_code", nullable = false)
    private String toStatusCode;

    @Column(name = "observed_at")
    private Instant observedAt;

    @Column(name = "recorded_at", nullable = false)
    private Instant recordedAt;
}
