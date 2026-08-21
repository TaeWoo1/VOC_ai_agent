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
 * A product as listed on a specific channel.
 *
 * <p><b>This table existed from V1 and held zero rows until Operator Graph v2</b>
 * (`docs/slices/product-context-diagnosis-groundwork.md` §2). It was created for exactly this purpose
 * and never wired, which is why v2 extends it rather than adding a second listings table beside an
 * empty one with the same meaning.
 *
 * <p><b>It is also where product identity moves to.</b> {@code ProductService.resolveOrCreate} keys on
 * SKU and falls back to an exact NAME match, so a seller who edits a listing title gets a second
 * {@code products} row and splits their own review history — measured, and undetected today. A listing
 * keyed by {@code (channel_id, external_product_id)} cannot split that way.
 */
@Getter
@Setter
@Entity
@Table(name = "channel_products")
public class ChannelProduct extends BaseEntity {

    @Column(name = "org_id")
    private UUID orgId;

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    @Column(name = "channel_id", nullable = false)
    private UUID channelId;

    @Column(name = "external_product_id")
    private String externalProductId;

    @Column(name = "channel_price")
    private BigDecimal channelPrice;

    /** The listing's own title on this channel — legitimately different from {@code products.name}. */
    @Column(name = "channel_product_name", length = 500)
    private String channelProductName;

    @Column(name = "product_url", length = 1000)
    private String productUrl;

    /** Minimal normalization — see {@link SellingStatus}. Never the channel token verbatim. */
    @Column(name = "selling_status", length = 24)
    private String sellingStatus;

    @Column(length = 8)
    private String currency;

    /** Which read produced this row, e.g. {@code CAFE24:PRODUCT_API:v2} or {@code DERIVED:INGEST}. */
    @Column(name = "source_kind", length = 64)
    private String sourceKind;

    /** The DATA's own observation time. Staleness is computed from this, never from {@code updatedAt}. */
    @Column(name = "observed_at")
    private Instant observedAt;

    @Column(name = "first_seen_at")
    private Instant firstSeenAt;

    @Column(name = "last_seen_at")
    private Instant lastSeenAt;
}
