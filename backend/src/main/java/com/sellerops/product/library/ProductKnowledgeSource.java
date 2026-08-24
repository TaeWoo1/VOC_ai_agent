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
