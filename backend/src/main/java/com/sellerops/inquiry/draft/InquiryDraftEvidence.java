package com.sellerops.inquiry.draft;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One thing a generated draft was grounded in, bound to the exact draft version.
 *
 * <p>Append-only, like the draft it belongs to: an edit produces a new version with its own evidence
 * rows, so the record of what version 3 was shown cannot be rewritten by what version 4 was shown.
 * The passage TEXT is deliberately not copied — {@code chunkId} points at the seller's own knowledge
 * row, so this table records what was cited rather than becoming a second, diverging copy of it.
 *
 * <p>Carries no customer content and no buyer identity.
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_draft_evidence")
public class InquiryDraftEvidence {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    @Column(name = "draft_version", nullable = false)
    private int draftVersion;

    /** Position in the order the passages were given to the drafter. Stable, so a citation list is. */
    @Column(name = "ordinal", nullable = false)
    private int ordinal;

    /**
     * What KIND of evidence this is — {@code PRODUCT_KNOWLEDGE} today. Kept as a string rather than
     * an enum column so a later kind (a past answer, a channel policy) does not need a migration to
     * be recordable, and so an unknown value read back is displayable rather than a deserialization
     * failure.
     */
    @Column(name = "kind", nullable = false, length = 40)
    private String kind;

    /** The seller's knowledge document. */
    @Column(name = "source_id")
    private UUID sourceId;

    /** The exact passage within it. */
    @Column(name = "chunk_id")
    private UUID chunkId;

    /** The document's own title, as it was at generation time — what a citation line shows. */
    @Column(name = "title", length = 300)
    private String title;

    /** A human-readable provenance string, e.g. {@code product-knowledge/USAGE:데모 운영자}. */
    @Column(name = "locator", length = 200)
    private String locator;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** The only kind this package produces. */
    public static final String KIND_PRODUCT_KNOWLEDGE = "PRODUCT_KNOWLEDGE";

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
