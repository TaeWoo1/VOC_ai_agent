package com.sellerops.product;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One purchasable option of a product on one channel.
 *
 * <p>The axis exists because a complaint is usually about an OPTION, not a product — and because
 * {@code reviews.source_option_id} (V37, Coupang 상품평) has been stored since 2026-08 with nothing to
 * resolve it against. A review attributed to "검정 / 2m" is a different operational fact from a review
 * attributed to the listing.
 *
 * <p>{@link #source} and {@link #observedAt} are NOT NULL for the reason {@link ProductFact} states:
 * a catalogue value with no stated origin is not evidence.
 */
@Getter
@Setter
@Entity
@Table(name = "product_variants")
public class ProductVariant extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    @Column(name = "channel_id")
    private UUID channelId;

    /** The channel's own option id (Coupang vendorItemId, NAVER optionId, Cafe24 variant code). */
    @Column(name = "external_variant_id", length = 120)
    private String externalVariantId;

    @Column(name = "option_name", length = 500)
    private String optionName;

    @Column(length = 120)
    private String sku;

    @Column(precision = 14, scale = 2)
    private BigDecimal price;

    @Column(name = "selling_status", length = 24)
    private String sellingStatus;

    @Column(nullable = false, length = 64)
    private String source;

    @Column(name = "observed_at", nullable = false)
    private Instant observedAt;

    /**
     * When the CHANNEL says the underlying row last changed, or null when it states none.
     *
     * <p>Distinct from {@link #observedAt}, which is when WE read it. They were one field, and freshness
     * was computed from it — so a catalogue read produced rows stamped 2014 and every verdict said STALE
     * about data that had just been read successfully.
     */
    @Column(name = "source_updated_at")
    private Instant sourceUpdatedAt;

    public Instant getSourceUpdatedAt() {
        return sourceUpdatedAt;
    }

    public void setSourceUpdatedAt(Instant sourceUpdatedAt) {
        this.sourceUpdatedAt = sourceUpdatedAt;
    }
}
