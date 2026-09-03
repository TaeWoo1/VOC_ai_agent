package com.sellerops.product.library;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One quotable passage of one document.
 *
 * <p><b>Chunks exist for citation, not for indexing.</b> An answer's evidence has to point at the
 * sentence it rested on, and a whole document is not a citation — a seller checking a claim against a
 * 2,000-character policy note is doing the verification the evidence was supposed to do for them.
 *
 * <p>{@code normalized} is stored rather than recomputed on read: scoring against a form derived at
 * query time means the day the normalization rule changes, old passages and new passages are scored
 * by two different rules, and nothing says so.
 */
@Getter
@Setter
@Entity
// The migration has carried this unique index since the table was created; declaring it
// here is what lets a test on a generated schema reproduce what Postgres enforces.
@Table(name = "product_knowledge_chunks",
        uniqueConstraints = @UniqueConstraint(name = "uq_pk_chunks_ordinal",
                columnNames = {"source_id", "ordinal"}))
public class ProductKnowledgeChunk extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    @Column(name = "source_id", nullable = false)
    private UUID sourceId;

    @Column(nullable = false)
    private int ordinal;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @Column(nullable = false, columnDefinition = "text")
    private String normalized;
}
