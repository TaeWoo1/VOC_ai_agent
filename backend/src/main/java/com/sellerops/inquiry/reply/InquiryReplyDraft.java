package com.sellerops.inquiry.reply;

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
 * One immutable version of a seller's ESM answer reply-draft for a work item.
 *
 * <p><b>Append-only:</b> a draft is never updated in place — an edit inserts the
 * next {@code version}, so a prior version can never change and (later) an approval
 * can bind immutably to one version's {@link #contentFingerprint}. Consequently
 * this entity has NO {@code updated_at} and does NOT extend {@code BaseEntity}.
 *
 * <p><b>Minimal identity:</b> only {@code org_id} + {@code work_item_id} + {@code
 * version}; the inquiry/proposal are reachable via the work item, so there is no
 * redundant {@code inquiry_id}/{@code proposal_id}. It stores ONLY the seller-owned
 * answer fields — never a token, {@code messageNo}, author, or buyer data.
 * {@code answer_status} is backend-fixed to {@code 2} (the check allows the ESM
 * reply set {@code 1,2}).
 */
@Getter
@Setter
@Entity
@Table(name = "inquiry_reply_draft",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_inquiry_reply_draft_work_item_version",
                columnNames = {"work_item_id", "version"}))
@Check(name = "chk_inquiry_reply_draft_version", constraints = "version > 0")
@Check(name = "chk_inquiry_reply_draft_answer_status", constraints = "answer_status in (1, 2)")
public class InquiryReplyDraft {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    @Column(name = "version", nullable = false)
    private int version;

    /** Backend-fixed to {@code 2} (EsmCsReplyAnswerStatus); the seller never sets it. */
    @Column(name = "answer_status", nullable = false)
    private int answerStatus;

    @Column(name = "title", nullable = false, columnDefinition = "text")
    private String title;

    @Column(name = "comments", nullable = false, columnDefinition = "text")
    private String comments;

    @Column(name = "content_fingerprint", nullable = false, length = 64)
    private String contentFingerprint;

    @Column(name = "fingerprint_algorithm", nullable = false, length = 40)
    private String fingerprintAlgorithm;

    /** System/actor tag of who saved this version (e.g. {@code SELLER:<userId>}) — no PII. */
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
