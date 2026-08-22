package com.sellerops.product;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One stated fact about a product, and who stated it when.
 *
 * <p><b>{@link #source} and {@link #observedAt} are not metadata; they are the reason this row is
 * allowed to exist.</b> Operator Graph v2 treats a product fact as EVIDENCE, and the Evidence Judge
 * refuses a sentence resting on a fact it cannot trace. A fact with no origin would be a sentence the
 * agent could assert and nobody could check — which is the failure the whole layer exists to prevent.
 *
 * <p><b>{@link #factKey} is namespaced</b> ({@code spec:} · {@code attr:} · {@code desc:} ·
 * {@code taxonomy:}) so a reader can tell a channel-stated attribute from a title-derived one without
 * consulting {@link #source}. The namespace is a small closed set ({@link FactKeys}); the suffix is
 * the channel's own attribute name, kept verbatim because renaming it would make the fact untraceable
 * back to the listing field it came from.
 *
 * <p>Nothing here is customer data: a description, a spec and a price are the seller's own catalogue
 * content. Buyer identity, order lines and customer utterances have no column on this table.
 */
@Getter
@Setter
@Entity
@Table(name = "product_facts")
public class ProductFact extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    @Column(name = "fact_key", nullable = false, length = 120)
    private String factKey;

    @Column(name = "fact_value", nullable = false, columnDefinition = "text")
    private String factValue;

    @Column(length = 32)
    private String unit;

    /** e.g. {@code NAVER:PRODUCT_API:v1}. Same vocabulary as {@code ChannelProduct.sourceKind}. */
    @Column(nullable = false, length = 64)
    private String source;

    /** The channel-side row this was read from — a channel product no, an article no. */
    @Column(name = "source_ref", length = 120)
    private String sourceRef;

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

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private FactConfidence confidence;
}
