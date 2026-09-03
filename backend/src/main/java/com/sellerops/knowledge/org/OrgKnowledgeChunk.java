package com.sellerops.knowledge.org;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One quotable passage of an operating rule.
 *
 * <p>Stored rather than derived at read time for the reason the product library stores its own: the
 * unit an answer cites is a passage, and a passage that is re-split on every read has no stable
 * identity to cite. {@code normalized} is written once so a later change to the normalization rules
 * cannot silently re-score passages written before it.
 */
@Getter
@Setter
@Entity
// The migration has carried this unique index since the table was created; declaring it
// here is what lets a test on a generated schema reproduce what Postgres enforces.
@Table(name = "org_knowledge_chunks",
        uniqueConstraints = @UniqueConstraint(name = "uq_org_knowledge_chunks_ordinal",
                columnNames = {"source_id", "ordinal"}))
public class OrgKnowledgeChunk extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "source_id", nullable = false)
    private UUID sourceId;

    @Column(nullable = false)
    private int ordinal;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @Column(nullable = false, columnDefinition = "text")
    private String normalized;
}
