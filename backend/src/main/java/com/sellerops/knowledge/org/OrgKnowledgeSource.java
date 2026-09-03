package com.sellerops.knowledge.org;

import com.sellerops.common.BaseEntity;
import com.sellerops.common.DataOrigin;
import com.sellerops.product.library.KnowledgeAuthorship;
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
 * One operating rule the seller wrote, for the whole company rather than for one product.
 *
 * <p><b>The sibling of {@code ProductKnowledgeSource}, deliberately not the same table.</b> They
 * differ in the only way that matters to a retrieval: the scope a question has to resolve before
 * either can be searched. A product note is reachable only once the inquiry is bound to a product; a
 * shipping policy is reachable for an inquiry that has no product at all — which is most of the
 * Cafe24 backlog. Sharing a table would mean a nullable product_id whose null means "org-wide", and
 * the first query that forgot the null would answer a question about one product with another
 * product's notes.
 *
 * <p><b>{@link #version} is not an audit trail and does not pretend to be one.</b> It says which
 * revision of the policy a draft was grounded in, so a citation recorded last week can be read as
 * "판매자가 그때 그렇게 정해 두었다" rather than as today's text. The previous body is not kept here;
 * when that is needed it is a separate append-only table, not a column.
 */
@Getter
@Setter
@Entity
@Table(name = "org_knowledge_sources")
@Filter(name = RealDataOnly.NAME, condition = RealDataOnly.CONDITION)
public class OrgKnowledgeSource extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Enumerated(EnumType.STRING)
    @Column(name = "knowledge_type", nullable = false, length = 32)
    private OrgKnowledgeType knowledgeType;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(nullable = false, columnDefinition = "text")
    private String body;

    @Column(name = "source_url", length = 1000)
    private String sourceUrl;

    /**
     * How this rule came to exist — typed on the settings screen, or read out of a file the seller
     * uploaded (Knowledge Sources &amp; Acquisition v1). The product corpus has carried this axis since
     * the 상세페이지 lane existed; the ORG corpus had one writer and therefore no need for it until now.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "authored_origin", nullable = false, length = 40)
    private KnowledgeAuthorship authoredOrigin = KnowledgeAuthorship.SELLER_ENTERED_KNOWLEDGE;

    /** The file this rule came from, when the seller uploaded one. Null for a typed rule. */
    @Column(name = "document_name", length = 260)
    private String documentName;

    /** Whether this rule still speaks for the company. Retiring is not deleting — see the product corpus. */
    @Column(nullable = false)
    private boolean active = true;

    @Column(name = "author_user_id")
    private UUID authorUserId;

    @Column(name = "author_name", length = 120)
    private String authorName;

    @Column(nullable = false)
    private int version = 1;

    @Enumerated(EnumType.STRING)
    @Column(name = "data_origin", nullable = false, length = 16)
    private DataOrigin dataOrigin = DataOrigin.REAL;
}
