package com.sellerops.product.library;

import com.sellerops.common.BaseEntity;
import com.sellerops.common.DataOrigin;
import com.sellerops.common.RealDataOnly;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

/**
 * One document the seller wrote about one product.
 *
 * <p><b>Not a {@code ProductFact}.</b> A fact is what a CHANNEL stated about the product and carries
 * that channel's name and observation time; this is what the SELLER stated, and carries a person and
 * a moment. The Evidence Judge is allowed to weigh them differently, which it cannot do if they share
 * a table.
 *
 * <p>Carries {@link DataOrigin} like every other row that a demo deployment can manufacture, so a
 * seeded note can never be quoted to a real seller as their own writing.
 */
@Getter
@Setter
@Entity
@Table(name = "product_knowledge_sources")
@Filter(name = RealDataOnly.NAME, condition = RealDataOnly.CONDITION)
public class ProductKnowledgeSource extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    @Enumerated(EnumType.STRING)
    @Column(name = "source_type", nullable = false, length = 24)
    private KnowledgeSourceType sourceType;

    /**
     * How this document came to exist — typed, read off the seller's own listing, or extracted from
     * an image on it. Defaults to the only kind that existed before 2026-08-26, so an unset value is
     * never a silent "unknown provenance".
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "authored_origin", nullable = false, length = 40)
    private KnowledgeAuthorship authoredOrigin = KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE;

    /**
     * The listing this was read from, for channel-derived documents only — {@code NAVER:13250364547}.
     * Null for typed knowledge, which has no external identity. It is what makes a re-read an update
     * instead of a second copy of the same detail page.
     */
    @Column(name = "channel_source_ref", length = 200)
    private String channelSourceRef;

    /**
     * The one 규격 this document is about, or null for the whole listing.
     *
     * <p><b>Null means 전체 상품 공통, not "unknown".</b> Every row written before 2026-08-27 is
     * product-level and stays so; a scope that could be absent-because-nobody-said would make the two
     * indistinguishable, and the drafter has to be able to tell "true for every option" from "true
     * for this one".
     *
     * <p>It points at a {@code product_variants} row the CHANNEL stated. There is no free-text
     * variant name here on purpose: a seller typing 「2호」 into a box would create a second naming
     * space that nothing can reconcile with the option list the customer actually chose from.
     */
    @Column(name = "variant_id")
    private UUID variantId;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(nullable = false, columnDefinition = "text")
    private String body;

    @Column(name = "source_url", length = 1000)
    private String sourceUrl;

    @Column(name = "author_user_id")
    private UUID authorUserId;

    @Column(name = "author_name", length = 120)
    private String authorName;

    @Enumerated(EnumType.STRING)
    @Column(name = "data_origin", nullable = false, length = 16)
    private DataOrigin dataOrigin = DataOrigin.REAL;
}
