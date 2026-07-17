package com.sellerops.attention.reply;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Check;

/**
 * One immutable version of an operator's reply draft for a collected review.
 *
 * <p><b>Append-only:</b> a draft is never updated in place — an edit inserts the next
 * {@code version}, so a prior version can never change and an approval binds immutably to one
 * version's {@link #contentFingerprint}. Consequently this entity has NO {@code updated_at}
 * and does NOT extend {@code BaseEntity}. Same shape and same reason as
 * {@code InquiryReplyDraft}.
 *
 * <p><b>Keyed on the review</b>, following {@code ReviewTriage}: the draft is about the
 * review, not about the signal that surfaced it or the decision that gated it.
 *
 * <p>One {@code body}, not title+comments: an ESM answer has both because ESM's contract has
 * both; a review reply is a single block of text.
 *
 * <p>Stores only the operator-authored text — no customer identity, no order/product
 * identifier, no channel-side id, and no provenance claim. The last one is deliberate: once an
 * operator edits a suggestion the text is theirs, and stamping {@code providerKind=RULE_BASED}
 * on the row would credit the rule engine for sentences a human may have entirely rewritten.
 * The suggestion carries its provenance when it is offered, which is the moment the claim is
 * actually true.
 */
@Getter
@Setter
@Entity
@Table(name = "review_reply_draft",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_review_reply_draft_review_version",
                columnNames = {"review_id", "version"}))
@Check(name = "chk_review_reply_draft_version", constraints = "version > 0")
public class ReviewReplyDraft {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "review_id", nullable = false)
    private UUID reviewId;

    @Column(name = "version", nullable = false)
    private int version;

    @Column(name = "body", nullable = false, columnDefinition = "text")
    private String body;

    @Column(name = "content_fingerprint", nullable = false, length = 64)
    private String contentFingerprint;

    @Column(name = "fingerprint_algorithm", nullable = false, length = 40)
    private String fingerprintAlgorithm;

    /** Actor tag of whoever saved this version (e.g. {@code SELLER:<userId>}) — no PII. */
    @Column(name = "created_by", nullable = false, length = 120)
    private String createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
